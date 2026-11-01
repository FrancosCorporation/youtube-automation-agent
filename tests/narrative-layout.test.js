'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const project = path.join(__dirname, '..', 'experiments', 'remotion-motion-review');
const typescript = require(path.join(project, 'node_modules', 'typescript'));
const source = fs.readFileSync(path.join(project, 'src', 'narrative-layout.ts'), 'utf8');
const compiled = typescript.transpileModule(source, { compilerOptions: { module: typescript.ModuleKind.CommonJS } }).outputText;
const loaded = { exports: {} };
new Function('module', 'exports', compiled)(loaded, loaded.exports);
const { safeNarrativePose, wrapNarrativeLabel } = loaded.exports;

test('cartões permanecem separados nos dois formatos para dois a quatro objetos em movimento', () => {
  for (const aspect of ['landscape', 'portrait']) {
    const width = aspect === 'landscape' ? 1000 : 562.5;
    const height = aspect === 'landscape' ? 562.5 : 1000;
    const cardWidth = aspect === 'landscape' ? 208 : 330;
    const cardHeight = (aspect === 'landscape' ? 132 : 154) + 16;
    for (const count of [2, 3, 4]) {
      const variants = Array.from({ length: count }, (_, index) => [
        safeNarrativePose({ x: -1, y: -1, scale: 1.6 }, { x: 0.5, y: 0.5, scale: 1 }, aspect, index, count),
        safeNarrativePose({ x: 2, y: 2, scale: 1.6 }, { x: 0.5, y: 0.5, scale: 1 }, aspect, index, count)
      ]);
      for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) {
        for (const first of variants[a]) for (const second of variants[b]) {
          // Include the maximum five-degree transform rotation and illustrative label.
          const angle = 5 * Math.PI / 180;
          const rotatedWidth = cardWidth * Math.cos(angle) + cardHeight * Math.sin(angle);
          const rotatedHeight = cardHeight * Math.cos(angle) + cardWidth * Math.sin(angle);
          const dx = Math.abs(first.x - second.x) * width;
          const dy = Math.abs(first.y - second.y) * height;
          assert.ok(dx >= rotatedWidth * (first.scale + second.scale) / 2
            || dy >= rotatedHeight * (first.scale + second.scale) / 2, `${aspect} objetos ${a}/${b} se sobrepõem`);
        }
      }
    }
  }
});

test('movimento do objeto preserva o sentido sem atravessar as células', () => {
  const base = { x: 0.3, y: 0.3, scale: 1 };
  const before = safeNarrativePose({ x: 0.2, y: 0.3, scale: 1 }, base, 'landscape', 0, 2);
  const after = safeNarrativePose({ x: 0.4, y: 0.3, scale: 1 }, base, 'landscape', 0, 2);
  assert.ok(before.x < after.x);
  assert.ok(after.x - before.x <= 0.07 + 1e-12);
});

test('rótulo comprido é limitado a duas linhas sem transbordar o cartão', () => {
  for (const text of ['responsabilidade extraordinariamente longa', 'supercalifragilisticexpialidocious']) {
    const lines = wrapNarrativeLabel(text, 14);
    assert.ok(lines.length <= 2);
    assert.ok(lines.every(line => line.length <= 14));
    assert.ok(lines.some(line => line.endsWith('…')));
  }
});

test('palavra longa que cabe em duas linhas é preservada em vez de abreviada', () => {
  const lines = wrapNarrativeLabel('Responsabilidade fiscal', 14);
  assert.deepEqual(lines, ['Responsabilid-', 'ade fiscal']);
  assert.equal(lines.join('').replace('-', ''), 'Responsabilidade fiscal');
});
