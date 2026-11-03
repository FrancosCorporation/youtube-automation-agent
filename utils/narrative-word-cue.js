'use strict';

function words(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

// A label may appear as several timed TTS words; only an exact contiguous
// match is safe for cueing. Missing or ambiguous data stays un-timed.
function narrativeLabelCueFrames(label, sentence) {
  const wanted = words(label);
  const timed = (Array.isArray(sentence?.wordTimings) ? sentence.wordTimings : []).flatMap(item =>
    words(item.text).map(word => ({ word, startFrame: item.startFrame })));
  if (!wanted.length || !timed.length) return [];
  const matches = [];
  for (let index = 0; index <= timed.length - wanted.length; index++) {
    if (wanted.every((word, offset) => word === timed[index + offset].word) && Number.isFinite(timed[index].startFrame)) {
      matches.push(timed[index].startFrame);
    }
  }
  return matches;
}
function narrativeLabelCueFrame(label, sentence) {
  const matches = narrativeLabelCueFrames(label, sentence);
  return matches.length === 1 ? matches[0] : null;
}

// Repeated short words have no unique word anchor. Give the writer a measured
// start-relative cue for those words, so it never guesses the first occurrence.
function narrativeWordCues(sentence, fps) {
  return (sentence.wordTimings || []).map((word, index) => {
    const atSeconds = Number(((word.startFrame - sentence.startFrame) / fps).toFixed(6));
    const unique = narrativeLabelCueFrame(word.text, sentence) === word.startFrame;
    let phrase;
    for (let size = 2; size <= 6 && index + size <= sentence.wordTimings.length; size++) {
      const candidate = sentence.wordTimings.slice(index, index + size).map(w => w.text).join(' ');
      if (String(sentence.text).toLowerCase().includes(candidate.toLowerCase())
        && narrativeLabelCueFrame(candidate, sentence) === word.startFrame) { phrase = candidate; break; }
    }
    return { text: word.text, atSeconds, keyframeCue: unique
      ? { cueSentenceId: sentence.id, boundary: 'word', cueText: word.text, offsetSeconds: 0 }
      : atSeconds <= 12
        ? { cueSentenceId: sentence.id, boundary: 'start', offsetSeconds: atSeconds }
        : sentence.endFrame - word.startFrame <= fps * 12
          ? { cueSentenceId: sentence.id, boundary: 'end', offsetSeconds: Number(((word.startFrame - sentence.endFrame) / fps).toFixed(6)) }
          : phrase ? { cueSentenceId: sentence.id, boundary: 'word', cueText: phrase, offsetSeconds: 0 } : null };
  }).filter(cue => cue.keyframeCue);
}

module.exports = { narrativeLabelCueFrame, narrativeLabelCueFrames, narrativeWordCues };
