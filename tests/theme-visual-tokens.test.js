'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { themes } = require('../config/themes.json');
const { contrastRatio, selectThemePalette } = require('../utils/theme-visuals');
const { VISUAL_DESIGN_TOKENS, sceneCssTokens, thumbnailCssTokens } = require('../utils/visual-design-tokens');
const { buildThumbnailHtml } = require('../utils/thumbnail-design');

const VIDEO_BACKGROUND = VISUAL_DESIGN_TOKENS.color.videoBackground;
const MIN_DECORATIVE_CONTRAST = 4.5;

test('ten enabled themes share deterministic video and thumbnail palette selection', () => {
  const enabled = themes.filter(theme => theme.enabled);
  assert.equal(enabled.length, 10);
  assert.equal(new Set(enabled.map(theme => theme.id)).size, enabled.length);

  for (const theme of enabled) {
    const paletteConfig = theme.visualPalettes;
    assert.ok(theme.brand, `${theme.id}: marca ausente`);
    assert.ok(paletteConfig?.identity?.name, `${theme.id}: identidade ausente`);
    assert.match(paletteConfig.identity.color, /^#[0-9a-f]{6}$/i, `${theme.id}: cor de identidade inválida`);
    assert.equal(paletteConfig.variants.length, 3, `${theme.id}: número de variantes inesperado`);

    for (const [seed, palette] of paletteConfig.variants.entries()) {
      assert.equal(palette.accents.length, 4, `${theme.id}, variante ${seed}: quatro acentos são obrigatórios`);
      assert.equal(new Set(palette.accents).size, palette.accents.length, `${theme.id}, variante ${seed}: cor duplicada`);
      for (const accent of palette.accents) {
        assert.match(accent, /^#[0-9a-f]{6}$/i, `${theme.id}, variante ${seed}: ${accent} inválida`);
        assert.ok(contrastRatio(accent, VIDEO_BACKGROUND) >= MIN_DECORATIVE_CONTRAST,
          `${theme.id}, variante ${seed}: ${accent} perde contraste sobre o fundo do vídeo`);
      }
      assert.equal(selectThemePalette(paletteConfig, seed), palette, `${theme.id}: seed ${seed} não escolheu a paleta compartilhada`);
    }
    assert.equal(paletteConfig.identity.color, paletteConfig.variants[0].accents[0], `${theme.id}: identidade diverge do primeiro acento`);
  }
});

test('palette selection rejects invalid seeds and tolerates themes without variants', () => {
  assert.equal(selectThemePalette(null, 0), null);
  assert.equal(selectThemePalette({ variants: [] }, 0), null);
  assert.throws(() => selectThemePalette({ variants: [{ accents: ['#fff'] }] }, -1), /seed visual/);
  assert.throws(() => selectThemePalette({ variants: [{}] }, 1.5), /seed visual/);
});

test('keyword accents retain WCAG AA contrast over the brightest photo pixel with the shared caption scrim', () => {
  const alpha = VISUAL_DESIGN_TOKENS.video.captionKeywordScrimAlpha;
  assert.equal(alpha, 0.96);
  const brightestPhotoPixelAfterScrim = '#141419';
  const kitCss = fs.readFileSync(path.join(__dirname, '..', 'assets', 'scenes', 'kit.css'), 'utf8');
  const tokensCss = sceneCssTokens();

  assert.ok(tokensCss.includes(`--pulso-caption-keyword-scrim-alpha: ${alpha};`));
  for (const [index, [position, opacity]] of VISUAL_DESIGN_TOKENS.video.heroImageVeilStops.entries()) {
    assert.ok(tokensCss.includes(`--pulso-photo-veil-stop-${index}: ${position * 100}%;`));
    assert.ok(tokensCss.includes(`--pulso-photo-veil-alpha-${index}: ${opacity};`));
  }
  assert.ok(tokensCss.includes('--pulso-hero-bottom-scrim-height: 40%;'));
  assert.ok(tokensCss.includes('--pulso-hero-bottom-scrim-stop: 82%;'));
  assert.ok(tokensCss.includes('--pulso-hero-bottom-scrim-alpha: 0.97;'));
  assert.match(kitCss, /background-color:\s*rgba\(10,\s*10,\s*15,\s*var\(--pulso-caption-keyword-scrim-alpha,\s*0\.96\)\)/);
  assert.match(kitCss, /var\(--pulso-photo-veil-stop-0,\s*0%\)/);
  assert.match(kitCss, /var\(--pulso-hero-bottom-scrim-stop,\s*82%\)/);
  assert.match(kitCss, /box-decoration-break:\s*clone/);

  for (const theme of themes.filter(candidate => candidate.enabled)) {
    for (const [variantIndex, variant] of theme.visualPalettes.variants.entries()) {
      for (const accent of variant.accents) {
        assert.ok(contrastRatio(accent, brightestPhotoPixelAfterScrim) >= MIN_DECORATIVE_CONTRAST,
          `${theme.id}, variante ${variantIndex}: ${accent} falha sobre uma foto branca composta pelo scrim`);
      }
    }
  }
});

test('video kit and thumbnail consume the same documented base tokens and theme accent', () => {
  const tokens = VISUAL_DESIGN_TOKENS;
  const sceneCss = sceneCssTokens();
  const coverCss = thumbnailCssTokens('#22C55E');
  const kitCss = fs.readFileSync(path.join(__dirname, '..', 'assets', 'scenes', 'kit.css'), 'utf8');
  const coverHtml = buildThumbnailHtml({
    title: 'Dinheiro em movimento',
    headline: 'DINHEIRO EM MOVIMENTO',
    accent: '#22C55E'
  });

  for (const [token, value] of Object.entries({
    '--pulso-video-background': tokens.color.videoBackground,
    '--pulso-surface': tokens.color.surface,
    '--pulso-surface-secondary': tokens.color.surfaceSecondary,
    '--pulso-border': tokens.color.border,
    '--pulso-text': tokens.color.text,
    '--pulso-muted': tokens.color.muted
  })) {
    assert.ok(sceneCss.includes(`${token}: ${value};`), `scene token ${token}`);
    assert.ok(coverCss.includes(`${token}: ${value};`), `thumbnail token ${token}`);
  }

  assert.ok(sceneCss.includes(`--pulso-font-family: ${tokens.typography.primaryFamily}, ${tokens.typography.sharedFallbacks};`));
  assert.ok(coverCss.includes(`--pulso-font-family: ${tokens.typography.primaryFamily}, ${tokens.typography.sharedFallbacks};`));
  assert.match(sceneCss, /--pulso-video-safe-inset-ratio: 0\.05;/);
  assert.match(sceneCss, /--pulso-caption-keyword-scrim-alpha: 0\.96;/);
  assert.match(sceneCss, /--pulso-photo-veil-alpha-2: 0\.68;/);
  assert.match(sceneCss, /--pulso-hero-bottom-scrim-height: 40%;/);
  assert.ok(coverCss.includes(`--pulso-thumbnail-content-left: ${tokens.thumbnail.contentLeft}px;`));
  assert.ok(coverCss.includes(`--pulso-thumbnail-content-width: ${tokens.thumbnail.contentWidth}px;`));
  assert.match(kitCss, /--surface:\s*var\(--pulso-surface,/);
  assert.match(kitCss, /--text:\s*var\(--pulso-text,/);
  assert.match(coverCss, /--pulso-thumbnail-accent: #22C55E;/);
  assert.match(coverHtml, /\.impact\{color:var\(--pulso-thumbnail-accent\)/);
  assert.doesNotMatch(coverHtml, /#FFD84D|--pulso-thumbnail-highlight/);
  assert.match(thumbnailCssTokens('red'), /--pulso-thumbnail-accent: #60A5FA;/);
});
