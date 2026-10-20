import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLocalDefinitions } from '../worker/local-dictionary.mjs';
test('localized dictionary only uses the English section and omits examples',()=>{
  const html='<h2 id="fr">法語</h2><ol><li>不要這個</li></ol><h2 id="en">英語</h2><ol><li>公共的<dl><dd>example</dd></dl></li><li>公開的</li></ol><h2>其他語言</h2><ol><li>不要這個</li></ol>';
  assert.deepEqual(extractLocalDefinitions(html,'zh'),['公共的','公開的']);
  assert.deepEqual(extractLocalDefinitions('<h2>英语</h2><p>公共</p><h1>中文</h1><p>其他內容</p>','zh'),['公共']);
  assert.deepEqual(extractLocalDefinitions('<h2>法語</h2><ol><li>中文</li></ol>','zh'),[]);
});
