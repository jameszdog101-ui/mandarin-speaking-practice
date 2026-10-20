export async function showStudentFeedback(detail,request,esc) {
  const result=await request(`/api/student/feedback/${detail.dataset.id}`);
  detail.querySelector('.review-status').textContent=result.feedback?'｜已批改':'｜待批改';
  const overall=detail.querySelector('.overall-feedback');
  if(!result.feedback){overall.textContent='教師尚未發布回饋。';return;}
  const render=item=>!item?'':`${item.score!=null?`<p><b>分數：${esc(String(item.score))} / 5</b></p>`:''}${item.text?`<p class="feedback-comment">${esc(item.text)}</p>`:''}${item.audioId?`<audio controls preload="none" src="/api/student/feedback-audio/${esc(item.audioId)}"></audio>`:''}`;
  detail.querySelectorAll('[data-feedback-question]').forEach(slot=>{const content=render(result.feedback.questions?.[slot.dataset.feedbackQuestion]);slot.innerHTML=content?`<h4>本題教師回饋</h4>${content}`:'';});
  const content=render(result.feedback.overall);
  overall.innerHTML=`<h3>整份作業總評</h3>${content || '<p>教師已完成批改，未提供總評或總分。</p>'}${result.feedback.scoreMode==='average' && result.feedback.overall?.score!=null?`<p class="muted">採用 ${result.feedback.ratedCount}／${result.feedback.questionCount} 題的平均分數</p>`:''}<small>發布時間：${new Date(result.publishedAt).toLocaleString('zh-TW')}</small>`;
}
