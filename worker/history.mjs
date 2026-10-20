import { audioResponse } from './audio.mjs';
export async function historyRoutes(req,env,url,{student,response,fail}) {
  if(!url.pathname.startsWith('/api/student/submissions') && !url.pathname.startsWith('/api/student/audio/')) return null;
  const account=await student(req,env); if(!account) return fail('請先登入並修改初始密碼',401);
  if(req.method!=='GET') return fail('路徑不存在',404);
  if(url.pathname==='/api/student/submissions') {
    const rows=await env.DB.prepare(`SELECT s.id,s.started_at,s.completed_at,a.title,t.display_name teacher_name,(SELECT published_at FROM feedback WHERE session_id=s.id) published_at FROM sessions s JOIN assignments a ON a.id=s.assignment_id LEFT JOIN teachers t ON t.id=a.teacher_id WHERE s.student_account_id=? AND s.deleted_at IS NULL AND a.deleted_at IS NULL ORDER BY s.started_at DESC`).bind(account.id).all();
    return response({submissions:rows.results});
  }
  const match=/^\/api\/student\/submissions\/([^/]+)$/.exec(url.pathname);
  if(match) {
    const s=await env.DB.prepare('SELECT s.* FROM sessions s JOIN assignments a ON a.id=s.assignment_id WHERE s.id=? AND s.student_account_id=? AND s.deleted_at IS NULL AND a.deleted_at IS NULL').bind(match[1],account.id).first();
    if(!s) return fail('找不到提交紀錄',404);
    const rows=await env.DB.prepare('SELECT se.id,se.text,se.pinyin,at.id audio_id FROM answers an JOIN sentences se ON se.id=an.sentence_id LEFT JOIN attempts at ON at.session_id=an.session_id AND at.sentence_id=an.sentence_id AND at.attempt_number=an.accepted_attempt AND at.deleted_at IS NULL WHERE an.session_id=? ORDER BY se.position').bind(s.id).all();
    return response({answers:rows.results.map(x=>({...x,audioUrl:x.audio_id?`/api/student/audio/${x.audio_id}`:null}))});
  }
  const audio=/^\/api\/student\/audio\/([^/]+)$/.exec(url.pathname);
  if(audio) {
    const meta=await env.DB.prepare(`SELECT at.* FROM attempts at JOIN sessions s ON s.id=at.session_id JOIN assignments a ON a.id=s.assignment_id JOIN answers an ON an.session_id=s.id AND an.sentence_id=at.sentence_id AND an.accepted_attempt=at.attempt_number WHERE at.id=? AND s.student_account_id=? AND s.deleted_at IS NULL AND at.deleted_at IS NULL AND a.deleted_at IS NULL`).bind(audio[1],account.id).first();
    if(!meta) return fail('找不到錄音',404); return audioResponse(req,env.AUDIO,meta);
  }
  return fail('路徑不存在',404);
}
