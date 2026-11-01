'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_HOOK_WORDS,
  MIN_HOOK_WORDS,
  STRUCTURES,
  countHookWords,
  hookStructureGuidance,
  isHookWordCountValid,
  selectHookStructure
} = require('../utils/hook-structure');

test('contagem de palavras aplica o limite editorial de 7–12 sem alterar o texto', () => {
  assert.equal(MIN_HOOK_WORDS, 7);
  assert.equal(MAX_HOOK_WORDS, 12);
  assert.equal(countHookWords('Por que o sono muda a forma de guardar memórias?'), 10);
  assert.equal(isHookWordCountValid(7), true);
  assert.equal(isHookWordCountValid(12), true);
  assert.equal(isHookWordCountValid(13), false);
  assert.equal(isHookWordCountValid(0), false);
});

test('contagem ignora tokens formados apenas por pontuação', () => {
  assert.equal(countHookWords('— Por que sono muda memória humana?'), 6);
  assert.equal(isHookWordCountValid(countHookWords('— Por que sono muda memória humana?')), false);
  assert.equal(countHookWords('“Por que o sono muda a forma de guardar memórias?”'), 10);
});

test('seleção de estrutura é determinística e limitada ao catálogo editorial', () => {
  const first = selectHookStructure('Privação de sono');
  assert.deepEqual(selectHookStructure('Privação de sono'), first);
  assert.ok(STRUCTURES.some(structure => structure.id === first.id));
});

test('orientações preservam limites factuais e o tamanho existente do gancho', () => {
  const guidance = hookStructureGuidance('Saúde e sono');
  assert.match(guidance, /7–12 palavras/);
  assert.match(guidance, /não acrescente números, causas, resultados/);
  assert.match(guidance, /ESTRUTURA DE GANCHO/);
});

test('fixtures em português exercitam as cinco estruturas sem alterar seus limites factuais', () => {
  const topics = [
    ['pergunta-respondida', 'Pauta 1: ciência, economia e cotidiano no Brasil'],
    ['contraste-verificado', 'Pauta 5: ciência, economia e cotidiano no Brasil'],
    ['consequencia-cotidiana', 'Pauta 3: ciência, economia e cotidiano no Brasil'],
    ['evidencia-e-limite', 'Pauta 6: ciência, economia e cotidiano no Brasil'],
    ['mecanismo-explicado', 'Pauta 7: ciência, economia e cotidiano no Brasil']
  ];

  assert.deepEqual(new Set(topics.map(([, topic]) => selectHookStructure(topic).id)),
    new Set(STRUCTURES.map(structure => structure.id)));
  for (const [id, topic] of topics) {
    const guidance = hookStructureGuidance(topic);
    assert.match(guidance, new RegExp(`ESTRUTURA DE GANCHO DESTA PAUTA \\(${id}\\)`));
    assert.match(guidance, /7–12 palavras/);
    assert.match(guidance, /sem insinuar uma resposta|use esta forma apenas|sem transformar possibilidade|limite do que ainda não se sabe|prometa somente a explicação/);
    assert.match(guidance, /não acrescente números, causas, resultados, falas ou certezas ausentes da fonte/);
  }
});
