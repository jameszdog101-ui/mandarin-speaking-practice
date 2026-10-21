export function submissionList(sessions, questions, esc) {
  return sessions.map(s => `<div class="submission-row"><label class="submission-select"><input type="checkbox" value="${esc(s.id)}" aria-label="選取 ${esc(s.name || s.anonymousId)} 的提交"></label><details class="item submission"><summary><b>${esc(s.name ? (s.studentId ? `${s.name}｜${s.studentId}` : s.name) : s.anonymousId)}</b> <span class="muted">${s.completedAt ? '完成：'+new Date(s.completedAt).toLocaleString('zh-TW') : '作答中'}</span></summary><div class="submission-body feedback-slot" data-session="${esc(s.id)}">${s.answers.map((x, i) => `<section class="submission-answer"><small class="notranslate" translate="no">第 ${i + 1} 題｜${esc(questions[x.sentenceId]?.text || '')}</small>${x.audioUrl ? `<audio controls preload="none" src="${esc(x.audioUrl)}"></audio>` : `<p>尚未提交｜已錄製 ${x.attempts} 次</p>`}<div class="question-feedback-mount" data-feedback-key="${esc(x.sentenceId)}"></div></section>`).join('')}<div class="overall-feedback-mount"></div><div class="feedback-actions-mount"></div><button type="button" class="danger trash-submission" data-id="${esc(s.id)}">整份提交移入垃圾桶</button></div></details></div>`).join('') || '<div class="notice">尚無學生開始作答。</div>';
}
export function bindSubmissions(root, request, reload) {
  const checks=[...root.querySelectorAll('.submission-select input')], selectAll=root.querySelector('#selectAllSubmissions'), trashSelected=root.querySelector('#trashSelectedSubmissions');
  const updateSelection=()=>{const count=checks.filter(x=>x.checked).length;if(trashSelected){trashSelected.disabled=!count;trashSelected.textContent=count?`勾選 ${count} 筆移到垃圾桶`:'勾選後移到垃圾桶';}if(selectAll)selectAll.textContent=count===checks.length && count?'取消全選':'勾選全部';};
  checks.forEach(check=>check.onchange=updateSelection);
  if(selectAll)selectAll.onclick=()=>{const allSelected=checks.length && checks.every(x=>x.checked);checks.forEach(x=>x.checked=!allSelected);updateSelection();};
  if(trashSelected)trashSelected.onclick=async()=>{
    const selected=checks.filter(x=>x.checked);
    if(!selected.length)return;
    if(!confirm(`將勾選的 ${selected.length} 筆整份提交移入垃圾桶？保留 30 天，可還原。`))return;
    trashSelected.disabled=true;
    try{await Promise.all(selected.map(x=>request(`/api/teacher/submissions/${x.value}/trash`,{method:'POST'})));await reload();}
    catch(e){alert(e.message);updateSelection();}
  };
  updateSelection();
  root.querySelectorAll('details.submission').forEach(el => el.addEventListener('toggle', () => { if (!el.open) el.querySelectorAll('audio').forEach(audio => audio.pause()); }));
  root.querySelectorAll('.trash-submission').forEach(btn => btn.onclick = async () => {
    const name = btn.closest('details').querySelector('summary').textContent;
    if (!confirm(`將「${name}」這一次整份提交移入垃圾桶？保留 30 天，可還原。`)) return;
    btn.disabled = true;
    try { await request(`/api/teacher/submissions/${btn.dataset.id}/trash`, { method: 'POST' }); await reload(); }
    catch (e) { alert(e.message); btn.disabled = false; }
  });
}
export async function submissionTrash(app, request, esc, back) {
  app.innerHTML = '<section class="panel wide"><button id="back">返回教師工作台</button><h2>學生提交垃圾桶</h2><p>保留 30 天，期限過後永久清除。</p><div id="rows">讀取中…</div></section>';
  app.querySelector('#back').onclick = back;
  try {
    const data = await request('/api/teacher/submissions/trash');
    app.querySelector('#rows').innerHTML = data.submissions.map(s => `<article class="item"><b>${esc(s.title)} — ${esc(s.name || s.anonymous_id)}</b><p>預計清除：${new Date(s.purge_after).toLocaleString('zh-TW')}</p><button data-id="${esc(s.id)}">還原提交</button></article>`).join('') || '<p>垃圾桶目前沒有提交紀錄。</p>';
    app.querySelectorAll('[data-id]').forEach(btn => btn.onclick = async () => { try { await request(`/api/teacher/submissions/${btn.dataset.id}/restore`, { method: 'POST' }); await submissionTrash(app, request, esc, back); } catch(e) { alert(e.message); } });
  } catch(e) { app.querySelector('#rows').textContent = e.message; }
}
