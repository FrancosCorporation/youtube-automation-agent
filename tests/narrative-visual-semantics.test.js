'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cueHasLongBeatVariation, cueRequiresPairedVisual, validateCueVisualGrounding } = require('../utils/narrative-visual-semantics');

function check(label, text, options = {}) {
  const objects = [{ id: 'one', label, labelType: options.labelType || 'literal' }];
  const actions = [{ cueSentenceId: 'cue', targetObjectId: 'one', kind: 'reveal-part' }];
  if (options.second) {
    objects.push({ id: 'two', label: options.second, labelType: 'literal' });
    actions.push({ cueSentenceId: 'cue', targetObjectId: 'two', kind: 'reveal-part' });
  }
  return validateCueVisualGrounding({ scene: { objects, actions, cameraShots: [] },
    cue: { id: 'cue', text }, previousCue: options.previous && { text: options.previous } });
}

test('objeto destacado deve estar na frase atual, anterior ou ser ilustrativo', () => {
  assert.equal(check('sinal', 'O sinal parte.').grounded, true);
  assert.equal(check('sinal', 'Ele chega.', { previous: 'O sinal parte.' }).grounded, true);
  assert.equal(check('satélite', 'O sinal parte.').grounded, false);
  assert.equal(check('exemplo', 'O sinal parte.', { labelType: 'illustrative' }).grounded, true);
  assert.equal(check('IA', 'O dia começou.').grounded, false);
  assert.equal(check('IA', 'A IA chegou.').grounded, true);
});

test('divisão e transformação explícitas exigem os dois elementos em foco', () => {
  const text = 'Os dados são divididos em pacotes.';
  assert.equal(cueRequiresPairedVisual(text), true);
  assert.equal(check('dados', text).paired, false);
  assert.equal(check('dados', text, { second: 'pacotes' }).paired, true);
  assert.equal(cueRequiresPairedVisual('A proposta dividiu opiniões.'), false);
  assert.equal(cueRequiresPairedVisual('O documento segue para o computador.'), true);
  assert.equal(cueRequiresPairedVisual('A pessoa não envia a carta para a escola.'), false);
});

test('trajetos diferentes precisam de um mapa ou rede em foco', () => {
  const cue = { id: 'cue', text: 'Eles seguem trajetos diferentes até o destino.' };
  const scene = { objects: [{ id: 'destination', kind: 'device', label: 'destino', labelType: 'literal' }],
    actions: [{ cueSentenceId: cue.id, targetObjectId: 'destination' }], cameraShots: [] };
  assert.equal(validateCueVisualGrounding({ scene, cue }).routes, false);
  scene.objects[0].kind = 'map';
  assert.equal(validateCueVisualGrounding({ scene, cue }).routes, true);
});

test('frase longa precisa mudar para outro foco durante a narração', () => {
  const cue = { id: 'cue', startFrame: 0, endFrame: 313 };
  const scene = { objects: [{ id: 'a', label: 'um', kind: 'document' }, { id: 'b', label: 'outro', kind: 'device' }],
    cameraShots: [{ cueSentenceId: 'cue', focusObjectId: 'a', startFrame: 0 }] };
  assert.equal(cueHasLongBeatVariation({ cue, scene, fps: 24 }), false);
  scene.cameraShots.push({ cueSentenceId: 'cue', focusObjectId: 'a', startFrame: 150 });
  assert.equal(cueHasLongBeatVariation({ cue, scene, fps: 24 }), false);
  scene.cameraShots[1].focusObjectId = 'b';
  assert.equal(cueHasLongBeatVariation({ cue, scene, fps: 24 }), true);
  scene.objects[1] = { id: 'b', label: 'um', kind: 'document' };
  assert.equal(cueHasLongBeatVariation({ cue, scene, fps: 24 }), false);
  assert.equal(cueHasLongBeatVariation({ cue: { ...cue, endFrame: 288 }, scene: { cameraShots: [] }, fps: 24 }), true);
});
