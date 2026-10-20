import { wavDuration, audioResponse } from './audio.mjs';
export function validateFeedback(input, questionIds) {
  const item = (value={}, overall=false) => {
    const text=String(value.text || ''); if(text.length>5000) throw Error('單則評語最多 5000 字');
    const score=value.score === '' || value.score == null ? null : Number(value.score);
    if(score !== null && (!Number.isFinite(score) || score<1 || score>5 || (!overall && !Number.isInteger(score)))) throw Error('每題分數需為 1–5 整數');
    return {text,score,audioId:value.audioId ? String(value.audioId) : null};
  };
  const result={overall:item(input.overall,true),questions:{},scoreMode:input.scoreMode==='average'?'average':'direct'};
  for(const [qid,value] of Object.entries(input.questions || {})) {
    if(!questionIds.includes(qid)) throw Error('評語題目不屬於這份作業');
    result.questions[qid]=item(value);
  }
  const scores=Object.values(result.questions).map(x=>x.score).filter(x=>x!==null);
  result.ratedCount=scores.length; result.questionCount=questionIds.length;
  result.suggestedScore=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length*100)/100:null;
  if(result.overall.score !== null) {
    if(result.scoreMode==='average' && result.overall.score!==result.suggestedScore) throw Error('題目分數已變更，請重新採用平均建議或改為直接給總分');
    if(result.scoreMode==='direct' && !Number.isInteger(result.overall.score)) throw Error('直接總分需為 1–5 整數');
  }
  return result;
}
export function feedbackAudioIds(data) { return [data?.overall,...Object.values(data?.questions || {})].map(x=>x?.audioId).filter(Boolean); }

export async function feedbackRoutes(req,env,url,h) {
  const {teacher,student,canEdit,response,fail,bodyJson,id}=h;
  const match=/^\/api\/(teacher|student)\/feedback\/([^/]+)(?:\/(audio|publish))?$/.exec(url.pathname);
  const audioMatch=/^\/api\/(teacher|student)\/feedback-audio\/([^/]+)$/.exec(url.pathname);
  if(!match && !audioMatch) return null;
  const role=(match || audioMatch)[1];
  const user=await (role==='teacher'?teacher(req,env):student(req,env));
  if(!user) return fail('請先登入',401);
  let meta;
  if(audioMatch) { meta=await env.DB.prepare('SELECT * FROM feedback_audio WHERE id=?').bind(audioMatch[2]).first(); if(!meta)return fail('找不到錄音',404); }
  const sessionId=meta?.session_id || match[2];
  const session=await env.DB.prepare('SELECT s.*,a.teacher_id FROM sessions s JOIN assignments a ON a.id=s.assignment_id WHERE s.id=? AND s.deleted_at IS NULL AND a.deleted_at IS NULL').bind(sessionId).first();
  if(!session || (role==='teacher'?!canEdit(user,session):session.student_account_id!==user.id)) return fail('找不到提交紀錄',404);
  const existing=await env.DB.prepare('SELECT * FROM feedback WHERE session_id=?').bind(sessionId).first();
  if(audioMatch && req.method==='GET') {
    if(role==='student' && !feedbackAudioIds(JSON.parse(existing?.published_json || '{}')).includes(meta.id)) return fail('找不到已發布錄音',404);
    return audioResponse(req,env.AUDIO,meta);
  }
  if(!match) return fail('路徑不存在',404);
  if(req.method==='GET' && !match[3]) return response(role==='teacher'?{draft:JSON.parse(existing?.draft_json || '{}'),version:existing?.version || 0,publishedAt:existing?.published_at || null}:{feedback:existing?.published_json?JSON.parse(existing.published_json):null,publishedAt:existing?.published_at || null});
  if(role!=='teacher') return fail('無權修改回饋',403);
  if(match[3]==='audio' && req.method==='POST') {
    if(Number(req.headers.get('content-length'))>15*1024*1024)return fail('音檔過大',413);
    const buffer=await req.arrayBuffer();
    if(buffer.byteLength>15*1024*1024)return fail('音檔過大',413);
    try{if(wavDuration(buffer)>180)return fail('錄音評語最多三分鐘');}catch(error){return fail(error.message);}
    const audioId=id('feedback'),key=`feedback/${sessionId}/${audioId}.wav`;
    await env.AUDIO.put(key,buffer,{httpMetadata:{contentType:'audio/wav'}});
    try{await env.DB.prepare('INSERT INTO feedback_audio(id,session_id,r2_key,mime_type,byte_size,created_at) VALUES(?,?,?,?,?,?)').bind(audioId,sessionId,key,'audio/wav',buffer.byteLength,new Date().toISOString()).run();}
    catch(error){await env.AUDIO.delete(key);throw error;}
    return response({audioId},201);
  }
  if(req.method==='PUT' && !match[3]) {
    const b=await bodyJson(req);
    if(b.version!==(existing?.version || 0))return fail('此份批改已在其他頁面更新，請重新載入',409);
    const questions=(await env.DB.prepare('SELECT id FROM sentences WHERE assignment_id=? ORDER BY position').bind(session.assignment_id).all()).results;
    let data;try{data=validateFeedback(b.data || {},questions.map(x=>x.id));}catch(error){return fail(error.message);}
    for(const audioId of feedbackAudioIds(data))if(!await env.DB.prepare('SELECT id FROM feedback_audio WHERE id=? AND session_id=?').bind(audioId,sessionId).first())return fail('錄音不屬於這份提交');
    const result=await env.DB.prepare(`INSERT INTO feedback(session_id,draft_json,version,updated_at) VALUES(?,?,1,?) ON CONFLICT(session_id) DO UPDATE SET draft_json=excluded.draft_json,version=feedback.version+1,updated_at=excluded.updated_at WHERE feedback.version=?`).bind(sessionId,JSON.stringify(data),new Date().toISOString(),b.version).run();
    if(!result.meta.changes)return fail('批改已更新，請重新載入',409);
    return response({version:b.version+1});
  }
  if(match[3]==='publish' && req.method==='POST') {
    const b=await bodyJson(req);
    if(!existing || b.version!==existing.version)return fail('請先儲存最新草稿',409);
    const result=await env.DB.prepare('UPDATE feedback SET published_json=draft_json,published_at=?,version=version+1 WHERE session_id=? AND version=?').bind(new Date().toISOString(),sessionId,b.version).run();
    if(!result.meta.changes)return fail('批改已更新，請重新載入',409);
    return response({ok:true,version:b.version+1});
  }
  return fail('路徑不存在',404);
}

export async function deleteFeedbackAudio(env,sessionIds) {
  for(const sessionId of sessionIds) {
    const rows=(await env.DB.prepare('SELECT r2_key FROM feedback_audio WHERE session_id=?').bind(sessionId).all()).results;
    for(const row of rows)await env.AUDIO.delete(row.r2_key);
  }
}
export async function purgeUnusedFeedbackAudio(env) {
  const rows=(await env.DB.prepare('SELECT fa.*,f.draft_json,f.published_json FROM feedback_audio fa LEFT JOIN feedback f ON f.session_id=fa.session_id WHERE fa.created_at<?').bind(new Date(Date.now()-86400000).toISOString()).all()).results;
  for(const row of rows) {
    const used=[...feedbackAudioIds(JSON.parse(row.draft_json || '{}')),...feedbackAudioIds(JSON.parse(row.published_json || '{}'))];
    if(!used.includes(row.id)){await env.AUDIO.delete(row.r2_key);await env.DB.prepare('DELETE FROM feedback_audio WHERE id=?').bind(row.id).run();}
  }
}
