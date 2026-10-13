import test from 'node:test';
import assert from 'node:assert/strict';
import { validMaxAttempts, publicAssignment } from '../worker/index.mjs';

test('Cloudflare Worker validates attempt limits',()=>{
  assert.equal(validMaxAttempts(1),true); assert.equal(validMaxAttempts(10),true);
  assert.equal(validMaxAttempts(0),false); assert.equal(validMaxAttempts(11),false); assert.equal(validMaxAttempts(2.5),false);
});
test('public assignment never exposes admin hash',()=>{
  const result=publicAssignment({id:'a',code:'ABC123',title:'T',instructions:'',anonymous:1,max_attempts:2,admin_key_hash:'secret'},[{id:'q',text:'你好',pinyin:'Nǐ hǎo'}]);
  assert.equal(result.admin_key_hash,undefined); assert.equal(result.anonymous,true); assert.equal(result.sentences.length,1);
});
