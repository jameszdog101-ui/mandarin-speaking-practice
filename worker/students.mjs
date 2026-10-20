export function studentServices(h) {
  const { response, fail, id, token, hash, passwordHash, cookie, teacher, bodyJson } = h;
  const authCookie = (value, secure, age=604800) => `student_session=${encodeURIComponent(value)}; Path=/; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Max-Age=${age}`;
  const publicStudent = s => ({ id:s.id, username:s.username, displayName:s.display_name, studentNumber:s.student_number, mustChangePassword:!!s.must_change_password });
  async function student(req, env, allowInitial=false) {
    const raw = cookie(req, 'student_session'); if (!raw) return null;
    const s = await env.DB.prepare('SELECT s.* FROM student_logins l JOIN students s ON s.id=l.student_id WHERE l.token_hash=? AND l.expires_at>? AND s.disabled_at IS NULL').bind(await hash(raw), new Date().toISOString()).first();
    return s && (allowInitial || !s.must_change_password) ? s : null;
  }
  async function routes(req, env, url) {
    const path = url.pathname;
    if (path === '/api/student/login' && req.method === 'POST') {
      const b = await bodyJson(req), username = String(b.username || '').trim();
      const key = await hash(`${req.headers.get('cf-connecting-ip') || 'local'}:${username.toLowerCase()}`);
      const limit = await env.DB.prepare('SELECT * FROM student_login_limits WHERE key=?').bind(key).first();
      if (limit && limit.reset_at > Date.now() && limit.failures >= 8) return fail('登入嘗試過多，請 15 分鐘後重試',429);
      const s = await env.DB.prepare('SELECT * FROM students WHERE username=?').bind(username).first();
      if (!s || s.disabled_at || await passwordHash(String(b.password || '').slice(0,256), s.password_salt) !== s.password_hash) {
        await env.DB.prepare('INSERT INTO student_login_limits(key,failures,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN reset_at<=? THEN 1 ELSE failures+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END').bind(key,Date.now()+900000,Date.now(),Date.now()).run();
        return fail('帳號或密碼錯誤，或帳號已停用',401);
      }
      await env.DB.prepare('DELETE FROM student_login_limits WHERE key=?').bind(key).run();
      const value = token();
      await env.DB.prepare('INSERT INTO student_logins(token_hash,student_id,expires_at) VALUES(?,?,?)').bind(await hash(value),s.id,new Date(Date.now()+604800000).toISOString()).run();
      return response({student:publicStudent(s)},200,{'set-cookie':authCookie(value,url.protocol==='https:')});
    }
    if(path === '/api/student/logout' && req.method === 'POST') {
      const raw = cookie(req,'student_session');
      if(raw) await env.DB.prepare('DELETE FROM student_logins WHERE token_hash=?').bind(await hash(raw)).run();
      return response({ok:true},200,{'set-cookie':authCookie('',url.protocol==='https:',0)});
    }
    if(path === '/api/student/me' && req.method === 'GET') {
      const s = await student(req,env,true); return s ? response({student:publicStudent(s)}) : fail('請先登入學生帳號',401);
    }
    if(path === '/api/student/password' && req.method === 'POST') {
      const s = await student(req,env,true); if(!s) return fail('請先登入',401);
      const b=await bodyJson(req), password=String(b.password || '');
      if(password.length<8 || password.length>128) return fail('密碼需為 8–128 個字元');
      if(await passwordHash(String(b.currentPassword || ''),s.password_salt)!==s.password_hash) return fail('目前密碼錯誤',403);
      if(password === b.currentPassword) return fail('新密碼不可與目前密碼相同');
      const salt=token(16),value=token();
      await env.DB.batch([
        env.DB.prepare('UPDATE students SET password_hash=?,password_salt=?,must_change_password=0 WHERE id=?').bind(await passwordHash(password,salt),salt,s.id),
        env.DB.prepare('DELETE FROM student_logins WHERE student_id=?').bind(s.id),
        env.DB.prepare('INSERT INTO student_logins(token_hash,student_id,expires_at) VALUES(?,?,?)').bind(await hash(value),s.id,new Date(Date.now()+604800000).toISOString())
      ]);
      return response({ok:true},200,{'set-cookie':authCookie(value,url.protocol==='https:')});
    }
    if(!path.startsWith('/api/teacher/students')) return null;
    const t=await teacher(req,env); if(!t) return fail('請先登入教師帳號',401);
    if(path === '/api/teacher/students' && req.method === 'GET') {
      const rows = await env.DB.prepare(`SELECT s.id,s.username,s.display_name,s.student_number,s.disabled_at,s.must_change_password FROM students s WHERE ?='super_admin' OR EXISTS(SELECT 1 FROM teacher_students ts WHERE ts.teacher_id=? AND ts.student_id=s.id) ORDER BY s.created_at DESC`).bind(t.role,t.id).all();
      return response({students:rows.results});
    }
    if(path === '/api/teacher/students' && req.method === 'POST') {
      const b=await bodyJson(req), username=String(b.username || '').trim(), name=String(b.displayName || '').trim(), password=String(b.password || '');
      if(!username || username.length>80 || /[\x00-\x1f]/.test(username) || !name || name.length>100 || password.length<8 || password.length>128) return fail('請填寫帳號、姓名及 8–128 字元的初始密碼');
      if(await env.DB.prepare('SELECT id FROM students WHERE username=?').bind(username).first()) return fail('帳號已存在，請使用其他帳號',409);
      const studentId=id('student'),salt=token(16);
      await env.DB.batch([
        env.DB.prepare('INSERT INTO students(id,username,display_name,student_number,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?)').bind(studentId,username,name,String(b.studentNumber || '').slice(0,80),await passwordHash(password,salt),salt,new Date().toISOString()),
        env.DB.prepare('INSERT INTO teacher_students(teacher_id,student_id) VALUES(?,?)').bind(t.id,studentId)
      ]);
      return response({id:studentId},201);
    }
    const match=/^\/api\/teacher\/students\/([^/]+)$/.exec(path);
    if(match && req.method === 'PATCH') {
      const s=await env.DB.prepare(`SELECT s.id FROM students s WHERE s.id=? AND (?='super_admin' OR EXISTS(SELECT 1 FROM teacher_students ts WHERE ts.student_id=s.id AND ts.teacher_id=?))`).bind(match[1],t.role,t.id).first();
      if(!s) return fail('找不到學生帳號',404);
      const b=await bodyJson(req), statements=[];
      if(b.password !== undefined) {
        const password=String(b.password); if(password.length<8 || password.length>128) return fail('密碼需為 8–128 個字元');
        const salt=token(16);
        statements.push(env.DB.prepare('UPDATE students SET password_hash=?,password_salt=?,must_change_password=1 WHERE id=?').bind(await passwordHash(password,salt),salt,s.id));
      }
      if(typeof b.disabled === 'boolean') statements.push(env.DB.prepare('UPDATE students SET disabled_at=? WHERE id=?').bind(b.disabled ? new Date().toISOString() : null,s.id));
      if(!statements.length) return fail('未指定操作');
      statements.push(env.DB.prepare('DELETE FROM student_logins WHERE student_id=?').bind(s.id));
      await env.DB.batch(statements); return response({ok:true});
    }
    return fail('路徑不存在',404);
  }
  return { student, routes };
}
