'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTimedNarration, narrativePlanInputSha256, sha256, stableJson, validateNarrativeEpisodePlan
} = require('../utils/narrative-episode-plan');

function basePlan() {
  const contextHash = 'a'.repeat(64);
  const plan = {
    schemaVersion: 'pulso.narrative-episode/v2', jobId: 'narrative-test-0001', themeId: 'ia',
    title: 'Plano de teste', fps: 24, durationMs: 2000, durationInFrames: 48, seed: 7,
    scriptSha256: 'b'.repeat(64), narrationSha256: 'c'.repeat(64),
    speechEnvelope: { stepMs: 10, levels: Array(200).fill(0.35), gateDb: -42, fullOpenDb: -12, sampleRate: 16000 },
    source: { eligible: true, contextHash, contextChars: 400, reviewStatus: 'approved', reviewSourceHash: contextHash },
    chapters: [{ id: 'hook', kind: 'hook', title: 'Abertura', startFrame: 0, durationInFrames: 48,
      sentenceIds: ['hook-sentence-1', 'hook-sentence-2'] }],
    sentences: [
      { id: 'hook-sentence-1', groupId: 'hook', startFrame: 0, endFrame: 24, text: 'O sinal parte.' },
      { id: 'hook-sentence-2', groupId: 'hook', startFrame: 24, endFrame: 48, text: 'A resposta chega.' }
    ],
    claims: [
      { id: 'claim-hook-sentence-1', sentenceId: 'hook-sentence-1', text: 'O sinal parte.', sourceContextHash: contextHash },
      { id: 'claim-hook-sentence-2', sentenceId: 'hook-sentence-2', text: 'A resposta chega.', sourceContextHash: contextHash }
    ], assets: [], scenes: []
  };
  plan.speechEnvelopeSha256 = sha256(Buffer.from(stableJson(plan.speechEnvelope)));
  plan.inputSha256 = narrativePlanInputSha256(plan);
  return plan;
}

test('buildTimedNarration mantém texto, capítulos e limites de palavras do TTS', () => {
  const script = {
    title: 'Teste', hook: { text: 'Olá.' },
    mainContent: { sections: [{ title: 'Parte', content: 'Vamos agora.' }] },
    conclusion: { finalThought: 'Até logo.' }
  };
  const timing = (text, audioOffsetMs) => ({ audioOffsetMs, durationMs: 500, sentences: [{
    text, startMs: 0, endMs: 420, words: text.split(/\s+/),
    wordTimes: text.split(/\s+/).map((_, index) => index * 90),
    wordEndTimes: text.split(/\s+/).map((_, index) => index * 90 + 70)
  }] });
  const result = buildTimedNarration(script, [timing('Olá.', 0), timing('Vamos agora.', 500), timing('Até logo.', 1000)], 24, 1500);
  assert.equal(result.chapters.length, 3);
  assert.equal(result.sentences.length, 3);
  assert.equal(result.sentences[1].text, 'Vamos agora.');
  assert.equal(result.sentences[1].wordTimings.length, 2);
  assert.ok(result.sentences[1].wordTimings[0].startFrame < result.sentences[1].wordTimings[1].startFrame);
  assert.throws(() => buildTimedNarration(script, [timing('Outra frase.', 0), timing('Vamos agora.', 500), timing('Até logo.', 1000)], 24, 1500), /não correspondem ao roteiro/);
});

test('validador exige que cada frase pertença exatamente ao capítulo declarado', () => {
  const plan = basePlan();
  plan.chapters[0].sentenceIds.pop();
  plan.inputSha256 = narrativePlanInputSha256(plan);
  const result = validateNarrativeEpisodePlan(plan);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('sentence:hook-sentence-2:chapter_coverage'));
});

test('validador rejeita imagem vinculada à frase errada, mesmo com plano recalculado', () => {
  const { narrativeBeatSha256 } = require('../utils/scene-image-prompt');
  const plan = basePlan();
  for (const sentence of plan.sentences) sentence.groupIndex = 0;
  plan.assets.push({ id: 'art-1', groupIndex: 0, managedPath: 'data/images/fixture.png', sha256: 'd'.repeat(64),
    illustrative: true, beatSha256: narrativeBeatSha256(plan.sentences[0].text), sentenceId: plan.sentences[1].id });
  plan.inputSha256 = narrativePlanInputSha256(plan);
  assert.ok(validateNarrativeEpisodePlan(plan).errors.includes('asset:art-1:sentence'));
  plan.assets[0].sentenceId = plan.sentences[0].id;
  plan.inputSha256 = narrativePlanInputSha256(plan);
  assert.ok(!validateNarrativeEpisodePlan(plan).errors.includes('asset:art-1:sentence'));
});

test('quantização aceita um quadro compartilhado entre palavras consecutivas, mas rejeita sobreposição maior', () => {
  const script = { title: 'Teste', hook: 'Olá mundo.' };
  const timings = [{ audioOffsetMs: 0, durationMs: 400, sentences: [{ text: 'Olá mundo.', startMs: 0, endMs: 220,
    words: ['Olá', 'mundo.'], wordTimes: [0, 101], wordEndTimes: [101, 220] }] }];
  const timed = buildTimedNarration(script, timings, 24, 2000);
  const [first, second] = timed.sentences[0].wordTimings;
  assert.equal(first.endFrame - second.startFrame, 1);
  const plan = basePlan();
  plan.sentences[0].wordTimings = timed.sentences[0].wordTimings;
  plan.inputSha256 = narrativePlanInputSha256(plan);
  assert.ok(!validateNarrativeEpisodePlan(plan).errors.includes('sentence:hook-sentence-1:word_timing'));
  plan.sentences[0].wordTimings[1].startFrame = 0;
  plan.inputSha256 = narrativePlanInputSha256(plan);
  assert.ok(validateNarrativeEpisodePlan(plan).errors.includes('sentence:hook-sentence-1:word_timing'));
});

test('seções longas preservam toda a narração e ainda rejeitam texto divergente', () => {
  const first = `${'Uma informação verificada '.repeat(20)}foi publicada.`;
  const second = `${'Outro dado da mesma fonte '.repeat(20)}foi confirmado.`;
  const content = `${first} ${second}`;
  assert.ok(content.length > 500);
  const script = { title: 'Teste', mainContent: { sections: [{ title: 'Seção', content }] } };
  const timings = [{ audioOffsetMs: 0, durationMs: 2000, sentences: [
    { text: first, startMs: 0, endMs: 900 }, { text: second, startMs: 1000, endMs: 1900 }
  ] }];
  const result = buildTimedNarration(script, timings, 24, 2000);
  assert.equal(result.sentences.map(sentence => sentence.text).join(' '), content);
  timings[0].sentences[1].text = 'Informação diferente.';
  assert.throws(() => buildTimedNarration(script, timings, 24, 2000), /não correspondem ao roteiro/);
});
