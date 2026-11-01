'use strict';

function articleScreenshotBlocked({ title = '', text = '', challengeFrame = false } = {}) {
  return challengeFrame || /just a moment|attention required|access denied|security verification/i.test(title)
    || /performing security verification|verify (?:that )?you are human|confirme que voc[eê] [eé] humano|checking your browser/i.test(text.slice(0, 3000));
}

/** Keep headline/date in frame and omit consent UI; never hide access challenges. */
async function prepareArticleScreenshotPage(page) {
  const state = await page.evaluate(() => ({ title: document.title, text: document.body?.innerText || '',
    challengeFrame: Boolean(document.querySelector('iframe[src*="challenges.cloudflare.com"], input[name="cf-turnstile-response"]')) }));
  if (articleScreenshotBlocked(state)) {
    throw Object.assign(new Error('article_screenshot_access_blocked'), { code: 'ARTICLE_SCREENSHOT_ACCESS_BLOCKED' });
  }
  await page.evaluate(() => {
    for (const node of document.querySelectorAll('div, aside, section, dialog')) {
      if (!node.isConnected || !/cookies|pol[ií]tica de privacidade/i.test(node.textContent || '')) continue;
      const position = window.getComputedStyle(node).position;
      if (position === 'fixed' || node.getAttribute('role') === 'dialog') node.remove();
    }
    const heading = document.querySelector('article h1, main h1, h1');
    if (heading) {
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, Math.max(0, window.scrollY + heading.getBoundingClientRect().top - 100));
    }
  });
  const heading = page.locator('article h1, main h1, h1').first();
  const headingText = (await heading.innerText({ timeout: 1500 })).trim();
  const box = await heading.boundingBox();
  if (!box || headingText.length < 12 || box.y < 0 || box.y >= 500) {
    throw Object.assign(new Error('article_screenshot_heading_missing'), { code: 'ARTICLE_SCREENSHOT_HEADING_MISSING' });
  }
  const x = Math.max(0, Math.floor(box.x - 24));
  return { headingText, readingWords: headingText.split(/\s+/).filter(Boolean).length,
    clip: { x, y: 0, width: Math.min(1280 - x, Math.max(720, Math.ceil(box.width + 48))), height: 820 } };
}

module.exports = { articleScreenshotBlocked, prepareArticleScreenshotPage };
