'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createJobId, videoIdForPath } = require('../utils/observability-ids');

test('video IDs are stable, opaque hashes of their managed output path', () => {
  const candidate = 'data/videos/topic-that-must-not-appear.mp4';
  const videoId = videoIdForPath(candidate);

  assert.match(videoId, /^vid_[a-f0-9]{24}$/);
  assert.equal(videoId, videoIdForPath(path.resolve(candidate)));
  assert.notEqual(videoId, videoIdForPath('data/videos/another-topic.mp4'));
  assert.doesNotMatch(videoId, /topic|videos/);
});

test('generation job IDs are independent UUIDs', () => {
  const first = createJobId();
  const second = createJobId();

  assert.match(first, /^[0-9a-f-]{36}$/i);
  assert.notEqual(first, second);
});

test('video ID generation rejects missing paths', () => {
  assert.throws(() => videoIdForPath(' '), /caminho do vídeo obrigatório/);
});
