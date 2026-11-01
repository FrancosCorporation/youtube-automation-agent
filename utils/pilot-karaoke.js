'use strict';

function validateWordEvents(events, durationMs = Infinity) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new TypeError('A trilha de karaokê precisa ter palavras alinhadas');
  }

  let previousStart = -1;
  for (const [index, event] of events.entries()) {
    const startMs = Number(event?.startMs);
    const endMs = Number(event?.endMs);
    if (typeof event?.text !== 'string' || !event.text.trim()) {
      throw new TypeError(`Palavra ${index} sem texto`);
    }
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
      throw new RangeError(`Intervalo inválido na palavra ${index}`);
    }
    if (startMs < previousStart || endMs > durationMs + 100) {
      throw new RangeError(`A palavra ${index} está fora de ordem ou além do áudio`);
    }
    previousStart = startMs;
  }
  return true;
}

function buildKaraokeTrack(events, maxWordsPerPhrase = 7) {
  if (!Number.isInteger(maxWordsPerPhrase) || maxWordsPerPhrase < 1) {
    throw new RangeError('maxWordsPerPhrase deve ser um inteiro positivo');
  }
  validateWordEvents(events);

  const groups = [];
  const eventToGroup = [];
  let words = [];
  const finish = () => {
    if (!words.length) return;
    const index = groups.length;
    groups.push({
      words,
      startMs: words[0].startMs,
      endMs: words.at(-1).endMs,
      text: words.map(word => word.text).join(' ')
    });
    for (const word of words) eventToGroup[word.eventIndex] = index;
    words = [];
  };

  for (const [eventIndex, event] of events.entries()) {
    words.push({ ...event, eventIndex });
    if (/[.!?][”’"')\]]*$/.test(event.text) || words.length >= maxWordsPerPhrase) finish();
  }
  finish();
  return { groups, eventToGroup };
}

function getKaraokeFrame(events, track, timeMs, holdAfterMs = 450) {
  const t = Number(timeMs);
  if (!Number.isFinite(t) || t < 0 || !track?.groups?.length) return null;

  let low = 0;
  let high = events.length - 1;
  let activeEventIndex = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (events[middle].startMs <= t) {
      activeEventIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (activeEventIndex < 0) return null;
  const last = events.at(-1);
  if (t > last.endMs + holdAfterMs) return null;

  const event = events[activeEventIndex];
  return {
    phraseIndex: track.eventToGroup[activeEventIndex],
    activeEventIndex: t <= event.endMs ? activeEventIndex : -1
  };
}

module.exports = { validateWordEvents, buildKaraokeTrack, getKaraokeFrame };
