'use strict';

const NARRATIVE_VISUAL_TYPES = new Set([
  'image-hero', 'image-panel', 'node-graph', 'atlas-story-scene', 'checklist', 'rotation-cards',
  'progressive-comparison', 'compare-table', 'score-chart', 'line-chart',
  'donut-chart', 'rank-list'
]);

function isConcreteNarrativeVisual(component) {
  const type = component?.type;
  if (!NARRATIVE_VISUAL_TYPES.has(type)) return false;
  if (type === 'image-hero' || type === 'image-panel') return typeof component.src === 'string' && component.src.length > 0;
  if (type === 'node-graph') return Array.isArray(component.nodes) && component.nodes.length >= 2;
  if (type === 'atlas-story-scene') return ['hook', 'question-set', 'baseline', 'retrieval', 'result', 'coverage', 'distribution', 'caveat'].includes(component.beat);
  if (type === 'checklist') return Array.isArray(component.items) && component.items.length >= 2;
  if (type === 'rotation-cards') return Array.isArray(component.cards) && component.cards.length >= 2;
  if (type === 'progressive-comparison') return Array.isArray(component.items) && component.items.length >= 2;
  if (['compare-table', 'score-chart', 'line-chart', 'donut-chart', 'rank-list'].includes(type)) {
    return Array.isArray(component.items) && component.items.length >= 2;
  }
  return false;
}

function auditNarrativeVisualCoverage(scenes = []) {
  const sentenceVisuals = new Map();
  for (const scene of scenes) {
    const components = Array.isArray(scene?.components) ? scene.components : [];
    const groupIndex = Number.isInteger(scene?.groupIndex) ? scene.groupIndex : null;
    const sentenceIndex = Number.isInteger(scene?.narrationSentenceIndex) ? scene.narrationSentenceIndex : null;
    const sentenceKey = groupIndex !== null && sentenceIndex !== null
      ? `${groupIndex}:${sentenceIndex}` : `scene:${String(scene?.id || sentenceVisuals.size)}`;
    const record = sentenceVisuals.get(sentenceKey) || {
      sceneId: String(scene?.id || ''), groupIndex,
      narrationSentenceIndex: sentenceIndex, groupKind: String(scene?.groupKind || ''),
      groupTitle: String(scene?.groupTitle || ''), covered: false
    };
    record.covered ||= components.some(isConcreteNarrativeVisual);
    sentenceVisuals.set(sentenceKey, record);
  }
  const missing = [...sentenceVisuals.values()].filter(sentence => !sentence.covered)
    .map(({ covered: _covered, ...sentence }) => sentence);
  return { complete: missing.length === 0, missing };
}

function assertNarrativeVisualCoverage(scenes) {
  const result = auditNarrativeVisualCoverage(scenes);
  if (result.complete) return result;
  const labels = [...new Set(result.missing.map(scene => scene.groupTitle || scene.sceneId))].slice(0, 8);
  const error = new Error(`visual narrativo ausente em ${result.missing.length} beat(s): ${labels.join(', ')}`);
  error.code = 'narrative_visual_coverage_incomplete';
  error.missingNarrativeVisuals = result.missing;
  throw error;
}

module.exports = { NARRATIVE_VISUAL_TYPES, isConcreteNarrativeVisual, auditNarrativeVisualCoverage, assertNarrativeVisualCoverage };
