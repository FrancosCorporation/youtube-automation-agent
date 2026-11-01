'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { reviewScriptDeterministically } = require('../scripts/generate-animated-video');
const { buildSourceEvidenceCatalog, compileScriptEvidenceBlocks, resolveScriptEvidenceIds } = require('../utils/source-evidence-catalog');
const { applyScriptRepair } = require('../utils/script-repair');
const { reviewScriptWithRepair } = require('../utils/script-review');

const source = [
  'The report says the company recorded 20 million U.S. dollars in revenue this quarter.',
  'The report does not establish why sales changed.',
  'It says the result may vary in future periods.',
  'The authors list two study limits: sample size and a three-month observation period.',
  'The publication provides no forecast beyond the quarter.',
  'The methods section describes data collected in 2025 from 120 participants across six sites.'
].join(' ');

const evidenceBlock = (text, sourceId) => ({ text, sourceIds: [sourceId] });

function draftWithUnits(units = 'dólares') {
  const catalog = buildSourceEvidenceCatalog(source);
  assert.equal(catalog.entries.length, 6);
  return compileScriptEvidenceBlocks({
    title: evidenceBlock(`Relatório aponta receita trimestral de 20 milhões de ${units}`, 'S001'),
    hook: evidenceBlock('O que o relatório informa sobre a receita trimestral?', 'S001'),
    sections: [{
      title: evidenceBlock('A receita citada no relatório', 'S001'),
      content: [
        evidenceBlock(`A empresa registrou receita de 20 milhões de ${units} neste trimestre.`, 'S001'),
        evidenceBlock('O relatório não estabelece por que as vendas mudaram.', 'S002'),
        evidenceBlock('O resultado pode variar em períodos futuros.', 'S003')
      ]
    }],
    conclusion: evidenceBlock('A publicação não apresenta previsão além do trimestre.', 'S005')
  });
}

test('production script path compiles IDs, cites literal source, translates, and passes local QA', () => {
  const script = draftWithUnits();
  const resolved = resolveScriptEvidenceIds(script, source);
  assert.equal(resolved.errors.length, 0);
  for (const item of resolved.script.claimEvidence) {
    assert.ok(source.includes(item.quote), `${item.path} must resolve to a literal source excerpt`);
  }

  const review = reviewScriptDeterministically(resolved.script, source, 2);
  assert.equal(review.verdict, 'aprovado');
  assert.equal(review.verification.claimCount, review.verification.evidenceCount);
  assert.equal(review.verification.errors.length, 0);
});

test('invalid IDs and noncontiguous references fail closed in the production reviewer', () => {
  const missing = draftWithUnits();
  missing.claimEvidence = missing.claimEvidence.filter(item => item.path !== 'sections.0.content#1');
  const missingReview = reviewScriptDeterministically(missing, source, 2);
  assert.equal(missingReview.verdict, 'reprovado');
  assert(missingReview.errors.some(error => error.code === 'claim_evidence_missing'));

  const unknown = draftWithUnits();
  unknown.claimEvidence.find(item => item.path === 'sections.0.content#1').sourceIds = ['S999'];
  const unknownReview = reviewScriptDeterministically(unknown, source, 2);
  assert.equal(unknownReview.verdict, 'reprovado');
  assert(unknownReview.errors.some(error => error.code === 'source_id_unknown'));

  const noncontiguous = draftWithUnits();
  noncontiguous.claimEvidence.find(item => item.path === 'sections.0.content#1').sourceIds = ['S001', 'S003'];
  const sequenceReview = reviewScriptDeterministically(noncontiguous, source, 2);
  assert.equal(sequenceReview.verdict, 'reprovado');
  assert(sequenceReview.errors.some(error => error.code === 'source_ids_not_contiguous'));
});

test('changed source context cannot preserve an approval for a different currency', () => {
  const script = draftWithUnits();
  const changedSource = source.replace('U.S. dollars', 'euros');
  assert.notEqual(buildSourceEvidenceCatalog(changedSource).sourceHash, buildSourceEvidenceCatalog(source).sourceHash);

  const review = reviewScriptDeterministically(script, changedSource, 2);
  assert.equal(review.verdict, 'reprovado');
  assert(review.errors.some(error => error.code === 'claim_unit_not_in_quote'));
});

test('sentence reordering remains valid only when each citation moves with its sentence', () => {
  const reordered = compileScriptEvidenceBlocks({
    title: evidenceBlock('Relatório aponta receita trimestral de 20 milhões de dólares', 'S001'),
    hook: evidenceBlock('O que o relatório informa sobre a receita trimestral?', 'S001'),
    sections: [{
      title: evidenceBlock('A receita citada no relatório', 'S001'),
      content: [
        evidenceBlock('O resultado pode variar em períodos futuros.', 'S003'),
        evidenceBlock('O relatório não estabelece por que as vendas mudaram.', 'S002')
      ]
    }],
    conclusion: evidenceBlock('A publicação não apresenta previsão além do trimestre.', 'S005')
  });
  assert.equal(reviewScriptDeterministically(reordered, source, 2).verdict, 'aprovado');

  const staleReferences = draftWithUnits();
  staleReferences.sections[0].content = [
    'O resultado pode variar em períodos futuros.',
    'O relatório não estabelece por que as vendas mudaram.'
  ].join(' ');
  const review = reviewScriptDeterministically(staleReferences, source, 2);
  assert.equal(review.verdict, 'reprovado');
  assert(review.errors.some(error => error.code === 'claim_uncertainty_not_preserved'));
});

test('uncertainty cannot be removed or added during translation', () => {
  const unnegated = draftWithUnits();
  unnegated.sections[0].content = unnegated.sections[0].content
    .replace('não estabelece', 'estabelece');
  const negation = reviewScriptDeterministically(unnegated, source, 2);
  assert(negation.errors.some(error => error.code === 'claim_negation_not_preserved'));

  const overcertain = draftWithUnits();
  overcertain.sections[0].content = overcertain.sections[0].content
    .replace('O resultado pode variar', 'O resultado varia');
  const missing = reviewScriptDeterministically(overcertain, source, 2);
  assert(missing.errors.some(error => error.code === 'claim_uncertainty_not_preserved'));

  const speculative = draftWithUnits();
  speculative.sections[0].content = speculative.sections[0].content
    .replace('A empresa registrou receita', 'Talvez a empresa registre receita');
  const added = reviewScriptDeterministically(speculative, source, 2);
  assert(added.errors.some(error => error.code === 'claim_uncertainty_not_preserved'));
});

test('short direct advice is not contaminated by uncertainty in its preceding sentence', () => {
  const paragraph = 'Assim, pode usar uma proteção nos olhos para escurecer o quarto. Prefira um ambiente silencioso.';
  const context = Array(8).fill(paragraph).join(' ');
  const catalog = buildSourceEvidenceCatalog(context);
  const shortSentence = catalog.entries.find(entry => entry.text === 'Prefira um ambiente silencioso.');
  assert.ok(shortSentence);
  const evidence = evidenceBlock('Prefira um ambiente silencioso.', shortSentence.id);
  const script = compileScriptEvidenceBlocks({
    title: evidenceBlock('Ambiente silencioso', 'S002'),
    hook: evidenceBlock('Qual ambiente favorece uma noite tranquila?', 'S002'),
    sections: [{ title: evidenceBlock('O ambiente', 'S002'), content: [evidence] }],
    conclusion: evidenceBlock('Prefira um ambiente silencioso.', 'S002')
  });
  const review = reviewScriptDeterministically(resolveScriptEvidenceIds(script, context).script, context, 1);
  assert.equal(review.errors.some(error => error.path === 'sections.0.content#1'
    && ['claim_uncertainty_not_preserved', 'claim_negation_not_preserved', 'quote_length_out_of_range'].includes(error.code)), false);
});

test('a bounded source-ID repair is recompiled and reviewed before approval', async () => {
  const wrong = draftWithUnits('reais');
  const correction = {
    edits: [
      { path: 'title', value: evidenceBlock('Relatório aponta receita trimestral de 20 milhões de dólares', 'S001') },
      {
        path: 'sections.0.content',
        value: [
          evidenceBlock('A empresa registrou receita de 20 milhões de dólares neste trimestre.', 'S001'),
          evidenceBlock('O relatório não estabelece por que as vendas mudaram.', 'S002'),
          evidenceBlock('O resultado pode variar em períodos futuros.', 'S003')
        ]
      }
    ]
  };
  const result = await reviewScriptWithRepair({
    script: wrong,
    topic: 'receita trimestral',
    sourceTitle: 'Quarterly company revenue report',
    sourceContext: source,
    reviewer: 'deterministic-source-evidence-v1',
    critique: script => reviewScriptDeterministically(script, source, 2),
    regenerate: (feedback, { script }) => applyScriptRepair(script, correction),
    maxRepairs: 2
  });

  assert.equal(result.regenerated, true);
  assert.equal(result.publicationReview.status, 'approved');
  assert.equal(result.reviewHistory.length, 2);
  assert.equal(result.reviewHistory[0].status, 'rejected');
  assert.equal(result.reviewHistory[1].status, 'approved');
  assert.equal(result.publicationReview.verification.sourceHash, buildSourceEvidenceCatalog(source).sourceHash);
});

test('numeric claims with the right value but wrong units or scale are rejected', () => {
  for (const units of ['reais', 'bilhões de dólares']) {
    const review = reviewScriptDeterministically(draftWithUnits(units), source, 2);
    assert.equal(review.verdict, 'reprovado', units);
    assert(review.errors.some(error => error.code === 'claim_unit_not_in_quote'), units);
  }
});
