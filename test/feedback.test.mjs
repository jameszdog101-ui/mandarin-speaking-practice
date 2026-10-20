import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFeedback } from '../worker/feedback.mjs';
test('optional grading counts only rated questions and preserves zero as invalid',()=>{
  const data=validateFeedback({questions:{a:{score:4},b:{score:5},c:{score:''}},overall:{score:4.5},scoreMode:'average'},['a','b','c']);
  assert.equal(data.suggestedScore,4.5); assert.equal(data.ratedCount,2);assert.equal(data.questionCount,3);
  assert.throws(()=>validateFeedback({questions:{a:{score:0}}},['a']));
  assert.throws(()=>validateFeedback({questions:{other:{score:4}}},['a']));
  assert.throws(()=>validateFeedback({questions:{a:{score:4}},overall:{score:4.5},scoreMode:'average'},['a']));
  assert.throws(()=>validateFeedback({overall:{score:3.5}},['a']));
  assert.equal(validateFeedback({},['a']).overall.score,null);
});
