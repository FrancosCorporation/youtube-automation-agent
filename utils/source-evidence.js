'use strict';

const crypto = require('node:crypto');

const DEFAULT_MINIMUM_CONTEXT_CHARS = 300;
const DEFAULT_MINIMUM_CONTEXT_WORDS = 40;

function countWords(value) {
  return String(value || '').match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length || 0;
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeSourceContext(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hashSourceContext(value) {
  return crypto.createHash('sha256').update(normalizeSourceContext(value)).digest('hex');
}

function hasSufficientSourceEvidence(evidence) {
  if (!evidence || evidence.eligible !== true) return false;
  if (String(evidence.sourceTitle || '').trim().length < 12) return false;
  if (Number(evidence.contextChars) < DEFAULT_MINIMUM_CONTEXT_CHARS) return false;
  if (Number(evidence.contextWords) < DEFAULT_MINIMUM_CONTEXT_WORDS) return false;
  if (!/^[a-f0-9]{64}$/i.test(String(evidence.contextHash || ''))) return false;
  if (evidence.mode !== 'recap' && !isHttpUrl(evidence.sourceUrl)) return false;
  return Number.isFinite(Date.parse(evidence.checkedAt || ''));
}

function createPublicationReview({ verdict, sourceContext, reviewer, checkedAt = new Date().toISOString() } = {}) {
  const normalizedVerdict = String(verdict || '').trim().toLowerCase();
  const status = normalizedVerdict === 'aprovado' ? 'approved'
    : normalizedVerdict === 'reprovado' ? 'rejected' : 'unavailable';
  return {
    status,
    sourceHash: hashSourceContext(sourceContext),
    reviewer: String(reviewer || '').trim(),
    checkedAt
  };
}

function isPublicationReviewApproved(review, sourceEvidence) {
  return Boolean(review && review.status === 'approved'
    && review.sourceHash === sourceEvidence?.contextHash
    && String(review.reviewer || '').trim()
    && Number.isFinite(Date.parse(review.checkedAt || '')));
}

function assessSourceEvidence({
  sourceTitle,
  sourceUrl,
  context,
  mode = 'article',
  minimumContextChars = DEFAULT_MINIMUM_CONTEXT_CHARS,
  minimumContextWords = DEFAULT_MINIMUM_CONTEXT_WORDS
} = {}) {
  const title = String(sourceTitle || '').replace(/\s+/g, ' ').trim();
  const sourceContext = normalizeSourceContext(context);
  const contextChars = sourceContext.length;
  const contextWords = countWords(sourceContext);
  let reason = '';

  if (title.length < 12) reason = 'source_title_missing';
  else if (mode !== 'recap' && !isHttpUrl(sourceUrl)) reason = 'source_url_missing';
  else if (contextChars < minimumContextChars) reason = 'source_context_too_short';
  else if (contextWords < minimumContextWords) reason = 'source_context_too_few_words';

  return {
    schemaVersion: 1,
    eligible: !reason,
    ...(reason ? { reason } : {}),
    mode,
    sourceTitle: title.slice(0, 300),
    ...(isHttpUrl(sourceUrl) ? { sourceUrl: String(sourceUrl).trim() } : {}),
    contextHash: hashSourceContext(sourceContext),
    contextChars,
    contextWords,
    checkedAt: new Date().toISOString()
  };
}

function createTopicRecord(entry, generatedAt = new Date().toISOString()) {
  const sourceEvidence = entry?.sourceEvidence;
  const publicationEligible = entry?.publicationEligible === true
    && hasSufficientSourceEvidence(sourceEvidence)
    && isPublicationReviewApproved(entry?.publicationReview, sourceEvidence);
  const publicationHold = publicationEligible
    ? undefined
    : entry?.publicationHold || {
      reason: sourceEvidence?.reason || (entry?.publicationReview?.status === 'rejected'
        ? 'source_claims_unverified' : sourceEvidence?.eligible ? 'publication_review_unverified' : 'source_evidence_missing')
    };
  return {
    ...entry,
    publicationEligible,
    ...(publicationHold ? { publicationHold } : {}),
    generatedAt
  };
}

module.exports = {
  DEFAULT_MINIMUM_CONTEXT_CHARS,
  DEFAULT_MINIMUM_CONTEXT_WORDS,
  assessSourceEvidence,
  countWords,
  createTopicRecord,
  createPublicationReview,
  hashSourceContext,
  hasSufficientSourceEvidence,
  isHttpUrl,
  isPublicationReviewApproved,
  normalizeSourceContext
};
