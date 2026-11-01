'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { directNarrativeBeat, narrativeEntities, fallbackActionKind } = require('../utils/narrative-direction');
const { buildChapterInputs, buildDeterministicScene, normalizeScene } = require('../utils/narrative-scene-author');
const sentence = (text, extra = {}) => ({ id: 's1', text, startFrame: 100, endFrame: 400, ...extra });

test('transfer moves the named payload between concrete props at the spoken verb', () => {
  const beat = directNarrativeBeat({ sentence: sentence('Uma pessoa envia um e-mail do computador para outro computador.', {
    wordTimings: [{ text: 'envia', startFrame: 151, endFrame: 165 }]
  }) });
  assert.equal(beat.kind, 'transfer');
  assert.equal(beat.subject.visual, 'envelope');
  assert.equal(beat.origin.visual, 'computer');
  assert.equal(beat.destination.visual, 'computer');
  assert.equal(beat.actionFrame, 151);
});
test('same interaction works outside computing without substituting computer icons', () => {
  const beat = directNarrativeBeat({ sentence: sentence('A pessoa entrega uma encomenda na casa.'), previousSentence: { text: 'A mensagem chega ao computador.' } });
  assert.equal(beat.kind, 'transfer');
  assert.equal(beat.subject.visual, 'parcel');
  assert.equal(beat.origin.visual, 'person');
  assert.equal(beat.destination.visual, 'building');
});
test('negative or uncertain transfers do not animate a successful delivery', () => {
  for (const text of ['O computador não envia a mensagem.', 'O computador poderia enviar a mensagem.', 'A pessoa tenta enviar a mensagem.']) {
    assert.notEqual(directNarrativeBeat({ sentence: sentence(text) })?.kind, 'transfer');
  }
  const attempt = directNarrativeBeat({ sentence: sentence('Uma pessoa tenta invadir o computador.') });
  assert.equal(attempt.kind, 'operate');
  assert.equal(attempt.resultAffirmed, false);
});
test('article layout requires identified source and uses no invented publication', () => {
  const cue = sentence('A revista apresenta um artigo sobre mensagens.');
  assert.notEqual(directNarrativeBeat({ sentence: cue })?.kind, 'publication');
  assert.equal(directNarrativeBeat({ sentence: cue, source: { eligible: true, sourceTitle: 'Mensagens', sourceUrl: 'https://example.com/article' } }).kind, 'publication');
});
test('fallback actions depend on meaning, not sentence order', () => {
  assert.equal(fallbackActionKind('A geladeira consome energia.'), 'reveal-part');
  assert.equal(fallbackActionKind('A pessoa envia um arquivo.'), 'travel');
  assert.equal(fallbackActionKind('Não envia um arquivo.'), 'reveal-part');
  assert.equal(fallbackActionKind('Compare o computador e o celular.'), 'compare');
  assert.equal(narrativeEntities('A notícia menciona uma pessoa.')[0].label, 'notícia');
});
test('production author preserves word timing and serializes the shared choreography', () => {
  const cue = sentence('Uma pessoa escreve uma mensagem no computador.', { wordTimings: [{ text: 'escreve', startFrame: 145, endFrame: 160 }] });
  const plan = { title: 'Uma mensagem', fps: 24, source: {}, assets: [], sentences: [cue], chapters: [{ id: 'ch1', title: 'Uma mensagem', kind: 'hook', startFrame: 100, durationInFrames: 300, sentenceIds: ['s1'] }] };
  const input = buildChapterInputs(plan)[0];
  assert.equal(input.narration[0].wordTimings[0].startFrame, 145);
  const raw = buildDeterministicScene(input, plan, cue.text);
  const normalized = normalizeScene(raw, input, plan, cue.text);
  assert.equal(normalized.direction[0].kind, 'operate');
  assert.equal(normalized.direction[0].actionFrame, 145);
});
