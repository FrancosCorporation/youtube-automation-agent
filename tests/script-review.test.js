'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { callWithModelFallback, findPreclinicalScopeViolation, reviewScriptWithRepair, reviewWithModelConsensus, reviewWithModelFallback } = require('../utils/script-review');
const { assessSourceEvidence } = require('../utils/source-evidence');
const { isPublicationEligible } = require('../utils/publication-status');

const sourceTitle = 'Fundat divulga novas vagas de emprego para esta terça-feira, 13';
const sourceUrl = 'https://example.test/vagas';
const sourceContext = Array(5).fill(
  'A publicação informa vagas disponíveis, requisitos para inscrição e locais de atendimento aos candidatos interessados.'
).join(' ');
const reviewer = 'nvidia/nemotron-3.5-lightning-30b-a3b';

test('lab-only sources reject narration that projects bacterial results onto people', () => {
  const labSource = 'All experiments were conducted in controlled laboratory settings, not in humans. Further studies are needed to determine whether these results affect people.';
  const actualNarration = [
    'Se você consome adoçantes regularmente, especialmente em combinação com medicamentos como antidepressivos, pode estar alterando o equilíbrio das bactérias que ajudam na digestão e no controle da glicose.',
    'Contudo, os dados levantam uma nova pergunta: os adoçantes que usamos diariamente podem estar prejudicando nosso intestino sem que percebamos?',
    'A perda de diversidade pode levar a inflamações e desequilíbrios metabólicos.',
    'Os adoçantes podem, de fato, interferir no crescimento de bactérias intestinais, especialmente quando combinados com certos medicamentos.'
  ].join(' ');

  assert.match(findPreclinicalScopeViolation(actualNarration, labSource), /n[aã]o demonstra efeito em humanos/i);
  assert.equal(findPreclinicalScopeViolation(
    'Em testes de laboratório, a combinação reduziu o crescimento de duas bactérias. Ainda não se sabe se esse resultado ocorre em humanos.',
    labSource
  ), null);
  assert.equal(findPreclinicalScopeViolation(actualNarration, 'A source describing human clinical trial results.'), null);
});

test('local preclinical scope check still runs with remote script review disabled', async () => {
  const priorKey = process.env.NVIDIA_API_KEY;
  const priorSkip = process.env.NO_SCRIPT_CRITIC;
  delete process.env.NVIDIA_API_KEY;
  process.env.NO_SCRIPT_CRITIC = '1';
  try {
    const { critiqueScript } = require('../scripts/generate-animated-video');
    const result = await critiqueScript({
      title: 'Adoçantes e bactérias em laboratório',
      hook: 'O que testes de laboratório revelaram sobre adoçantes?',
      sections: [{ content: 'Se você consome adoçantes, pode estar alterando o equilíbrio das bactérias no intestino.' }]
    }, 'adoçantes', 'Scientists tested sweeteners', 'https://example.test/study',
    'Experiments were conducted in laboratory settings, not in humans. Further studies are needed to establish human effects.', 10);

    assert.equal(result.verdict, 'reprovado');
    assert.match(result.feedback, /n[aã]o demonstra efeito em humanos/i);
  } finally {
    if (priorKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = priorKey;
    if (priorSkip === undefined) delete process.env.NO_SCRIPT_CRITIC;
    else process.env.NO_SCRIPT_CRITIC = priorSkip;
  }
});


test('generation fallback advances after a timeout and records the model that succeeds', async () => {
  const attempted = [];
  const failures = [];
  const result = await callWithModelFallback({
    models: [{ id: 'slow-model', timeoutMs: 120000 }, { id: 'working-model', timeoutMs: 60000 }],
    request: async model => {
      attempted.push(model.id);
      if (model.id === 'slow-model') throw Object.assign(new Error('timeout'), { code: 'request_timeout' });
      return { title: 'Roteiro aprovado para revisão' };
    },
    onFailure: (model, error) => failures.push([model.id, error.code])
  });

  assert.deepEqual(attempted, ['slow-model', 'working-model']);
  assert.deepEqual(failures, [['slow-model', 'request_timeout']]);
  assert.equal(result.model, 'working-model');
  assert.equal(result.value.title, 'Roteiro aprovado para revisão');
});

test('generation fallback stops immediately when the shared API budget is exhausted', async () => {
  const attempted = [];
  await assert.rejects(callWithModelFallback({
    models: [{ id: 'first' }, { id: 'second' }],
    request: async model => {
      attempted.push(model.id);
      throw Object.assign(new Error('budget'), { code: 'BUDGET_EXHAUSTED' });
    }
  }), { code: 'BUDGET_EXHAUSTED' });
  assert.deepEqual(attempted, ['first']);
});

test('rejected script is regenerated once and only the reviewed replacement can be approved', async () => {
  const first = { title: '300 vagas que somem em minutos' };
  const replacement = { title: 'Fundat divulga oportunidades de emprego' };
  const reviewedDrafts = [];
  const output = await reviewScriptWithRepair({
    script: first,
    topic: sourceTitle,
    sourceTitle,
    sourceContext,
    reviewer,
    critique: async draft => {
      reviewedDrafts.push(draft);
      return draft === first
        ? { verdict: 'reprovado', feedback: 'Remova o número sem fonte.' }
        : { verdict: 'aprovado', feedback: '' };
    },
    regenerate: async feedback => {
      assert.match(feedback, /número sem fonte/);
      return replacement;
    }
  });
  const evidence = assessSourceEvidence({ sourceTitle, sourceUrl, context: sourceContext });

  assert.equal(output.script, replacement);
  assert.equal(output.regenerated, true);
  assert.equal(reviewedDrafts.length, 2);
  assert.equal(output.publicationReview.status, 'approved');
  assert.equal(output.publicationReview.sourceHash, evidence.contextHash);
  assert.equal(isPublicationEligible({
    publicationEligible: true,
    sourceEvidence: evidence,
    publicationReview: output.publicationReview
  }), true);
});

test('a second bounded repair can fix a new review finding and reviews every replacement', async () => {
  const drafts = [{ version: 1 }, { version: 2 }, { version: 3 }];
  const feedbacks = [];
  let reviewCount = 0;
  const output = await reviewScriptWithRepair({
    script: drafts[0],
    topic: sourceTitle,
    sourceTitle,
    sourceContext,
    reviewer,
    maxRepairs: 2,
    critique: async draft => {
      assert.equal(draft, drafts[reviewCount]);
      reviewCount++;
      if (draft.version === 1) return { verdict: 'reprovado', feedback: 'Remova a afirmação sem fonte.' };
      if (draft.version === 2) return { verdict: 'reprovado', feedback: 'Ajuste o gancho para 7–12 palavras.' };
      return { verdict: 'aprovado', feedback: '' };
    },
    regenerate: async (feedback, { script: currentDraft, attempt }) => {
      assert.equal(currentDraft, drafts[feedbacks.length]);
      assert.equal(attempt, feedbacks.length + 1);
      feedbacks.push(feedback);
      return drafts[feedbacks.length];
    }
  });

  assert.equal(output.script, drafts[2]);
  assert.equal(output.publicationReview.status, 'approved');
  assert.equal(output.regenerated, true);
  assert.equal(reviewCount, 3);
  assert.deepEqual(feedbacks, ['Remova a afirmação sem fonte.', 'Ajuste o gancho para 7–12 palavras.']);
  assert.deepEqual(output.reviewHistory.map(item => item.status), ['rejected', 'rejected', 'approved']);
  assert.deepEqual(output.reviewHistory.map(item => item.feedback), [...feedbacks, '']);
  assert.equal(new Set(output.reviewHistory.map(item => item.scriptSha256)).size, 3);
  assert(output.reviewHistory.every(item => /^[a-f0-9]{64}$/.test(item.scriptSha256)));
});

test('repair limit stays bounded and an unresolved review remains rejected', async () => {
  let reviews = 0;
  let repairs = 0;
  const output = await reviewScriptWithRepair({
    script: { version: 1 },
    topic: sourceTitle,
    sourceTitle,
    sourceContext,
    reviewer,
    maxRepairs: 2,
    critique: async () => {
      reviews++;
      return { verdict: 'reprovado', feedback: 'A afirmação ainda não está sustentada.' };
    },
    regenerate: async () => ({ version: ++repairs + 1 })
  });

  assert.equal(reviews, 3);
  assert.equal(repairs, 2);
  assert.equal(output.script.version, 3);
  assert.equal(output.publicationReview.status, 'rejected');
  assert.equal(output.reviewFeedback, 'A afirmação ainda não está sustentada.');
});

test('the configured three repair attempts review every draft and stop on approval', async () => {
  let reviewCount = 0;
  let repairCount = 0;
  const output = await reviewScriptWithRepair({
    script: { version: 0 },
    topic: sourceTitle,
    sourceTitle,
    sourceContext,
    reviewer,
    maxRepairs: 3,
    critique: async draft => {
      reviewCount++;
      return draft.version < 3
        ? { verdict: 'reprovado', feedback: `Corrija a versão ${draft.version}.` }
        : { verdict: 'aprovado', feedback: '' };
    },
    regenerate: async () => ({ version: ++repairCount })
  });

  assert.equal(repairCount, 3);
  assert.equal(reviewCount, 4);
  assert.equal(output.script.version, 3);
  assert.equal(output.publicationReview.status, 'approved');
});

test('the writer repair loop supports ten distinct fallback attempts', async () => {
  let reviewCount = 0;
  let repairCount = 0;
  const output = await reviewScriptWithRepair({
    script: { version: 0 },
    topic: sourceTitle,
    sourceTitle,
    sourceContext,
    reviewer,
    maxRepairs: 10,
    critique: async draft => {
      reviewCount++;
      return draft.version === 10
        ? { verdict: 'aprovado', feedback: '' }
        : { verdict: 'reprovado', feedback: `Corrija a versão ${draft.version}.` };
    },
    regenerate: async (_feedback, { attempt }) => {
      repairCount++;
      assert.equal(attempt, repairCount);
      return { version: repairCount };
    }
  });

  assert.equal(repairCount, 10);
  assert.equal(reviewCount, 11);
  assert.equal(output.script.version, 10);
  assert.equal(output.publicationReview.status, 'approved');
});

test('an unavailable review remains fail-closed and does not authorize publication', async () => {
  const output = await reviewScriptWithRepair({
    script: { title: 'Rascunho' },
    topic: sourceTitle,
    sourceTitle,
    sourceContext,
    reviewer,
    critique: async () => null,
    regenerate: async () => ({ title: 'Não deve ser gerado' })
  });
  const evidence = assessSourceEvidence({ sourceTitle, sourceUrl, context: sourceContext });

  assert.equal(output.publicationReview.status, 'unavailable');
  assert.equal(output.regenerated, false);
  assert.equal(isPublicationEligible({
    publicationEligible: true,
    sourceEvidence: evidence,
    publicationReview: output.publicationReview
  }), false);
});

test('a rejected replacement stays rejected even though the first draft was also rejected', async () => {
  let calls = 0;
  const output = await reviewScriptWithRepair({
    script: { version: 1 },
    topic: sourceTitle,
    sourceTitle,
    sourceContext,
    reviewer,
    critique: async () => {
      calls++;
      return { verdict: 'reprovado', feedback: 'Revise a afirmação central.' };
    },
    regenerate: async () => ({ version: 2 })
  });

  assert.equal(calls, 2);
  assert.equal(output.script.version, 2);
  assert.equal(output.regenerated, true);
  assert.equal(output.publicationReview.status, 'rejected');
  assert.equal(output.reviewFeedback, 'Revise a afirmação central.');
});

test('an unavailable fact-repair writer keeps the rejected draft blocked and preserves reviewer feedback', async () => {
  const original = { title: 'Rascunho com afirmação não verificada' };
  const output = await reviewScriptWithRepair({
    script: original,
    topic: sourceTitle,
    sourceTitle,
    sourceContext,
    reviewer,
    critique: async () => ({ verdict: 'reprovado', feedback: 'Remova a etapa não citada.' }),
    regenerate: async () => { throw Object.assign(new Error('unavailable'), { code: 'SCRIPT_GENERATION_UNAVAILABLE' }); }
  });

  assert.equal(output.script, original);
  assert.equal(output.publicationReview.status, 'rejected');
  assert.equal(output.reviewFeedback, 'Remova a etapa não citada.');
  assert.equal(output.regenerated, false);
});

test('review fallback advances after unavailable models and records the approving model', async () => {
  const attempts = [];
  const review = await reviewWithModelFallback({
    models: ['primary', 'backup', 'backup'],
    request: async model => {
      attempts.push(model);
      if (model === 'primary') throw Object.assign(new Error('provider unavailable'), { status: 403 });
      return { verdict: 'APROVADO', feedback: '' };
    }
  });

  assert.deepEqual(attempts, ['primary', 'backup']);
  assert.equal(review.verdict, 'aprovado');
  assert.equal(review.reviewer, 'backup');
});

test('review fallback normalizes standard English verdicts without weakening the verdict gate', async () => {
  const approved = await reviewWithModelFallback({
    models: ['reviewer'],
    request: async () => ({ verdict: 'APPROVED', feedback: '' })
  });
  const rejected = await reviewWithModelFallback({
    models: ['reviewer'],
    request: async () => ({ verdict: 'Rejected', feedback: 'Unsupported claim.' })
  });

  assert.equal(approved.verdict, 'aprovado');
  assert.equal(rejected.verdict, 'reprovado');
});

test('review fallback stops when the shared model budget is exhausted', async () => {
  const attempts = [];
  const review = await reviewWithModelFallback({
    models: ['primary', 'backup'],
    request: async model => {
      attempts.push(model);
      throw Object.assign(new Error('budget'), { code: 'BUDGET_EXHAUSTED' });
    }
  });

  assert.deepEqual(attempts, ['primary']);
  assert.equal(review, null);
});

test('review fallback rejects malformed verdicts and keeps publication fail-closed', async () => {
  const review = await reviewWithModelFallback({
    models: ['primary'],
    request: async () => ({ verdict: 'maybe' })
  });

  assert.equal(review, null);
});

test('factual consensus requires two distinct independent approvals', async () => {
  const attempts = [];
  const review = await reviewWithModelConsensus({
    models: ['reviewer-a', 'reviewer-b', 'reviewer-c'],
    requiredApprovals: 2,
    request: async model => {
      attempts.push(model);
      return { verdict: 'approved', feedback: '' };
    }
  });

  assert.deepEqual(attempts, ['reviewer-a', 'reviewer-b']);
  assert.equal(review.verdict, 'aprovado');
  assert.deepEqual(review.reviewers, ['reviewer-a', 'reviewer-b']);
});

test('factual consensus keeps its approval count while refilling the concurrent review window', async () => {
  const started = [];
  let releaseBatch;
  let signalBothStarted;
  const batchGate = new Promise(resolve => { releaseBatch = resolve; });
  const bothStarted = new Promise(resolve => { signalBothStarted = resolve; });
  const pendingReview = reviewWithModelConsensus({
    models: ['reviewer-a', 'reviewer-b', 'reviewer-c'],
    requiredApprovals: 2,
    concurrency: 2,
    request: async model => {
      started.push(model);
      if (started.length === 2) signalBothStarted();
      await batchGate;
      return { verdict: 'approved', feedback: '' };
    }
  });

  await bothStarted;
  assert.deepEqual(started, ['reviewer-a', 'reviewer-b']);
  releaseBatch();
  const review = await pendingReview;

  assert.equal(review.verdict, 'aprovado');
  assert.deepEqual(review.reviewers, ['reviewer-a', 'reviewer-b']);
  // After the first approval arrives, the third reviewer may fill the newly
  // available slot while the second initial review is still pending.
  assert.deepEqual(started, ['reviewer-a', 'reviewer-b', 'reviewer-c']);
});

test('factual consensus starts all configured reviewers in one wave when requested', async () => {
  const started = [];
  let releaseBatch;
  let signalAllStarted;
  const batchGate = new Promise(resolve => { releaseBatch = resolve; });
  const allStarted = new Promise(resolve => { signalAllStarted = resolve; });
  const pendingReview = reviewWithModelConsensus({
    models: ['reviewer-a', 'reviewer-b', 'reviewer-c', 'reviewer-d'],
    requiredApprovals: 2,
    concurrency: 4,
    request: async model => {
      started.push(model);
      if (started.length === 4) signalAllStarted();
      await batchGate;
      return { verdict: 'approved', feedback: '' };
    }
  });

  await allStarted;
  assert.deepEqual(started, ['reviewer-a', 'reviewer-b', 'reviewer-c', 'reviewer-d']);
  releaseBatch();
  const review = await pendingReview;

  assert.equal(review.verdict, 'aprovado');
  assert.deepEqual(review.reviewers, ['reviewer-a', 'reviewer-b']);
});

test('factual consensus cancels remaining reviewers after two independent approvals', async () => {
  const started = [];
  const cancelled = [];
  let signalRemainingCancelled;
  const remainingCancelled = new Promise(resolve => { signalRemainingCancelled = resolve; });
  const review = await reviewWithModelConsensus({
    models: ['reviewer-a', 'reviewer-b', 'reviewer-c', 'reviewer-d'],
    requiredApprovals: 2,
    concurrency: 4,
    request: async (model, { signal }) => {
      started.push(model);
      if (model === 'reviewer-a' || model === 'reviewer-b') {
        return { verdict: 'approved', feedback: '' };
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          cancelled.push(model);
          if (cancelled.length === 2) signalRemainingCancelled();
          reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
        }, { once: true });
      });
    }
  });
  await remainingCancelled;

  assert.deepEqual(started, ['reviewer-a', 'reviewer-b', 'reviewer-c', 'reviewer-d']);
  assert.deepEqual(review.reviewers, ['reviewer-a', 'reviewer-b']);
  assert.deepEqual(cancelled.sort(), ['reviewer-c', 'reviewer-d']);
});

test('factual consensus still rejects a dissent when reviewers run concurrently', async () => {
  const review = await reviewWithModelConsensus({
    models: ['reviewer-a', 'reviewer-b'],
    concurrency: 2,
    request: async model => model === 'reviewer-a'
      ? { verdict: 'approved', feedback: '' }
      : { verdict: 'rejected', feedback: 'A afirmação central não consta da fonte.' }
  });

  assert.equal(review.verdict, 'reprovado');
  assert.equal(review.reviewer, 'reviewer-b');
});

test('factual consensus falls back after a reviewer throws before returning a promise', async () => {
  const attempted = [];
  const review = await reviewWithModelConsensus({
    models: ['reviewer-a', 'reviewer-b', 'reviewer-c'],
    concurrency: 2,
    request: model => {
      attempted.push(model);
      if (model === 'reviewer-a') throw new Error('sync provider error');
      return Promise.resolve({ verdict: 'approved', feedback: '' });
    }
  });

  assert.deepEqual(attempted, ['reviewer-a', 'reviewer-b', 'reviewer-c']);
  assert.equal(review.verdict, 'aprovado');
  assert.deepEqual(review.reviewers, ['reviewer-b', 'reviewer-c']);
});

test('factual consensus rejects a dissenting review and fails closed when fewer than two approve', async () => {
  const rejected = await reviewWithModelConsensus({
    models: ['reviewer-a', 'reviewer-b'],
    request: async model => model === 'reviewer-a'
      ? { verdict: 'rejected', feedback: 'Atribuição sem apoio.' }
      : { verdict: 'approved', feedback: '' }
  });
  const insufficient = await reviewWithModelConsensus({
    models: ['reviewer-a', 'reviewer-b'],
    request: async model => {
      if (model === 'reviewer-a') return { verdict: 'approved', feedback: '' };
      throw new Error('provider unavailable');
    }
  });

  assert.equal(rejected.verdict, 'reprovado');
  assert.equal(insufficient, null);
});

test('QA replaces a nonresponding reviewer even when the provider ignores cancellation', async () => {
  const attempts = [];
  const failures = [];
  let primarySignal;
  const review = await reviewWithModelConsensus({
    models: ['stalled-primary', 'fallback-a', 'fallback-b'],
    timeoutMs: model => model === 'stalled-primary' ? 20 : 500,
    request: async (model, { signal }) => {
      attempts.push(model);
      if (model === 'stalled-primary') {
        primarySignal = signal;
        return new Promise(() => {});
      }
      return { verdict: 'approved', feedback: '' };
    },
    onFailure: (model, error) => failures.push([model, error.code])
  });
  assert.deepEqual(attempts, ['stalled-primary', 'fallback-a', 'fallback-b']);
  assert.deepEqual(failures, [['stalled-primary', 'REVIEWER_TIMEOUT']]);
  assert.equal(primarySignal.aborted, true);
  assert.deepEqual(review.reviewers, ['fallback-a', 'fallback-b']);
});

test('an unanswered QA and one approval never become a publication approval', async () => {
  const review = await reviewWithModelConsensus({
    models: ['stalled-primary', 'only-available-fallback'], concurrency: 2, timeoutMs: 20,
    request: async model => model === 'stalled-primary'
      ? new Promise(() => {}) : { verdict: 'approved', feedback: '' }
  });
  assert.equal(review, null);
});
