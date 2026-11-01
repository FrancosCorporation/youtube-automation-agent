'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { narrativeActiveObjectIds } = require('../utils/narrative-active-objects');

test('cada trecho mostra apenas os objetos e foco associados à frase atual', () => {
  const scene = { actions: [
    { cueSentenceId: 'sleep', targetObjectId: 'bed' }, { cueSentenceId: 'airway', targetObjectId: 'lungs' }
  ], cameraShots: [{ cueSentenceId: 'sleep', focusObjectId: 'clock' }, { cueSentenceId: 'airway', focusObjectId: 'lungs' }] };
  assert.deepEqual([...narrativeActiveObjectIds(scene, 'sleep')], ['bed', 'clock']);
  assert.deepEqual([...narrativeActiveObjectIds(scene, 'airway')], ['lungs']);
  assert.deepEqual([...narrativeActiveObjectIds(scene, undefined, { focusObjectId: 'bed' })], ['bed']);
});
