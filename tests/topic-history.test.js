'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { collectUsedTopicSignals } = require('../utils/topic-history');

test('used topic history includes the original source headline to prevent reusing a rejected article', () => {
  const signals = collectUsedTopicSignals([{
    title: 'Por que seu planejamento de compras falha no caixa',
    url: 'https://sapo.pt/artigo/story',
    originTitle: 'Using AI to reverse engineer hardware',
    originUrl: 'https://blogs.gnome.org/uraeus/2026/10/15/aiandreverseengineerhardware/',
    sourceEvidence: {
      sourceTitle: 'Dia Mundial da Alimentação: DECO apresenta estudo sobre comportamento dos consumidores',
      sourceUrl: 'https://sapo.pt/artigo/story'
    }
  }]);
  assert(signals.titles.includes('Por que seu planejamento de compras falha no caixa'));
  assert(signals.titles.includes('Dia Mundial da Alimentação: DECO apresenta estudo sobre comportamento dos consumidores'));
  assert(signals.titles.includes('Using AI to reverse engineer hardware'));
  assert.deepEqual(signals.urls, [
    'https://sapo.pt/artigo/story',
    'https://blogs.gnome.org/uraeus/2026/10/15/aiandreverseengineerhardware/'
  ]);
});

test('used topic history honors its bounded lookback and drops empty signals', () => {
  const signals = collectUsedTopicSignals([
    { title: 'outside limit', url: 'https://example.com/old' },
    { title: 'recent' },
    {}
  ], 2);
  assert.deepEqual(signals.titles, ['recent']);
  assert.deepEqual(signals.urls, []);
});

test('default used-topic window covers the full retained ledger', () => {
  const entries = [
    { title: 'A recent source', originTitle: 'Already posted source headline', originUrl: 'https://example.com/source' },
    ...Array.from({ length: 99 }, (_, index) => ({ title: `other topic ${index}` }))
  ];
  const signals = collectUsedTopicSignals(entries);
  assert(signals.titles.includes('Already posted source headline'));
  assert(signals.urls.includes('https://example.com/source'));
});
