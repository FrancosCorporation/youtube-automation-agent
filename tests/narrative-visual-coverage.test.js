'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { auditNarrativeVisualCoverage, assertNarrativeVisualCoverage } = require('../utils/narrative-visual-coverage');
const { ScenePlanBuilder } = require('../utils/scene-plan-builder');

test('rejects beats covered only by captions, headlines, source cards, or text cards', () => {
  const result = auditNarrativeVisualCoverage([{ id: 's1', groupIndex: 1, groupKind: 'section', groupTitle: 'Ação', components: [
    { type: 'caption' }, { type: 'demo-header' }, { type: 'news-card' }, { type: 'bento-card' }
  ] }]);
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing.map(scene => scene.groupTitle), ['Ação']);
  assert.throws(() => assertNarrativeVisualCoverage([{ id: 's1', components: [] }]), {
    code: 'narrative_visual_coverage_incomplete'
  });
});

test('accepts concrete images and semantic explanatory visuals', () => {
  const result = auditNarrativeVisualCoverage([
    { id: 's1', components: [{ type: 'image-hero', src: 'asset' }] },
    { id: 's2', components: [{ type: 'node-graph', nodes: ['A', 'B'] }] },
    { id: 's3', components: [{ type: 'progressive-comparison', items: [{}, {}] }] },
    { id: 's4', components: [{ type: 'checklist', items: [{}, {}] }] }
  ]);
  assert.deepEqual(result, { complete: true, missing: [] });
  assert.deepEqual(assertNarrativeVisualCoverage([{ id: 's1', components: [{ type: 'rotation-cards', cards: [{}, {}] }] }]), result);
});

test('Atlas story illustrations count only when they name a supported narrative beat', () => {
  assert.equal(auditNarrativeVisualCoverage([{ id: 's1', components: [
    { type: 'atlas-story-scene', beat: 'retrieval' }
  ] }]).complete, true);
  assert.equal(auditNarrativeVisualCoverage([{ id: 's1', components: [
    { type: 'atlas-story-scene', beat: 'unknown' }
  ] }]).complete, false);
});

test('reports every uncovered narration beat rather than accepting one visual per section', () => {
  const result = auditNarrativeVisualCoverage([
    { id: 's1_0', groupIndex: 1, narrationSentenceIndex: 0, groupTitle: 'Processo', components: [{ type: 'image-hero', src: 'asset-a' }] },
    { id: 's1_1', groupIndex: 1, narrationSentenceIndex: 1, groupTitle: 'Processo', components: [{ type: 'caption' }, { type: 'bento-card' }] }
  ]);
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing.map(scene => scene.narrationSentenceIndex), [1]);
});

test('production scene plans with no generated imagery cannot pass on text cards alone', () => {
  const script = {
    forceLayout: 'text',
    hook: 'Abertura da história.',
    mainContent: { sections: [{ title: 'Ação', content: 'A personagem toma uma decisão.' }] },
    conclusion: { finalThought: 'A consequência ainda será revelada.' }
  };
  const scenes = new ScenePlanBuilder().buildScenes(script, 12_000, {}, null, {
    coalesce: false, includeNarrationSentenceIndex: true
  });
  const result = auditNarrativeVisualCoverage(scenes);
  assert.equal(result.complete, false);
  assert.equal(result.missing.length, scenes.length);
});

test('production scene plans pass when every spoken group has concrete scene imagery', () => {
  const script = {
    forceLayout: 'hero',
    hook: 'Abertura da história.',
    mainContent: { sections: [{ title: 'Ação', content: 'A personagem toma uma decisão.' }] },
    conclusion: { finalThought: 'A consequência ainda será revelada.' }
  };
  const images = Object.fromEntries([0, 1, 2].map(groupIndex => [groupIndex, { sources: ['scene-a', 'scene-b'] }]));
  const scenes = new ScenePlanBuilder().buildScenes(script, 12_000, images, null, {
    coalesce: false, includeNarrationSentenceIndex: true
  });
  assert.deepEqual(assertNarrativeVisualCoverage(scenes), { complete: true, missing: [] });
});

test('explicit hook, section, and conclusion visuals stay synchronized to their spoken cues', () => {
  const script = {
    forceLayout: 'text',
    hook: { text: 'O pedido sai do navegador e cruza a rede.', visual: {
      type: 'node-graph', nodes: ['Navegador', 'Rede', 'Servidor'], cue: 'cruza a rede'
    } },
    mainContent: { sections: [{ title: 'Resposta', content: 'O servidor devolve a página ao navegador.', visual: {
      type: 'node-graph', nodes: ['Servidor', 'Página', 'Navegador'], cue: 'devolve a página'
    } }] },
    conclusion: { finalThought: 'Pedido, transporte e resposta completam o percurso.', visual: {
      type: 'node-graph', nodes: ['Pedido', 'Transporte', 'Resposta'], cue: 'completam o percurso'
    } }
  };
  const scenes = new ScenePlanBuilder().buildScenes(script, 12_000, {}, null, {
    coalesce: false, includeNarrationSentenceIndex: true
  });
  assert.deepEqual(assertNarrativeVisualCoverage(scenes), { complete: true, missing: [] });
  assert.deepEqual([...new Set(scenes.filter(scene => scene.components.some(component => component.type === 'node-graph'))
    .map(scene => scene.groupKind))], ['hook', 'section', 'conclusion']);
});
