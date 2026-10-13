const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mandarin-test-'));
process.env.DATA_DIR = temp;
const { createServer } = require('../src/server');
let server, base;
test.before(async () => { server=createServer(); await new Promise(r=>server.listen(0,r)); base=`http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await new Promise(r=>server.close(r)); fs.rmSync(temp,{recursive:true,force:true}); });
async function call(url, options={}) { const r=await fetch(base+url,options); return {status:r.status,body:await r.json()}; }
async function create(maxAttempts=2) { return call('/api/assignments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'測試',maxAttempts,anonymous:true,sentences:[{text:'你好',pinyin:'Nǐ hǎo'}]})}); }

test('教師錄製次數限制為 1–10，預設為 2', async()=>{
  assert.equal((await create()).body.maxAttempts,2);
  assert.equal((await create(0)).status,400);
  assert.equal((await create(11)).status,400);
});
test('設備測試是建立作答階段的必要條件', async()=>{
  const a=(await create()).body;
  const denied=await call('/api/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:a.code,deviceTestPassed:false})});
  assert.equal(denied.status,400);
});
test('後端嚴格執行錄製次數且必須逐題接受', async()=>{
  const a=(await create(1)).body;
  const session=(await call('/api/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:a.code,deviceTestPassed:true})})).body;
  const url=`/api/sessions/${session.sessionId}/sentences/${a.sentences[0].id}/attempts`;
  assert.equal((await call(url,{method:'POST',headers:{'content-type':'audio/webm'},body:Buffer.alloc(200)})).status,201);
  assert.equal((await call(url,{method:'POST',headers:{'content-type':'audio/webm'},body:Buffer.alloc(200)})).status,409);
  assert.equal((await call(`/api/sessions/${session.sessionId}/complete`,{method:'POST'})).status,409);
  assert.equal((await call(`/api/sessions/${session.sessionId}/sentences/${a.sentences[0].id}/accept`,{method:'POST'})).status,200);
  assert.equal((await call(`/api/sessions/${session.sessionId}/complete`,{method:'POST'})).status,200);
});
test('已有學生開始作答後不可修改次數', async()=>{
  const a=(await create()).body;
  await call('/api/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:a.code,deviceTestPassed:true})});
  const result=await call(`/api/assignments/${a.id}`,{method:'PUT',headers:{'content-type':'application/json','x-admin-key':a.adminKey},body:JSON.stringify({maxAttempts:3})});
  assert.equal(result.status,409);
});
