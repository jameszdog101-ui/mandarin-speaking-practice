const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('./store');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 3000);
const MAX_AUDIO = 15 * 1024 * 1024;
const store = new Store(DATA);

function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { 'Content-Length': payload.length, ...headers });
  res.end(payload);
}
function json(res, status, body) { send(res, status, body, { 'Content-Type': 'application/json; charset=utf-8' }); }
function error(res, status, message) { json(res, status, { error: message }); }
async function readBody(req, limit = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('資料過大'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function readJson(req) {
  const raw = await readBody(req);
  try { return raw.length ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('JSON 格式錯誤'), { status: 400 }); }
}
function code() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  do { value = Array.from(crypto.randomBytes(6), (b) => chars[b % chars.length]).join(''); }
  while (store.assignmentByCode(value));
  return value;
}
function admin(req, assignment) {
  return req.headers['x-admin-key'] === assignment.adminKey;
}
function mimeExt(type = '') {
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('mp4')) return 'm4a';
  if (type.includes('mpeg')) return 'mp3';
  return 'webm';
}

async function api(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/assignments') {
    const body = await readJson(req);
    const maxAttempts = Number(body.maxAttempts ?? 2);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) return error(res, 400, '錄製次數必須為 1–10 的整數');
    if (!String(body.title || '').trim()) return error(res, 400, '請輸入作業名稱');
    if (!Array.isArray(body.sentences) || !body.sentences.length) return error(res, 400, '至少需要一個句子');
    const sentences = body.sentences.map((s) => ({ id: store.id('q'), text: String(s.text || '').trim(), pinyin: String(s.pinyin || '').trim() }));
    if (sentences.some((s) => !s.text)) return error(res, 400, '句子不可空白');
    const assignment = { id: store.id('a'), adminKey: crypto.randomBytes(18).toString('base64url'), code: code(),
      title: String(body.title).trim(), instructions: String(body.instructions || ''), anonymous: Boolean(body.anonymous),
      maxAttempts, sentences, createdAt: new Date().toISOString() };
    store.db.assignments.push(assignment); store.save();
    return json(res, 201, { ...store.publicAssignment(assignment), adminKey: assignment.adminKey });
  }

  let match = url.pathname.match(/^\/api\/assignments\/code\/([A-Z0-9]+)$/i);
  if (req.method === 'GET' && match) {
    const a = store.assignmentByCode(match[1]);
    return a ? json(res, 200, store.publicAssignment(a)) : error(res, 404, '找不到課程代碼');
  }

  match = url.pathname.match(/^\/api\/assignments\/([^/]+)$/);
  if (req.method === 'PUT' && match) {
    const a = store.db.assignments.find((x) => x.id === match[1]);
    if (!a) return error(res, 404, '找不到作業');
    if (!admin(req, a)) return error(res, 403, '管理金鑰錯誤');
    if (store.db.sessions.some((s) => s.assignmentId === a.id)) return error(res, 409, '已有學生開始作答，無法修改');
    const body = await readJson(req); const value = Number(body.maxAttempts);
    if (!Number.isInteger(value) || value < 1 || value > 10) return error(res, 400, '錄製次數必須為 1–10 的整數');
    a.maxAttempts = value; store.save(); return json(res, 200, store.publicAssignment(a));
  }

  match = url.pathname.match(/^\/api\/assignments\/([^/]+)\/submissions$/);
  if (req.method === 'GET' && match) {
    const a = store.db.assignments.find((x) => x.id === match[1]);
    if (!a) return error(res, 404, '找不到作業');
    if (!admin(req, a)) return error(res, 403, '管理金鑰錯誤');
    const sessions = store.db.sessions.filter((s) => s.assignmentId === a.id).map((s) => ({
      id: s.id, name: s.name, studentId: s.studentId, anonymousId: s.anonymousId,
      startedAt: s.startedAt, completedAt: s.completedAt,
      answers: s.answers.map((x) => { const chosen=x.attempts.find((t)=>t.number===x.acceptedAttempt); return {
        sentenceId: x.sentenceId, attempts: x.attempts.length, acceptedAttempt: x.acceptedAttempt,
        audioUrl: chosen ? `/api/audio/${chosen.filename}?assignment=${a.id}&key=${encodeURIComponent(a.adminKey)}` : null
      }; })
    }));
    return json(res, 200, { assignment: store.publicAssignment(a), sessions });
  }

  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    const body = await readJson(req); const a = store.assignmentByCode(body.code);
    if (!a) return error(res, 404, '找不到課程代碼');
    if (body.deviceTestPassed !== true) return error(res, 400, '必須先完成設備測試');
    if (!a.anonymous && (!String(body.name || '').trim() || !String(body.studentId || '').trim())) return error(res, 400, '請填寫姓名與學號');
    const s = { id: store.id('s'), assignmentId: a.id, name: a.anonymous ? null : String(body.name).trim(),
      studentId: a.anonymous ? null : String(body.studentId).trim(), anonymousId: a.anonymous ? `匿名-${crypto.randomBytes(3).toString('hex').toUpperCase()}` : null,
      deviceTestConfirmedAt: new Date().toISOString(), startedAt: new Date().toISOString(), completedAt: null,
      answers: a.sentences.map((q) => ({ sentenceId: q.id, attempts: [], acceptedAttempt: null })) };
    store.db.sessions.push(s); store.save(); return json(res, 201, { sessionId: s.id, assignment: store.publicAssignment(a), anonymousId: s.anonymousId });
  }

  match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/sentences\/([^/]+)\/attempts$/);
  if (req.method === 'POST' && match) {
    const s = store.db.sessions.find((x) => x.id === match[1]);
    if (!s || s.completedAt) return error(res, 404, '作答階段不存在或已完成');
    const a = store.db.assignments.find((x) => x.id === s.assignmentId);
    const answer = s.answers.find((x) => x.sentenceId === match[2]);
    if (!answer) return error(res, 404, '找不到題目');
    const currentIndex = s.answers.findIndex((x) => x.sentenceId === match[2]);
    if (s.answers.slice(0, currentIndex).some((x) => !x.acceptedAttempt)) return error(res, 409, '必須依序完成題目');
    if (answer.acceptedAttempt) return error(res, 409, '題目已完成');
    if (answer.attempts.length >= a.maxAttempts) return error(res, 409, '已達錄製次數上限');
    const audio = await readBody(req, MAX_AUDIO);
    if (audio.length < 100) return error(res, 400, '未收到有效音訊資料');
    // The body read yields to other requests, so re-check the mutable state before committing.
    if (answer.acceptedAttempt) return error(res, 409, '題目已完成');
    if (answer.attempts.length >= a.maxAttempts) return error(res, 409, '已達錄製次數上限');
    const attempt = answer.attempts.length + 1;
    const filename = `${s.id}_${answer.sentenceId}_${attempt}.${mimeExt(req.headers['content-type'])}`;
    fs.writeFileSync(path.join(store.audioRoot, filename), audio);
    answer.attempts.push({ number: attempt, filename, mime: req.headers['content-type'] || 'audio/webm', size: audio.length, createdAt: new Date().toISOString() });
    store.save(); return json(res, 201, { attempt, maxAttempts: a.maxAttempts, remaining: a.maxAttempts - attempt });
  }

  match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/sentences\/([^/]+)\/accept$/);
  if (req.method === 'POST' && match) {
    const s = store.db.sessions.find((x) => x.id === match[1]);
    if (!s || s.completedAt) return error(res, 404, '作答階段不存在或已完成');
    const answer = s.answers.find((x) => x.sentenceId === match[2]);
    if (!answer || !answer.attempts.length) return error(res, 400, '尚無成功儲存的錄音');
    if (answer.acceptedAttempt) return error(res, 409, '題目已完成');
    answer.acceptedAttempt = answer.attempts.at(-1).number; store.save();
    return json(res, 200, { acceptedAttempt: answer.acceptedAttempt });
  }

  match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/complete$/);
  if (req.method === 'POST' && match) {
    const s = store.db.sessions.find((x) => x.id === match[1]);
    if (!s) return error(res, 404, '找不到作答階段');
    if (s.answers.some((x) => !x.acceptedAttempt)) return error(res, 409, '仍有題目尚未完成');
    s.completedAt ||= new Date().toISOString(); store.save();
    return json(res, 200, { completedAt: s.completedAt, name: s.name, studentId: s.studentId, anonymousId: s.anonymousId });
  }

  match = url.pathname.match(/^\/api\/audio\/([^/]+)$/);
  if (req.method === 'GET' && match) {
    const meta = store.db.sessions.flatMap((s) => s.answers.flatMap((a) => a.attempts)).find((x) => x.filename === match[1]);
    if (!meta) return error(res, 404, '找不到音檔');
    const assignment = store.db.assignments.find((a) => a.id === url.searchParams.get('assignment'));
    if (!assignment || url.searchParams.get('key') !== assignment.adminKey) return error(res, 403, '無權存取音檔');
    const file = path.join(store.audioRoot, path.basename(meta.filename));
    return send(res, 200, fs.readFileSync(file), { 'Content-Type': meta.mime, 'Content-Disposition': 'inline' });
  }
  return error(res, 404, 'API 路徑不存在');
}

function staticFile(res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(PUBLIC, requested);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
  return send(res, 200, fs.readFileSync(file), { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) await api(req, res, url); else staticFile(res, url.pathname);
    } catch (err) { console.error(err); if (!res.headersSent) error(res, err.status || 500, err.status ? err.message : '伺服器錯誤'); }
  });
}
if (require.main === module) createServer().listen(PORT, () => console.log(`華語口說平台：http://localhost:${PORT}`));
module.exports = { createServer };
