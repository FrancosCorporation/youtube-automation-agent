'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { extractCoverImageUrl, fetchSourceCoverImage, readBoundedBytes } = require('../utils/source-cover-image');

test('imagem de capa só usa foto do artigo Terra em hosts permitidos', async () => {
  const html = `<meta content="https://p2.trrsf.com/image/fget/cf/1200/630/middle/images.terra.com/2026/photo.jpg" property="og:image"><img src="https://images.terra.com/2026/photo.jpg" alt="Produto — Foto: Divulga&ccedil;&atilde;o/Nutrify">`;
  assert.equal(extractCoverImageUrl(html), 'https://images.terra.com/2026/photo.jpg');
  assert.equal(extractCoverImageUrl('<meta property="og:image" content="http://127.0.0.1/private">'), null);
  const bytes = await sharp({ create: { width: 500, height: 500, channels: 3, background: '#44aa88' } }).png().toBuffer();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, redirect: options.redirect });
    return calls.length === 1 ? new globalThis.Response(html, { headers: { 'content-type': 'text/html' } })
      : new globalThis.Response(bytes, { headers: { 'content-type': 'image/png' } });
  };
  const result = await fetchSourceCoverImage('https://www.terra.com.br/noticia', { fetchImpl });
  assert.equal(result.sourceUrl, 'https://images.terra.com/2026/photo.jpg');
  assert.equal(result.credit, 'Divulgação/Nutrify');
  assert.deepEqual(result.bytes, bytes);
  assert.deepEqual(calls.map(call => call.redirect), ['error', 'error']);
  assert.equal(await fetchSourceCoverImage('https://example.com/noticia', { fetchImpl }), null);
  assert.equal(calls.length, 2);
});

test('imagem excessiva é recusada e não vira capa', async () => {
  const response = new globalThis.Response(Buffer.alloc(100));
  await assert.rejects(readBoundedBytes(response, 50), /excede limite/);
});
