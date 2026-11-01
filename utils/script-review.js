'use strict';

const { createPublicationReview } = require('./source-evidence');
const crypto = require('node:crypto');

const LAB_SCOPE = /\b(?:in vitro|laborat[oó]ri|laboratory|lab(?:oratory)?\s+(?:test|study|experiment))\b/i;
const HUMAN_EVIDENCE_LIMIT = /\b(?:not in humans|not (?:yet )?known (?:whether|if).{0,80}humans?|unclear whether.{0,80}humans?|further studies?.{0,100}humans?|future studies?.{0,100}humans?)\b|\b(?:n[aã]o (?:em|nos) humanos|ainda n[aã]o se sabe.{0,80}humanos?|estudos? (?:adicionais|futuros).{0,100}humanos?)\b/i;
const LAB_QUALIFIER = /\b(?:in vitro|laborat[oó]ri\w*|laboratory|lab(?:oratory)?\s+(?:test|study|experiment)|nas condi[cç][oõ]es do experimento|em culturas? bacterianas?|comunidade (?:artificial|sint[eé]tica)|modelo (?:artificial|simplificado))\b/i;
const BIOLOGICAL_SCOPE = /\b(?:microbiota|microbiome|gut bacteria|intestinal bacteria|bact[eé]rias?|microb\w*|intestin\w*|gut|health|sa[uú]de|inflama\w*|diversidade|diversity|metabol\w*|glicose|glucose)\b/i;
const EFFECT_LANGUAGE = /\b(?:inhibit\w*|alter\w*|interfer\w*|modif\w*|reduc\w*|suprim\w*|prejudic\w*|caus\w*|aument\w*|impact\w*|affect\w*|chang\w*|disrupt\w*|harm\w*|implica[cç][oõ]es|pode\w*|podem|poderia\w*|could|may|might|can|will|lead to)\b/i;
const EXPLICIT_UNCERTAINTY = /\b(?:n[aã]o sabemos|ainda n[aã]o se sabe|n[aã]o h[aá] evid[eê]ncia|n[aã]o (?:foi|foram|est[aá]|est[aã]o) demonstrad\w*|does not establish|not established|no evidence|not known|remains? unclear|unclear whether|whether.{0,80}humans?)\b/i;

/** Rejects human or health extrapolations that escape an explicitly lab-only source. */
function findPreclinicalScopeViolation(script, sourceContext) {
  const source = String(sourceContext || '').replace(/\s+/g, ' ').trim();
  if (!LAB_SCOPE.test(source) || !HUMAN_EVIDENCE_LIMIT.test(source)) return null;
  const sections = Array.isArray(script?.sections) ? script.sections : script?.mainContent?.sections;
  const text = typeof script === 'string' ? script : [
    script?.title,
    script?.hook,
    script?.conclusion,
    ...(Array.isArray(sections) ? sections.flatMap(section => typeof section === 'string'
      ? [section]
      : [section?.title, section?.content, section?.text, section?.narration]) : [])
  ].filter(value => typeof value === 'string').join('\n');
  const claims = text.split(/(?<=[.!?])\s+|\n+/).map(sentence => sentence.trim()).filter(Boolean);
  const violations = claims.filter(sentence => BIOLOGICAL_SCOPE.test(sentence)
    && EFFECT_LANGUAGE.test(sentence)
    && !LAB_QUALIFIER.test(sentence)
    && !EXPLICIT_UNCERTAINTY.test(sentence));
  if (!violations.length) return null;
  return 'A fonte limita esses resultados a ensaios de laboratório e não demonstra efeito em humanos. Enquadre cada efeito em bactérias ou comunidades como resultado do experimento e remova extrapolações para consumo, intestino ou saúde de pessoas; preserve a incerteza clínica.';
}

/** Calls each configured generation model once, then moves on after failure. */
async function callWithModelFallback({ models, request, onFailure } = {}) {
  if (!Array.isArray(models) || !models.length) throw new TypeError('models must be a non-empty array');
  if (typeof request !== 'function') throw new TypeError('request must be a function');
  const attempted = new Set();
  for (const config of models) {
    const model = String(typeof config === 'string' ? config : config?.id || config?.model || '').trim();
    if (!model || attempted.has(model)) continue;
    attempted.add(model);
    try {
      return { model, value: await request(config) };
    } catch (error) {
      onFailure?.(config, error);
      if (['BUDGET_EXHAUSTED', 'SCRIPT_CALL_BUDGET_EXHAUSTED'].includes(error?.code)) throw error;
    }
  }
  return null;
}

/** Tries configured reviewers in order and records which model returned a verdict. */
async function reviewWithModelFallback({ models, request, onFailure } = {}) {
  if (!Array.isArray(models) || !models.length) throw new TypeError('models must be a non-empty array');
  if (typeof request !== 'function') throw new TypeError('request must be a function');
  const attempted = new Set();
  for (const candidate of models) {
    const model = String(candidate || '').trim();
    if (!model || attempted.has(model)) continue;
    attempted.add(model);
    try {
      const result = await request(model);
      const rawVerdict = String(result?.verdict || '').trim().toLowerCase();
      const verdict = ({ approved: 'aprovado', rejected: 'reprovado' })[rawVerdict] || rawVerdict;
      if (!['aprovado', 'reprovado'].includes(verdict)) {
        throw Object.assign(new Error('invalid_review_verdict'), { code: 'INVALID_REVIEW_VERDICT' });
      }
      return { ...result, verdict, reviewer: model };
    } catch (error) {
      onFailure?.(model, error);
      if (error?.code === 'BUDGET_EXHAUSTED') break;
    }
  }
  return null;
}

/** Requires agreeing approvals from distinct reviewers; any rejection fails closed. */
async function reviewWithModelConsensus({ models, request, onFailure, requiredApprovals = 2, concurrency = 1, timeoutMs = 60_000 } = {}) {
  if (!Array.isArray(models) || !models.length) throw new TypeError('models must be a non-empty array');
  if (typeof request !== 'function') throw new TypeError('request must be a function');
  if (!Number.isSafeInteger(requiredApprovals) || requiredApprovals < 2) {
    throw new TypeError('requiredApprovals must be an integer of at least 2');
  }
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new TypeError('concurrency must be a positive integer');
  }

  const attempted = new Set();
  const approvals = [];
  const uniqueModels = [];
  for (const candidate of models) {
    const model = String(candidate || '').trim();
    if (!model || attempted.has(model)) continue;
    attempted.add(model);
    uniqueModels.push(model);
  }
  const deadlines = new Map(uniqueModels.map(model => {
    const deadline = typeof timeoutMs === 'function' ? timeoutMs(model) : timeoutMs;
    if (!Number.isSafeInteger(deadline) || deadline < 1) throw new TypeError('timeoutMs must be a positive integer per reviewer');
    return [model, deadline];
  }));

  const pending = new Map();
  let nextModelIndex = 0;
  let budgetExhausted = false;

  const abortPending = () => {
    for (const { controller } of pending.values()) controller.abort();
  };
  const reportFailure = (model, error) => {
    try { onFailure?.(model, error); }
    catch (failure) {
      abortPending();
      throw failure;
    }
  };
  const startMore = () => {
    while (!budgetExhausted && pending.size < concurrency && nextModelIndex < uniqueModels.length) {
      const model = uniqueModels[nextModelIndex++];
      const controller = new AbortController();
      let timer;
      let cancel;
      // Bound the entire reviewer operation, including decoding its response.
      // A provider that ignores abort must not occupy a QA slot indefinitely.
      const promise = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          const error = Object.assign(new Error('reviewer_timeout'), { code: 'REVIEWER_TIMEOUT' });
          reject(error);
          controller.abort(error);
        }, deadlines.get(model));
        cancel = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', cancel, { once: true });
        Promise.resolve().then(() => request(model, { signal: controller.signal })).then(resolve, reject);
      })
        .finally(() => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', cancel);
        })
        .then(
          value => ({ model, status: 'fulfilled', value }),
          error => ({ model, status: 'rejected', error })
        );
      pending.set(model, { controller, promise });
    }
  };

  startMore();
  while (pending.size) {
    const outcome = await Promise.race([...pending.values()].map(item => item.promise));
    pending.delete(outcome.model);

    if (outcome.status === 'rejected') {
      reportFailure(outcome.model, outcome.error);
      if (outcome.error?.code === 'BUDGET_EXHAUSTED') budgetExhausted = true;
    } else {
      const result = outcome.value;
      const rawVerdict = String(result?.verdict || '').trim().toLowerCase();
      const verdict = ({ approved: 'aprovado', rejected: 'reprovado' })[rawVerdict] || rawVerdict;
      if (!['aprovado', 'reprovado'].includes(verdict)) {
        reportFailure(outcome.model, Object.assign(new Error('invalid_review_verdict'), {
          code: 'INVALID_REVIEW_VERDICT'
        }));
      } else if (verdict === 'reprovado') {
        abortPending();
        return {
          ...result,
          verdict,
          reviewer: outcome.model,
          reviewers: [outcome.model]
        };
      } else {
        approvals.push({ model: outcome.model, result });
        if (approvals.length >= requiredApprovals) {
          abortPending();
          const reviewers = approvals.slice(0, requiredApprovals).map(item => item.model);
          return {
            verdict: 'aprovado',
            feedback: '',
            reviewer: reviewers.join(' + '),
            reviewers
          };
        }
      }
    }

    startMore();
  }
  return null;
}

/** Reviews the final script version; a rewritten version must be reviewed again. */
async function reviewScriptWithRepair({
  script,
  topic,
  sourceTitle,
  sourceContext,
  reviewer,
  critique,
  regenerate,
  maxRepairs = 1
}) {
  if (typeof critique !== 'function') throw new TypeError('critique must be a function');
  if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0 || maxRepairs > 10) {
    throw new TypeError('maxRepairs must be an integer between 0 and 10');
  }
  const reviewHistory = [];
  const reviewDraft = async draft => {
    let result = null;
    try {
      result = await critique(draft, { topic, sourceTitle, sourceContext });
    } catch { /* An unavailable reviewer never approves the draft. */ }
    const publicationReview = createPublicationReview({
      verdict: result?.verdict,
      sourceContext,
      reviewer: result?.reviewer || reviewer,
      ...(typeof result?.checkedAt === 'string' ? { checkedAt: result.checkedAt } : {})
    });
    if (result?.verification && typeof result.verification === 'object') {
      publicationReview.verification = {
        schemaVersion: result.verification.schemaVersion,
        verifier: String(result.verification.verifier || '').slice(0, 80),
        sourceHash: String(result.verification.sourceHash || '').slice(0, 64),
        claimCount: Number.isSafeInteger(result.verification.claimCount) ? result.verification.claimCount : null,
        evidenceCount: Number.isSafeInteger(result.verification.evidenceCount) ? result.verification.evidenceCount : null,
        errors: Array.isArray(result.verification.errors) ? result.verification.errors.slice(0, 30) : []
      };
    }
    reviewHistory.push({
      scriptSha256: crypto.createHash('sha256').update(JSON.stringify(draft ?? null)).digest('hex'),
      status: publicationReview.status,
      reviewer: publicationReview.reviewer,
      feedback: String(result?.feedback || '').trim().slice(0, 1000),
      ...(publicationReview.verification ? { verification: publicationReview.verification } : {})
    });
    return { result, publicationReview };
  };

  let currentScript = script;
  let currentReview = await reviewDraft(currentScript);
  let regenerated = false;

  for (let attempt = 0; attempt < maxRepairs; attempt++) {
    const feedback = String(currentReview.result?.feedback || '').trim();
    if (currentReview.publicationReview.status !== 'rejected' || !feedback
      || typeof regenerate !== 'function') break;

    try {
      currentScript = await regenerate(feedback, { script: currentScript, attempt: attempt + 1 });
      regenerated = true;
      currentReview = await reviewDraft(currentScript);
    } catch {
      break;
    }
  }

  return {
    script: currentScript,
    publicationReview: currentReview.publicationReview,
    reviewFeedback: String(currentReview.result?.feedback || '').trim(),
    regenerated,
    reviewHistory
  };
}

module.exports = {
  callWithModelFallback,
  findPreclinicalScopeViolation,
  reviewScriptWithRepair,
  reviewWithModelConsensus,
  reviewWithModelFallback
};
