'use strict';

function normalizeToken(word) {
  return String(word || '').toLowerCase().replace(/[^\wÀ-ÿ-]/g, '');
}

function cueTokens(cues) {
  return (Array.isArray(cues) ? cues : []).flatMap(cue =>
    String(cue?.text || '').split(/\s+/).filter(Boolean));
}

// Subtitle providers may omit a standalone typographic quote or dash because
// it has no spoken duration. Keep those tokens in the source text for captions
// and rendering, but do not let them shift the spoken-word partition.
function spokenWords(text) {
  return String(text || '').split(/\s+/).filter(word => normalizeToken(word));
}

function isEdgeTtsWordBoundaryAlignment(alignment) {
  return alignment === 'edge-tts-word-boundary' || alignment === 'edge-tts-word-boundary-mixed';
}

function expandEdgeTtsBoundaryEvents(events, text) {
  const expectedWords = String(text || '').split(/\s+/).filter(Boolean);
  const words = [];
  let hadCombinedEvents = false;
  for (const [eventIndex, event] of (Array.isArray(events) ? events : []).entries()) {
    const eventWords = String(event?.text || '').trim().split(/\s+/).filter(Boolean);
    const startMs = Number(event?.startMs), endMs = Number(event?.endMs);
    if (!eventWords.length || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
      throw new Error(`Limite de palavra Edge TTS inválido na posição ${eventIndex + 1}`);
    }
    const weights = eventWords.map(word => Math.max(1, [...word].length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const durationMs = endMs - startMs;
    if (eventWords.length > 1) hadCombinedEvents = true;
    let elapsedWeight = 0;
    for (let index = 0; index < eventWords.length; index++) {
      const wordStartMs = startMs + durationMs * elapsedWeight / totalWeight;
      elapsedWeight += weights[index];
      const wordEndMs = index === eventWords.length - 1
        ? endMs : startMs + durationMs * elapsedWeight / totalWeight;
      if (wordEndMs <= wordStartMs) throw new Error(`Limite Edge TTS curto demais para dividir na posição ${eventIndex + 1}`);
      words.push({ text: eventWords[index], startMs: wordStartMs, endMs: wordEndMs,
        ...(eventWords.length > 1 ? { splitFromCombinedBoundary: true } : {}) });
    }
  }
  let recoveredMissingWordCount = 0;
  const missing = expectedWords.length - words.length;
  const mismatch = words.findIndex((word, index) => normalizeToken(word.text) !== normalizeToken(expectedWords[index]));
  // Some metadata events cover a short phrase but report only its last word.
  // Recover a single sparse gap only when the entire remaining transcript is
  // otherwise exact and the event has enough real audio time. Mark every
  // affected word as interpolated; never report these as exact boundaries.
  if (missing > 0 && missing <= 4 && missing / expectedWords.length <= 0.02 && mismatch >= 0
    && words.slice(mismatch).every((word, offset) =>
      normalizeToken(word.text) === normalizeToken(expectedWords[mismatch + missing + offset]))
    && words[mismatch].endMs - words[mismatch].startMs >= (missing + 1) * 100) {
    const anchor = words[mismatch];
    const recovered = expectedWords.slice(mismatch, mismatch + missing + 1);
    const weights = recovered.map(word => Math.max(1, [...word].length));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let elapsed = 0;
    const replacements = recovered.map((text, index) => {
      const startMs = anchor.startMs + (anchor.endMs - anchor.startMs) * elapsed / total;
      elapsed += weights[index];
      return { text, startMs, endMs: index === recovered.length - 1 ? anchor.endMs
        : anchor.startMs + (anchor.endMs - anchor.startMs) * elapsed / total,
      interpolatedMissingBoundary: true };
    });
    words.splice(mismatch, 1, ...replacements);
    hadCombinedEvents = true;
    recoveredMissingWordCount = missing;
  }
  if (words.length !== expectedWords.length || words.some((word, index) =>
    normalizeToken(word.text) !== normalizeToken(expectedWords[index]))) {
    throw new Error('Limites de palavra do Edge TTS não correspondem ao texto narrado');
  }
  return {
    alignment: hadCombinedEvents ? 'edge-tts-word-boundary-mixed' : 'edge-tts-word-boundary',
    words: words.map((word, index) => ({ ...word, text: expectedWords[index] })),
    ...(recoveredMissingWordCount ? { recoveredMissingWordCount } : {})
  };
}

function partitionNarrationCues(groups, cues, alignmentHint = null) {
  const sourceCues = Array.isArray(cues) ? cues : [];
  const expectedWords = (Array.isArray(groups) ? groups : [])
    .flatMap(group => spokenWords(group?.text));
  if (isEdgeTtsWordBoundaryAlignment(alignmentHint)) {
    const validWordBoundaries = sourceCues.length === expectedWords.length && sourceCues.every((cue, index) => {
      const cueWords = String(cue?.text || '').trim().split(/\s+/).filter(Boolean);
      const startMs = Number(cue?.startMs), endMs = Number(cue?.endMs);
      return cueWords.length === 1 && normalizeToken(cueWords[0]) === normalizeToken(expectedWords[index])
        && Number.isFinite(startMs) && Number.isFinite(endMs) && startMs >= 0 && endMs > startMs
        && (index === 0 || startMs >= Number(sourceCues[index - 1]?.endMs));
    });
    if (!validWordBoundaries) {
      throw new Error('Limites de palavra do Edge TTS não correspondem à narração; sincronização cancelada');
    }
    let cursor = 0;
    return (Array.isArray(groups) ? groups : []).map(group => {
      const words = String(group?.text || '').split(/\s+/).filter(Boolean);
      if (!words.length) return { audioOffsetMs: 0, durationMs: 0, cues: [], alignment: alignmentHint };
      const selected = sourceCues.slice(cursor, cursor + words.length);
      cursor += words.length;
      const startMs = Number(selected[0].startMs);
      const endMs = Number(selected.at(-1).endMs);
      return {
        audioOffsetMs: Math.round(startMs),
        durationMs: Math.max(1, Math.round(endMs - startMs)),
        alignment: alignmentHint,
        cues: selected.map(cue => ({
          startMs: Number(cue.startMs) - startMs,
          endMs: Number(cue.endMs) - startMs,
          text: String(cue.text).trim()
        }))
      };
    });
  }

  const wordCues = sourceCues.flatMap(cue => {
    const words = spokenWords(cue?.text);
    const startMs = Number(cue?.startMs) || 0;
    const endMs = Math.max(startMs, Number(cue?.endMs) || startMs);
    const durationMs = endMs - startMs;
    return words.map((word, index) => ({
      text: word,
      startMs: startMs + (durationMs * index) / words.length,
      endMs: startMs + (durationMs * (index + 1)) / words.length
    }));
  });

  let wordOffset = 0;
  let lastEndMs = 0;
  const alignment = sourceCues.length > 1 ? 'subtitle-cues-interpolated' : 'uniform-estimate';
  const partitions = (Array.isArray(groups) ? groups : []).map((group, index) => {
    const words = spokenWords(group?.text);
    if (!words.length) return { audioOffsetMs: lastEndMs, durationMs: 0, cues: [], alignment };

    const selected = wordCues.slice(wordOffset, wordOffset + words.length);
    const matches = selected.length === words.length && words.every((word, wordIndex) =>
      normalizeToken(selected[wordIndex].text) === normalizeToken(word));
    if (!matches) {
      throw new Error(`Narração contínua não corresponde ao grupo ${index + 1}; sincronização cancelada`);
    }

    wordOffset += words.length;
    const startMs = selected[0].startMs;
    const endMs = selected[selected.length - 1].endMs;
    lastEndMs = endMs;
    return {
      audioOffsetMs: Math.round(startMs),
      durationMs: Math.max(1, Math.round(endMs - startMs)),
      alignment,
      cues: selected.map(cue => ({
        startMs: Math.round(cue.startMs - startMs),
        endMs: Math.round(cue.endMs - startMs),
        text: cue.text
      }))
    };
  });
  if (wordOffset !== wordCues.length) {
    throw new Error('Narração contínua contém palavras fora dos grupos do roteiro; sincronização cancelada');
  }
  return partitions;
}

function hasMatchingSubtitleText(text, cues) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const subtitles = cueTokens(cues);
  return words.length > 0 && subtitles.length === words.length &&
    words.every((word, index) => normalizeToken(subtitles[index]) === normalizeToken(word));
}

function timingAlignment(text, cues, alignmentHint = null) {
  if (isEdgeTtsWordBoundaryAlignment(alignmentHint) && hasMatchingSubtitleText(text, cues)) {
    return alignmentHint;
  }
  if ((Array.isArray(cues) ? cues.length : 0) > 1 && hasMatchingSubtitleText(text, cues)) {
    return 'subtitle-cues-interpolated';
  }
  return 'uniform-estimate';
}

function buildWordTimings(text, cues, groupMs, alignmentHint = null) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  if (isEdgeTtsWordBoundaryAlignment(alignmentHint)) {
    if (!hasMatchingSubtitleText(text, cues) || cues.some(cue => String(cue?.text || '').trim().split(/\s+/).filter(Boolean).length !== 1)) {
      throw new Error('Limites de palavra do Edge TTS inválidos para os tempos do grupo');
    }
    return words.map((word, index) => ({
      w: word,
      startMs: Number(cues[index].startMs),
      endMs: Number(cues[index].endMs)
    }));
  }

  const flat = [];
  for (const cue of Array.isArray(cues) ? cues : []) {
    const cueWords = String(cue?.text || '').split(/\s+/).filter(Boolean);
    const startMs = Number(cue?.startMs) || 0;
    const endMs = Number(cue?.endMs) || startMs;
    const step = Math.max(60, (endMs - startMs) / Math.max(1, cueWords.length));
    cueWords.forEach((word, index) => flat.push({
      w: word,
      startMs: startMs + index * step,
      endMs: startMs + (index + 1) * step
    }));
  }

  if (hasMatchingSubtitleText(text, cues)) {
    return words.map((word, index) => ({ w: word, startMs: flat[index].startMs, endMs: flat[index].endMs }));
  }

  const step = Math.max(60, (Number(groupMs) - 200) / words.length);
  return words.map((word, index) => ({
    w: word,
    startMs: 100 + index * step,
    endMs: 100 + (index + 1) * step
  }));
}

function buildGroupTimings(text, cues, groupMs, provider = 'unknown', alignmentHint = null) {
  const durationMs = Math.max(1, Math.round(Number(groupMs) || 4000));
  const words = buildWordTimings(text, cues, durationMs, alignmentHint);
  const sentences = String(text || '').split(/(?<=[.!?…])\s+/).map(sentence => sentence.trim()).filter(Boolean);
  const output = [];
  let cursor = 0;

  for (const sentence of sentences) {
    const sentenceWords = sentence.split(/\s+/).filter(Boolean);
    const slice = words.slice(cursor, cursor + sentenceWords.length);
    if (slice.length < sentenceWords.length) break;
    output.push({
      text: sentence,
      words: sentenceWords,
      startMs: Math.round(slice[0].startMs),
      endMs: Math.round(slice[slice.length - 1].endMs),
      wordTimes: slice.map(word => Math.max(0, Math.round(word.startMs - slice[0].startMs))),
      wordEndTimes: slice.map(word => Math.max(0, Math.round(word.endMs - slice[0].startMs)))
    });
    cursor += sentenceWords.length;
  }

  if (!output.length && String(text || '').trim()) {
    const fallbackWords = String(text).split(/\s+/).filter(Boolean);
    const step = Math.max(60, (durationMs - 200) / Math.max(1, fallbackWords.length));
    output.push({
      text: String(text),
      words: fallbackWords,
      startMs: 100,
      endMs: durationMs,
      durationMs,
      wordTimes: fallbackWords.map((_, index) => Math.round(index * step)),
      wordEndTimes: fallbackWords.map((_, index) => Math.round((index + 1) * step))
    });
  }

  for (let index = 0; index < output.length - 1; index++) {
    output[index].endMs = Math.max(output[index].endMs, output[index + 1].startMs);
  }
  for (const sentence of output) sentence.durationMs = Math.max(400, Math.round(sentence.endMs - sentence.startMs));

  return {
    durationMs,
    provider,
    alignment: timingAlignment(text, cues, alignmentHint),
    cueCount: Array.isArray(cues) ? cues.length : 0,
    sentences: output
  };
}

function summarizeNarrationTimings(timings) {
  const groups = Array.isArray(timings) ? timings : [];
  const providers = {};
  const alignments = {};
  let totalDurationMs = 0;
  let subtitleCueCount = 0;

  for (const group of groups) {
    const provider = String(group?.provider || 'unknown');
    const alignment = String(group?.alignment || 'unknown');
    providers[provider] = (providers[provider] || 0) + 1;
    alignments[alignment] = (alignments[alignment] || 0) + 1;
    totalDurationMs += Number.isFinite(Number(group?.durationMs)) ? Math.max(0, Number(group.durationMs)) : 0;
    subtitleCueCount += Number.isSafeInteger(group?.cueCount) ? Math.max(0, group.cueCount) : 0;
  }

  return {
    groupCount: groups.length,
    totalDurationMs: Math.round(totalDurationMs),
    subtitleCueCount,
    providers,
    alignments,
    voiceContinuity: narrationProviderContinuity({ groupCount: groups.length, providers })
  };
}

function narrationProviderContinuity(summary) {
  const providers = Object.entries(summary?.providers || {})
    .filter(([, count]) => Number.isFinite(Number(count)) && Number(count) > 0)
    .map(([provider]) => provider.trim().toLowerCase())
    .filter(Boolean);
  const known = providers.filter(provider => provider !== 'unknown').sort();
  if (known.length > 1) return { status: 'mixed', providers: known };
  if (known.length !== 1 || providers.includes('unknown')) return { status: 'unverified', providers: known };
  return { status: 'consistent', provider: known[0] };
}

module.exports = {
  expandEdgeTtsBoundaryEvents,
  buildGroupTimings,
  buildWordTimings,
  hasMatchingSubtitleText,
  partitionNarrationCues,
  summarizeNarrationTimings,
  narrationProviderContinuity,
  timingAlignment
};
