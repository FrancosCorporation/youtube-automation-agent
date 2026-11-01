'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { alignArticlePrints, getNewsReferenceIndex } = require('../utils/article-print-routing');

test('mantém print vinculado à fonte original quando captura falha ou referência é ignorada', () => {
  const articlePrint = { src: 'data:image/jpeg;base64,article', source: 'Fonte primária' };
  const secondNewsPrint = { src: 'data:image/jpeg;base64,news-2', source: 'Fonte 2' };
  const shots = [
    { referenceIndex: -1 },
    { referenceIndex: 0 },
    { referenceIndex: 2 }
  ];
  const aligned = alignArticlePrints(shots, [articlePrint, null, secondNewsPrint], 3);

  assert.deepEqual(aligned, [articlePrint, null, null, secondNewsPrint]);
});

test('mantém índice da notícia e do print sincronizados ao repetir referências nas seções', () => {
  const count = 2;
  const indexes = Array.from({ length: 5 }, (_, sectionIndex) => getNewsReferenceIndex(sectionIndex, count));
  assert.deepEqual(indexes, [1, 0, 1, 0, 1]);
  assert.equal(getNewsReferenceIndex(0, 0), null);
  assert.equal(getNewsReferenceIndex(-1, count), null);
});

test('recusa o contrato inválido de alinhamento sem esconder erro de chamada', () => {
  assert.throws(() => alignArticlePrints({}, [], 1), TypeError);
  assert.throws(() => alignArticlePrints([], [], -1), TypeError);
});
