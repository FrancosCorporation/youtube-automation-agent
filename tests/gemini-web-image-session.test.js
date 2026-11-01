'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { GeminiWebImageGenerator } = require('../utils/gemini-web-image');

test('attaches to the task-owned Gemini CDP session and reuses its signed-in tab', async () => {
  const originalConnect = chromium.connectOverCDP;
  let disconnects = 0;
  let newPages = 0;
  let pageCloses = 0;
  const page = {
    url: () => 'https://gemini.google.com/app',
    isClosed: () => false,
    goto: async () => {},
    close: async () => { pageCloses++; }
  };
  const context = {
    pages: () => [page],
    newPage: async () => { newPages++; return page; }
  };
  chromium.connectOverCDP = async url => {
    assert.equal(url, 'http://127.0.0.1:9233');
    return { contexts: () => [context], close: async () => { disconnects++; } };
  };
  try {
    const provider = new GeminiWebImageGenerator({ cdpUrl: 'http://127.0.0.1:9233' });
    assert.equal(await provider._conversationPage(), page);
    assert.equal(newPages, 0);
    await provider.close();
    assert.equal(disconnects, 1);
    assert.equal(pageCloses, 0, 'closing the provider must not close the operator’s browser tab');
  } finally { chromium.connectOverCDP = originalConnect; }
});

test('an explicit empty CDP URL selects the local headless profile even when a stale endpoint is configured', () => {
  const previous = process.env.GEMINI_WEB_CDP_URL;
  process.env.GEMINI_WEB_CDP_URL = 'http://127.0.0.1:9233';
  try {
    const provider = new GeminiWebImageGenerator({ cdpUrl: '', headless: true });
    assert.equal(provider.cdpUrl, '');
    assert.equal(provider.headless, true);
  } finally {
    if (previous === undefined) delete process.env.GEMINI_WEB_CDP_URL;
    else process.env.GEMINI_WEB_CDP_URL = previous;
  }
});
