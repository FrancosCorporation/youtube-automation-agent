'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildShortsTitle, resolvePublicationTitle } = require('../utils/publication-title');

test('YouTube usa título da fonte quando o título narrativo excede o limite', () => {
  const title = 'A Nutrify anunciou o lançamento da Creatine HMB em formato stick, uma nova apresentação do suplemento que combina creatina monohidratada, HMB, vitaminas e minerais.';
  const sourceTitle = 'Nutrify lança Creatine HMB em sticks para saúde muscular e emagrecimento';
  assert.equal(resolvePublicationTitle({ title, sourceTitle }), sourceTitle);
  assert.equal(resolvePublicationTitle({ title, seoTitle: 'Creatine HMB em sticks', sourceTitle }), 'Creatine HMB em sticks');
  const short = buildShortsTitle({ title, sourceTitle, partIndex: 1, partCount: 1, hashtags: '#saúde #nutrição' });
  assert.ok(short.length <= 100);
  assert.match(short, /#shorts$/);
  assert.ok(short.includes(sourceTitle));
});

test('sem título ou fonte utilizável não inventa título para publicação', () => {
  assert.throws(() => resolvePublicationTitle({}), error => error.code === 'PUBLICATION_TITLE_UNAVAILABLE');
});
