'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { generationFailureCodeFromLog } = require('../utils/generation-errors');

test('generation logs preserve the structured interruption reason for retry policy and diagnostics', () => {
  assert.equal(generationFailureCodeFromLog('FALHA: geração interrompida no_fresh_topic_candidates'), 'no_fresh_topic_candidates');
  assert.equal(generationFailureCodeFromLog('FALHA: geração interrompida source_context_too_short'), 'source_context_too_short');
  assert.equal(generationFailureCodeFromLog('FALHA: geração interrompida source_context_too_few_words'), 'source_context_too_few_words');
  assert.equal(generationFailureCodeFromLog('FALHA: geração interrompida source_url_missing'), 'source_url_missing');
  assert.equal(generationFailureCodeFromLog('FALHA: geração interrompida source_claims_unverified'), 'source_claims_unverified');
  assert.equal(generationFailureCodeFromLog('FALHA: geração interrompida publication_review_unavailable'), 'publication_review_unavailable');
  assert.equal(generationFailureCodeFromLog('FALHA: geração interrompida fonte_indisponivel'), 'fonte_indisponivel');
  assert.equal(generationFailureCodeFromLog('Error: unknown failure'), null);
  assert.equal(generationFailureCodeFromLog(null), null);
});
