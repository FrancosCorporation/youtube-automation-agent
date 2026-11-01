'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  extractOrderedChecklist,
  extractRotationCards,
  formatVideoTimestamp,
  normalizeComparisonItems,
  normalizeMetricComparisonItems,
  findNarrationCueOffset
} = require('../utils/scene-visuals');

test('ordered checklist requires explicit, increasing steps and preserves their spoken wording', () => {
  const source = 'Primeiro, confira a origem da notícia. Segundo, compare os dados publicados. Terceiro, explique o que ainda falta confirmar.';
  assert.deepEqual(extractOrderedChecklist(source), [
    'Primeiro, confira a origem da notícia.',
    'Segundo, compare os dados publicados.',
    'Terceiro, explique o que ainda falta confirmar.'
  ]);
  assert.deepEqual(extractOrderedChecklist('Primeiro, leia a nota. Depois, veja o resultado.'), []);
  assert.deepEqual(extractOrderedChecklist('Segundo, confira a fonte. Primeiro, resuma o dado.'), []);
});

test('rotation cards are created only from three complete, short spoken sentences', () => {
  const source = 'O teste mede o consumo total. A equipe registra cada leitura. O resultado compara os dois cenários.';
  assert.deepEqual(extractRotationCards(source), source.split(/(?<=[.!?…])\s+/));
  assert.deepEqual(extractRotationCards('Uma frase apenas. Outra frase curta.'), []);
  assert.deepEqual(extractRotationCards('Esta primeira frase contém texto longo demais para virar um card seguro sem cortar contexto ou ressalvas importantes. A equipe registra a leitura. O resultado compara os cenários.'), []);
});

test('video timestamp is deterministic, non-negative, and formats long durations', () => {
  assert.equal(formatVideoTimestamp(0), '00:00');
  assert.equal(formatVideoTimestamp(65_999), '01:05');
  assert.equal(formatVideoTimestamp(3_661_000), '01:01:01');
  assert.equal(formatVideoTimestamp(-1), null);
  assert.equal(formatVideoTimestamp(Number.NaN), null);
});

test('comparison values preserve zero and reject missing, non-numeric, or out-of-range scores', () => {
  assert.deepEqual(normalizeComparisonItems([
    { label: 'Opção A', score: 0 },
    { label: 'Opção B', score: 10 }
  ]), [{ label: 'Opção A', score: 0 }, { label: 'Opção B', score: 10 }]);
  assert.deepEqual(normalizeComparisonItems([{ label: 'A', score: 8 }, { label: 'B', score: null }]), []);
  assert.deepEqual(normalizeComparisonItems([{ label: 'A', score: 8 }, { label: 'B', score: 11 }]), []);
  assert.deepEqual(normalizeComparisonItems([{ label: 'A', score: 8 }, { label: '', score: 7 }]), []);
});

test('metric comparisons require a shared unit and a spoken cue for each sourced value', () => {
  const items = [
    { label: 'Modelo A', value: 8, unit: 'B', cue: 'oito bilhões' },
    { label: 'Modelo B', value: 70, unit: 'B', cue: 'setenta bilhões' }
  ];
  assert.deepEqual(normalizeMetricComparisonItems(items), items);
  assert.deepEqual(normalizeMetricComparisonItems([
    ...items.slice(0, 1), { ...items[1], unit: 'M' }
  ]), []);
  assert.deepEqual(normalizeMetricComparisonItems([
    ...items.slice(0, 1), { ...items[1], cue: '' }
  ]), []);
});

test('spoken cues resolve to measured word offsets, with accents and punctuation normalized', () => {
  const sentence = {
    text: 'O modelo chega a setenta bilhões de parâmetros.',
    words: ['O', 'modelo', 'chega', 'a', 'setenta', 'bilhões', 'de', 'parâmetros.'],
    startMs: 2100,
    wordTimes: [0, 280, 650, 900, 1120, 1460, 1750, 1900]
  };
  assert.equal(findNarrationCueOffset('setenta bilhões', [sentence]), 3220);
  assert.equal(findNarrationCueOffset('quarenta bilhões', [sentence]), null);
});
