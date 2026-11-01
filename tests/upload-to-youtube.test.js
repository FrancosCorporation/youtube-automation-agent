const assert = require('node:assert/strict');
const test = require('node:test');
const { buildYouTubeInsertRequestBody, loadCliQaManifest, uploadVideo } = require('../scripts/upload-to-youtube');

test('YouTube insert uses only writable language metadata and marks synthetic media', () => {
  const body = buildYouTubeInsertRequestBody({
    value: {
      title: 'Vídeo testável',
      description: 'Descrição',
      tags: ['ia', 'tecnologia', 'notícias'],
      categoryId: '28'
    }
  }, 'public');

  assert.equal(body.snippet.defaultLanguage, 'pt-BR');
  assert.equal(Object.hasOwn(body.snippet, 'defaultAudioLanguage'), false);
  assert.equal(body.status.containsSyntheticMedia, true);
  assert.equal(body.status.privacyStatus, 'public');
});

test('low-level YouTube upload refuses calls without verified visual approval', async () => {
  await assert.rejects(
    uploadVideo({ videoPath: '/not-read', title: 'Test', description: 'Test', tags: [] }),
    error => error.code === 'PUBLICATION_VISUAL_REVIEW_REQUIRED'
  );
});

test('standalone uploader requires a verified QA manifest before resolving credentials', async () => {
  await assert.rejects(
    loadCliQaManifest({}),
    error => error.code === 'VIDEO_QA_MANIFEST_REQUIRED'
      && /--qa-manifest/.test(error.message)
  );
});
