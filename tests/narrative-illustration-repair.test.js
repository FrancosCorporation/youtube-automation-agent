'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { concreteCandidates, repairNarrativeIllustrations } = require('../utils/narrative-illustration-repair');
const { auditNarrativeIllustration, assertNarrativeIllustration, authorWithIllustrationRepair } = require('../utils/narrative-illustration-audit');
const { narrativePlanInputSha256, sha256, stableJson, validateNarrativeEpisodePlan } = require('../utils/narrative-episode-plan');

function fixture() {
  const sourceHash = 'a'.repeat(64);
  const sentences = [
    { id: 's1', groupId: 'hook', text: 'O documento segue para o computador.', startFrame: 0, endFrame: 48,
      wordTimings: [['O', 0, 2], ['documento', 2, 10], ['segue', 10, 18], ['para', 18, 22], ['o', 22, 24], ['computador.', 24, 45]]
        .map(([text, startFrame, endFrame]) => ({ text, startFrame, endFrame })) },
    { id: 's2', groupId: 'hook', text: 'A pessoa sorri.', startFrame: 48, endFrame: 96,
      wordTimings: [['A', 48, 50], ['pessoa', 50, 60], ['sorri.', 60, 80]]
        .map(([text, startFrame, endFrame]) => ({ text, startFrame, endFrame })) }
  ];
  const point = { x: 0.3, y: 0.25, scale: 1 };
  const action = (id, cue, start) => ({ targetObjectId: id, cueSentenceId: cue, kind: 'reveal-part', startFrame: start, endFrame: start + 12,
    trajectories: { landscape: { from: point, to: point }, portrait: { from: point, to: point } } });
  const objects = [{ id: 'a', label: 'segue', kind: 'token', labelType: 'literal', illustrative: false },
    { id: 'b', label: 'para', kind: 'token', labelType: 'literal', illustrative: false },
    { id: 'c', label: 'pessoa', kind: 'person', labelType: 'literal', illustrative: false }];
  const plan = { schemaVersion: 'pulso.narrative-episode/v2', jobId: 'repair-fixture-01', themeId: 'ia', title: 'Documento e computador',
    fps: 24, durationMs: 4000, durationInFrames: 96, seed: 1, scriptSha256: 'b'.repeat(64), narrationSha256: 'c'.repeat(64),
    speechEnvelope: { stepMs: 10, levels: Array(400).fill(.3), gateDb: -42, fullOpenDb: -12, sampleRate: 16000 },
    source: { eligible: true, contextHash: sourceHash, reviewStatus: 'approved', reviewSourceHash: sourceHash },
    chapters: [{ id: 'hook', kind: 'hook', title: 'Abertura', startFrame: 0, durationInFrames: 96, sentenceIds: ['s1', 's2'] }],
    sentences, claims: sentences.map(sentence => ({ id: `claim-${sentence.id}`, sentenceId: sentence.id, text: sentence.text, sourceContextHash: sourceHash })), assets: [],
    scenes: [{ id: 'scene-01', chapterId: 'hook', title: 'Abertura', visualThesis: 'O documento segue.', startFrame: 0, durationInFrames: 96,
      sentenceIds: ['s1', 's2'], claimRefs: ['claim-s1', 'claim-s2'], objects,
      layouts: { landscape: { objects: { a: point, b: point, c: point } }, portrait: { objects: { a: point, b: point, c: point } } },
      actions: [action('a', 's1', 0), action('b', 's1', 4), action('c', 's2', 48)],
      cameraShots: [{ cueSentenceId: 's1', kind: 'wide', focusObjectId: 'a', startFrame: 0 },
        { cueSentenceId: 's2', kind: 'wide', focusObjectId: 'c', startFrame: 48 }],
      presenter: { side: 'right', framing: 'medium', gestureCues: [{ cueSentenceId: 's1', gesture: 'explain' }] } }] };
  plan.speechEnvelopeSha256 = sha256(Buffer.from(stableJson(plan.speechEnvelope)));
  plan.inputSha256 = narrativePlanInputSha256(plan);
  return plan;
}

test('repara um fluxo com dois objetos literais, preserva o original e mantém os tempos da fala', async () => {
  const plan = fixture();
  assert.equal(validateNarrativeEpisodePlan(plan).valid, true);
  assert.deepEqual(auditNarrativeIllustration(plan).missing, ['s1']);
  let calls = 0;
  const result = await authorWithIllustrationRepair({ author: async () => { calls++; return plan; }, options: {} });
  assert.equal(calls, 1);
  assert.equal(validateNarrativeEpisodePlan(result).valid, true);
  assert.equal(auditNarrativeIllustration(result).complete, true);
  assert.deepEqual(result.scenes[0].objects.filter(object => ['documento', 'computador'].includes(object.label)).map(object => object.label), ['documento', 'computador']);
  assert.deepEqual(result.scenes[0].actions.filter(action => action.cueSentenceId === 's1').map(action => action.startFrame), [2, 24]);
  assert.equal(plan.scenes[0].objects.some(object => object.label === 'documento'), false);
});

test('não cria desenhos para um fluxo que o renderer não sabe representar', () => {
  const plan = fixture();
  plan.sentences[0].text = 'O pássaro segue para a nuvem.';
  plan.sentences[0].wordTimings = [];
  assert.deepEqual(concreteCandidates(plan.sentences[0]), []);
  const result = repairNarrativeIllustrations(plan, ['s1']);
  assert.deepEqual(result.repaired, []);
});

test('completa objetos relevantes mesmo quando o teste mínimo já encontra um desenho', async () => {
  const plan = fixture();
  plan.sentences[1].text = 'A pessoa guarda potes.';
  plan.sentences[1].wordTimings = [['A', 48, 50], ['pessoa', 50, 58], ['guarda', 58, 66], ['potes.', 66, 80]]
    .map(([text, startFrame, endFrame]) => ({ text, startFrame, endFrame }));
  plan.claims[1].text = plan.sentences[1].text;
  plan.inputSha256 = narrativePlanInputSha256(plan);
  const partiallyRepaired = repairNarrativeIllustrations(plan, ['s1']).plan;
  assert.equal(auditNarrativeIllustration(partiallyRepaired).complete, true);
  assert.throws(() => assertNarrativeIllustration(partiallyRepaired), { code: 'NARRATIVE_STORYTELLING_INCOMPLETE' });
  const result = await authorWithIllustrationRepair({ author: async () => plan, options: {} });
  assert.equal(assertNarrativeIllustration(result).complete, true);
  assert.ok(result.scenes[0].objects.some(object => object.label === 'potes'));
});

test('receitas financeiras não viram ilustrações culinárias', () => {
  assert.deepEqual(concreteCandidates({ text: 'As receitas financeiras cresceram.' }), []);
  assert.ok(!concreteCandidates({ text: 'A família de modelos recebeu uma atualização.' }).some(item => item.label === 'família'));
});

test('mantém a lembrança como sujeito e reconhece o descarte citado na fala', () => {
  const labels = concreteCandidates({ text: 'Se a lembrança da escassez dispara ansiedade quando algo vai para o lixo, procure um psicólogo.' }).map(item => item.label);
  assert.ok(labels.includes('lembrança da escassez'));
  assert.ok(!labels.includes('escassez'));
  assert.ok(labels.includes('algo') && labels.includes('lixo'));
  assert.ok(concreteCandidates({ text: 'A pessoa sente angústia ao descartar algo estragado.' }).some(item => item.label === 'algo estragado'));
  const { narrativeObjectVisual } = require('../utils/narrative-concept-visual');
  const item = { label: 'algo estragado', kind: 'product', labelType: 'literal' };
  assert.equal(narrativeObjectVisual(item, { text: 'A pessoa decide descartar algo estragado.' }).kind, 'discard-spoiled');
  assert.equal(narrativeObjectVisual(item, { text: 'A pessoa encontrou algo estragado.' }).kind, 'spoiled-item');
});
