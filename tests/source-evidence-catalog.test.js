'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSourceEvidenceCatalog, resolveSourceIds, resolveScriptEvidenceIds,
  compileScriptEvidenceBlocks } = require('../utils/source-evidence-catalog');
const { scriptClaims, verifyScriptEvidence } = require('../utils/deterministic-script-review');
const { applyScriptRepair } = require('../utils/script-repair');

const source = 'O projeto usa dados públicos para gerar textos. O estudo não demonstrou redução dos erros. Os resultados podem variar conforme o contexto.';
const block = (text, id) => ({ text, sourceIds: [id] });

test('literal sourceQuote scopes an existing factual clause without importing another clause uncertainty', () => {
  const context = 'Os cientistas adicionaram óxido de platina ao ambiente para testar quanto oxigênio o magma poderia absorver. '
    + 'Os resultados não demonstraram uma redução dos erros de medição. '
    + 'A equipe registrou os dados completos das amostras e explicou os procedimentos de análise no relatório técnico publicado. '.repeat(3);
  const title = 'Os cientistas adicionaram óxido de platina ao ambiente.';
  const plain = resolveScriptEvidenceIds({ title, claimEvidence: [{ path: 'title', sourceIds: ['S001'] }] }, context);
  assert(verifyScriptEvidence(plain.script, context).errors.some(e => e.code === 'claim_uncertainty_not_preserved'));
  const sourceQuote = 'Os cientistas adicionaram óxido de platina ao ambiente';
  const precise = resolveScriptEvidenceIds({ title,
    claimEvidence: [{ path: 'title', sourceIds: ['S001'], sourceQuote }] }, context);
  assert.deepEqual(precise.errors, []);
  assert.equal(precise.script.claimEvidence[0].quote, sourceQuote);
  assert.equal(verifyScriptEvidence(precise.script, context).status, 'approved');
  for (const evidence of [
    { sourceIds: ['S002'], sourceQuote },
    { sourceIds: ['S999'], sourceQuote },
    { sourceIds: ['S001'], sourceQuote: 'O estudo garantiu cura para todos os participantes' },
    { sourceIds: ['S001'], sourceQuote: '' },
    { sourceIds: ['S002'], sourceQuote: 'demonstraram uma redução dos erros de medição' },
    { sourceIds: ['S001'], sourceQuote: 'oxigênio o magma poderia absorver' }
  ]) {
    const rejected = resolveScriptEvidenceIds({ title, claimEvidence: [{ path: 'title', ...evidence }] }, context);
    assert(rejected.errors.length > 0);
    assert.equal(verifyScriptEvidence(rejected.script, context).status, 'rejected');
    assert.deepEqual(rejected.repairs, []);
  }
  const uncertain = resolveScriptEvidenceIds({ title: 'O magma absorve oxigênio.',
    claimEvidence: [{ path: 'title', sourceIds: ['S001'], sourceQuote: buildSourceEvidenceCatalog(context).entries[0].text }] }, context);
  assert(verifyScriptEvidence(uncertain.script, context).errors.some(e => e.code === 'claim_uncertainty_not_preserved'));
});

test('explicit quote survives compilation and repair and cannot authorize noncontiguous IDs or excessive length', () => {
  const context = 'A equipe publicou os dados completos da pesquisa. O estudo não demonstrou redução dos erros. Os resultados podem variar conforme o contexto. '
    + 'A equipe registrou os dados completos das amostras e explicou os procedimentos de análise no relatório técnico publicado. '.repeat(3);
  const catalog = buildSourceEvidenceCatalog(context);
  assert.equal(resolveSourceIds(['S001', 'S003'], catalog,
    { sourceQuote: 'Os resultados podem variar conforme o contexto.' }).error, 'source_ids_not_contiguous');
  const longText = Array.from({ length: 81 }, () => 'palavra').join(' ');
  const longCatalog = buildSourceEvidenceCatalog(longText);
  assert.equal(resolveSourceIds(longCatalog.entries.map(e => e.id), longCatalog,
    { sourceQuote: longText }).error, 'source_reference_length_invalid');
  const quote = 'A equipe publicou os dados completos da pesquisa';
  const script = compileScriptEvidenceBlocks({
    title: { text: quote, sourceIds: ['S001'], sourceQuote: quote },
    hook: block('A equipe publicou os dados completos da pesquisa?', 'S001'),
    sections: [{ title: block('O estudo não demonstrou redução dos erros', 'S002'), content: block('O estudo não demonstrou redução dos erros.', 'S002') }],
    conclusion: block('Os resultados podem variar conforme o contexto.', 'S003')
  });
  assert.equal(script.claimEvidence[0].sourceQuote, quote);
  const repaired = applyScriptRepair(script, { edits: [{ path: 'hook', value: {
    text: 'A equipe publicou os dados completos da pesquisa?', sourceIds: ['S001'], sourceQuote: quote
  } }] });
  const resolved = resolveScriptEvidenceIds(repaired, context);
  assert.equal(resolved.script.claimEvidence.find(e => e.path === 'hook#1').quote, quote);
  assert.equal(verifyScriptEvidence(resolved.script, context).status, 'approved');
});

test('source sentences stay independently citable, without neighbouring negation', () => {
  const catalog = buildSourceEvidenceCatalog(source);
  assert.equal(catalog.entries.length, 3);
  for (const entry of catalog.entries) assert.equal(catalog.source.slice(entry.start, entry.end).trim(), entry.text);
  assert.equal(resolveSourceIds(['S001'], catalog).quote, 'O projeto usa dados públicos para gerar textos.');
  assert.equal(resolveSourceIds(['S001', 'S003'], catalog).error, 'source_ids_not_contiguous');
  assert.equal(resolveSourceIds(['S999'], catalog).error, 'source_id_unknown');
});

test('a four-word source sentence remains independently citable', () => {
  const shortSentence = 'Prefira um ambiente silencioso.';
  const catalog = buildSourceEvidenceCatalog(`Assim, pode usar uma proteção nos olhos para escurecer o quarto. ${shortSentence}`);
  const shortEntry = catalog.entries.find(entry => entry.text === shortSentence);
  assert.ok(shortEntry);
  assert.equal(resolveSourceIds([shortEntry.id], catalog).quote, shortSentence);
  assert.equal(catalog.entries[0].text, `Assim, pode usar uma proteção nos olhos para escurecer o quarto. ${shortSentence}`);
});

test('maxWords reaches the long-sentence splitter and preserves exact source text', () => {
  const source = Array.from({ length: 37 }, (_, i) => `palavra${i}`).join(' ') + '.';
  const catalog = buildSourceEvidenceCatalog(source, { maxWords: 10 });
  assert.ok(catalog.entries.every(entry => entry.words <= 10));
  assert.equal(catalog.entries.map(entry => entry.text).join(' '), source);
});

test('local citation repair only recovers a unique literal source sentence', () => {
  const script = {
    title: 'O projeto usa dados públicos para gerar textos.',
    hook: 'O estudo não demonstrou redução dos erros.',
    sections: [],
    claimEvidence: [{ path: 'title', sourceIds: ['S999'] }]
  };
  const resolved = resolveScriptEvidenceIds(script, source);
  assert.deepEqual(resolved.errors, []);
  assert.deepEqual(resolved.repairs, [
    { path: 'title', sourceId: 'S001' },
    { path: 'hook#1', sourceId: 'S002' }
  ]);
  assert.equal(resolved.script.claimEvidence.find(item => item.path === 'title').quote, script.title);
  assert.equal(resolved.script.claimEvidence.find(item => item.path === 'hook#1').quote, script.hook);
});

test('local citation repair fails closed for changed punctuation and repeated source passages', () => {
  const changed = resolveScriptEvidenceIds({ title: 'O estudo não demonstrou redução dos erros?',
    claimEvidence: [{ path: 'title', sourceIds: ['S999'] }] }, source);
  assert.equal(changed.errors[0].code, 'source_id_unknown');
  assert.deepEqual(changed.repairs, []);
  const changedCase = resolveScriptEvidenceIds({ title: 'o projeto usa dados públicos para gerar textos.',
    claimEvidence: [{ path: 'title', sourceIds: ['S999'] }] }, source);
  assert.equal(changedCase.errors[0].code, 'source_id_unknown');
  assert.deepEqual(changedCase.repairs, []);
  const repeated = `${source} O estudo não demonstrou redução dos erros.`;
  const ambiguous = resolveScriptEvidenceIds({ title: 'O estudo não demonstrou redução dos erros.',
    claimEvidence: [{ path: 'title', sourceIds: ['S999'] }] }, repeated);
  assert.equal(ambiguous.errors[0].code, 'source_id_unknown');
  assert.deepEqual(ambiguous.repairs, []);
  const validButWrong = resolveScriptEvidenceIds({ title: 'O projeto usa dados públicos para gerar textos.',
    claimEvidence: [{ path: 'title', sourceIds: ['S002'] }] }, source);
  assert.deepEqual(validButWrong.script.claimEvidence[0].sourceIds, ['S002']);
  assert.deepEqual(validButWrong.repairs, []);
});

test('compiler covers every claim, including multiple sentences in a block', () => {
  const script = compileScriptEvidenceBlocks({
    title: block('O projeto usa dados públicos', 'S001'),
    hook: block('O projeto usa dados públicos para gerar textos?', 'S001'),
    sections: [{ title: block('O estudo não demonstrou redução dos erros', 'S002'),
      content: [block('O estudo não demonstrou redução dos erros. Os resultados podem variar conforme o contexto.', 'S002')],
      imagePrompt: 'Kept intact.' }],
    conclusion: [block('Os resultados podem variar conforme o contexto.', 'S003')]
  });
  assert.deepEqual(script.claimEvidence.map(e => e.path), scriptClaims(script).map(c => c.path));
  assert.equal(script.sections[0].imagePrompt, 'Kept intact.');
  const repaired = applyScriptRepair(script, { edits: [{ path: 'sections.0.content', value: [
    block('O estudo não demonstrou redução dos erros.', 'S002'),
    block('Os resultados podem variar conforme o contexto.', 'S003')
  ] }] });
  assert.deepEqual(repaired.claimEvidence.find(e => e.path === 'sections.0.content#2').sourceIds, ['S003']);
  assert.deepEqual(repaired.claimEvidence.find(e => e.path === 'title'), script.claimEvidence[0]);
  const resolved = resolveScriptEvidenceIds(repaired, source);
  assert.equal(resolved.errors.length, 0);
  assert.equal(resolved.script.claimEvidence.find(e => e.path === 'sections.0.content#2').quote, 'Os resultados podem variar conforme o contexto.');
});

test('missing evidence and sentence fragments fail closed', () => {
  for (const bad of [{ text: 'Texto sem evidência.' }, block('Fragmento sem ponto', 'S001')]) {
    assert.throws(() => compileScriptEvidenceBlocks({ title: block('Título', 'S001'), hook: block('Gancho?', 'S001'),
      sections: [{ title: block('Título', 'S001'), content: [bad, block('Outra frase.', 'S002')] }],
      conclusion: block('Conclusão.', 'S001') }), { code: 'SCRIPT_EVIDENCE_INVALID' });
  }
});
