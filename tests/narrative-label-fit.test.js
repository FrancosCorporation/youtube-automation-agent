'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { narrativeLabelMaxWidth, placeProjectedLabels } = require('../utils/narrative-label-fit');

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

test('projected actor labels remain separate within the portrait viewport and reproduce on seek', () => {
  const labels=[{id:'parent',x:520,y:700,width:350,height:36},{id:'child',x:460,y:714,width:152,height:36}];
  const before=globalThis.structuredClone(labels);
  const placed=placeProjectedLabels(labels,994,1100);
  const [a,b]=placed;
  assert(a.x+a.width+8<=b.x||b.x+b.width+8<=a.x||a.y+a.height+8<=b.y||b.y+b.height+8<=a.y);
  assert(placed.every(p=>p.x>=8&&p.y>=8&&p.x+p.width<=986&&p.y+p.height<=1092));
  placeProjectedLabels(labels.map(p=>({...p,x:p.x+50,y:p.y-100})),994,1100);
  assert.deepEqual(placeProjectedLabels(labels,994,1100),placed);
  assert.deepEqual(labels,before);
});

test('labels with a shared anchor do not obscure the rendered human silhouette', () => {
  const actor = {x: 400, y: 300, width: 100, height: 240};
  const labels = ['floor', 'wall', 'sink', 'person'].map(id => ({id, x: 450, y: 400, width: 180, height: 36}));
  const placed = placeProjectedLabels(labels, 900, 650, 8, [actor]);
  for (const label of placed) assert(label.x + label.width <= actor.x || label.x >= actor.x + actor.width
    || label.y + label.height <= actor.y || label.y >= actor.y + actor.height);
  assert.deepEqual(placeProjectedLabels(labels, 900, 650, 8, [actor]), placed);
});
