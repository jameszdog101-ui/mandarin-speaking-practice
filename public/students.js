export async function studentPortal(app, request, esc, join, history) {
  let account;
  try { account=(await request('/api/student/me')).student; } catch {}
  if (!account) {
    app.innerHTML=`<section class="panel"><h2>學生登入</h2><p>請使用教師提供的帳號與初始密碼。</p><form id="studentLogin"><label>帳號<input name="username" required autocomplete="username"></label><label>密碼<input name="password" type="password" required autocomplete="current-password"></label><p id="studentMessage" role="status"></p><button>登入</button></form><button id="anonymousEntry" class="secondary">免登入匿名作業</button></section>`;
    app.querySelector('#anonymousEntry').onclick=()=>join(true);
    app.querySelector('form').onsubmit=async e=>{e.preventDefault(); try{await request('/api/student/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))}); await studentPortal(app,request,esc,join,history);}catch(error){app.querySelector('#studentMessage').textContent=error.message;}};
    return;
  }
  if(account.mustChangePassword) { passwordForm(app,request,()=>studentPortal(app,request,esc,join,history)); return; }
  app.innerHTML=`<section class="panel wide"><div class="row"><div><h2>我的作業</h2><p>${esc(account.displayName)}｜${esc(account.username)}</p></div><div class="actions"><button id="joinAssignment">輸入作業代碼</button><button id="changePassword" class="secondary">修改密碼</button><button id="studentLogout" class="secondary">登出</button></div></div><div id="studentHistory"></div></section>`;
  app.querySelector('#joinAssignment').onclick=()=>join(false,account);
  app.querySelector('#changePassword').onclick=()=>passwordForm(app,request,()=>studentPortal(app,request,esc,join,history));
  app.querySelector('#studentLogout').onclick=async()=>{await request('/api/student/logout',{method:'POST'}); studentPortal(app,request,esc,join,history);};
  if(history) await history(app.querySelector('#studentHistory'),request,esc);
}
function passwordForm(app,request,done) {
  app.innerHTML='<section class="panel"><h2>設定新密碼</h2><p>首次登入或教師重設後，需要修改密碼才能繼續。</p><form><label>目前／初始密碼<input name="currentPassword" type="password" required autocomplete="current-password"></label><label>新密碼<input name="password" type="password" minlength="8" maxlength="128" required autocomplete="new-password"></label><label>再次輸入新密碼<input name="confirmPassword" type="password" required autocomplete="new-password"></label><p role="status"></p><button>儲存密碼</button></form></section>';
  app.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));try{if(b.password!==b.confirmPassword)throw Error('兩次新密碼不一致');await request('/api/student/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});done();}catch(error){app.querySelector('[role=status]').textContent=error.message;}};
}
export async function manageStudents(app,request,esc,back) {
  app.innerHTML='<section class="panel wide"><button id="back" class="secondary">返回教師工作台</button><h2>學生帳號管理</h2><form id="newStudent"><div class="row"><label>帳號<input name="username" maxlength="80" required autocomplete="off"></label><label>姓名<input name="displayName" maxlength="100" required></label><label>學號（選填）<input name="studentNumber" maxlength="80"></label></div><label>初始密碼<input name="password" type="password" minlength="8" maxlength="128" required autocomplete="new-password"></label><p role="status"></p><button>建立學生帳號</button></form><div id="students"></div></section>';
  app.querySelector('#back').onclick=back;
  app.querySelector('form').onsubmit=async e=>{e.preventDefault();try{await request('/api/teacher/students',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});await manageStudents(app,request,esc,back);}catch(error){app.querySelector('[role=status]').textContent=error.message;}};
  try {
    const data=await request('/api/teacher/students');
    app.querySelector('#students').innerHTML=data.students.map(s=>`<details class="item"><summary>${esc(s.display_name)}｜${esc(s.username)} — ${s.disabled_at?'已停用':s.must_change_password?'待首次修改密碼':'使用中'}</summary><form class="resetStudent" data-id="${esc(s.id)}"><label>重設臨時密碼<input name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label><button>重設密碼</button></form><button class="secondary toggleStudent" data-id="${esc(s.id)}" data-disabled="${!s.disabled_at}">${s.disabled_at?'啟用':'停用'}帳號</button></details>`).join('') || '<p>尚未建立學生帳號。</p>';
    const update=async(id,body)=>{await request(`/api/teacher/students/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await manageStudents(app,request,esc,back);};
    app.querySelectorAll('.resetStudent').forEach(form=>form.onsubmit=async e=>{e.preventDefault();if(!confirm('重設後會登出此學生，並要求下次登入修改密碼。'))return;try{await update(form.dataset.id,Object.fromEntries(new FormData(form)));}catch(error){alert(error.message);}});
    app.querySelectorAll('.toggleStudent').forEach(btn=>btn.onclick=async()=>{try{await update(btn.dataset.id,{disabled:btn.dataset.disabled==='true'});}catch(error){alert(error.message);}});
  } catch(error){app.querySelector('#students').textContent=error.message;}
}
