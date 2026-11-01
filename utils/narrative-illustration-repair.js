'use strict';

const { narrativeObjectVisual } = require('./narrative-concept-visual');
const { cueHasExplicitFlow, narrativeBeatRelation } = require('./narrative-beat-relation');
const { narrativeLabelCueFrame } = require('./narrative-word-cue');
const { transitBeat } = require('./narrative-transit-scene');
const { gratitudeResearchBeat } = require('./narrative-research-gratitude');
const { applianceVisualMode } = require('./narrative-appliance-scene');

const KINDS = ['token', 'product', 'document', 'person', 'device', 'vehicle', 'building', 'nature', 'cell', 'network', 'map'];

// Only literal words that the renderer already knows how to draw are eligible.
// Unknown terms are left for the author to repair; they never become generic
// icons merely to satisfy the gate.
function concreteCandidates(sentence) {
  const text = String(sentence?.text || '');
  const phrases = [/\bunidade\s+de\s+sa[uú]de\b/iu, /\blembran[cç]a\s+da\s+escassez\b/iu, /\balgo\s+estragado\b/iu]
    .map(pattern => pattern.exec(text)).filter(Boolean).map(match => ({ label: match[0], at: match.index }));
  const found = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map(match => ({ label: match[0], at: match.index }))
    .filter(word => !phrases.some(phrase => word.at >= phrase.at && word.at + word.label.length <= phrase.at + phrase.label.length));
  found.push(...phrases);
  found.sort((a, b) => a.at - b.at || b.label.length - a.label.length);
  const seen = new Set();
  const candidates = [];
  for (const { label } of found) {
    const key = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (label.length < 3 || label.length > 24 || /^\d+$/.test(label) || seen.has(key)) continue;
    for (const kind of KINDS) {
      const candidate = { id: `candidate-${candidates.length}`, label, kind, labelType: 'literal', illustrative: false };
      if (narrativeObjectVisual(candidate, sentence).kind === 'concept_text') continue;
      candidates.push(candidate);
      seen.add(key);
      break;
    }
  }
  return candidates;
}

function findNarrativeEnrichmentCues(plan) {
  if (plan?.schemaVersion !== 'pulso.narrative-episode/v2') return [];
  const episodeText = (plan.sentences || []).map(sentence => sentence.text || '').join(' ');
  const result = [];
  for (const sentence of plan.sentences || []) {
    if (gratitudeResearchBeat(sentence) || transitBeat({ title: plan.title, episodeText, sentence })
      || applianceVisualMode({ title: plan.title, sentence })) continue;
    const scene = (plan.scenes || []).find(item => item.sentenceIds.includes(sentence.id));
    if (!scene) continue;
    const candidates = concreteCandidates(sentence);
    if (candidates.length < 2) continue;
    const ids = new Set([...scene.actions.filter(action => action.cueSentenceId === sentence.id).map(action => action.targetObjectId),
      ...scene.cameraShots.filter(shot => shot.cueSentenceId === sentence.id).map(shot => shot.focusObjectId)]);
    const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const drawnLabels = scene.objects.filter(object => ids.has(object.id)
      && narrativeObjectVisual(object, sentence).kind !== 'concept_text').map(object => normalized(object.label));
    const covered = candidate => {
      const label = normalized(candidate.label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return drawnLabels.some(drawn => new RegExp(`(?:^|[^\\p{L}\\p{N}])${label}(?:$|[^\\p{L}\\p{N}])`, 'u').test(drawn));
    };
    if (candidates.some(candidate => !covered(candidate))) result.push(sentence.id);
  }
  return result;
}

function repairNarrativeIllustrations(plan, missingIds) {
  if (plan?.schemaVersion !== 'pulso.narrative-episode/v2' || !Array.isArray(missingIds)) return { plan, repaired: [] };
  const next = JSON.parse(JSON.stringify(plan));
  const repaired = [];
  for (const cueId of missingIds) {
    const sentence = next.sentences.find(item => item.id === cueId);
    const scene = next.scenes.find(item => item.sentenceIds.includes(cueId));
    if (!sentence || !scene) continue;
    const candidates = concreteCandidates(sentence);
    const flow = narrativeBeatRelation({ sentence: sentence.text, objects: candidates });
    const isFlow = cueHasExplicitFlow(sentence.text);
    if (!candidates.length || isFlow && flow?.kind !== 'flow' || candidates.length > (isFlow ? 8 : 4)) continue;
    if (candidates.length > 1 && candidates.some(item => narrativeLabelCueFrame(item.label, sentence) === null)) continue;
    const mapped = candidates.map((candidate, index) => {
      const existing = scene.objects.find(object => object.label === candidate.label
        && narrativeObjectVisual(object, sentence).kind !== 'concept_text');
      if (existing) return existing;
      let id = `auto-${next.sentences.indexOf(sentence) + 1}-${index + 1}`;
      while (scene.objects.some(object => object.id === id)) id += 'x';
      const object = { ...candidate, id };
      scene.objects.push(object);
      for (const aspect of ['landscape', 'portrait']) {
        const x = aspect === 'landscape' ? [0.2, 0.34, 0.49][index % 3] : [0.25, 0.5, 0.75][index % 3];
        scene.layouts[aspect].objects[id] = { x, y: aspect === 'landscape' ? 0.34 : 0.24, scale: 0.9 };
      }
      return object;
    });
    scene.actions = scene.actions.filter(action => action.cueSentenceId !== cueId);
    scene.cameraShots = scene.cameraShots.filter(shot => shot.cueSentenceId !== cueId);
    for (const object of mapped) {
      const cueFrame = narrativeLabelCueFrame(object.label, sentence) ?? sentence.startFrame;
      const startFrame = Math.min(sentence.endFrame - 1, Math.max(sentence.startFrame, cueFrame));
      const endFrame = Math.min(sentence.endFrame, startFrame + Math.max(1, Math.round(next.fps * 1.2)));
      const trajectories = {};
      for (const aspect of ['landscape', 'portrait']) {
        const position = scene.layouts[aspect].objects[object.id];
        trajectories[aspect] = { from: { ...position }, to: { ...position } };
      }
      scene.actions.push({ targetObjectId: object.id, cueSentenceId: cueId, kind: 'reveal-part', startFrame, endFrame, trajectories });
    }
    scene.cameraShots.push({ cueSentenceId: cueId, kind: 'wide', focusObjectId: mapped[0].id, startFrame: sentence.startFrame });
    if (mapped.length > 1) scene.cameraShots.push({ cueSentenceId: cueId, kind: 'result', focusObjectId: mapped[mapped.length - 1].id,
      startFrame: Math.min(sentence.endFrame - 1, sentence.startFrame + Math.max(1, Math.floor((sentence.endFrame - sentence.startFrame) / 2))) });
    scene.cameraShots.sort((a, b) => a.startFrame - b.startFrame);
    repaired.push(cueId);
  }
  // Remove orphaned author objects after replacing a cue, retaining every
  // object referenced by another action or camera shot.
  for (const scene of next.scenes) {
    const used = new Set([...scene.actions.map(action => action.targetObjectId), ...scene.cameraShots.map(shot => shot.focusObjectId)]);
    scene.objects = scene.objects.filter(object => used.has(object.id));
    for (const aspect of ['landscape', 'portrait']) {
      for (const id of Object.keys(scene.layouts[aspect].objects)) if (!used.has(id)) delete scene.layouts[aspect].objects[id];
    }
  }
  return { plan: next, repaired };
}

module.exports = { concreteCandidates, findNarrativeEnrichmentCues, repairNarrativeIllustrations };
