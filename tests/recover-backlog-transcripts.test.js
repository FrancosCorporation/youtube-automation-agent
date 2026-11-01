'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  audioLineageConfirmed,
  buildTranscript,
  parseSrtText,
  pcmCorrelation,
  resolveReportPath,
  timestampToMilliseconds
} = require('../scripts/recover-backlog-transcripts');

test('SRT parser handles UTF-8 captions, timestamps and cue text', () => {
  assert.equal(timestampToMilliseconds('00:01:02,345'), 62_345);
  const cues = parseSrtText('\uFEFF1\r\n00:00:00,050 --> 00:00:02,500\r\nInflação subiu.\r\nA projeção é 5,22%.\r\n\r\n2\r\n00:00:02.500 --> 00:00:04.000\r\nFim.');
  assert.deepEqual(cues, [
    { startMs: 50, endMs: 2500, text: 'Inflação subiu. A projeção é 5,22%.' },
    { startMs: 2500, endMs: 4000, text: 'Fim.' }
  ]);
});

test('transcript builder preserves part order and hashes normalized text', () => {
  const report = buildTranscript([
    { path: 'g1.srt', sha256: 'b'.repeat(64), durationMs: 1200, cues: [{ text: 'segunda parte' }] },
    { path: 'g0.srt', sha256: 'a'.repeat(64), durationMs: 800, cues: [{ text: 'primeira parte' }] }
  ]);
  assert.equal(report.transcript, 'segunda parte primeira parte');
  assert.equal(report.wordCount, 4);
  assert.equal(report.segmentDurationMs, 2000);
  assert.equal(report.parts.length, 2);
  assert.match(report.transcriptSha256, /^[a-f0-9]{64}$/);
});

test('PCM correlation identifies re-encoded matching audio and rejects unrelated audio', () => {
  const left = Buffer.alloc(1200 * 2);
  const matching = Buffer.alloc(1200 * 2);
  const unrelated = Buffer.alloc(1200 * 2);
  let seed = 17;
  for (let i = 0; i < 1200; i += 1) {
    seed = (seed * 48271) % 0x7fffffff;
    const sample = Math.trunc(((seed / 0x7fffffff) * 2 - 1) * 20000);
    left.writeInt16LE(sample, i * 2);
    matching.writeInt16LE(Math.trunc(sample * 0.92) + ((i % 7) - 3), i * 2);
    unrelated.writeInt16LE(Math.trunc(((i * 97) % 20001) - 10000), i * 2);
  }
  const same = pcmCorrelation(left, matching, { sampleRate: 1200, windowSeconds: 1 });
  const different = pcmCorrelation(left, unrelated, { sampleRate: 1200, windowSeconds: 1 });
  assert.ok(same.fullCorrelation > 0.99);
  assert.ok(same.minWindowCorrelation > 0.99);
  assert.ok(different.fullCorrelation < 0.15);
});

test('audio lineage requires duration, full track, windows and transcript coverage gates', () => {
  const metrics = {
    sampleRate: 12000,
    narrationSamples: 12000 * 100,
    durationDeltaSeconds: 0.2,
    fullCorrelation: 0.98,
    minWindowCorrelation: 0.94
  };
  assert.equal(audioLineageConfirmed(metrics, { segmentDurationMs: 95_000, wordCount: 300 }), true);
  assert.equal(audioLineageConfirmed({ ...metrics, minWindowCorrelation: 0.8 }, { segmentDurationMs: 95_000, wordCount: 300 }), false);
  assert.equal(audioLineageConfirmed(metrics, { segmentDurationMs: 50_000, wordCount: 300 }), false);
  assert.equal(audioLineageConfirmed(metrics, { segmentDurationMs: 95_000, wordCount: 40 }), false);
});

test('backlog report paths resolve relative to the project, not its parent workspace', () => {
  const root = '/tmp/youtube-automation-agent';
  assert.equal(resolveReportPath(root, 'youtube-automation-agent/data/videos/a.mp4'), `${root}/data/videos/a.mp4`);
  assert.equal(resolveReportPath(root, 'data/videos/a.mp4'), `${root}/data/videos/a.mp4`);
});
