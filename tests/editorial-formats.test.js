'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FORMATS, resolveEditorialFormat, editorialFormatPrompt } = require('../utils/editorial-formats');

test('the approved catalog has eight distinct editorial structures', () => {
  assert.equal(FORMATS.length, 8);
  assert.equal(new Set(FORMATS.map(format => format.id)).size, 8);
  assert.equal(new Set(FORMATS.map(format => format.structure)).size, 8);
});

test('selection is stable for resume and explicit format IDs are validated', () => {
  assert.deepEqual(resolveEditorialFormat({ seed: '/videos/one.mp4' }), resolveEditorialFormat({ seed: '/videos/one.mp4' }));
  assert.equal(resolveEditorialFormat({ formatId: 'myth-correction' }).id, 'myth-correction');
  assert.throws(() => resolveEditorialFormat({ formatId: 'made-up' }), /formatId/);
  assert.match(editorialFormatPrompt('three-steps'), /três etapas/);
});
