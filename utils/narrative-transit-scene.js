'use strict';

const clean = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// This illustration is only applicable to an episode explicitly about
// thanking a bus driver. Other subjects keep their own scene vocabulary.
function transitBeat({ title, episodeText, sentence }) {
  if (!/\bmotorist[ao]s?\b/.test(clean(title)) || !/\bonibus\b/.test(clean(episodeText))) return null;
  const text = clean(sentence?.text);
  if (/\b(?:estudos?|pesquisas?|publicad[ao]s?|nao|nunca|sem)\b/.test(text)) return null;
  // The scene shows a passenger thanking the driver, not the reverse.
  if (/\b(?:ela|passageir[ao]s?)\s+agradec\w*\s+(?:ao|aos|a|para o)\s+motorist[ao]s?\b/.test(text)) return 'gratitude';
  // A static scene of people inside a bus; other transit actions need their
  // own illustration rather than being silently changed into this one.
  if (/^(?:os |as )?passageir[ao]s?\s+est(?:a|ao)\s+no\s+onibus[.!?]?$/u.test(text.trim())) return 'journey';
  return null;
}

function transitCueProgress(sentence, frame, words) {
  const timings = Array.isArray(sentence?.wordTimings) ? sentence.wordTimings : [];
  const trigger = timings.find(item => words.some(word => clean(item.text).startsWith(word)));
  const start = trigger?.startFrame ?? sentence?.startFrame ?? 0;
  const end = Math.max(start + 1, (sentence?.endFrame ?? start + 24) - 3);
  const p = Math.max(0, Math.min(1, (frame - start) / (end - start)));
  return p * p * (3 - 2 * p);
}

module.exports = { transitBeat, transitCueProgress };
