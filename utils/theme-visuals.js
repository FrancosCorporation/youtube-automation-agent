'use strict';

function selectThemePalette(paletteConfig, seed) {
  const variants = Array.isArray(paletteConfig?.variants) ? paletteConfig.variants : [];
  if (!variants.length) return null;
  if (!Number.isSafeInteger(seed) || seed < 0) throw new TypeError('seed visual deve ser inteiro não negativo');
  return variants[seed % variants.length] || null;
}

function relativeLuminance(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(String(hex || ''))) throw new TypeError(`cor hexadecimal inválida: ${hex}`);
  const [red, green, blue] = [1, 3, 5].map(index => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first, second) {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

module.exports = { contrastRatio, relativeLuminance, selectThemePalette };
