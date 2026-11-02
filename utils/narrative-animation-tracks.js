'use strict';
const { narrativeLabelCueFrame } = require('./narrative-word-cue');
const fail = message => { throw new Error(`illustration: ${message}`); };
const PROPERTIES = new Set(['position3d', 'rotation3d', 'scale3d', 'opacity', 'target3d']);
const EASINGS = new Set(['linear', 'smooth', 'ease-in', 'ease-out']);
const fold = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Keyframes reference the chapter's spoken timeline, not the active sentence.
// This preserves object identity and motion across cuts and caption changes.
function normalizeAnimationTracks(raw, nodes, sentences, fps, { orderByTime = false } = {}) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 128) fail('trilhas excessivas');
  const start = Math.min(...sentences.map(s => s.startFrame));
  const end = Math.max(...sentences.map(s => s.endFrame));
  const seen = new Set();
  return raw.map(track => {
    const node = track.targetId === 'camera' ? { id: 'camera', meshes: [] } : nodes.find(item => item.id === track.targetId);
    if (!node || !PROPERTIES.has(track.property)) fail('trilha sem alvo/propriedade permitida');
    if (track.targetId === 'camera' ? !['position3d', 'target3d'].includes(track.property) : track.property === 'target3d') fail('propriedade de câmera inválida');
    const meshIndex = track.meshIndex;
    if (meshIndex != null && (!Number.isInteger(meshIndex) || meshIndex < 0 || meshIndex >= node.meshes.length)) fail('trilha sem malha válida');
    const id = `${track.targetId}:${meshIndex ?? 'node'}:${track.property}`;
    if (seen.has(id)) fail('trilhas concorrentes para a mesma propriedade');
    seen.add(id);
    if (!Array.isArray(track.keyframes) || track.keyframes.length < 2 || track.keyframes.length > 64) fail('trilha precisa de 2–64 estados');
    const parsed = track.keyframes.map(key => {
      const sentence = sentences.find(item => item.id === key.cueSentenceId);
      if (!sentence) fail('trilha sem frase válida');
      const boundary = key.boundary || 'word';
      if (!['start', 'end', 'word'].includes(boundary)) fail('limite de cue inválido');
      if (boundary === 'word' && (!key.cueText || !fold(sentence.text).includes(fold(key.cueText)))) fail('trilha sem palavra narrada');
      const offsetSeconds = key.offsetSeconds ?? 0;
      if (!Number.isFinite(offsetSeconds) || Math.abs(offsetSeconds) > 12) fail('offset de trilha inválido');
      const anchor = boundary === 'start' ? sentence.startFrame : boundary === 'end' ? sentence.endFrame : narrativeLabelCueFrame(key.cueText, sentence) ?? sentence.startFrame;
      const frame = Math.max(start, Math.min(end, anchor + Math.round(offsetSeconds * fps)));
      const easing = key.easing || 'linear';
      if (!EASINGS.has(easing)) fail('curva da trilha inválida');
      const scalar = track.property === 'opacity';
      const values = scalar ? [key.value] : key.value;
      const spatial = ['position3d', 'target3d'].includes(track.property);
      const min = scalar ? 0 : track.property === 'scale3d' ? .001 : spatial ? -24 : -1000;
      const max = scalar ? 1 : track.property === 'scale3d' ? 10 : spatial ? 24 : 1000;
      if (!Array.isArray(values) || values.length !== (scalar ? 1 : 3) || values.some(value => !Number.isFinite(value) || value < min || value > max)) {
        fail(`estado da trilha inválido em ${node.id}.${track.property}; value deve ser ${scalar ? 'um número, nunca vetor' : 'vetor de três números [x,y,z]'} entre ${min} e ${max}`);
      }
      return { cueSentenceId: sentence.id, boundary, ...(key.cueText ? { cueText: key.cueText } : {}), offsetSeconds,
        frame, value: scalar ? values[0] : [...values], easing };
    });
    // Some writers copy the cue's elapsed time into an offset that is already
    // relative to that same cue. When this demonstrably clamps distinct word
    // cues to the same end frame, use the measured word times themselves.
    // Restrict this to two word states with real word alignment and offsets
    // matching the elapsed word times; ambiguous collisions remain errors.
    if (orderByTime && parsed.length === 2 && parsed[0].frame === end && parsed[1].frame === end
      && parsed.every(key => key.boundary === 'word' && key.offsetSeconds > 0)
      && parsed[0].cueSentenceId === parsed[1].cueSentenceId) {
      const sentence = sentences.find(item => item.id === parsed[0].cueSentenceId);
      const anchors = parsed.map(key => narrativeLabelCueFrame(key.cueText, sentence));
      const copiedElapsed = anchors.every((anchor, index) => anchor != null
        && Math.abs(parsed[index].offsetSeconds - (anchor - sentence.startFrame) / fps) <= .2);
      if (copiedElapsed && anchors[0] < anchors[1]) {
        for (let i = 0; i < parsed.length; i++) {
          parsed[i].offsetSeconds = 0;
          parsed[i].frame = anchors[i];
        }
      }
    }
    // An author may list measured cues in object order instead of time order.
    // Order the explicit time/value pairs only during authorship. Publication
    // remains strict; neither cues, values nor their easing are retimed.
    if (orderByTime) parsed.sort((a, b) => a.frame - b.frame);
    let lastFrame = -Infinity;
    let lastValue;
    let lastEasing;
    const keyframes = parsed.filter(key => {
      const { frame, easing } = key;
      const values = Array.isArray(key.value) ? key.value : [key.value];
      const identical = lastValue && values.every((value, index) => value === lastValue[index]) && easing === lastEasing;
      // A word offset and an end hold can clamp to the same final frame. An
      // identical value/curve adds no motion; remove only that redundant hold.
      if (frame === lastFrame && identical) return false;
      if (frame <= lastFrame) fail(`trilha precisa de tempos estritamente crescentes em ${node.id}.${track.property}; frame ${frame} não supera ${lastFrame}; ajuste boundary/cueText/offsetSeconds sem sair da frase`);
      lastFrame = frame;
      lastValue = values;
      lastEasing = easing;
      return true;
    });
    if (keyframes.length < 2) fail('trilha precisa de 2–64 estados distintos no tempo');
    return { targetId: node.id, property: track.property, ...(meshIndex == null ? {} : { meshIndex }), keyframes };
  });
}

function evaluateAnimationTrack(track, frame) {
  const keys = track.keyframes;
  if (frame <= keys[0].frame) return keys[0].value;
  if (frame >= keys[keys.length - 1].frame) return keys[keys.length - 1].value;
  const index = keys.findIndex(key => key.frame >= frame);
  const a = keys[index - 1], b = keys[index];
  let p = (frame - a.frame) / (b.frame - a.frame);
  if (b.easing === 'smooth') p = p * p * (3 - 2 * p);
  if (b.easing === 'ease-in') p *= p;
  if (b.easing === 'ease-out') p = 1 - (1 - p) ** 2;
  const mix = (left, right) => left + (right - left) * p;
  return Array.isArray(a.value) ? a.value.map((v, i) => mix(v, b.value[i])) : mix(a.value, b.value);
}

function animationState(tracks, targetId, frame, meshIndex) {
  const state = {};
  for (const track of tracks || []) if (track.targetId === targetId && track.meshIndex === meshIndex) {
    state[track.property] = evaluateAnimationTrack(track, frame);
  }
  return state;
}
module.exports = { normalizeAnimationTracks, evaluateAnimationTrack, animationState };
