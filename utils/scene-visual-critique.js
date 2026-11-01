'use strict';

const crypto = require('node:crypto');

const REVEAL_COMPONENTS = new Set([
  'article-print', 'bento-card', 'checklist', 'clip-title', 'compare-table', 'donut-chart',
  'highlight', 'image-hero', 'image-panel', 'kinetic-number', 'line-chart', 'news-card',
  'node-graph', 'progress-bar', 'progressive-comparison', 'pulse-glow', 'rank-list',
  'rotation-cards', 'score-chart', 'spec-chips'
]);
const DECORATIVE_COMPONENTS = new Set(['highlight', 'pulse-glow']);

function buildScenePlanEvidence(scenes) {
  if (!Array.isArray(scenes) || !scenes.length) throw new TypeError('scene plan must contain scenes');
  const sceneIds = scenes.map(scene => String(scene?.id || ''));
  if (sceneIds.some(id => !/^[A-Za-z0-9_-]{1,96}$/.test(id)) || new Set(sceneIds).size !== sceneIds.length) {
    throw new TypeError('scene plan contains invalid or duplicate scene IDs');
  }
  const sha256 = crypto.createHash('sha256').update(JSON.stringify(scenes)).digest('hex');
  return { schemaVersion: 1, sha256, sceneIds };
}

function normalizeSceneCorrection(correction) {
  if (!correction || typeof correction !== 'object' || Array.isArray(correction)) {
    throw new TypeError('visual correction must be an object');
  }
  const operation = String(correction.operation || '');
  const keys = Object.keys(correction).sort();
  const exactKeys = allowed => {
    if (JSON.stringify(keys) !== JSON.stringify([...allowed].sort())) {
      throw new TypeError(`visual correction ${operation} has unsupported fields`);
    }
  };
  const componentTarget = () => {
    if (!REVEAL_COMPONENTS.has(String(correction.componentType || ''))) {
      throw new TypeError(`visual correction ${operation} has unsupported componentType`);
    }
    if (!Number.isInteger(correction.componentIndex) || correction.componentIndex < 0 || correction.componentIndex > 100) {
      throw new TypeError(`visual correction ${operation} requires a valid componentIndex`);
    }
    return { componentType: correction.componentType, componentIndex: correction.componentIndex };
  };

  if (operation === 'set-layout') {
    exactKeys(['operation', 'layout']);
    if (!['hero', 'split', 'splitLeft'].includes(correction.layout)) {
      throw new TypeError('set-layout requires hero, split or splitLeft');
    }
    return { operation, layout: correction.layout };
  }
  if (operation === 'set-presenter-visibility') {
    exactKeys(['operation', 'visible']);
    if (typeof correction.visible !== 'boolean') throw new TypeError('presenter visibility must be boolean');
    return { operation, visible: correction.visible };
  }
  if (operation === 'remove-component') {
    exactKeys(['operation', 'componentType', 'componentIndex']);
    if (!DECORATIVE_COMPONENTS.has(String(correction.componentType || ''))) {
      throw new TypeError('remove-component only permits explicitly identified highlight or pulse-glow decorations');
    }
    return { operation, ...componentTarget() };
  }
  if (operation === 'set-reveal-time') {
    exactKeys(['operation', 'componentType', 'componentIndex', 'revealAtMs']);
    const { componentType, componentIndex } = componentTarget();
    if (!Number.isInteger(correction.revealAtMs) || correction.revealAtMs < 0 || correction.revealAtMs > 60_000) {
      throw new TypeError('revealAtMs must be an integer from 0 to 60000');
    }
    return { operation, componentType, componentIndex, revealAtMs: correction.revealAtMs };
  }
  throw new TypeError(`unsupported visual correction operation: ${operation || '(empty)'}`);
}

function applyCorrection(scene, correction) {
  const components = Array.isArray(scene.components) ? scene.components : [];
  if (correction.operation === 'set-layout') {
    delete scene.hero;
    delete scene.split;
    delete scene.splitLeft;
    if (correction.layout === 'hero') scene.hero = true;
    if (correction.layout === 'split') scene.split = true;
    if (correction.layout === 'splitLeft') {
      scene.split = true;
      scene.splitLeft = true;
    }
    return;
  }
  if (correction.operation === 'set-presenter-visibility') {
    scene.presenter = correction.visible;
    return;
  }
  const component = components[correction.componentIndex];
  if (!component || component.type !== correction.componentType) {
    throw new Error(`visual correction target mismatch in scene ${scene.id} at component ${correction.componentIndex}`);
  }
  if (correction.operation === 'remove-component') {
    if (!DECORATIVE_COMPONENTS.has(component.type)) {
      throw new Error(`visual correction cannot remove non-decorative component in scene ${scene.id}`);
    }
    components.splice(correction.componentIndex, 1);
    return;
  }
  if (correction.operation === 'set-reveal-time') {
    if (!Object.hasOwn(component, 'revealAtMs')) {
      throw new Error(`visual correction target has no reveal timing in scene ${scene.id}`);
    }
    if (correction.revealAtMs >= Number(scene.durationMs)) {
      throw new Error(`visual correction reveal time exceeds scene ${scene.id} duration`);
    }
    component.revealAtMs = correction.revealAtMs;
  }
}

function applySceneVisualCritique(scenes, critique) {
  const basePlan = buildScenePlanEvidence(scenes);
  if (critique == null) {
    return {
      scenes,
      evidence: { ...basePlan, baseSha256: basePlan.sha256 },
      rebuild: null
    };
  }
  if (!critique || critique.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(String(critique.sourceQaManifestSha256 || ''))
    || !/^[a-f0-9]{64}$/.test(String(critique.critiqueManifestSha256 || ''))
    || critique.sourceScenePlanSha256 !== basePlan.sha256
    || !Array.isArray(critique.sceneIds) || !Array.isArray(critique.findings)
    || critique.findings.length < 1 || critique.findings.length > 50) {
    const error = new Error('visual critique does not match the current hash-bound scene plan');
    error.code = 'VISUAL_CRITIQUE_PLAN_MISMATCH';
    throw error;
  }
  const knownIds = new Set(basePlan.sceneIds);
  const targetedIds = [...new Set(critique.findings.map(finding => String(finding?.sceneId || '')))];
  const declaredIds = [...new Set(critique.sceneIds.map(String))];
  if (targetedIds.some(id => !knownIds.has(id)) || declaredIds.length !== targetedIds.length
    || declaredIds.some(id => !targetedIds.includes(id))) {
    const error = new Error('visual critique scene IDs do not match the current scene plan');
    error.code = 'VISUAL_CRITIQUE_SCENE_ID_MISMATCH';
    throw error;
  }

  const adjustedScenes = JSON.parse(JSON.stringify(scenes));
  const sceneById = new Map(adjustedScenes.map(scene => [scene.id, scene]));
  const findings = critique.findings.map(finding => ({
    sceneId: String(finding.sceneId),
    correction: normalizeSceneCorrection(finding.correction)
  }));
  for (const finding of findings) applyCorrection(sceneById.get(finding.sceneId), finding.correction);
  const finalPlan = buildScenePlanEvidence(adjustedScenes);
  const correctionSetSha256 = crypto.createHash('sha256').update(JSON.stringify(findings)).digest('hex');
  const evidence = {
    ...finalPlan,
    baseSha256: basePlan.sha256,
    rebuild: {
      sourceQaManifestSha256: critique.sourceQaManifestSha256,
      critiqueManifestSha256: critique.critiqueManifestSha256,
      correctionSetSha256,
      sourceScenePlanSha256: basePlan.sha256,
      sceneIds: declaredIds,
      correctionsApplied: findings.length
    }
  };
  return { scenes: adjustedScenes, evidence, rebuild: evidence.rebuild };
}

module.exports = { buildScenePlanEvidence, normalizeSceneCorrection, applySceneVisualCritique };
