'use strict';

function words(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

// A label may appear as several timed TTS words; only an exact contiguous
// match is safe for cueing. Missing or ambiguous data stays un-timed.
function narrativeLabelCueFrame(label, sentence) {
  const wanted = words(label);
  const timed = (Array.isArray(sentence?.wordTimings) ? sentence.wordTimings : []).flatMap(item =>
    words(item.text).map(word => ({ word, startFrame: item.startFrame })));
  if (!wanted.length || !timed.length) return null;
  const matches = [];
  for (let index = 0; index <= timed.length - wanted.length; index++) {
    if (wanted.every((word, offset) => word === timed[index + offset].word) && Number.isFinite(timed[index].startFrame)) {
      matches.push(timed[index].startFrame);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

module.exports = { narrativeLabelCueFrame };
