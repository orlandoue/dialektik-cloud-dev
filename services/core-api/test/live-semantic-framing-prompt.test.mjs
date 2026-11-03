import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LIVE_CLAIM_EXTRACTION_PROMPT,LIVE_PAIR_ASSESSMENT_PROMPT} from '../dist/semantic/live-semantic-production.contract.js';
test('prompts require complete grounded positions and reject cause-effect as a contradiction',()=>{
 assert.match(LIVE_CLAIM_EXTRACTION_PROMPT,/complete standalone sentence/i);
 assert.match(LIVE_CLAIM_EXTRACTION_PROMPT,/do not invent a motive or purpose/i);
 assert.match(LIVE_PAIR_ASSESSMENT_PROMPT,/cause and effect or complementary facts are not by themselves a contradiction/i);
});
