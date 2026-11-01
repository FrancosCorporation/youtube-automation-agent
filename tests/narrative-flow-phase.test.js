'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectNarrativeFlowPhase } = require('../utils/narrative-flow-phase');

test('frase longa troca os conceitos antecedentes pelo processo e conserva o desfecho', () => {
  const objects = ['escassez', 'ansiedade', 'algo', 'lixo', 'psicólogo'].map(id => ({ id, label: id }));
  const sentence = { wordTimings: objects.map((object, index) => ({ text: object.label, startFrame: [10, 20, 40, 50, 80][index] })) };
  const relation = { kind: 'flow', objectIds: ['algo', 'lixo'] };
  assert.deepEqual(selectNarrativeFlowPhase({ objects, relation, sentence, frame: 30 }).map(x => x.id), ['escassez', 'ansiedade']);
  assert.deepEqual(selectNarrativeFlowPhase({ objects, relation, sentence, frame: 60 }).map(x => x.id), ['algo', 'lixo']);
  assert.deepEqual(selectNarrativeFlowPhase({ objects, relation, sentence, frame: 85 }).map(x => x.id), ['algo', 'lixo', 'psicólogo']);
  assert.deepEqual(selectNarrativeFlowPhase({ objects, relation, sentence, frame: 30 }).map(x => x.id), ['escassez', 'ansiedade']);
});
