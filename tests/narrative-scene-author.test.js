'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AUTHOR_REVISION, authorNarrativeScenes, buildChapterInputs, buildDeterministicScene, buildPrompt, literalLabelChoices, sceneFailureTag, validateAuthoredPlan } = require('../utils/narrative-scene-author');

test('known rhythm and route validation failures get bounded repair feedback', () => {
  assert.equal(sceneFailureTag(new Error('scene-02: frase sentence-04 acima de 12 segundos precisa mudar o foco visual')), 'invalid_visual_rhythm');
  assert.equal(sceneFailureTag(new Error('scene-02: frase sentence-04 sobre trajetos diferentes precisa de mapa ou rede em foco')), 'invalid_visual_routes');
  assert.equal(sceneFailureTag(new Error('arbitrary provider response: acima de 12 segundos precisa mudar o foco visual')), 'error');
});
const { narrativePlanInputSha256, sha256, stableJson, validateNarrativeEpisodePlan } = require('../utils/narrative-episode-plan');
const { safeErrorTag } = require('../utils/safe-error-tag');
const { isRetryableGenerationFailure } = require('../utils/generation-retry');

test('rótulos sugeridos ao autor são trechos exatos e curtos da fala', () => {
  const text = 'A coleta de DNA dos pais identificou Reginaldo em Barra Velha.';
  const choices = literalLabelChoices(text);
  assert(choices.includes('DNA dos pais'));
  assert(choices.every(label => label.length <= 24 && text.includes(label)));
  assert.equal(new Set(choices).size, choices.length);
});

function basePlan() {
  const contextHash = 'd'.repeat(64);
  const plan = {
    schemaVersion: 'pulso.narrative-episode/v2', jobId: 'scene-test-0001', themeId: 'ia', title: 'Envio de sinal',
    fps: 24, durationMs: 2000, durationInFrames: 48, seed: 4,
    scriptSha256: 'e'.repeat(64), narrationSha256: 'f'.repeat(64),
    speechEnvelope: { stepMs: 10, levels: Array(200).fill(0.5), gateDb: -42, fullOpenDb: -12, sampleRate: 16000 },
    source: { eligible: true, contextHash, reviewStatus: 'approved', reviewSourceHash: contextHash },
    chapters: [{ id: 'hook', kind: 'hook', title: 'O caminho do sinal', startFrame: 0, durationInFrames: 48,
      sentenceIds: ['hook-sentence-1', 'hook-sentence-2'] }],
    sentences: [
      { id: 'hook-sentence-1', groupId: 'hook', text: 'O sinal parte.', startFrame: 0, endFrame: 24 },
      { id: 'hook-sentence-2', groupId: 'hook', text: 'A resposta chega.', startFrame: 24, endFrame: 48 }
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

function authoredScene(overrides = {}) {
  return {
    id: 'scene-01', visualThesis: 'Um sinal percorre o caminho e chega ao destino.',
    objects: [
      { id: 'sender', label: 'parte', kind: 'device', labelType: 'literal' },
      { id: 'receiver', label: 'chega', kind: 'device', labelType: 'literal' }
    ],
    layouts: {
      landscape: { objects: { sender: { x: 0.24, y: 0.34, scale: 0.9 }, receiver: { x: 0.48, y: 0.42, scale: 1 } } },
      portrait: { objects: { sender: { x: 0.32, y: 0.18, scale: 0.8 }, receiver: { x: 0.68, y: 0.30, scale: 0.9 } } }
    },
    actions: [
      { targetObjectId: 'sender', cueSentenceId: 'hook-sentence-1', kind: 'travel', trajectories: {
        landscape: { from: { x: 0.24, y: 0.34, scale: 0.9 }, to: { x: 0.36, y: 0.36, scale: 1 } },
        portrait: { from: { x: 0.32, y: 0.18, scale: 0.8 }, to: { x: 0.48, y: 0.24, scale: 0.9 } }
      } },
      { targetObjectId: 'receiver', cueSentenceId: 'hook-sentence-2', kind: 'reveal-part', trajectories: {
        landscape: { from: { x: 0.48, y: 0.42, scale: 1 }, to: { x: 0.50, y: 0.38, scale: 1.05 } },
        portrait: { from: { x: 0.68, y: 0.30, scale: 0.9 }, to: { x: 0.58, y: 0.26, scale: 1 } }
      } }
    ],
    cameraShots: [
      { cueSentenceId: 'hook-sentence-1', kind: 'wide', focusObjectId: 'sender' },
      { cueSentenceId: 'hook-sentence-1', kind: 'follow', focusObjectId: 'sender' },
      { cueSentenceId: 'hook-sentence-2', kind: 'result', focusObjectId: 'receiver' }
    ],
    presenter: { side: 'right', framing: 'medium', gestureCues: [
      { cueSentenceId: 'hook-sentence-1', gesture: 'explain' },
      { cueSentenceId: 'hook-sentence-2', gesture: 'point' }
    ] },
    ...overrides
  };
}

test('fallback determinístico cria cenas válidas sem provedor de autoria', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-deterministic-'));
  const previousFallback = process.env.PULSO_DETERMINISTIC_SCENE_FALLBACK;
  const previousNvidia = process.env.NVIDIA_API_KEY;
  process.env.PULSO_DETERMINISTIC_SCENE_FALLBACK = '1';
  delete process.env.NVIDIA_API_KEY;
  t.after(async () => {
    if (previousFallback === undefined) delete process.env.PULSO_DETERMINISTIC_SCENE_FALLBACK;
    else process.env.PULSO_DETERMINISTIC_SCENE_FALLBACK = previousFallback;
    if (previousNvidia === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousNvidia;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const plan = basePlan();
  const raw = buildDeterministicScene(buildChapterInputs(plan)[0], plan, 'Contexto da fonte aprovada.');
  const checked = validateAuthoredPlan({ ...plan, scenes: [raw] }, buildChapterInputs(plan), 'Contexto da fonte aprovada.');
  assert.equal(checked.valid, true, checked.errors.join('\n'));
  const result = await authorNarrativeScenes({ plan, cacheDir, logger: {}, geminiEnabled: false, reserve: async () => {} });
  assert.equal(result.scenes.length, 1);
  assert.equal(result.author.modelsByScene['scene-01'], 'deterministic-fallback');
});

test('fallback determinístico não importa rótulo literal de outra frase curta', () => {
  const plan = basePlan();
  plan.sentences[1] = { ...plan.sentences[1], text: 'Para o Dr.' };
  plan.claims[1] = { ...plan.claims[1], text: 'Para o Dr.' };
  plan.inputSha256 = narrativePlanInputSha256(plan);
  const inputs = buildChapterInputs(plan);
  const raw = buildDeterministicScene(inputs[0], plan, 'Contexto da fonte aprovada.');
  const checked = validateAuthoredPlan({ ...plan, scenes: [raw] }, inputs, 'Contexto da fonte aprovada.');
  assert.equal(checked.valid, true, checked.errors.join('\n'));
  assert.equal(raw.objects[1].labelType, 'illustrative');
});

test('autor valida objetos, ações e enquadramentos nos dois formatos', () => {
  const plan = basePlan();
  const inputs = buildChapterInputs(plan);
  const result = validateAuthoredPlan({ ...plan, scenes: [authoredScene()] }, inputs, 'Contexto da fonte aprovada.');
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.deepEqual(plan.scenes, []);
});

test('primeira frase de novo capítulo recebe a frase anterior como contexto', () => {
  const plan = basePlan();
  plan.chapters = [
    { ...plan.chapters[0], sentenceIds: ['hook-sentence-1'] },
    { ...plan.chapters[0], id: 'section', sentenceIds: ['hook-sentence-2'] }
  ];
  const inputs = buildChapterInputs(plan);
  assert.equal(inputs[0].previousSentence, null);
  assert.equal(inputs[1].previousSentence.text, 'O sinal parte.');
});

test('validador final também rejeita rótulo longo que não cabe no quadro', () => {
  const plan = basePlan();
  plan.scenes = [authoredScene()];
  assert.equal(validateAuthoredPlan(plan, buildChapterInputs(plan), '').valid, true);
  plan.scenes[0].objects[0].label = 'um rótulo visual grande demais para o quadro';
  const result = validateNarrativeEpisodePlan(plan);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.startsWith('scene:scene-01:object:')));
});

test('autor não aceita falar de trajetos diferentes sem visual de percurso', () => {
  const plan = basePlan();
  plan.sentences[0].text = 'Eles seguem trajetos diferentes.';
  plan.claims[0].text = plan.sentences[0].text;
  plan.inputSha256 = narrativePlanInputSha256(plan);
  const scene = authoredScene();
  scene.objects[0] = { ...scene.objects[0], label: 'trajetos', kind: 'device' };
  const inputs = buildChapterInputs(plan);
  let result = validateAuthoredPlan({ ...plan, scenes: [JSON.parse(JSON.stringify(scene))] }, inputs, '');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('trajetos diferentes')));
  scene.objects[0].kind = 'map';
  result = validateAuthoredPlan({ ...plan, scenes: [scene] }, inputs, '');
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('autor precisa mudar o foco visual durante frase acima de 12 segundos', () => {
  const plan = basePlan();
  plan.durationInFrames = 337;
  plan.durationMs = 14042;
  plan.chapters[0].durationInFrames = 337;
  plan.sentences[0].endFrame = 313;
  plan.sentences[1].startFrame = 313;
  plan.sentences[1].endFrame = 337;
  plan.speechEnvelope.levels = Array(Math.ceil(plan.durationMs / plan.speechEnvelope.stepMs)).fill(.5);
  plan.speechEnvelopeSha256 = sha256(Buffer.from(stableJson(plan.speechEnvelope)));
  plan.inputSha256 = narrativePlanInputSha256(plan);
  const scene = authoredScene();
  const inputs = buildChapterInputs(plan);
  let result = validateAuthoredPlan({ ...plan, scenes: [JSON.parse(JSON.stringify(scene))] }, inputs, '');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('acima de 12 segundos')));
  scene.objects[1].label = 'sinal';
  scene.cameraShots[1].focusObjectId = 'receiver';
  result = validateAuthoredPlan({ ...plan, scenes: [scene] }, inputs, '');
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('exemplo do prompt atende ao próprio contrato e usa os IDs reais', () => {
  const plan = basePlan();
  const inputs = buildChapterInputs(plan);
  const prompt = buildPrompt({ plan, chapterInputs: inputs, sourceContext: 'Fonte aprovada.' });
  assert.match(prompt, /rótulo generic deve ser exatamente um destes/);
  assert.match(prompt, /celular é device, não cell/);
  const example = JSON.parse(prompt.split('\n').find(line => line.startsWith('{"scenes":')));
  assert.deepEqual(example.scenes[0].objects.map(object => object.kind), ['person', 'document']);
  const result = validateAuthoredPlan({ ...plan, scenes: example.scenes }, inputs, 'Fonte aprovada.');
  assert.equal(result.valid, true, result.errors.join('\n'));
  const laterInput = { ...inputs[0], id: 'scene-02', narration: [{ ...inputs[0].narration[1] }] };
  const later = buildPrompt({ plan, chapterInputs: [laterInput], sourceContext: 'Fonte aprovada.' });
  assert.match(later, /"maximumObjects":\d+/);
  const laterExample = JSON.parse(later.split('\n').find(line => line.startsWith('{"scenes":')));
  assert.equal(laterExample.scenes[0].id, 'scene-02');
  assert.equal(laterExample.scenes[0].actions[0].cueSentenceId, 'hook-sentence-2');
});

test('rótulo literal deve constar da narração do capítulo ou da fonte', () => {
  const plan = basePlan();
  const scene = authoredScene();
  scene.objects[1] = { ...scene.objects[1], label: 'A resposta chega', labelType: 'literal' };
  let result = validateAuthoredPlan({ ...plan, scenes: [scene] }, buildChapterInputs(plan), 'Fonte aprovada sem essa expressão.');
  assert.equal(result.valid, true, result.errors.join('\n'));
  const invalid = authoredScene();
  invalid.objects[0] = { ...invalid.objects[0], label: 'afirmação não verificada', labelType: 'literal' };
  result = validateAuthoredPlan({ ...plan, scenes: [invalid] }, buildChapterInputs(plan), 'Fonte aprovada sem essa expressão.');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('rótulo literal sem correspondência')));
});

test('rótulo genérico autorizado aceita acentos sem aceitar rótulo desconhecido', () => {
  const plan = basePlan();
  const scene = authoredScene();
  scene.objects[0] = { ...scene.objects[0], label: 'comparação', labelType: 'generic' };
  scene.objects[1] = { ...scene.objects[1], label: 'O sinal', labelType: 'literal' };
  scene.cameraShots.push({ cueSentenceId: 'hook-sentence-1', kind: 'wide', focusObjectId: 'receiver' });
  let result = validateAuthoredPlan({ ...plan, scenes: [scene] }, buildChapterInputs(plan), 'Fonte aprovada.');
  assert.equal(result.valid, true, result.errors.join('\n'));
  const invalid = authoredScene();
  invalid.objects[0] = { ...invalid.objects[0], label: 'afirmação', labelType: 'generic' };
  result = validateAuthoredPlan({ ...plan, scenes: [invalid] }, buildChapterInputs(plan), 'Fonte aprovada.');
  assert.equal(result.valid, false);
});

test('rótulo generic específico é reclassificado como literal somente se estiver fundamentado', () => {
  const plan = basePlan();
  const scene = authoredScene();
  scene.objects[0] = { ...scene.objects[0], label: 'parte', labelType: 'generic' };
  const authored = { ...plan, scenes: [scene] };
  const result = validateAuthoredPlan(authored, buildChapterInputs(plan), 'Fonte aprovada.');
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(authored.scenes[0].objects[0].labelType, 'literal');
  const invalid = authoredScene();
  invalid.objects[0] = { ...invalid.objects[0], label: 'fato inexistente', labelType: 'generic' };
  assert.equal(validateAuthoredPlan({ ...plan, scenes: [invalid] }, buildChapterInputs(plan), '').valid, false);
});

test('cena com cartões apenas genéricos é rejeitada e deve usar a pauta como referência', () => {
  const plan = basePlan();
  const scene = authoredScene();
  scene.objects[0] = { ...scene.objects[0], label: 'entrada', labelType: 'generic' };
  scene.objects[1] = { ...scene.objects[1], label: 'resultado', labelType: 'generic' };
  const result = validateAuthoredPlan({ ...plan, scenes: [scene] }, buildChapterInputs(plan), 'Fonte aprovada.');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('rótulos específicos literais')));
});

test('conceitos sem desenho específico não geram reprovação que exige outra rodada de autoria', () => {
  const plan = basePlan();
  const scene = authoredScene();
  scene.objects = scene.objects.map(object => ({ ...object, kind: 'step' }));
  scene.actions = scene.actions.map(action => ({ ...action, cueSentenceId: 'hook-sentence-1' }));
  scene.cameraShots = scene.cameraShots.map(shot => ({ ...shot, cueSentenceId: 'hook-sentence-1' }));
  const result = validateAuthoredPlan({ ...plan, scenes: [scene] }, buildChapterInputs(plan), 'Fonte aprovada.');
  assert.ok(!result.errors.some(error => error.includes('símbolos genéricos repetidos')));
});

test('gráfico sem valores não provoca retenção no plano de autoria', () => {
  const plan = basePlan();
  const scene = authoredScene();
  scene.objects[0] = { ...scene.objects[0], kind: 'chart' };
  const result = validateAuthoredPlan({ ...plan, scenes: [scene] }, buildChapterInputs(plan), 'Fonte aprovada.');
  assert.ok(!result.errors.some(error => error.includes('gráfico sem valor verificável')));
});

test('cena com três objetos precisa de ao menos dois rótulos específicos', () => {
  const plan = basePlan();
  const scene = authoredScene();
  scene.objects[1] = { ...scene.objects[1], label: 'resultado', labelType: 'generic' };
  scene.objects.push({ id: 'third', label: 'exemplo', kind: 'step', labelType: 'generic' });
  const result = validateAuthoredPlan({ ...plan, scenes: [scene] }, buildChapterInputs(plan), 'Fonte aprovada.');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('rótulos específicos literais')));
});

test('rótulo literal extenso é recusado para não ser cortado nos cartões', () => {
  const plan = basePlan();
  const scene = authoredScene();
  scene.objects[0] = { ...scene.objects[0], label: 'rótulo literal comprido demais', labelType: 'literal' };
  const result = validateAuthoredPlan({ ...plan, scenes: [scene] }, buildChapterInputs(plan), 'rótulo literal comprido demais');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('rótulo longo')));
  assert.equal(sceneFailureTag(new Error(result.errors[0])), 'invalid_label_length');
});

test('autor distribui planos de câmera repetidos ao longo da frase', () => {
  const plan = basePlan();
  const inputs = buildChapterInputs(plan);
  const authored = { ...plan, scenes: [authoredScene()] };
  const result = validateAuthoredPlan(authored, inputs, 'Contexto da fonte aprovada.');
  assert.equal(result.valid, true, result.errors.join('\n'));
  const [first, second, third] = authored.scenes[0].cameraShots;
  assert.equal(first.startFrame, 0);
  assert.equal(second.startFrame, 12);
  assert.equal(third.startFrame, 24);
});

test('autor rejeita trajetória fora da zona segura vertical', () => {
  const plan = basePlan();
  const inputs = buildChapterInputs(plan);
  const scene = authoredScene();
  scene.actions[0].trajectories.portrait.to.y = 0.8;
  const result = validateAuthoredPlan({ ...plan, scenes: [scene] }, inputs, 'Contexto da fonte aprovada.');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('/portrait/ação-1/to')));
  assert.ok(result.errors.some(error => error.includes('y=0.8') && error.includes('y=0.12–0.36')));
});

test('timeout no autor principal tenta outro modelo e valida e registra o resultado', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-author-'));
  const previousKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'test-only';
  t.after(async () => {
    if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousKey;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const models = [];
  const result = await authorNarrativeScenes({
    plan: basePlan(), sourceContext: 'Contexto da fonte aprovada.', cacheDir,
    model: 'z-ai/glm-5.3-flash', logger: {}, reserve: async () => {},
    request: async ({ body }) => {
      models.push(body.model);
      if (models.length === 1) throw Object.assign(new Error('expired'), { name: 'TimeoutError', code: 23 });
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ scenes: [authoredScene()] }) } }] }) };
    }
  });
  assert.deepEqual(models, ['z-ai/glm-5.3-flash', 'nvidia/nemotron-3.5-lightning-30b-a3b']);
  assert.equal(result.author.model, models[1]);
  assert.equal(result.scenes.length, 1);
  const cached = await authorNarrativeScenes({
    plan: basePlan(), sourceContext: 'Contexto da fonte aprovada.', cacheDir,
    model: models[0], logger: {}, reserve: async () => { throw new Error('cache não utilizado'); }
  });
  assert.equal(cached.cached, true);
  assert.equal(cached.author.model, models[1]);
});

test('Gemini autorizado pode gerar cena validada sem chave NVIDIA e usa o orçamento compartilhado', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-gemini-'));
  const previousKey = process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  t.after(async () => {
    if (previousKey !== undefined) process.env.NVIDIA_API_KEY = previousKey;
    else delete process.env.NVIDIA_API_KEY;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const reservations = [];
  const result = await authorNarrativeScenes({
    plan: basePlan(), sourceContext: 'Contexto da fonte aprovada.', cacheDir, logger: {}, geminiEnabled: true,
    reserve: async service => reservations.push(service),
    request: async () => { throw new Error('NVIDIA não deve ser usado'); },
    geminiRequest: async ({ model }) => {
      assert.equal(model, 'gemini-3.5-flash-lite');
      return JSON.stringify({ scenes: [authoredScene()] });
    }
  });
  assert.deepEqual(reservations, ['script-gemini']);
  assert.equal(result.scenes.length, 1);
  assert.equal(result.author.model, 'chapter-fallback');
  assert.equal(result.author.modelsByScene['scene-01'], 'gemini:gemini-3.5-flash-lite');
});

test('esgotar orçamento NVIDIA não impede a alternativa Gemini nem afrouxa o corretor', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-gemini-budget-'));
  const previousKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'test-only';
  t.after(async () => {
    if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousKey;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const reservations = [];
  const result = await authorNarrativeScenes({ plan: basePlan(), cacheDir, logger: {}, geminiEnabled: true, geminiFirst: false,
    reserve: async service => {
      reservations.push(service);
      if (service === 'nvidia') throw Object.assign(new Error('budget'), { code: 'BUDGET_EXHAUSTED' });
    },
    request: async () => { throw new Error('NVIDIA não deve ser chamado sem orçamento'); },
    geminiRequest: async () => JSON.stringify({ scenes: [authoredScene()] })
  });
  assert.deepEqual(reservations, ['nvidia', 'nvidia', 'script-gemini']);
  assert.equal(result.scenes.length, 1);
});

test('erro arbitrário do provedor anterior não é repassado no prompt Gemini', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-gemini-redaction-'));
  const previousKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'test-only';
  t.after(async () => {
    if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousKey;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const result = await authorNarrativeScenes({ plan: basePlan(), cacheDir, logger: {}, geminiEnabled: true, geminiFirst: false,
    reserve: async () => {},
    request: async () => { throw new Error('private-token-example'); },
    geminiRequest: async ({ prompt }) => {
      assert.equal(prompt.includes('private-token-example'), false);
      return JSON.stringify({ scenes: [authoredScene()] });
    }
  });
  assert.equal(result.scenes.length, 1);
});

test('Gemini configurado é tentado antes da NVIDIA na autoria por capítulo', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-gemini-first-'));
  const previousKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'test-only';
  t.after(async () => {
    if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousKey;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const reservations = [];
  const result = await authorNarrativeScenes({ plan: basePlan(), cacheDir, logger: {}, geminiEnabled: true,
    reserve: async service => reservations.push(service),
    request: async () => { throw new Error('NVIDIA não deve ser usada antes do Gemini'); },
    geminiRequest: async () => JSON.stringify({ scenes: [authoredScene()] })
  });
  assert.deepEqual(reservations, ['script-gemini']);
  assert.equal(result.scenes.length, 1);
});

test('orçamento Gemini esgotado permite tentar NVIDIA sem ignorar a validação', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-gemini-exhausted-'));
  const previousKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'test-only';
  t.after(async () => {
    if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousKey;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const reservations = [];
  const result = await authorNarrativeScenes({ plan: basePlan(), cacheDir, logger: {}, geminiEnabled: true,
    reserve: async service => {
      reservations.push(service);
      if (service === 'script-gemini') throw Object.assign(new Error('budget'), { code: 'BUDGET_EXHAUSTED' });
    },
    geminiRequest: async () => { throw new Error('Gemini não deve ser chamado sem orçamento'); },
    request: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ scenes: [authoredScene()] }) } }] }) })
  });
  assert.deepEqual(reservations, ['script-gemini', 'nvidia']);
  assert.equal(result.scenes.length, 1);
});

test('fallback Gemini também rejeita cena que não passa na validação', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-gemini-invalid-'));
  const previousKey = process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  t.after(async () => {
    if (previousKey !== undefined) process.env.NVIDIA_API_KEY = previousKey;
    else delete process.env.NVIDIA_API_KEY;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  let calls = 0;
  await assert.rejects(authorNarrativeScenes({ plan: basePlan(), cacheDir, logger: {}, geminiEnabled: true,
    reserve: async () => {},
    geminiRequest: async () => { calls++; return JSON.stringify({ scenes: [authoredScene({ objects: [] })] }); }
  }), error => error.code === 'NARRATIVE_SCENE_PROVIDER_UNAVAILABLE');
  assert.equal(calls, 2);
});

test('cena sem cobertura de uma frase é rejeitada antes do cache e mantém falha recuperável', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-aggregate-'));
  const previousKey = process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  t.after(async () => {
    if (previousKey !== undefined) process.env.NVIDIA_API_KEY = previousKey;
    else delete process.env.NVIDIA_API_KEY;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const scene = authoredScene();
  for (const action of scene.actions) action.cueSentenceId = 'hook-sentence-1';
  for (const shot of scene.cameraShots) shot.cueSentenceId = 'hook-sentence-1';
  const warnings = [];
  await assert.rejects(authorNarrativeScenes({ plan: basePlan(), cacheDir, geminiEnabled: true,
    logger: { warn: value => warnings.push(value) }, reserve: async () => {},
    geminiRequest: async () => JSON.stringify({ scenes: [scene] })
  }), error => error.code === 'NARRATIVE_SCENE_PROVIDER_UNAVAILABLE'
    && isRetryableGenerationFailure(safeErrorTag(error)));
  assert.ok(warnings.some(message => message.includes('invalid_actions')));
});

test('erro do contrato agregado não mascara o código recuperável do scheduler', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-contract-retry-'));
  const previousKey = process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  t.after(async () => {
    if (previousKey !== undefined) process.env.NVIDIA_API_KEY = previousKey;
    else delete process.env.NVIDIA_API_KEY;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const plan = basePlan();
  plan.speechEnvelope.levels = [];
  const warnings = [];
  await assert.rejects(authorNarrativeScenes({ plan, cacheDir, geminiEnabled: true,
    logger: { warn: value => warnings.push(value) }, reserve: async () => {},
    geminiRequest: async () => JSON.stringify({ scenes: [authoredScene()] })
  }), error => error.code === 'NARRATIVE_SCENE_PROVIDER_UNAVAILABLE'
    && isRetryableGenerationFailure(safeErrorTag(error)));
  assert.ok(warnings.some(message => message.includes('speechEnvelope')));
});

test('respostas inválidas antes de salvar qualquer cena mantêm job recuperável sem expor texto', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-invalid-'));
  const previousKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'test-only';
  t.after(async () => {
    if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousKey;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const invalid = authoredScene();
  invalid.objects = [];
  const messages = [];
  await assert.rejects(authorNarrativeScenes({
    plan: basePlan(), cacheDir, reserve: async () => {},
    logger: { warn: message => messages.push(message) },
    request: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ scenes: [invalid] }) } }] }) })
  }), error => error.code === 'NARRATIVE_SCENE_PROVIDER_UNAVAILABLE');
  assert.ok(messages.every(message => message.includes('invalid_objects')));
  assert.equal(sceneFailureTag(new Error('segredo arbitrário')), 'error');
});

test('fallback por capítulo reaproveita capítulo validado depois de interrupção', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-parts-'));
  const previousKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'test-only';
  t.after(async () => {
    if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousKey;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const plan = basePlan();
  plan.chapters = [
    { id: 'hook', kind: 'hook', title: 'Origem', startFrame: 0, durationInFrames: 24, sentenceIds: ['hook-sentence-1'] },
    { id: 'section-1', kind: 'section', title: 'Destino', startFrame: 24, durationInFrames: 24, sentenceIds: ['hook-sentence-2'] }
  ];
  plan.sentences[1].groupId = 'section-1';
  plan.inputSha256 = narrativePlanInputSha256(plan);
  const calls = [];
  let failSecond = true;
  const request = async ({ body }) => {
    const prompt = body.messages[0].content.split('Responda somente')[0];
    const both = prompt.includes('"id":"scene-01"') && prompt.includes('"id":"scene-02"');
    const id = prompt.includes('"id":"scene-02"') ? 'scene-02' : 'scene-01';
    calls.push(both ? 'batch' : id);
    if (both || (id === 'scene-02' && failSecond)) throw Object.assign(new Error('expired'), { name: 'TimeoutError' });
    const cue = id === 'scene-01' ? 'hook-sentence-1' : 'hook-sentence-2';
    const scene = authoredScene({ id });
    if (id === 'scene-01') scene.objects[1] = { ...scene.objects[1], label: 'resultado', labelType: 'generic' };
    else scene.objects[0] = { ...scene.objects[0], label: 'entrada', labelType: 'generic' };
    for (const action of scene.actions) action.cueSentenceId = cue;
    for (const shot of scene.cameraShots) shot.cueSentenceId = cue;
    for (const gesture of scene.presenter.gestureCues) gesture.cueSentenceId = cue;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ scenes: [scene] }) } }] }) };
  };
  const options = { plan, sourceContext: 'Contexto da fonte aprovada.', cacheDir, logger: {}, reserve: async () => {}, request };
  await assert.rejects(authorNarrativeScenes(options), error => error.code === 'NARRATIVE_SCENE_PROVIDER_UNAVAILABLE');
  assert.deepEqual(calls, ['batch', 'batch', 'scene-01', 'scene-02', 'scene-02']);
  const partialPath = path.join(cacheDir, (await fs.readdir(cacheDir)).find(name => name.endsWith('.scene-01.partial')));
  const partial = JSON.parse(await fs.readFile(partialPath, 'utf8'));
  const contextHash = sha256(Buffer.from(options.sourceContext));
  const model = process.env.NARRATIVE_SCENE_MODEL || 'z-ai/glm-5.3-flash';
  const legacyHash = sha256(Buffer.from(`${AUTHOR_REVISION}:${plan.inputSha256}:${contextHash}:${model}:none`));
  const legacyPath = path.join(cacheDir, `${plan.themeId}-${legacyHash}.json.scene-01.partial`);
  await fs.writeFile(legacyPath, JSON.stringify({ ...partial, inputSha256: legacyHash, sceneSha256: '0'.repeat(64) }));
  await fs.unlink(partialPath);
  calls.length = 0;
  await assert.rejects(authorNarrativeScenes(options), error => error.code === 'NARRATIVE_SCENE_PROVIDER_UNAVAILABLE');
  assert(calls.includes('scene-01'), 'a corrupt legacy scene must be regenerated');
  await fs.writeFile(legacyPath, JSON.stringify({ ...partial, inputSha256: legacyHash,
    creativeReference: { ...partial.creativeReference, revision: 1 } }));
  await fs.unlink(partialPath);
  calls.length = 0;
  await assert.rejects(authorNarrativeScenes(options), error => error.code === 'NARRATIVE_SCENE_PROVIDER_UNAVAILABLE');
  assert(calls.includes('scene-01'), 'legacy scenes made before the owner feedback must be regenerated');
  await fs.writeFile(legacyPath, JSON.stringify({ ...partial, inputSha256: legacyHash }));
  await fs.unlink(partialPath);
  calls.length = 0;
  await assert.rejects(authorNarrativeScenes(options), error => error.code === 'NARRATIVE_SCENE_PROVIDER_UNAVAILABLE');
  assert.deepEqual(calls, ['scene-02', 'scene-02'], 'a valid exact legacy chapter survives the cache-key upgrade');
  calls.length = 0;
  failSecond = false;
  plan.scriptSha256 = 'b'.repeat(64); // A new collection timestamp changes the full script hash.
  plan.inputSha256 = narrativePlanInputSha256(plan);
  const result = await authorNarrativeScenes(options);
  assert.deepEqual(calls, ['scene-02']);
  assert.equal(result.author.model, 'chapter-fallback');
  assert.equal(result.scenes.length, 2);
  calls.length = 0;
  plan.scriptSha256 = 'c'.repeat(64);
  plan.inputSha256 = narrativePlanInputSha256(plan);
  const cached = await authorNarrativeScenes(options);
  assert.equal(cached.cached, true);
  assert.equal(cached.inputSha256, plan.inputSha256);
  assert.equal(cached.scriptSha256, plan.scriptSha256);
  assert.deepEqual(calls, []);
});

test('capítulo recebe reparos limitados com feedback acumulado para defeitos distintos', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-repair-'));
  const previousKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'test-only';
  t.after(async () => {
    if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousKey;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const plan = basePlan();
  plan.chapters = [
    { id: 'hook', kind: 'hook', title: 'Origem', startFrame: 0, durationInFrames: 24, sentenceIds: ['hook-sentence-1'] },
    { id: 'section-1', kind: 'section', title: 'Destino', startFrame: 24, durationInFrames: 24, sentenceIds: ['hook-sentence-2'] }
  ];
  plan.sentences[1].groupId = 'section-1';
  plan.inputSha256 = narrativePlanInputSha256(plan);
  const calls = [];
  const request = async ({ body }) => {
    const prompt = body.messages[0].content;
    const compact = prompt.split('Responda somente')[0];
    if (compact.includes('"id":"scene-01"') && compact.includes('"id":"scene-02"')) {
      calls.push('batch');
      throw Object.assign(new Error('expired'), { name: 'TimeoutError' });
    }
    const second = compact.includes('"id":"scene-02"');
    const cue = second ? 'hook-sentence-2' : 'hook-sentence-1';
    const scene = authoredScene({ id: second ? 'scene-02' : 'scene-01' });
    if (second) scene.objects[0] = { ...scene.objects[0], label: 'entrada', labelType: 'generic' };
    else scene.objects[1] = { ...scene.objects[1], label: 'resultado', labelType: 'generic' };
    for (const action of scene.actions) action.cueSentenceId = cue;
    for (const shot of scene.cameraShots) shot.cueSentenceId = cue;
    for (const gesture of scene.presenter.gestureCues) gesture.cueSentenceId = cue;
    if (!second && !calls.includes('invalid')) {
      calls.push('invalid');
      scene.objects = [];
    } else if (!second && !calls.includes('position')) {
      assert.match(prompt, /objetos com IDs únicos/);
      calls.push('position');
      scene.layouts.portrait.objects.sender.y = 0.9;
    } else {
      if (!second) {
        assert.match(prompt, /objetos com IDs únicos/);
        assert.match(prompt, /posição fora dos limites/);
      }
      calls.push(second ? 'scene-02' : 'repaired');
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ scenes: [scene] }) } }] }) };
  };
  const result = await authorNarrativeScenes({ plan, cacheDir, logger: {}, reserve: async () => {}, request });
  assert.equal(result.scenes.length, 2);
  assert.deepEqual(calls, ['batch', 'batch', 'invalid', 'position', 'repaired', 'scene-02']);
});

test('mesmo defeito de capítulo não gera ciclo infinito de reparos', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-repeat-'));
  const previousKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'test-only';
  t.after(async () => {
    if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousKey;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const plan = basePlan();
  plan.chapters = [
    { id: 'hook', kind: 'hook', title: 'Origem', startFrame: 0, durationInFrames: 24, sentenceIds: ['hook-sentence-1'] },
    { id: 'section-1', kind: 'section', title: 'Destino', startFrame: 24, durationInFrames: 24, sentenceIds: ['hook-sentence-2'] }
  ];
  plan.sentences[1].groupId = 'section-1';
  plan.inputSha256 = narrativePlanInputSha256(plan);
  const calls = [];
  await assert.rejects(authorNarrativeScenes({ plan, cacheDir, logger: {}, reserve: async () => {},
    request: async ({ body }) => {
      const compact = body.messages[0].content.split('Responda somente')[0];
      if (compact.includes('"id":"scene-01"') && compact.includes('"id":"scene-02"')) {
        calls.push('batch');
        throw Object.assign(new Error('expired'), { name: 'TimeoutError' });
      }
      calls.push(body.model);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ scenes: [authoredScene({ objects: [] })] }) } }] }) };
    }
  }), error => error.code === 'NARRATIVE_SCENE_PROVIDER_UNAVAILABLE');
  assert.deepEqual(calls, ['batch', 'batch', 'nvidia/nemotron-3.5-lightning-30b-a3b',
    'nvidia/nemotron-3.5-lightning-30b-a3b', 'z-ai/glm-5.3-flash']);
});

test('reparos de defeitos sempre diferentes respeitam o limite por capítulo', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-repair-limit-'));
  const previousKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'test-only';
  t.after(async () => {
    if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousKey;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const plan = basePlan();
  plan.chapters = [
    { id: 'hook', kind: 'hook', title: 'Origem', startFrame: 0, durationInFrames: 24, sentenceIds: ['hook-sentence-1'] },
    { id: 'section-1', kind: 'section', title: 'Destino', startFrame: 24, durationInFrames: 24, sentenceIds: ['hook-sentence-2'] }
  ];
  plan.sentences[1].groupId = 'section-1';
  plan.inputSha256 = narrativePlanInputSha256(plan);
  const models = [];
  await assert.rejects(authorNarrativeScenes({ plan, cacheDir, logger: {}, reserve: async () => {},
    request: async ({ body }) => {
      const compact = body.messages[0].content.split('Responda somente')[0];
      if (compact.includes('"id":"scene-01"') && compact.includes('"id":"scene-02"')) {
        throw Object.assign(new Error('expired'), { name: 'TimeoutError' });
      }
      models.push(body.model);
      const scene = authoredScene();
      scene.objects[1] = { ...scene.objects[1], label: 'resultado', labelType: 'generic' };
      scene.layouts.portrait.objects.sender.y = 1 + models.length;
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ scenes: [scene] }) } }] }) };
    }
  }), error => error.code === 'NARRATIVE_SCENE_PROVIDER_UNAVAILABLE');
  assert.equal(models.filter(model => model === 'nvidia/nemotron-3.5-lightning-30b-a3b').length, 6);
  assert.equal(models.at(-1), 'z-ai/glm-5.3-flash');
  assert.equal(models.length, 7);
});

test('episódio com muitos capítulos começa por uma cena e não por lote grande', async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-scene-large-'));
  const previousKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'test-only';
  t.after(async () => {
    if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousKey;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const plan = basePlan();
  plan.chapters = Array.from({ length: 4 }, (_, i) => ({ id: `chapter-${i}`, kind: 'section', title: `Capítulo ${i}`,
    startFrame: i * 12, durationInFrames: 12, sentenceIds: [`sentence-${i}`] }));
  plan.sentences = plan.chapters.map((chapter, i) => ({ id: `sentence-${i}`, groupId: chapter.id,
    text: `Frase ${i}.`, startFrame: i * 12, endFrame: (i + 1) * 12 }));
  plan.claims = plan.sentences.map(sentence => ({ id: `claim-${sentence.id}`, sentenceId: sentence.id,
    text: sentence.text, sourceContextHash: plan.source.contextHash }));
  plan.inputSha256 = narrativePlanInputSha256(plan);
  const calls = [];
  await assert.rejects(authorNarrativeScenes({ plan, cacheDir, logger: {}, reserve: async () => {},
    request: async ({ body }) => {
      const compact = body.messages[0].content.split('Responda somente')[0];
      assert.equal(body.max_tokens, 16000);
      calls.push(compact.includes('"id":"scene-02"') ? 'batch' : 'scene-01');
      throw Object.assign(new Error('expired'), { name: 'TimeoutError' });
    }
  }), error => error.code === 'NARRATIVE_SCENE_PROVIDER_UNAVAILABLE');
  assert.deepEqual(calls, ['scene-01', 'scene-01']);
});
