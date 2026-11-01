'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { narrativeLabelMaxWidth } = require('../utils/narrative-label-fit');

test('largura dos rótulos respeita as bordas e a separação entre objetos no retrato', () => {
  for (const x of [116.5, 446.5]) {
    const width = narrativeLabelMaxWidth({ x, width: 562.5, spacing: 330 });
    assert.ok(x - width / 2 >= 18);
    assert.ok(x + width / 2 <= 562.5 - 18);
    assert.ok(width <= 312);
  }
  assert.equal(narrativeLabelMaxWidth({ x: 500, width: 1000, spacing: 180 }), 162);
  assert.throws(() => narrativeLabelMaxWidth({ x: NaN, width: 1000, spacing: 180 }), /inválida/);
});
