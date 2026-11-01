'use strict';

const { cueHasExplicitFlow } = require('./narrative-beat-relation');

function normalizeVisualText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
}

function cueRequiresPairedVisual(text) {
  return cueHasExplicitFlow(text) || /\b(?:divid\w*|separ\w*|fragment\w*|transform\w*|convert\w*)\b.{0,100}\b(?:em|para|entre)\b/.test(normalizeVisualText(text));
}

function cueRequiresRoutes(text) {
  const normalized = normalizeVisualText(text);
  return /\b(?:trajetos?|rotas?|caminhos?|percursos?)\b.{0,55}\b(?:diferentes|alternativos|alternativas|distintos|distintas)\b/.test(normalized)
    || /\b(?:diferentes|alternativos|alternativas|distintos|distintas)\b.{0,55}\b(?:trajetos?|rotas?|caminhos?|percursos?)\b/.test(normalized);
}

// Long spoken beats must change visual focus during the narration rather than
// holding a single pictogram. This is a minimum rhythm check, not aesthetic QA.
function cueHasLongBeatVariation({ cue, scene, fps }) {
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(cue?.startFrame) || !Number.isFinite(cue?.endFrame)) return false;
  if (cue.endFrame - cue.startFrame <= 12 * fps) return true;
  const shots = (scene.cameraShots || []).filter(shot => shot.cueSentenceId === cue.id)
    .sort((a, b) => a.startFrame - b.startFrame);
  const first = (scene.objects || []).find(object => object.id === shots[0]?.focusObjectId);
  if (!first) return false;
  return shots.some((shot, index) => {
    const focused = (scene.objects || []).find(object => object.id === shot.focusObjectId);
    return index > 0 && focused && shot.focusObjectId !== shots[0].focusObjectId
      && shot.startFrame > shots[0].startFrame
      && (focused.kind !== first.kind || normalizeVisualText(focused.label) !== normalizeVisualText(first.label));
  });
}

function includesLiteral(corpus, label) {
  const normalized = normalizeVisualText(label);
  if (!normalized) return false;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'u').test(corpus);
}

function validateCueVisualGrounding({ scene, cue, previousCue }) {
  const actions = (scene.actions || []).filter(action => action.cueSentenceId === cue.id);
  const shots = (scene.cameraShots || []).filter(shot => shot.cueSentenceId === cue.id);
  const ids = new Set([...actions.map(action => action.targetObjectId), ...shots.map(shot => shot.focusObjectId)]);
  const selected = (scene.objects || []).filter(object => ids.has(object.id));
  const corpus = normalizeVisualText(`${previousCue?.text || ''} ${cue.text || ''}`);
  const grounded = selected.some(object => object.labelType === 'illustrative'
    || (object.labelType === 'literal' && includesLiteral(corpus, object.label)));
  return { grounded, paired: !cueRequiresPairedVisual(cue.text) || ids.size >= 2,
    routes: !cueRequiresRoutes(cue.text) || selected.some(object => object.kind === 'map' || object.kind === 'network'),
    signature: `${[...ids].sort().join(',')}|${actions.map(action => action.kind).sort().join(',')}|${shots.map(shot => shot.kind).sort().join(',')}` };
}

module.exports = { cueHasLongBeatVariation, cueRequiresPairedVisual, cueRequiresRoutes, validateCueVisualGrounding };
