'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cueHasExplicitFlow, narrativeBeatRelation, narrativeCauseRelation, narrativeAlternativeRelation } = require('../utils/narrative-beat-relation');

test('relação bidirecional liga apenas os dois conceitos expressos na mesma frase', () => {
  const objects = [{ id: 'sleep', label: 'qualidade do sono' }, { id: 'weight', label: 'obesidade' }];
  assert.deepEqual(narrativeBeatRelation({ sentence: 'A relação bidirecional entre obesidade e qualidade do sono.', objects }),
    { kind: 'bidirectional', objectIds: ['sleep', 'weight'] });
  assert.equal(narrativeBeatRelation({ sentence: 'O sono e a obesidade estão relacionados.', objects }), null);
  assert.equal(narrativeBeatRelation({ sentence: 'A obesidade e o apetite influenciam-se mutuamente.', objects }), null);
});

test('relação causal direta mantém o sujeito completo e a condição da fala', () => {
  const objects = [{ id: 'memory', label: 'lembrança da escassez' }, { id: 'anxiety', label: 'ansiedade' }];
  assert.deepEqual(narrativeCauseRelation({ sentence: 'Se a lembrança da escassez dispara ansiedade, procure ajuda.', objects }),
    { kind: 'cause', objectIds: ['memory', 'anxiety'], trigger: 'dispara', conditional: true });
  assert.equal(narrativeCauseRelation({ sentence: 'A lembrança da escassez pode causar ansiedade.', objects }), null);
  assert.equal(narrativeCauseRelation({ sentence: 'A lembrança da escassez não causa ansiedade.', objects }), null);
});

test('mostra alternativa somente quando a fala liga as duas opções com ou', () => {
  const objects = [{ id: 'clinic', label: 'unidade de saúde' }, { id: 'doctor', label: 'psicólogo' }];
  assert.deepEqual(narrativeAlternativeRelation({ sentence: 'Procure um psicólogo ou a unidade de saúde.', objects }),
    { objectIds: ['doctor', 'clinic'], trigger: 'ou' });
  assert.equal(narrativeAlternativeRelation({ sentence: 'Procure um psicólogo e a unidade de saúde.', objects }), null);
});

test('comparação explícita não inventa direção, valor, nem liga rótulos sobrepostos', () => {
  const objects = [{ id: 'a', label: 'insônia' }, { id: 'b', label: 'apneia' }];
  assert.deepEqual(narrativeBeatRelation({ sentence: 'Insônia comparada com apneia.', objects }),
    { kind: 'comparison', objectIds: ['a', 'b'] });
  assert.equal(narrativeBeatRelation({ sentence: 'A insônia é menos comum que a apneia.', objects: [{ id: 'a', label: 'insônia' }, { id: 'b', label: 'sono' }] }), null);
  assert.equal(narrativeBeatRelation({ sentence: 'Uma comparação entre qualidade do sono e sono.', objects: [{ id: 'a', label: 'qualidade do sono' }, { id: 'b', label: 'sono' }] }), null);
});

test('processos desenham a direção explicitamente falada, sem criar relações negadas', () => {
  const objects = [{ id: 'answer', label: 'resposta' }, { id: 'question', label: 'pergunta' }];
  assert.deepEqual(narrativeBeatRelation({ sentence: 'A pergunta se transforma em resposta.', objects }),
    { kind: 'flow', objectIds: ['question', 'answer'], trigger: 'transforma' });
  assert.deepEqual(narrativeBeatRelation({ sentence: 'O documento segue para o computador.', objects: [
    { id: 'computer', label: 'computador' }, { id: 'paper', label: 'documento' }
  ] }), { kind: 'flow', objectIds: ['paper', 'computer'], trigger: 'segue' });
  assert.deepEqual(narrativeBeatRelation({ sentence: 'A fonte envia informação para o modelo.', objects: [
    { id: 'source', label: 'fonte' }, { id: 'model', label: 'modelo' }
  ] }), { kind: 'flow', objectIds: ['source', 'model'], trigger: 'envia' });
  assert.equal(narrativeBeatRelation({ sentence: 'A pergunta não se transforma em resposta.', objects }), null);
  assert.equal(narrativeBeatRelation({ sentence: 'A pergunta e a resposta são analisadas.', objects }), null);
  assert.equal(narrativeBeatRelation({ sentence: 'A pergunta envia dados; outro processo segue para a resposta.', objects }), null);
  assert.equal(cueHasExplicitFlow('Os prazos seguem até dezembro.'), false);
  assert.deepEqual(narrativeBeatRelation({ sentence: 'Se algo vai para o lixo, peça ajuda.', objects: [
    { id: 'bin', label: 'lixo' }, { id: 'item', label: 'algo' }
  ] }), { kind: 'flow', objectIds: ['item', 'bin'], trigger: 'vai', conditional: true });
  assert.deepEqual(narrativeBeatRelation({ sentence: 'Se a escassez dispara ansiedade quando algo vai para o lixo, procure um psicólogo.', objects: [
    { id: 'help', label: 'psicólogo' }, { id: 'scarcity', label: 'escassez' }, { id: 'anxiety', label: 'ansiedade' },
    { id: 'item', label: 'algo' }, { id: 'bin', label: 'lixo' }
  ] }), { kind: 'flow', objectIds: ['item', 'bin'], trigger: 'vai', conditional: true });
  assert.equal(narrativeBeatRelation({ sentence: 'Se a escassez dispara ansiedade quando algo vai para o lixo, procure um psicólogo.', objects: [
    { id: 'scarcity', label: 'escassez' }, { id: 'help', label: 'psicólogo' }
  ] }), null);
  assert.deepEqual(narrativeBeatRelation({ sentence: 'Transformar sobras em novas receitas ajuda o bolso.', objects: [
    { id: 'recipes', label: 'receitas' }, { id: 'leftovers', label: 'sobras' }
  ] }), { kind: 'flow', objectIds: ['leftovers', 'recipes'], trigger: 'transformar' });
});
