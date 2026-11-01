'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildThumbnailHtml, THUMBNAIL_CANVAS, THUMBNAIL_RENDER_POLICY } = require('../utils/thumbnail-design');
const { createCompositionHtml } = require('../utils/hyperframes-video-renderer');
const { VISUAL_DESIGN_TOKENS, sceneCssTokens, thumbnailCssTokens } = require('../utils/visual-design-tokens');

const ROOT = path.join(__dirname, '..');

test('video and thumbnail CSS consume the shared typography and safe-area contract', () => {
  const sceneCss = fs.readFileSync(path.join(ROOT, 'assets/scenes/kit.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(ROOT, 'utils/hyperframes-video-renderer.js'), 'utf8');
  const thumbnail = buildThumbnailHtml({ title: 'Pauta de teste', accent: '#22D3EE' });

  assert.match(sceneCss, /var\(--pulso-font-family/);
  assert.match(sceneCss, /var\(--pulso-video-safe-inset-ratio/);
  assert.match(renderer, /sceneCssTokens\(\)/);
  assert.match(sceneCssTokens(), /--pulso-video-safe-inset-ratio: 0\.05/);
  assert.match(sceneCssTokens(), /--pulso-surface-radius-ratio: 0\.012/);
  assert.match(sceneCssTokens(), /--pulso-caption-keyword-scrim-alpha: 0\.96/);
  assert.match(sceneCss, /\.bento::before/);
  assert.match(sceneCss, /--surface-shadow/);
  assert.match(sceneCss, /color-mix\(in srgb, var\(--accent\)/);
  assert.match(thumbnailCssTokens(), /--pulso-thumbnail-content-left: 92px/);
  assert.match(thumbnailCssTokens(), /--pulso-thumbnail-content-width: 780px/);
  assert.match(thumbnail, /font-family:var\(--pulso-font-family\)/);
  assert.match(thumbnail, /left:var\(--pulso-thumbnail-content-left\)/);
  assert.match(thumbnail, /inset:var\(--pulso-thumbnail-edge-inset\)/);

  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    const composition = createCompositionHtml({
      width,
      height,
      fps: 30,
      duration: 1,
      scenes: [],
      imageAssets: [],
      audioFile: 'silent.wav',
      robotConfig: { seed: 0, script: {}, speechEnvelope: {} },
      kitCss: sceneCss,
      kitJs: ''
    });
    const emittedCss = composition.assets['scene-kit.css'];
    assert.match(emittedCss, /--pulso-font-family: Inter,/);
    assert.match(emittedCss, /--pulso-video-safe-inset-ratio: 0\.05/);
    assert.match(emittedCss, new RegExp(`--w: ${width}px`));
    assert.match(emittedCss, new RegExp(`--h: ${height}px`));
  }
});

test('central tokens preserve established render dimensions, fonts, and typography fit limits', () => {
  assert.deepEqual(THUMBNAIL_CANVAS, { width: 1280, height: 720 });
  assert.deepEqual(THUMBNAIL_RENDER_POLICY, {
    initialFontSize: 92,
    minimumFontSize: 48,
    maximumTextHeight: 560,
    maximumTextWidth: 780
  });
  assert.equal(VISUAL_DESIGN_TOKENS.video.safeInsetRatio, 0.05);
  assert.equal(VISUAL_DESIGN_TOKENS.video.surfaceRadiusRatio, 0.012);
  assert.equal(VISUAL_DESIGN_TOKENS.video.surfaceBorderAlpha, 0.22);
  assert.match(VISUAL_DESIGN_TOKENS.typography.primaryFamily, /^Inter$/);
  assert.equal(VISUAL_DESIGN_TOKENS.color.videoBackground, '#0A0A0F');
  assert.deepEqual(VISUAL_DESIGN_TOKENS.presenter.fallbackAccents, ['#60A5FA', '#5EEAD4', '#A78BFA', '#FBBF24']);
  assert.equal(VISUAL_DESIGN_TOKENS.presenter.fallbackAccents[0], VISUAL_DESIGN_TOKENS.color.fallbackAccent);

  const renderer = fs.readFileSync(path.join(ROOT, 'utils/hyperframes-video-renderer.js'), 'utf8');
  const presenter = fs.readFileSync(path.join(ROOT, 'experiments/hyperframes-pulso-pilot/src/production-presenter-bonito.js'), 'utf8');
  assert.match(renderer, /VISUAL_DESIGN_TOKENS\.presenter\.fallbackAccents/);
  assert.match(presenter, /VISUAL_DESIGN_TOKENS\.presenter\.fallbackAccents/);
});
