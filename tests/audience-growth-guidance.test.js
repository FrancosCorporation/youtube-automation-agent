'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { themes } = require('../config/themes.json');
const { NICHE_GUIDANCE, FOLLOW_UP_METRICS, audienceGrowthGuidance } = require('../utils/audience-growth-guidance');

test('all ten configured niches have tailored, non-promissory growth guidance', () => {
  const enabled = themes.filter(theme => theme.enabled);
  assert.equal(enabled.length, 10);
  for (const theme of enabled) {
    const guidance = audienceGrowthGuidance(theme.id);
    assert.ok(NICHE_GUIDANCE[theme.id], `missing niche guidance: ${theme.id}`);
    assert.match(guidance, /primeiros 1–3 segundos/);
    assert.match(guidance, /não peça salvamento\/compartilhamento de forma artificial/);
    assert.match(guidance, /não deduza seguidores, retenção ou causalidade/);
  }
});

test('sensitive niches carry their own factual guardrails and platform metrics stay distinct', () => {
  assert.match(audienceGrowthGuidance('saude'), /não diagnostique, prescreva/);
  assert.match(audienceGrowthGuidance('dinheiro'), /não prometa riqueza/);
  assert.match(audienceGrowthGuidance('misterios'), /não apresente especulação como solução/);
  assert.match(FOLLOW_UP_METRICS.instagram.join(' '), /salvamentos e compartilhamentos/);
  assert.match(FOLLOW_UP_METRICS.youtube.join(' '), /engaged views/);
});
