export function submissionList(sessions, questions, esc) {
  return sessions.map(s => `<details class="item submission"><summary><b>${esc(s.name ? (s.studentId ? `${s.name}｜${s.studentId}` : s.name) : s.anonymousId)}</b> <span class="muted">${s.completedAt ? '完成：'+new Date(s.completedAt).toLocaleString('zh-TW') : '作答中'}</span></summary><div class="submission-body">${s.answers.map(x => `<div><small class="notranslate" translate="no">${esc(questions[x.sentenceId]?.text || '')}</small>${x.audioUrl ? `<audio controls preload="none" src="${esc(x.audioUrl)}"></audio>` : `<p>尚未提交｜已錄製 ${x.attempts} 次</p>`}</div>`).join('')}<button type="button" class="danger trash-submission" data-id="${esc(s.id)}">整份提交移入垃圾桶</button><div class="feedback-slot" data-session="${esc(s.id)}"></div></div></details>`).join('') || '<div class="notice">尚無學生開始作答。</div>';
}
export function bindSubmissions(root, request, reload) {
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
