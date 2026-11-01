'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveRetryEntryMedia, sortRetryEntriesOldestFirst } = require('../utils/retry-entry-media');

test('prioriza retries antigos para o backlog não ficar atrás da produção nova', () => {
  const entries = [
    { id: 'new', generatedAt: '2026-10-20T12:00:00Z' },
    { id: 'unknown-date' },
    { id: 'old', generatedAt: '2026-10-10T12:00:00Z' }
  ];

  assert.deepEqual(sortRetryEntriesOldestFirst(entries).map(entry => entry.id), [
    'unknown-date', 'old', 'new'
  ]);
  assert.equal(entries[0].id, 'new', 'sorting does not mutate the source ledger');
});

test('retém retry social de cortes seguros mesmo após remoção do master', async () => {
  const available = new Set(['/managed/part1.mp4', '/managed/part2.mp4']);
  const entry = {
    videoPath: '/managed/master.mp4',
    clips: ['/managed/deleted.mp4', { path: '/managed/part1.mp4' }, { path: '/outside.mp4' }]
  };
  const media = await resolveRetryEntryMedia(entry, async candidate => (
    available.has(candidate) ? candidate : null
  ));

  assert.deepEqual(media, {
    masterPath: null,
    clipPaths: ['/managed/part1.mp4']
  });
});

test('não agenda retry sem nenhum master ou corte seguro existente', async () => {
  const media = await resolveRetryEntryMedia({
    videoPath: '/managed/deleted-master.mp4',
    clips: ['/managed/deleted-part.mp4']
  }, async () => null);

  assert.equal(media, null);
});

test('preserva retry normal quando o master ainda existe', async () => {
  const media = await resolveRetryEntryMedia({
    videoPath: '/managed/master.mp4',
    clips: [{ path: '/managed/part.mp4' }]
  }, async candidate => candidate);

  assert.deepEqual(media, {
    masterPath: '/managed/master.mp4',
    clipPaths: ['/managed/part.mp4']
  });
});
