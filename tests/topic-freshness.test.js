'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  selectRecentTopicCandidates,
  formatTopicAgeLabel
} = require('../utils/topic-freshness');

test('fresh sources remain preferred over the older fallback window', () => {
  const fresh = { title: 'fresh', ageHours: 12 };
  const fallback = { title: 'older', ageHours: 54 };
  const selected = selectRecentTopicCandidates([fallback, fresh]);
  assert.deepEqual(selected.candidates, [fresh]);
  assert.equal(selected.usedFallback, false);
  assert.equal(selected.maxAgeHours, 36);
});

test('uses clearly aged sources up to one week only when no primary source is available', () => {
  const fallback = { title: 'fallback', ageHours: 138 };
  const selected = selectRecentTopicCandidates([fallback]);
  assert.deepEqual(selected.candidates, [fallback]);
  assert.equal(selected.usedFallback, true);
  assert.equal(selected.maxAgeHours, 168);
});

test('fails closed for stale, future-dated, or invalid candidate ages', () => {
  const selected = selectRecentTopicCandidates([
    { title: 'too old', ageHours: 168.01 },
    { title: 'far future', ageHours: -1.01 },
    { title: 'missing', ageHours: null },
    { title: 'invalid', ageHours: 'unknown' }
  ]);
  assert.deepEqual(selected.candidates, []);
  assert.equal(selected.usedFallback, false);
});

test('labels fallback sources with their approximate age', () => {
  assert.equal(formatTopicAgeLabel(0.4), 'há menos de 1h');
  assert.equal(formatTopicAgeLabel(27.6), 'há 28h');
  assert.equal(formatTopicAgeLabel(Number.NaN), 'data não confirmada');
});
