'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assessSourceEvidence,
  createPublicationReview,
  createTopicRecord
} = require('../utils/source-evidence');
const { isPublicationEligible } = require('../utils/publication-status');
const { chooseThumbnailHeadline } = require('../utils/thumbnail-design');

const officialTitle = 'Fundat divulga novas vagas de emprego para esta terça-feira, 13';
const supportedContext = [
  'A Fundação Municipal de Formação para o Trabalho divulgou oportunidades disponíveis para candidatos em Aracaju.',
  'A publicação informa os cargos, os requisitos, os documentos necessários e os locais para atendimento.',
  'As pessoas interessadas devem consultar as orientações oficiais e confirmar os critérios de cada vaga antes de comparecer.'
].join(' ');

test('automatic publication requires a source URL and substantive extracted context', () => {
  const missingContext = assessSourceEvidence({
    sourceTitle: officialTitle,
    sourceUrl: 'https://example.test/vagas',
    context: ''
  });
  assert.equal(missingContext.eligible, false);
  assert.equal(missingContext.reason, 'source_context_too_short');

  const missingUrl = assessSourceEvidence({ sourceTitle: officialTitle, context: supportedContext });
  assert.equal(missingUrl.eligible, false);
  assert.equal(missingUrl.reason, 'source_url_missing');

  const verified = assessSourceEvidence({
    sourceTitle: officialTitle,
    sourceUrl: 'https://example.test/vagas',
    context: supportedContext
  });
  assert.equal(verified.eligible, true);
  assert.equal(verified.contextWords >= 40, true);
});

test('recaps need substantive prior-topic context even though they do not have one article URL', () => {
  const evidence = assessSourceEvidence({
    sourceTitle: 'Resumo semanal de tecnologia',
    mode: 'recap',
    context: supportedContext
  });
  assert.equal(evidence.eligible, true);
});

test('topic ledger preserves an explicit hold and fails closed without verified source evidence', () => {
  const noEvidence = createTopicRecord({ title: 'Roteiro', publicationEligible: true }, '2026-10-14T00:00:00.000Z');
  assert.equal(noEvidence.publicationEligible, false);
  assert.equal(noEvidence.publicationHold.reason, 'source_evidence_missing');

  const held = createTopicRecord({
    title: 'Roteiro',
    publicationEligible: false,
    publicationHold: { reason: 'source_claims_unverified' },
    sourceEvidence: { eligible: true }
  }, '2026-10-14T00:00:00.000Z');
  assert.equal(held.publicationEligible, false);
  assert.equal(held.publicationHold.reason, 'source_claims_unverified');

  const eligible = createTopicRecord({
    title: 'Vagas de emprego',
    publicationEligible: true,
    sourceEvidence: assessSourceEvidence({
      sourceTitle: officialTitle,
      sourceUrl: 'https://example.test/vagas',
      context: supportedContext
    }),
    publicationReview: createPublicationReview({
      verdict: 'aprovado', sourceContext: supportedContext, reviewer: 'nvidia/nemotron-3.5-lightning-30b-a3b'
    })
  }, '2026-10-14T00:00:00.000Z');
  assert.equal(eligible.publicationEligible, true);
  assert.equal(isPublicationEligible(eligible), true);
  assert.equal(isPublicationEligible(noEvidence), false);
  assert.equal(isPublicationEligible({
    ...eligible,
    publicationReview: { ...eligible.publicationReview, sourceHash: '0'.repeat(64) }
  }), false, 'review for different source text cannot authorize publication');
  assert.equal(createTopicRecord({
    title: 'Pauta sem revisão',
    publicationEligible: true,
    sourceEvidence: eligible.sourceEvidence
  }).publicationEligible, false, 'available context alone does not approve generated claims');
});

test('misleading generated title and SEO hook fall back to a source-grounded cover headline', () => {
  const unsupported = 'Fundat: O segredo por trás das 300 vagas que somem em minutos';
  const headline = chooseThumbnailHeadline({
    candidate: unsupported,
    seoTitle: unsupported,
    title: officialTitle,
    sourceText: `${officialTitle} ${supportedContext}`
  });

  assert.match(headline, /vagas|emprego|terça/i);
  assert.doesNotMatch(headline, /300|segredo|somem|minutos/i);
});
