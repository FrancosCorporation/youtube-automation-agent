'use strict';

// The Gemini chat mode does not identify the image model. Record the visible
// mode for diagnostics; requesting Nano Banana Pro is done in the prompt.
async function selectNanoBananaPro(page) {
  const picker = page.locator('button[aria-label*="seletor de modo" i], button[aria-label*="mode selector" i]').first();
  return (await picker.getAttribute('aria-label', { timeout: 6000 }).catch(() => '')) || 'unknown';
}

module.exports = { selectNanoBananaPro };
