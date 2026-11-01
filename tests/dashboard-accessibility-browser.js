'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const dashboardRoot = path.resolve(__dirname, '..', 'dashboard');
const knowledgeDocuments = [];
const fixture = {
  profile: { channel_name: 'Accessibility fixture', bannedTopics: [] },
  settings: {},
  system: { setupRequired: true, automationPaused: true, initialized: false, agents: [], videoProviders: [] },
  pipeline: [], schedule: [], jobs: [], notifications: [], events: [], ideas: [], stats: {},
  analytics: {}, learning: {}, experiments: {}, engagement: {}, activation: {}, readiness: {},
  channelStrategy: null, operatorRuns: []
};
const dailyPerformanceFixture = {
  status: 'partial',
  latestDate: '2026-10-17',
  reports: [{
    reportDate: '2026-10-17',
    collectedAt: '2026-10-17T12:00:00.000Z',
    status: 'partial',
    coverage: { youtube: { status: 'partial', reason: null } },
    publicationHealth: {},
    posts: [
      { publicationId: 'slower', platform: 'youtube', title: 'Slower observed rate', status: 'observed', delta: { hours: 24, metrics: { views: 10 }, viewsPer24Hours: 10 } },
      { publicationId: 'faster', platform: 'youtube', title: 'Faster observed rate', status: 'observed', delta: { hours: 24, metrics: { views: 80 }, viewsPer24Hours: 80 } }
    ]
  }]
};

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function createStaticServer() {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/api/knowledge-base/documents' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ success: true, documents: knowledgeDocuments }));
      return;
    }
    if (pathname === '/api/knowledge-base/documents' && request.method === 'POST') {
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const document = {
          id: `browser-${knowledgeDocuments.length + 1}`,
          original_name: request.headers['x-file-name'],
          mime_type: request.headers['content-type'],
          size_bytes: buffer.length,
          extracted_characters: buffer.toString('utf8').length,
          sha256: 'browser-fixture',
          created_at: new Date().toISOString()
        };
        knowledgeDocuments.unshift(document);
        response.writeHead(201, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ success: true, document }));
      });
      return;
    }
    const deleteKnowledgeDocument = pathname.match(/^\/api\/knowledge-base\/documents\/([^/]+)$/);
    if (deleteKnowledgeDocument && request.method === 'DELETE') {
      const index = knowledgeDocuments.findIndex(document => document.id === decodeURIComponent(deleteKnowledgeDocument[1]));
      if (index >= 0) knowledgeDocuments.splice(index, 1);
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ success: true }));
      return;
    }
    if (pathname === '/api/dashboard') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(fixture));
      return;
    }
    if (pathname === '/api/daily-performance') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(dailyPerformanceFixture));
      return;
    }

    const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const filePath = path.resolve(dashboardRoot, relativePath);
    if (!filePath.startsWith(`${dashboardRoot}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    fs.readFile(filePath, (error, body) => {
      if (error) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'content-type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
      response.end(body);
    });
  });
}

async function nextFrame(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function checkKeyboardNavigation(page) {
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('skip-link')), true,
    'the first Tab should focus the skip link');
  assert.equal(await page.locator('.skip-link').isVisible(), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content',
    'the skip link should move focus to main content');

  // The native skip link adds an anchor history entry. Replace it before
  // checking SPA view history so Back exercises view navigation itself.
  await page.evaluate(() => window.history.replaceState(window.history.state, '', window.location.pathname));
  const analytics = page.locator('[data-view="analytics"]');
  await analytics.click();
  assert.equal(await analytics.getAttribute('aria-current'), 'page');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'view-title');

  await page.evaluate(() => window.history.back());
  await page.waitForFunction(
    () => document.querySelector('[data-view="overview"]')?.getAttribute('aria-current') === 'page',
    { timeout: 5000 }
  );

  const trigger = page.getByRole('button', { name: 'Open command palette' });
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await trigger.click();
  await dialog.waitFor({ state: 'visible' });
  const input = page.getByRole('combobox', { name: 'Command input' });
  // The palette intentionally focuses its input on the next animation frame;
  // visibility alone does not guarantee that callback has run on a busy host.
  await page.waitForFunction(() => document.activeElement?.matches('[role="combobox"][aria-label="Command input"]'));
  assert.equal(await input.evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true,
    'closing the command palette should restore focus to its trigger');

  await page.keyboard.press('Control+k');
  await dialog.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.activeElement?.matches('.cmdk-input'));
  assert.equal(await input.evaluate(element => element === document.activeElement), true,
    'the keyboard shortcut should focus the command input');
  await page.keyboard.press('Tab');
  assert.equal(await input.evaluate(element => element === document.activeElement), true,
    'Tab should remain inside the command palette');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true,
    'closing the command palette should restore focus to its trigger');
}

async function checkAccessibleNames(page) {
  const client = await page.context().newCDPSession(page);
  try {
    const { nodes } = await client.send('Accessibility.getFullAXTree');
    const interactiveRoles = new Set(['button', 'checkbox', 'combobox', 'link', 'radio', 'textbox']);
    const unnamed = nodes.filter(node => !node.ignored
      && interactiveRoles.has(node.role?.value)
      && !String(node.name?.value || '').trim())
      .map(node => node.role.value);
    assert.deepEqual(unnamed, [], `visible interactive controls need accessible names: ${unnamed.join(', ')}`);
  } finally {
    await client.detach();
  }
}

async function checkDailyPerformanceRanking(page) {
  await page.locator('[data-view="analytics"]').click();
  const titles = page.locator('#daily-performance-rows .daily-video-title');
  await page.waitForFunction(() => document.querySelectorAll('#daily-performance-rows tr').length === 2);
  assert.deepEqual(await titles.allTextContents(), ['Faster observed rate', 'Slower observed rate'],
    'daily performance must sort by the observed views-per-24h rate');
}

async function checkKnowledgeBaseDropUpload(page) {
  await page.locator('[data-view="knowledge"]').click();
  await page.waitForFunction(() => document.querySelector('#knowledge-document-count')?.textContent === '0 documents');
  await page.evaluate(() => {
    const transfer = new window.DataTransfer();
    transfer.items.add(new window.File(['Use a clear, practical voice.'], 'channel-guide.txt', { type: 'text/plain' }));
    document.querySelector('#knowledge-dropzone').dispatchEvent(new window.DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }));
  });
  await page.waitForFunction(() => document.querySelector('#knowledge-document-count')?.textContent === '1 document');
  assert.match(await page.locator('#knowledge-documents').innerText(), /channel-guide\.txt/);
  assert.match(await page.locator('#knowledge-upload-status').innerText(), /ready for the agents/i);
}

async function main() {
  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/`;
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#system-label')?.textContent === 'Setup required');
    await nextFrame(page);
    assert.equal(await page.locator('#main-content').getAttribute('aria-busy'), 'false');
    await checkAccessibleNames(page);
    await checkKeyboardNavigation(page);
    await checkDailyPerformanceRanking(page);
    await checkKnowledgeBaseDropUpload(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#system-label')?.textContent === 'Setup required');
    await nextFrame(page);
    const mobileLayout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth
    }));
    assert.ok(mobileLayout.documentWidth <= mobileLayout.viewportWidth,
      `mobile dashboard must not overflow horizontally: ${JSON.stringify(mobileLayout)}`);
    await checkKeyboardNavigation(page);
    assert.deepEqual(pageErrors, [], `dashboard should not throw browser errors: ${pageErrors.join('; ')}`);
    console.log('Dashboard accessibility: keyboard skip, history navigation, command palette focus, and 390px layout passed.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
