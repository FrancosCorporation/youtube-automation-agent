/** Preserve the source frame before advancing Instagram's default square crop. */
function instagramComposer(page) {
  return page.locator('[role="dialog"]').filter({ has: page.locator('video') }).last();
}

async function inspectInstagramVideoFrame(page) {
  const video = instagramComposer(page).locator('video').first();
  return video.evaluate(video => {
    const rect = video.getBoundingClientRect();
    const style = window.getComputedStyle(video);
    let contentWidth = rect.width, contentHeight = rect.height;
    if (video.videoWidth > 0 && video.videoHeight > 0 && /^(contain|cover)$/.test(style.objectFit)) {
      const scale = Math[style.objectFit === 'contain' ? 'min' : 'max'](rect.width / video.videoWidth, rect.height / video.videoHeight);
      contentWidth = video.videoWidth * scale;
      contentHeight = video.videoHeight * scale;
    }
    // The uploader centers the video. Non-centered object-position must be reviewed.
    const centered = /^(50%|center) (50%|center)$/.test(style.objectPosition);
    const content = { left: rect.left + (rect.width - contentWidth) / 2,
      right: rect.left + (rect.width + contentWidth) / 2,
      top: rect.top + (rect.height - contentHeight) / 2,
      bottom: rect.top + (rect.height + contentHeight) / 2 };
    const visible = { ...content };
    // object-fit:cover can crop inside the video itself as well as its ancestors.
    visible.left = Math.max(visible.left, rect.left, 0);
    visible.right = Math.min(visible.right, rect.right, window.innerWidth);
    visible.top = Math.max(visible.top, rect.top, 0);
    visible.bottom = Math.min(visible.bottom, rect.bottom, window.innerHeight);
    for (let ancestor = video.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const css = window.getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
      if (/^(hidden|clip|auto|scroll)$/.test(css.overflowX)) {
        visible.left = Math.max(visible.left, box.left);
        visible.right = Math.min(visible.right, box.right);
      }
      if (/^(hidden|clip|auto|scroll)$/.test(css.overflowY)) {
        visible.top = Math.max(visible.top, box.top);
        visible.bottom = Math.min(visible.bottom, box.bottom);
      }
    }
    const croppedPixels = Math.max(visible.left - content.left, content.right - visible.right,
      visible.top - content.top, content.bottom - visible.bottom, 0);
    const aspectError = Math.abs((contentWidth / contentHeight) / (video.videoWidth / video.videoHeight) - 1);
    return { sourceWidth: video.videoWidth, sourceHeight: video.videoHeight,
      previewWidth: rect.width, previewHeight: rect.height, croppedPixels,
      visibleFraction: Math.max(0, visible.right - visible.left) * Math.max(0, visible.bottom - visible.top) / (contentWidth * contentHeight),
      fullFrame: video.videoWidth > 0 && video.videoHeight > 0 && rect.width > 0 && rect.height > 0
        && croppedPixels <= 2 && aspectError < 0.01 && centered };
  }, undefined, { timeout: 10000 });
}

async function assertInstagramVideoFrame(page, { timeoutMs = 10000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let frame;
  do {
    frame = await inspectInstagramVideoFrame(page);
    if (frame.fullFrame) return frame;
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(250);
  } while (Date.now() <= deadline);
  throw new Error(`Instagram: enquadramento cortado ou não verificável (${frame.sourceWidth}x${frame.sourceHeight}; área visível ${(frame.visibleFraction * 100 || 0).toFixed(1)}%). Envio interrompido antes de compartilhar.`);
}

async function preserveInstagramVideoFrame(page) {
  const composer = instagramComposer(page);
  await composer.locator('video').first().waitFor({ state: 'visible', timeout: 30000 });
  const icon = composer.locator('svg[aria-label="Selecionar corte"], svg[aria-label="Select crop"]').first();
  const original = composer.getByText(/^original$/i).first();
  if (await icon.isVisible()) {
    const button = icon.locator('xpath=ancestor::*[self::button or @role="button"][1]');
    if (!await original.isVisible()) await button.click();
    await original.waitFor({ state: 'visible', timeout: 5000 });
    await original.click();
    const frame = await assertInstagramVideoFrame(page);
    if (await original.isVisible()) await button.click();
    return { selection: 'Original', ...frame };
  }
  // Some interfaces skip the crop step; they still have to show the complete frame.
  return { selection: 'already-full-frame', ...await assertInstagramVideoFrame(page) };
}

module.exports = { preserveInstagramVideoFrame, inspectInstagramVideoFrame, assertInstagramVideoFrame };
