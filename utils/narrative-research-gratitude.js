'use strict';

function gratitudeResearchBeat(sentence) {
  const text = String(sentence?.text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return !/\b(?:nao|nunca|sem)\b/.test(text)
    && /\b(?:pesquis\w*|estud\w*)\b/.test(text)
    && /\b(?:gratidao|agradec\w*)\b/.test(text)
    && /\b(?:ajudar|ajuda|colabor\w*|valor social)\b/.test(text);
}

function gratitudeResearchMotion(sentence, frame) {
  const words = Array.isArray(sentence?.wordTimings) ? sentence.wordTimings : [];
  const progress = pattern => {
    const cue = words.find(word => pattern.test(String(word.text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()));
    return cue && Number.isFinite(cue.startFrame) ? Math.max(0, Math.min(1, (frame - cue.startFrame) / 18)) : 0;
  };
  return { gratitude: progress(/^(?:gratidao|agradec)/), help: progress(/^(?:ajud|colabor)/) };
}

module.exports = { gratitudeResearchBeat, gratitudeResearchMotion };
