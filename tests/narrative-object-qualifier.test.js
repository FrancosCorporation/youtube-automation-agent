'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { narrativeObjectQualifier } = require('../utils/narrative-object-qualifier');

test('qualificadores preservam negação e condição sem inventar uma proibição', () => {
  assert.deepEqual(narrativeObjectQualifier('escolha', { text: 'O cuidado deixa de ser escolha.' }), { trigger: 'escolha', label: 'DEIXA DE SER' });
  assert.deepEqual(narrativeObjectQualifier('potes', { text: 'Ela junta potes que nunca vai usar.' }), { trigger: 'usar', label: 'NÃO VAI USAR' });
  assert.equal(narrativeObjectQualifier('potes', { text: 'Ela usa os potes.' }), null);
  assert.equal(narrativeObjectQualifier('escolha', { text: 'A escolha continua possível.' }), null);
});
