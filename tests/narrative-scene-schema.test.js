'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Ajv = require('ajv');
const { sceneResponseFormat } = require('../utils/narrative-scene-schema');

const model = 'nvidia/nemotron-3.5-super-vl-120b-a12b';
const input = { id: 'scene-02', narration: [{ id: 'section-1-sentence-5', text: 'O sinal se torna visível.' }] };
function fixture() {
  const pose = { x: .5, y: .5, scale: 1, rotate: 0 };
  const camera = { position: [0, 3, 14], target: [0, 0, 0], fov: 34 };
  const node = { id: 'signal', evidence: 'sinal', evidenceSentenceId: null, label: '',
    layout: { landscape: pose, portrait: pose }, depth: 0, actorId: null, actorMotion: null, actorMotionCueText: '',
    meshes: [{ type: 'sphere', color: '#95d7bc', position: [0, 0, 0], rotation: [0, 0, 0],
      size: [1, 1, 1], opacity: 1, metalness: .15, points: [] }] };
  return { scenes: [{ id: input.id, visualThesis: 'O sinal se torna visível.', illustrations: [{
    cueSentenceId: input.narration[0].id, dimension: '3d', explanation: 'O sinal se torna visível na frase narrada.',
    nodes: [node, { ...node, id: 'receiver' }], motions: [], spatialChecks: [], camera: { landscape: camera, portrait: camera },
    tracks: [{ targetId: 'signal', meshIndex: null, property: 'opacity', keyframes: [
      { cueSentenceId: input.narration[0].id, boundary: 'start', cueText: '', offsetSeconds: 0, value: 0, easing: 'linear' },
      { cueSentenceId: input.narration[0].id, boundary: 'end', cueText: '', offsetSeconds: 0, value: 1, easing: 'linear' }
    ] }]
  }] }] };
}

test('provider schema rejects production type/enum/range/ID failures before local visual validation', () => {
  const format = sceneResponseFormat(model, [input]);
  assert.equal(format.type, 'json_schema');
  const validate = new Ajv().compile(format.json_schema.schema);
  assert.equal(validate(fixture()), true, JSON.stringify(validate.errors));
  for (const mutate of [
    value => { value.scenes[0].illustrations[0].tracks[0].keyframes[0].value = [0.1, 0, 0]; },
    value => { value.scenes[0].illustrations[0].nodes[0].meshes[0].size[0] = 14; },
    value => { value.scenes[0].illustrations[0].motions.push({ targetId: 'signal', kind: 'opacity' }); },
    value => { value.scenes[0].illustrations[0].cueSentenceId = 'wrong-cue'; },
    value => { value.scenes[0].illustrations.push(value.scenes[0].illustrations[0]); },
    value => { value.scenes[0].dimension = '3d'; },
    value => { value.scenes[0].illustrations[0].nodes[0].evidence = 'objeto inventado'; }
  ]) {
    const value = fixture(); mutate(value);
    assert.equal(validate(value), false);
  }
});

test('other provider models retain supported JSON mode instead of assuming schema support', () => {
  assert.deepEqual(sceneResponseFormat('other-model', [input]), { type: 'json_object' });
});
