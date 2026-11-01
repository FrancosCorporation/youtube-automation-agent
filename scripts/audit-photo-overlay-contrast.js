#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { themes } = require('../config/themes.json');
const { VISUAL_DESIGN_TOKENS } = require('../utils/visual-design-tokens');

const IMAGE_ROOT = path.resolve(process.argv[2] || 'data/images');
const OUTPUT_PATH = process.argv[3] ? path.resolve(process.argv[3]) : null;
const WIDTH = 256;
const HEIGHT = 144;
const TEXT_REGION_START = 0.8;
const SAMPLE_NAME = /^g0a-visual-.*\.(?:png|jpe?g|webp)$/i;
const BASE = VISUAL_DESIGN_TOKENS.color.videoBackground;
const PRIMARY_TEXT = VISUAL_DESIGN_TOKENS.color.text;
const MUTED_TEXT = VISUAL_DESIGN_TOKENS.color.muted;
const VIDEO_TOKENS = VISUAL_DESIGN_TOKENS.video;
const MIN_CONTRAST = 4.5;

function walk(directory, files = []) {
  return fs.readdir(directory, { withFileTypes: true }).then(async entries => {
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file, files);
      else if (SAMPLE_NAME.test(entry.name)) files.push(file);
    }
    return files;
  });
}

function channelFromHex(hex, offset) {
  return Number.parseInt(hex.slice(offset, offset + 2), 16);
}

function colorFromHex(hex) {
  return [channelFromHex(hex, 1), channelFromHex(hex, 3), channelFromHex(hex, 5)];
}

function luminance(rgb) {
  const linear = rgb.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastAgainst(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function mixChannel(foreground, background, alpha) {
  return Math.round(foreground * alpha + background * (1 - alpha));
}

function mix(foreground, background, alpha) {
  return foreground.map((channel, index) => mixChannel(channel, background[index], alpha));
}

function interpolateStops(y, stops) {
  for (let index = 1; index < stops.length; index += 1) {
    const [rightY, rightAlpha] = stops[index];
    const [leftY, leftAlpha] = stops[index - 1];
    if (y <= rightY) {
      const fraction = (y - leftY) / (rightY - leftY);
      return leftAlpha + (rightAlpha - leftAlpha) * fraction;
    }
  }
  return stops.at(-1)[1];
}

function heroVeilAlpha(y) {
  return interpolateStops(y, VIDEO_TOKENS.heroImageVeilStops);
}

function heroBottomScrimAlpha(y) {
  const { heightRatio, opaqueStop, alpha } = VIDEO_TOKENS.heroBottomScrim;
  const start = 1 - heightRatio;
  if (y <= start) return 0;
  const withinScrim = (y - start) / heightRatio;
  return alpha * Math.min(1, withinScrim / opaqueStop);
}

function themeColors(theme) {
  return [...new Set(theme.visualPalettes.variants.flatMap(variant => variant.accents))];
}

async function auditImage(file, theme) {
  const { data, info } = await sharp(file)
    .flatten({ background: BASE })
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const foregrounds = [
    { role: 'primaryText', hex: PRIMARY_TEXT },
    { role: 'mutedText', hex: MUTED_TEXT },
    ...themeColors(theme).map((hex, index) => ({ role: `accent${index + 1}`, hex }))
  ].map(color => ({
    ...color,
    backingAlpha: color.role.startsWith('accent') ? VIDEO_TOKENS.captionKeywordScrimAlpha : null,
    rgb: colorFromHex(color.hex),
    min: Infinity,
    at: null
  }));
  const baseRgb = colorFromHex(BASE);
  const startY = Math.floor(info.height * TEXT_REGION_START);

  for (let y = startY; y < info.height; y += 1) {
    const fractionY = y / info.height;
    const veilAlpha = heroVeilAlpha(fractionY);
    const bottomAlpha = heroBottomScrimAlpha(fractionY);
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const photo = [data[offset], data[offset + 1], data[offset + 2]];
      const afterVeil = mix(baseRgb, photo, veilAlpha);
      const rendered = mix(baseRgb, afterVeil, bottomAlpha);
      for (const foreground of foregrounds) {
        const textBackground = foreground.backingAlpha == null
          ? rendered
          : mix(baseRgb, rendered, foreground.backingAlpha);
        const ratio = contrastAgainst(foreground.rgb, textBackground);
        if (ratio < foreground.min) {
          foreground.min = ratio;
          foreground.at = { x: Number((x / info.width).toFixed(4)), y: Number(fractionY.toFixed(4)) };
        }
      }
    }
  }

  const dimensions = await sharp(file).metadata();
  return {
    file: path.relative(process.cwd(), file),
    dimensions: { width: dimensions.width, height: dimensions.height },
    region: { yStart: TEXT_REGION_START, yEnd: 1, samples: info.width * (info.height - startY) },
    minimumContrast: Object.fromEntries(foregrounds.map(({ role, hex, min, at }) => [role, {
      foreground: hex,
      ratio: Number(min.toFixed(3)),
      at,
      passes: min >= MIN_CONTRAST
    }]))
  };
}

async function main() {
  const files = await walk(IMAGE_ROOT);
  const themeResults = [];
  for (const theme of themes.filter(item => item.enabled)) {
    const candidates = files.filter(file => path.basename(path.dirname(file)).startsWith(`${theme.id}_`)).sort();
    const images = [];
    for (const file of candidates) images.push(await auditImage(file, theme));
    themeResults.push({ id: theme.id, imageCount: images.length, images });
  }

  const missingThemes = themeResults.filter(theme => theme.imageCount === 0).map(theme => theme.id);
  const failed = themeResults.flatMap(theme => theme.images.flatMap(image =>
    Object.entries(image.minimumContrast)
      .filter(([, result]) => !result.passes)
      .map(([role, result]) => ({ theme: theme.id, file: image.file, role, ...result }))));
  const report = {
    generatedAt: new Date().toISOString(),
    method: {
      source: 'all local g0a generated visual assets in matching article directories',
      themes: themeResults.length,
      imageCount: themeResults.reduce((sum, theme) => sum + theme.imageCount, 0),
      resizedTo: { width: WIDTH, height: HEIGHT, fit: 'cover', position: 'centre' },
      measuredRegion: { yStart: TEXT_REGION_START, yEnd: 1 },
      overlays: {
        imageVeil: {
          source: 'assets/scenes/kit.css .img-hero .veil linear-gradient, composited over #0A0A0F',
          stops: VIDEO_TOKENS.heroImageVeilStops
        },
        heroBottomScrim: {
          source: 'assets/scenes/kit.css .scene.hero::after',
          ...VIDEO_TOKENS.heroBottomScrim
        }
      },
      colors: {
        primaryText: PRIMARY_TEXT,
        mutedText: MUTED_TEXT,
        accents: 'all configured accents per theme',
        accentKeywordBackingAlpha: VIDEO_TOKENS.captionKeywordScrimAlpha
      },
      threshold: `WCAG contrast ratio >= ${MIN_CONTRAST}`,
      limitation: 'Offline CSS/photo estimate; does not validate portrait-photo scenes, layout variation, glyph antialiasing, physical displays, or human visual approval.'
    },
    missingThemes,
    failed,
    themes: themeResults,
    passed: missingThemes.length === 0 && failed.length === 0
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (OUTPUT_PATH) {
    await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fs.writeFile(OUTPUT_PATH, json);
  }
  process.stdout.write(json);
  if (!report.passed) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`Falha na auditoria de contraste fotográfico: ${String(error.message || error)}\n`);
  process.exitCode = 1;
});
