'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { choosePresenterShot } = require('../utils/presenter-framing');

test('portrait narrative keeps the presenter on the right at a stable full framing', () => {
  for (let index = 0; index < 8; index += 1) {
    assert.deepEqual(choosePresenterShot({
      presenter: true,
      presenterShot: { side: 'left', framing: 'close' }
    }, index, 9281, { portrait: true }), {
      side: 'right', framing: 'full', hidden: false
    });
  }
});

test('landscape retains explicit editorial framing', () => {
  assert.deepEqual(choosePresenterShot({
    presenter: true,
    presenterShot: { side: 'left', framing: 'close' }
  }, 2, 4), { side: 'left', framing: 'close', hidden: false });
});

test('landscape holds one presenter side and framing across every scene in a video', () => {
  const shots = Array.from({ length: 12 }, (_, index) => choosePresenterShot({ presenter: true }, index, 19));
  assert(shots.every(shot => shot.side === shots[0].side));
  assert(shots.every(shot => shot.framing === 'full'));
});

test('landscape data scenes can hide the presenter while portrait keeps the presenter visible', () => {
  const graph = { presenter: true, components: [{ type: 'node-graph' }] };
  assert.equal(choosePresenterShot(graph, 0, 1, { hideOnDataScenes: true }).hidden, true);
  assert.equal(choosePresenterShot(graph, 0, 1, { portrait: true, hideOnDataScenes: true }).hidden, false);
  assert.equal(choosePresenterShot({ presenter: true, components: [{ type: 'caption' }] }, 0, 1,
    { hideOnDataScenes: true }).hidden, false);
});

test('Atlas retrieval scenes use the data-scene framing policy', () => {
  const atlas = { presenter: true, components: [{ type: 'atlas-story-scene' }] };
  assert.equal(choosePresenterShot(atlas, 0, 1, { hideOnDataScenes: true }).hidden, true);
  assert.equal(choosePresenterShot(atlas, 0, 1, { portrait: true, hideOnDataScenes: true }).hidden, false);
});
