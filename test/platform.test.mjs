import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { encodeWavMono } from '../public/audio-dsp.js';
import { purgeSubmissions } from '../worker/submissions.mjs';

test('student accounts, ownership, feedback snapshots, ranges and submission trash', {timeout:120000}, async()=>{
  await mkdir('.wrangler/tests',{recursive:true});
  await build({entryPoints:['worker/index.mjs'],outfile:'.wrangler/tests/worker.mjs',bundle:true,format:'esm',platform:'browser',logLevel:'silent'});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.wrangler/tests/worker.mjs',compatibilityDate:'2026-10-13',d1Databases:['DB'],r2Buckets:['AUDIO']}));
  try {
    const db=await mf.getD1Database('DB');
    for(const file of (await readdir('migrations')).filter(x=>x.endsWith('.sql')).sort()) {
      const sql=await readFile(`migrations/${file}`,'utf8');
      for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
    for(const [id,value] of [['t1','teacher-one'],['t2','teacher-two']]) {
      await db.prepare('INSERT INTO teachers(id,email,display_name,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?)').bind(id,`${id}@example.test`,id,'unused','unused',new Date().toISOString()).run();
      await db.prepare('INSERT INTO teacher_sessions(token_hash,teacher_id,expires_at,created_at) VALUES(?,?,?,?)').bind(await sha(value),id,'2099-01-01T00:00:00.000Z',new Date().toISOString()).run();
    }
    const tc='teacher_session=teacher-one',other='teacher_session=teacher-two';
    const call=async(path,{method='GET',cookie,body,headers={}}={})=>{
      const res=await mf.dispatchFetch(`https://test.local${path}`,{method,headers:{...(cookie?{cookie}:{}),...(body && !(body instanceof ArrayBuffer)?{'content-type':'application/json'}:{}),...headers},body:body instanceof ArrayBuffer?body:body===undefined?undefined:JSON.stringify(body)});
      const data=res.headers.get('content-type')?.includes('application/json')?await res.json():null;
      return {res,data};
    };
    let r=await call('/api/teacher/students',{method:'POST',cookie:tc,body:{username:'student-一',displayName:'學生一',studentNumber:'001',password:'initial-1234'}});assert.equal(r.res.status,201);const studentId=r.data.id;
    r=await call('/api/teacher/students',{cookie:other});assert.equal(r.data.students.length,0);
    r=await call(`/api/teacher/students/${studentId}`,{method:'PATCH',cookie:other,body:{password:'hijack-1234'}});assert.equal(r.res.status,404);
    r=await call('/api/student/login',{method:'POST',body:{username:'student-一',password:'initial-1234'}});assert.equal(r.res.status,200);let sc=r.res.headers.get('set-cookie').split(';')[0];assert.equal(r.data.student.mustChangePassword,true);
    assert.equal((await call('/api/student/submissions',{cookie:sc})).res.status,401);
    r=await call('/api/student/password',{method:'POST',cookie:sc,body:{currentPassword:'initial-1234',password:'changed-1234'}});assert.equal(r.res.status,200);sc=r.res.headers.get('set-cookie').split(';')[0];
    await db.prepare("INSERT INTO students(id,username,display_name,password_hash,password_salt,must_change_password,created_at) SELECT 'second','second','第二位學生',password_hash,password_salt,0,created_at FROM students WHERE id=?").bind(studentId).run();
    r=await call('/api/student/login',{method:'POST',body:{username:'second',password:'changed-1234'}});assert.equal(r.res.status,200);const secondCookie=r.res.headers.get('set-cookie').split(';')[0];
    await db.prepare('INSERT INTO assignments(id,code,title,admin_key_hash,teacher_id,identity_mode,created_at) VALUES(?,?,?,?,?,?,?)').bind('assignment','ABCDEF','Test','unused','t1','name_only',new Date().toISOString()).run();
    for(const [id,position]of[['q1',0],['q2',1]])await db.prepare('INSERT INTO sentences(id,assignment_id,position,text,pinyin,max_attempts) VALUES(?,?,?,?,?,?)').bind(id,'assignment',position,'Hello world','',2).run();
    r=await call('/api/sessions',{method:'POST',body:{code:'ABCDEF',deviceTestPassed:true}});assert.equal(r.res.status,400);
    r=await call('/api/sessions',{method:'POST',body:{code:'ABCDEF',deviceTestPassed:true,name:'訪客姓名'}});assert.equal(r.res.status,201);
    const guestId=r.data.sessionId,guestToken=r.data.sessionToken;
    let guest=await db.prepare('SELECT name,student_id,student_account_id FROM sessions WHERE id=?').bind(guestId).first();
    assert.equal(guest.name,'訪客姓名');assert.equal(guest.student_id,null);assert.equal(guest.student_account_id,null);
    const guestWav=encodeWavMono(new Float32Array(32000),32000);
    r=await call(`/api/sessions/${guestId}/sentences/q1/attempts`,{method:'POST',headers:{'x-session-token':guestToken,'content-type':'audio/wav'},body:guestWav});assert.equal(r.res.status,201);
    assert.equal((await call(`/api/sessions/${guestId}/sentences/q1/accept`,{method:'POST'})).res.status,404);
    await db.prepare("UPDATE assignments SET identity_mode='full' WHERE id='assignment'").run();
    r=await call('/api/sessions',{method:'POST',body:{code:'ABCDEF',deviceTestPassed:true,name:'訪客姓名'}});assert.equal(r.res.status,400);
    r=await call('/api/sessions',{method:'POST',cookie:sc,body:{guest:true,code:'ABCDEF',deviceTestPassed:true,name:'另一訪客',studentId:'G001'}});assert.equal(r.res.status,201);
    guest=await db.prepare('SELECT name,student_id,student_account_id FROM sessions WHERE id=?').bind(r.data.sessionId).first();
    assert.equal(guest.name,'另一訪客');assert.equal(guest.student_id,'G001');assert.equal(guest.student_account_id,null);
    await db.prepare("UPDATE assignments SET identity_mode='anonymous' WHERE id='assignment'").run();
    r=await call('/api/sessions',{method:'POST',body:{guest:true,code:'ABCDEF',deviceTestPassed:true}});assert.equal(r.res.status,201);
    guest=await db.prepare('SELECT name,student_id,student_account_id,anonymous_id FROM sessions WHERE id=?').bind(r.data.sessionId).first();
    assert.equal(guest.name,null);assert.equal(guest.student_id,null);assert.equal(guest.student_account_id,null);assert.ok(guest.anonymous_id);
    await db.prepare("UPDATE assignments SET identity_mode='name_only' WHERE id='assignment'").run();
    r=await call('/api/sessions',{method:'POST',cookie:sc,body:{code:'ABCDEF',deviceTestPassed:true}});assert.equal(r.res.status,201);const sid=r.data.sessionId,st=r.data.sessionToken;
    const wav=encodeWavMono(new Float32Array(32000),32000);
    r=await call(`/api/sessions/${sid}/sentences/q1/attempts`,{method:'POST',cookie:sc,headers:{'x-session-token':st,'content-type':'audio/wav'},body:encodeWavMono(new Float32Array(32000*181),32000)});assert.equal(r.res.status,400);
    assert.equal((await call(`/api/sessions/${sid}/sentences/q1/attempts`,{method:'POST',cookie:secondCookie,headers:{'x-session-token':st,'content-type':'audio/wav'},body:wav})).res.status,404);
    for(const q of ['q1','q2']) {
      r=await call(`/api/sessions/${sid}/sentences/${q}/attempts`,{method:'POST',cookie:sc,headers:{'x-session-token':st,'content-type':'audio/wav'},body:wav});assert.equal(r.res.status,201,JSON.stringify(r.data));
      r=await call(`/api/sessions/${sid}/sentences/${q}/accept`,{method:'POST',cookie:sc,headers:{'x-session-token':st}});assert.equal(r.res.status,200);
    }
    assert.equal((await call(`/api/sessions/${sid}/complete`,{method:'POST',cookie:sc,headers:{'x-session-token':st}})).res.status,200);
    r=await call('/api/student/submissions',{cookie:sc});assert.equal(r.data.submissions.length,1);
    r=await call(`/api/student/submissions/${sid}`,{cookie:sc});const audioUrl=r.data.answers[0].audioUrl;
    r=await call(audioUrl,{cookie:sc,headers:{range:'bytes=0-43'}});assert.equal(r.res.status,206);assert.equal((await r.res.arrayBuffer()).byteLength,44);
    assert.equal((await call(audioUrl)).res.status,401);
    assert.equal((await call(audioUrl,{cookie:secondCookie})).res.status,404);
    assert.equal((await call(`/api/student/submissions/${sid}`,{cookie:secondCookie})).res.status,404);
    r=await call(`/api/teacher/feedback/${sid}/audio`,{method:'POST',cookie:tc,body:wav,headers:{'content-type':'audio/wav'}});assert.equal(r.res.status,201);const feedbackAudio=r.data.audioId;
    assert.equal((await call(`/api/student/feedback-audio/${feedbackAudio}`,{cookie:sc})).res.status,404);
    const payload={overall:{text:'總評',score:4},questions:{q1:{text:'單題評語',score:3},q2:{score:5}},scoreMode:'average'};
    payload.overall.audioId=feedbackAudio;
    r=await call(`/api/teacher/feedback/${sid}`,{method:'PUT',cookie:tc,body:{version:0,data:payload}});assert.equal(r.res.status,200,JSON.stringify(r.data));
    r=await call(`/api/student/feedback/${sid}`,{cookie:sc});assert.equal(r.data.feedback,null);
    assert.equal((await call(`/api/teacher/feedback/${sid}`,{cookie:other})).res.status,404);
    r=await call(`/api/teacher/feedback/${sid}/publish`,{method:'POST',cookie:tc,body:{version:1}});assert.equal(r.res.status,200);
    assert.equal((await call(`/api/student/feedback-audio/${feedbackAudio}`,{cookie:sc})).res.status,200);
    assert.equal((await call(`/api/student/feedback-audio/${feedbackAudio}`,{cookie:secondCookie})).res.status,404);
    payload.overall.text='未發布草稿';r=await call(`/api/teacher/feedback/${sid}`,{method:'PUT',cookie:tc,body:{version:2,data:payload}});assert.equal(r.res.status,200);
    r=await call(`/api/student/feedback/${sid}`,{cookie:sc});assert.equal(r.data.feedback.overall.text,'總評');
    r=await call(`/api/teacher/submissions/${sid}/trash`,{method:'POST',cookie:tc});assert.equal(r.res.status,200);
    assert.equal((await call('/api/student/submissions',{cookie:sc})).data.submissions.length,0);
    assert.equal((await call(audioUrl,{cookie:sc})).res.status,404);
    assert.equal((await call(`/api/student/feedback/${sid}`,{cookie:sc})).res.status,404);
    assert.equal((await call(`/api/student/feedback-audio/${feedbackAudio}`,{cookie:sc})).res.status,404);
    r=await call(`/api/teacher/submissions/${sid}/restore`,{method:'POST',cookie:tc});assert.equal(r.res.status,200);
    assert.equal((await call('/api/student/submissions',{cookie:sc})).data.submissions.length,1);
    await db.prepare("UPDATE assignments SET identity_mode='anonymous' WHERE id='assignment'").run();
    r=await call('/api/sessions',{method:'POST',cookie:sc,body:{code:'ABCDEF',deviceTestPassed:true}});assert.equal(r.res.status,201);
    assert.equal((await db.prepare('SELECT student_account_id FROM sessions WHERE id=?').bind(r.data.sessionId).first()).student_account_id,null);
    await call(`/api/teacher/submissions/${sid}/trash`,{method:'POST',cookie:tc});
    await db.prepare("UPDATE sessions SET purge_after='2000-01-01' WHERE id=?").bind(sid).run();
    assert.equal((await call(`/api/teacher/submissions/${sid}/restore`,{method:'POST',cookie:tc})).res.status,409);
    const feedbackObject=await db.prepare('SELECT r2_key FROM feedback_audio WHERE id=?').bind(feedbackAudio).first();
    const bucket=await mf.getR2Bucket('AUDIO');
    await purgeSubmissions({DB:db,AUDIO:bucket});
    assert.equal(await db.prepare('SELECT id FROM sessions WHERE id=?').bind(sid).first(),null);
    assert.equal(await bucket.get(feedbackObject.r2_key),null);
    r=await call(`/api/teacher/students/${studentId}`,{method:'PATCH',cookie:tc,body:{disabled:true}});assert.equal(r.res.status,200);
    assert.equal((await call('/api/student/me',{cookie:sc})).res.status,401);
  } finally {await mf.dispose();}
});
