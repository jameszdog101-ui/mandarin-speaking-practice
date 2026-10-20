import { deleteFeedbackAudio } from './feedback.mjs';
export async function submissionRoutes(req, env, url, { teacher, canEdit, response, fail }) {
  if (!url.pathname.startsWith('/api/teacher/submissions')) return null;
  const t = await teacher(req, env);
  if (!t) return fail('請先登入', 401);
  if (url.pathname === '/api/teacher/submissions/trash' && req.method === 'GET') {
    const rows = await env.DB.prepare(`SELECT s.id,s.name,s.student_id,s.anonymous_id,s.deleted_at,s.purge_after,a.title FROM sessions s JOIN assignments a ON a.id=s.assignment_id WHERE s.deleted_at IS NOT NULL AND a.deleted_at IS NULL AND (?='super_admin' OR a.teacher_id=?) ORDER BY s.deleted_at DESC`).bind(t.role, t.id).all();
    return response({ submissions: rows.results });
  }
  const match = /^\/api\/teacher\/submissions\/([^/]+)\/(trash|restore)$/.exec(url.pathname);
  if (!match || req.method !== 'POST') return fail('路徑不存在', 404);
  const s = await env.DB.prepare('SELECT s.*,a.teacher_id,a.deleted_at assignment_deleted FROM sessions s JOIN assignments a ON a.id=s.assignment_id WHERE s.id=?').bind(match[1]).first();
  if (!s || !canEdit(t, s) || s.assignment_deleted) return fail('找不到提交紀錄', 404);
  if (match[2] === 'restore') {
    if (s.purge_after && s.purge_after <= new Date().toISOString()) return fail('保存期限已過，無法還原', 409);
    await env.DB.prepare('UPDATE sessions SET deleted_at=NULL,purge_after=NULL,deleted_by=NULL WHERE id=?').bind(s.id).run();
  } else if (!s.deleted_at) {
    await env.DB.prepare('UPDATE sessions SET deleted_at=?,purge_after=?,deleted_by=? WHERE id=? AND deleted_at IS NULL').bind(new Date().toISOString(),new Date(Date.now()+30*86400000).toISOString(),t.id,s.id).run();
  }
  return response({ ok: true });
}

export async function purgeSubmissions(env) {
  const rows = (await env.DB.prepare('SELECT id FROM sessions WHERE deleted_at IS NOT NULL AND purge_after<=?').bind(new Date().toISOString()).all()).results;
  for (const s of rows) {
    await deleteFeedbackAudio(env,[s.id]);
    const recordings = (await env.DB.prepare('SELECT r2_key FROM attempts WHERE session_id=?').bind(s.id).all()).results;
    for (const recording of recordings) await env.AUDIO.delete(recording.r2_key);
    await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(s.id).run();
  }
}
