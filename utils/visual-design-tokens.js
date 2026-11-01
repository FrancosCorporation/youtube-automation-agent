'use strict';

const VISUAL_DESIGN_TOKENS = Object.freeze({
  color: Object.freeze({
    videoBackground: '#0A0A0F',
    surface: '#131519',
    surfaceSecondary: '#16181D',
    border: '#23252B',
    text: '#F5F5F7',
    muted: '#9CA3AF',
    thumbnailBackground: '#070b13',
    thumbnailSurface: '#101827',
    fallbackAccent: '#60A5FA'
  }),
  typography: Object.freeze({
    primaryFamily: 'Inter',
    sharedFallbacks: 'system-ui, -apple-system, \'Segoe UI\', Arial, sans-serif',
    coverHeadlineSize: 92,
    coverHeadlineMinimumSize: 48,
    coverHeadlineMaximumHeight: 560
  }),
  video: Object.freeze({
    safeInsetRatio: 0.05,
    captionKeywordScrimAlpha: 0.96,
    surfaceRadiusRatio: 0.012,
    surfaceBorderAlpha: 0.22,
    surfaceHighlightAlpha: 0.12,
    surfaceGlowAlpha: 0.14,
    heroImageVeilStops: Object.freeze([
      Object.freeze([0, 0.9]),
      Object.freeze([0.34, 0.5]),
      Object.freeze([0.6, 0.68]),
      Object.freeze([1, 0.97])
    ]),
    heroBottomScrim: Object.freeze({ heightRatio: 0.4, opaqueStop: 0.82, alpha: 0.97 })
  }),
  presenter: Object.freeze({
    fallbackAccents: Object.freeze(['#60A5FA', '#5EEAD4', '#A78BFA', '#FBBF24'])
  }),
  thumbnail: Object.freeze({
    width: 1280,
    height: 720,
    contentLeft: 92,
    contentTop: 64,
    contentBottom: 48,
    contentWidth: 780,
    accentLeft: 68,
    accentTop: 78,
    edgeInset: 20
  })
});

function fontStack(fallbacks) {
  return `${VISUAL_DESIGN_TOKENS.typography.primaryFamily}, ${fallbacks}`;
}

function sceneCssTokens() {
  const { color, typography, video } = VISUAL_DESIGN_TOKENS;
  return `:root {
  --pulso-font-family: ${fontStack(typography.sharedFallbacks)};
  --pulso-video-background: ${color.videoBackground};
  --pulso-surface: ${color.surface};
  --pulso-surface-secondary: ${color.surfaceSecondary};
  --pulso-border: ${color.border};
  --pulso-text: ${color.text};
  --pulso-muted: ${color.muted};
  --pulso-accent-fallback: ${color.fallbackAccent};
  --pulso-video-safe-inset-ratio: ${video.safeInsetRatio};
  --pulso-caption-keyword-scrim-alpha: ${video.captionKeywordScrimAlpha};
  --pulso-surface-radius-ratio: ${video.surfaceRadiusRatio};
  --pulso-surface-border-alpha: ${video.surfaceBorderAlpha};
  --pulso-surface-highlight-alpha: ${video.surfaceHighlightAlpha};
  --pulso-surface-glow-alpha: ${video.surfaceGlowAlpha};
  --pulso-photo-veil-stop-0: ${video.heroImageVeilStops[0][0] * 100}%;
  --pulso-photo-veil-alpha-0: ${video.heroImageVeilStops[0][1]};
  --pulso-photo-veil-stop-1: ${video.heroImageVeilStops[1][0] * 100}%;
  --pulso-photo-veil-alpha-1: ${video.heroImageVeilStops[1][1]};
  --pulso-photo-veil-stop-2: ${video.heroImageVeilStops[2][0] * 100}%;
  --pulso-photo-veil-alpha-2: ${video.heroImageVeilStops[2][1]};
  --pulso-photo-veil-stop-3: ${video.heroImageVeilStops[3][0] * 100}%;
  --pulso-photo-veil-alpha-3: ${video.heroImageVeilStops[3][1]};
  --pulso-hero-bottom-scrim-height: ${video.heroBottomScrim.heightRatio * 100}%;
  --pulso-hero-bottom-scrim-stop: ${video.heroBottomScrim.opaqueStop * 100}%;
  --pulso-hero-bottom-scrim-alpha: ${video.heroBottomScrim.alpha};
}`;
}

function thumbnailCssTokens(accent = VISUAL_DESIGN_TOKENS.color.fallbackAccent) {
  const { color, typography, thumbnail } = VISUAL_DESIGN_TOKENS;
  const safeAccent = /^#[0-9a-f]{6}$/i.test(String(accent || '')) ? accent : color.fallbackAccent;
  return `:root {
  --pulso-font-family: ${fontStack(typography.sharedFallbacks)};
  --pulso-video-background: ${color.videoBackground};
  --pulso-surface: ${color.surface};
  --pulso-surface-secondary: ${color.surfaceSecondary};
  --pulso-border: ${color.border};
  --pulso-text: ${color.text};
  --pulso-muted: ${color.muted};
  --pulso-thumbnail-background: ${color.thumbnailBackground};
  --pulso-thumbnail-surface: ${color.thumbnailSurface};
  --pulso-thumbnail-accent: ${safeAccent};
  --pulso-thumbnail-width: ${thumbnail.width}px;
  --pulso-thumbnail-height: ${thumbnail.height}px;
  --pulso-thumbnail-content-left: ${thumbnail.contentLeft}px;
  --pulso-thumbnail-content-top: ${thumbnail.contentTop}px;
  --pulso-thumbnail-content-bottom: ${thumbnail.contentBottom}px;
  --pulso-thumbnail-content-width: ${thumbnail.contentWidth}px;
  --pulso-thumbnail-accent-left: ${thumbnail.accentLeft}px;
  --pulso-thumbnail-accent-top: ${thumbnail.accentTop}px;
  --pulso-thumbnail-edge-inset: ${thumbnail.edgeInset}px;
  --pulso-thumbnail-headline-size: ${typography.coverHeadlineSize}px;
  --pulso-thumbnail-headline-min-size: ${typography.coverHeadlineMinimumSize}px;
  --pulso-thumbnail-headline-max-height: ${typography.coverHeadlineMaximumHeight}px;
}`;
}

module.exports = { VISUAL_DESIGN_TOKENS, sceneCssTokens, thumbnailCssTokens };
