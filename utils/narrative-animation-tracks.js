'use strict';
const { isDeepStrictEqual } = require('node:util');
const { narrativeLabelCueFrame, narrativeLabelCueFrames, narrativeWordCues } = require('./narrative-word-cue');
const fail = message => { throw new Error(`illustration: ${message}`); };
const PROPERTIES = new Set(['position3d', 'rotation3d', 'scale3d', 'opacity', 'target3d']);
const EASINGS = new Set(['linear', 'smooth', 'ease-in', 'ease-out']);
const fold = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Writers sometimes repeat a track or split it at an identical endpoint.
// Join only an unambiguous chain of explicit states during authorship. Every
// cue, value and easing still passes the normal validation below.
function joinAuthoredTracks(raw) {
  const groups = new Map();
  for (const track of raw) {
    const id = `${track.targetId}:${track.meshIndex ?? 'node'}:${track.property}`;
    const group = groups.get(id) || [];
    if (!group.some(other => isDeepStrictEqual(other, track))) group.push(track);
    groups.set(id, group);
  }
  return [...groups.values()].map(group => {
    if (group.length === 1) return group[0];
    if (group.some(track => !Array.isArray(track.keyframes) || track.keyframes.length < 2)) return group;
    const links = track => group.filter(other => other !== track
      && isDeepStrictEqual(track.keyframes.at(-1), other.keyframes[0]));
    const starts = group.filter(track => !group.some(other => links(other).includes(track)));
    if (starts.length !== 1) return group;
    let current = starts[0];
    const visited = new Set([current]), keys = [...current.keyframes];
    while (links(current).length === 1) {
      current = links(current)[0];
      if (visited.has(current)) return group;
      visited.add(current);
      keys.push(...current.keyframes.slice(1));
    }
    if (visited.size !== group.length || links(current).length) return group;
    return { ...starts[0], keyframes: keys };
  }).flat();
}

// Keyframes reference the chapter's spoken timeline, not the active sentence.
// This preserves object identity and motion across cuts and caption changes.
function normalizeAnimationTracks(raw, nodes, sentences, fps, { orderByTime = false } = {}) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 128) fail('trilhas excessivas');
  if (orderByTime) raw = joinAuthoredTracks(raw);
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
    // Require real word alignment and copied elapsed times for every delayed
    // word in that sentence; ambiguous collisions remain errors.
    if (orderByTime) {
      for (const sentence of sentences) {
        const words = parsed.filter(key => key.cueSentenceId === sentence.id && key.boundary === 'word' && key.offsetSeconds > 0);
        const anchors = words.map(key => {
          const matches = narrativeLabelCueFrames(key.cueText, sentence)
            .filter(frame => Math.abs(key.offsetSeconds - (frame - sentence.startFrame) / fps) <= .25);
          return matches.length === 1 ? matches[0] : null;
        });
        const clamped = words.filter(key => key.frame === end).length >= 2;
        const copiedElapsed = words.length >= 2 && anchors.every((anchor, index) => anchor != null
          && Math.abs(words[index].offsetSeconds - (anchor - sentence.startFrame) / fps) <= .25);
        if (clamped && copiedElapsed && new Set(anchors).size === anchors.length) {
          for (let i = 0; i < words.length; i++) {
            const unique = narrativeLabelCueFrame(words[i].cueText, sentence) === anchors[i];
            const measuredCue = unique ? { boundary: 'word', offsetSeconds: 0 }
              : narrativeWordCues(sentence, fps).find(cue => Math.round(cue.atSeconds * fps) + sentence.startFrame === anchors[i])?.keyframeCue;
            if (!measuredCue) continue;
            Object.assign(words[i], measuredCue);
            words[i].frame = anchors[i];
          }
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
