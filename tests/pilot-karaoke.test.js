'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateWordEvents, buildKaraokeTrack, getKaraokeFrame } = require('../utils/pilot-karaoke');

const events = [
  { text: 'A', startMs: 0, endMs: 100 },
  { text: 'pista', startMs: 100, endMs: 280 },
  { text: 'é', startMs: 290, endMs: 360 },
  { text: 'falsa.', startMs: 370, endMs: 640 },
  { text: 'Agora', startMs: 900, endMs: 1100 },
  { text: 'para', startMs: 1100, endMs: 1260 },
  { text: 'aqui', startMs: 1270, endMs: 1500 }
];

test('word timings must be ordered, positive, and within the narration', () => {
  assert.equal(validateWordEvents(events, 1500), true);
  assert.throws(() => validateWordEvents([{ text: 'x', startMs: 12, endMs: 12 }]), /Intervalo inválido/);
  assert.throws(() => validateWordEvents([{ text: 'x', startMs: 10, endMs: 30 }, { text: 'y', startMs: 9, endMs: 40 }]), /fora de ordem/);
  assert.throws(() => validateWordEvents([{ text: 'x', startMs: 0, endMs: 200 }], 50), /além do áudio/);
});

test('karaoke phrases break on sentence punctuation and remain bounded', () => {
  const track = buildKaraokeTrack(events, 3);
  assert.deepEqual(track.groups.map(group => group.text), ['A pista é', 'falsa.', 'Agora para aqui']);
  assert.deepEqual(track.eventToGroup, [0, 0, 0, 1, 2, 2, 2]);
});

test('seeking backward, forward, and across pauses yields the same spoken word', () => {
  const track = buildKaraokeTrack(events, 7);
  assert.deepEqual(getKaraokeFrame(events, track, 130), { phraseIndex: 0, activeEventIndex: 1 });
  assert.deepEqual(getKaraokeFrame(events, track, 1020), { phraseIndex: 1, activeEventIndex: 4 });
  assert.deepEqual(getKaraokeFrame(events, track, 1200), { phraseIndex: 1, activeEventIndex: 5 });
  assert.deepEqual(getKaraokeFrame(events, track, 500), { phraseIndex: 0, activeEventIndex: 3 });
  assert.deepEqual(getKaraokeFrame(events, track, 700), { phraseIndex: 0, activeEventIndex: -1 });
  assert.deepEqual(getKaraokeFrame(events, track, 1900), { phraseIndex: 1, activeEventIndex: -1 });
  assert.equal(getKaraokeFrame(events, track, 2050), null);
});
