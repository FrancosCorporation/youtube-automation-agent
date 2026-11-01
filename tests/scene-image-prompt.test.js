'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSceneImageBase, buildSceneImagePrompt, selectNarrativeBeat, narrativeBeatSha256 } = require('../utils/scene-image-prompt');
const { bindNarrativeBeatAssets } = require('../utils/narrative-episode-plan');

test('scene base uses source context and section, ignoring conflicting writer image notes', () => {
  const base = buildSceneImageBase({
    topic: 'Psicologia',
    sourceTitle: 'Como silenciar notificações de grupos familiares por um dia',
    sectionTitle: 'O experimento de um dia',
    sectionText: 'Desativar alertas por algumas horas pode aliviar a atenção constante sem sair do grupo.',
    imagePrompt: 'Researcher at a computer with a readable chart and labels'
  });

  assert.match(base, /Psicologia/);
  assert.match(base, /Como silenciar notificações de grupos familiares por um dia/);
  assert.match(base, /O experimento de um dia/);
  assert.match(base, /Desativar alertas por algumas horas pode aliviar a atenção constante/);
  assert.doesNotMatch(base, /Researcher|computer|readable chart|labels/i);
  assert.match(base, /Unoccupied editorial still/);
});

test('scene base bounds and neutralizes control characters in source grounding', () => {
  const base = buildSceneImageBase({
    topic: 'Psicologia',
    sourceTitle: 'Fonte\n verificada',
    sectionTitle: 'Abertura',
    sectionText: `A ${'narrativa '.repeat(80)}`
  });

  assert.match(base, /Fonte verificada/);
  assert.doesNotMatch(base, /\n/);
  assert.ok(base.length < 600, `expected bounded prompt base, got ${base.length} characters`);
});

test('narrative scene base binds each image to one timed narration beat', () => {
  const base = buildSceneImageBase({
    topic: 'Pista enviada a uma polícia',
    sourceTitle: 'Relato revisado',
    sectionTitle: 'O envio da pista',
    sectionText: 'Um modelo enviou uma pista ao portal policial. O portal registrou o recebimento às 23h27.',
    visualBeatText: 'O portal registrou o recebimento às 23h27.',
    visualDirection: 'A computer sends a signal to a police portal'
  });

  assert.match(base, /Narrative editorial scene/);
  assert.match(base, /exact narrated beat/);
  assert.match(base, /O portal registrou o recebimento às 23h27/);
  assert.match(base, /visual direction/);
  assert.match(base, /subordinate to the narrated beat/);
});

test('visual variants map deterministically across the timed narration', () => {
  const beats = [
    { text: 'Um computador cria a mensagem.' },
    { text: 'O pacote segue pela rede.' },
    { text: 'O portal policial recebe a pista.' }
  ];

  assert.equal(selectNarrativeBeat(beats, 0, 2), 'Um computador cria a mensagem.');
  assert.equal(selectNarrativeBeat(beats, 1, 2), 'O portal policial recebe a pista.');
  assert.equal(selectNarrativeBeat(beats, 1, 3), 'O pacote segue pela rede.');
  assert.equal(selectNarrativeBeat(beats, 9, 2), 'O portal policial recebe a pista.');
  assert.equal(selectNarrativeBeat([], 0, 2), '');
});

test('imagem só se vincula à frase única do mesmo grupo que originou seu prompt', () => {
  const sentences = [{ id: 'a', groupIndex: 0, text: 'A pessoa agradece ao motorista.' },
    { id: 'b', groupIndex: 1, text: 'O estudo discute a gratidão.' }];
  const beatSha256 = narrativeBeatSha256(sentences[0].text);
  const assets = [{ id: 'correct', groupIndex: 0, beatSha256 }, { id: 'other-group', groupIndex: 1, beatSha256 }, { id: 'old', groupIndex: 0 }];
  assert.deepEqual(bindNarrativeBeatAssets(assets, sentences).map(asset => asset.sentenceId || null), ['a', null, null]);
  assert.equal(bindNarrativeBeatAssets([assets[0]], [...sentences, { ...sentences[0], id: 'duplicate' }])[0].sentenceId, undefined);
  assert.equal(narrativeBeatSha256(''), '');
  assert.equal(narrativeBeatSha256('  A pessoa\nagradece ao motorista. '), beatSha256);
});

test('scene prompts block invented signage, institution names, documents, and unrelated settings', () => {
  const prompt = buildSceneImagePrompt({
    base: 'Editorial scene about a university health study with a blood sample tray',
    subject: 'No people; focus on relevant research objects',
    shot: 'cinematic close-up'
  });

  for (const phrase of [
    'No people or human forms: no humans, faces, portraits, silhouettes, hands, statues or mannequins',
    'Show an unoccupied environment with inanimate story objects only',
    'no text, letters, numbers, symbols, logos, brands, watermarks',
    'institutional or company names',
    'signage, labels, tags, printed documents, charts, diagrams, packaging',
    'All visible surfaces, objects and backgrounds must be blank and unmarked',
    'Do not invent a named institution, place, product or organization',
    'landscapes, activities or settings'
  ]) assert.ok(prompt.includes(phrase), `expected prompt to include: ${phrase}`);
  assert.ok(prompt.includes('university health study'));
  assert.ok(prompt.includes('Shot: cinematic close-up'));
});

test('narrative scene prompts allow only grounded people and abstract unreadable interfaces', () => {
  const prompt = buildSceneImagePrompt({
    base: 'Narrative editorial scene about the exact narrated beat "a person writes an email"',
    subject: 'Show the supported action',
    shot: 'medium documentary view',
    narrative: true
  });

  assert.match(prompt, /Show a person only when the exact narrated beat explicitly supports/);
  assert.match(prompt, /keep any person anonymous/);
  assert.match(prompt, /Screens, email or computer interfaces must be abstract and unreadable/);
  assert.match(prompt, /No readable text/);
  assert.match(prompt, /one coherent scene/);
  assert.doesNotMatch(prompt, /Show an unoccupied environment/);
});

test('scene prompt builder rejects missing content instead of generating a vague prompt', () => {
  assert.throws(() => buildSceneImagePrompt({ base: '', subject: 'focus', shot: 'close-up' }), /base is required/);
  assert.throws(() => buildSceneImagePrompt({ base: 'topic', subject: '', shot: 'close-up' }), /subject is required/);
  assert.throws(() => buildSceneImagePrompt({ base: 'topic', subject: 'focus', shot: '' }), /shot is required/);
});
