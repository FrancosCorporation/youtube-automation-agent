'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const structuredClone = globalThis.structuredClone;
const {
  critiqueScript,
  parseReviewChoice,
  parseReviewResponseContent,
  parseScriptResponseContent,
  parseScriptChoice,
  narrativeSectionCount,
  SCRIPT_GENERATION_MODELS,
  SCRIPT_GENERATION_MIN_TOKENS,
  SCRIPT_REVIEW_MAX_TOKENS,
  SCRIPT_REVIEW_CONCURRENCY,
  scriptGenerationModelsForRetry,
  repairExcludedWriters,
  scriptRepairPreferredModel,
  scriptGenerationCandidatesForRetry,
  scriptProviderUsageService,
  scriptReviewCandidatesForRetry,
  SCRIPT_GENERATION_MAX_FALLBACKS,
  SCRIPT_GENERATION_MAX_CALLS,
  SCRIPT_REVIEW_MAX_REPAIRS,
  reviewScriptDeterministically,
  scriptGenerationRequestOptions,
  scriptReviewRequestOptions,
  scriptReviewReasoningOptions,
  scriptReviewTimeoutMs,
  shouldTryAlternativeCoverage,
  automaticReviewFailure,
  scriptGateFailure,
  hasUnsupportedSingleFunderTitle,
  normalizeScript,
  productionMotionVisualGuidance,
  visualItemIsSourceGrounded,
  stripUnsupportedScriptVisuals,
  SCRIPT_REVIEW_MODELS,
  SCRIPT_REVISION,
  sourceBoundedWordTarget,
  countNarrativeSpokenWords,
  YOUTUBE_LONGFORM_TARGET_WORDS,
  YOUTUBE_LONGFORM_MIN_WORDS,
  factRepairWordTarget,
  factRepairGuidance,
  buildScriptRepairPrompt, buildScriptRepairTasks
} = require('../scripts/generate-animated-video');

test('production script guidance requests source-grounded, narration-synced motion graphics', () => {
  const guidance = productionMotionVisualGuidance();
  assert.match(guidance, /type":"node-graph"/);
  assert.match(guidance, /type":"metric-compare"/);
  assert.match(guidance, /cue sincroniza a entrada da barra com a fala/);
  assert.match(guidance, /Não fabrique números, pontuações, rankings, relações nem etapas/);
});

test('a fact-repair rewrite prefers other writers, then keeps the original as a last-resort fallback', () => {
  const models = scriptGenerationModelsForRetry(['openai/gpt-oss-20b']);
  assert.equal(models.length, SCRIPT_GENERATION_MODELS.length);
  assert.equal(models.at(-1).id, 'openai/gpt-oss-20b');
  assert.equal(new Set(models.map(model => model.id)).size, models.length);
  assert.equal(models.slice(0, -1).some(model => model.id === 'openai/gpt-oss-20b'), false);
  assert.deepEqual(scriptGenerationModelsForRetry([]), SCRIPT_GENERATION_MODELS);
});

test('targeted factual repair excludes writers already tried', () => {
  const preferred = 'openai/gpt-oss-20b';
  const tried = [preferred];
  const models = scriptGenerationCandidatesForRetry({
    environment: { NVIDIA_API_KEY: 'configured', GEMINI_API_KEY: 'configured' },
    excludeModels: tried,
    preferredModel: preferred
  });
  assert(models.length > 0);
  assert.notEqual(models[0].id, preferred);
  assert.equal(models.some(model => tried.includes(model.id)), false);
  assert.deepEqual(scriptGenerationModelsForRetry([], preferred).map(model => model.id), SCRIPT_GENERATION_MODELS.map(model => model.id));
});

test('reparo factual pode reutilizar primeiro o writer que respondeu', () => {
  const preferred = 'openai/gpt-oss-20b';
  const failed = 'z-ai/glm-5.3-flash';
  const excludeModels = repairExcludedWriters(new Set([preferred, failed]), preferred);
  assert.deepEqual(excludeModels, [failed]);
  const candidates = scriptGenerationCandidatesForRetry({
    environment: { NVIDIA_API_KEY: 'configured' }, excludeModels, preferredModel: preferred
  });
  assert.equal(candidates[0].id, preferred);
  assert.equal(candidates.some(candidate => candidate.id === failed), false);
});

test('segundo reparo factual escala o writer e mantém alternativas configuradas', () => {
  const environment = { NVIDIA_API_KEY: 'configured', GEMINI_API_KEY: 'configured' };
  const previous = 'gemini-3.5-flash-lite';
  assert.equal(scriptRepairPreferredModel(1, previous, environment), previous);
  const preferredModel = scriptRepairPreferredModel(2, previous, environment);
  assert.equal(preferredModel, 'nvidia/nemotron-3-ultra-550b-a55b');
  const candidates = scriptGenerationCandidatesForRetry({ environment, preferredModel,
    excludeModels: repairExcludedWriters(new Set([previous]), previous) });
  assert.equal(candidates[0].id, preferredModel);
  assert(candidates.some(candidate => candidate.model === previous));
  assert.equal(scriptRepairPreferredModel(2, previous, { GEMINI_API_KEY: 'configured' }), 'gemini:gemini-3.1-pro-preview');
  assert.equal(scriptRepairPreferredModel(2, previous, {}), previous);
});

test('script generation uses every configured provider and skips an exhausted NVIDIA route', () => {
  const environment = {
    NVIDIA_API_KEY: 'configured',
    GEMINI_API_KEY: 'configured',
    OPENAI_API_KEY: 'configured',
    OPENROUTER_API_KEY: 'configured',
    API_KEY: 'dashboard-only'
  };
  const candidates = scriptGenerationCandidatesForRetry({ environment, disabledProviders: ['nvidia'] });
  assert(candidates.length >= SCRIPT_GENERATION_MAX_CALLS);
  assert.equal(candidates.some(candidate => candidate.provider === 'nvidia'), false);
  assert.equal(candidates.some(candidate => candidate.provider === 'gemini'), true);
  assert.equal(candidates.some(candidate => candidate.provider === 'openai'), true);
  assert.equal(candidates.some(candidate => candidate.provider === 'openrouter'), true);
  assert.equal(candidates.some(candidate => candidate.provider === 'dashboard'), false);
  assert.equal(SCRIPT_GENERATION_MAX_FALLBACKS, 10);
  assert.equal(SCRIPT_GENERATION_MAX_CALLS, 11);
  assert.equal(SCRIPT_REVIEW_MAX_REPAIRS, 2);
});

test('local factual review recovers only literal citations and rejects unsupported changes', () => {
  const sentences = [
    'O projeto apresenta dados públicos em um relatório anual.',
    'O relatório mostra dados públicos de um projeto brasileiro.',
    'A pesquisa reúne indicadores públicos de várias regiões.',
    'Os pesquisadores publicaram os resultados em um relatório aberto.',
    'O relatório descreve os indicadores apresentados pelos pesquisadores.',
    'O documento reúne informações que foram disponibilizadas para consulta pública por diferentes instituições brasileiras.',
    'A equipe organizou os materiais em seções e indicou a origem das informações usadas no relatório.'
  ];
  const source = sentences.join(' ');
  const script = { title: sentences[0], hook: sentences[1],
    sections: [{ title: sentences[2], content: sentences[3] }], conclusion: sentences[4],
    claimEvidence: [{ path: 'title', sourceIds: ['S999'] }] };
  const approved = reviewScriptDeterministically(script, source, 0);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.literalCitationRepairs.length, 5);
  const unsupported = reviewScriptDeterministically({ ...script, title: 'O projeto comprovou uma redução de custos.' }, source, 0);
  assert.equal(unsupported.status, 'rejected');
});

test('provider usage counters normalize route separators accepted by the usage store', () => {
  assert.equal(scriptProviderUsageService('opencode:atria'), 'script-opencode-atria');
  assert.equal(scriptProviderUsageService('mimocode:xiaomi'), 'script-mimocode-xiaomi');
  assert.equal(scriptProviderUsageService('nvidia'), 'nvidia');
  assert.match(scriptProviderUsageService('opencode:mwapi'), /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/);
});

test('script generation can run on Gemini alone when NVIDIA is out of quota', () => {
  const candidates = scriptGenerationCandidatesForRetry({
    environment: { GEMINI_API_KEY: 'configured' },
    disabledProviders: ['nvidia']
  });
  assert.deepEqual(candidates.map(candidate => candidate.provider), ['gemini', 'gemini', 'gemini']);
  assert.equal(candidates[0].model, 'gemini-3.5-flash-lite');
});

test('script generation adds only explicitly configured OpenCode gateway models', () => {
  const externalProviders = [
    { id: 'mwapi', models: ['claude-haiku-4-5-20251001'] },
    { id: 'lebang', models: ['qwen3.8-flash', 'glm-5.3-flash'] }
  ];
  const candidates = scriptGenerationCandidatesForRetry({
    environment: {},
    externalProviders
  });
  assert.deepEqual(candidates.map(candidate => [candidate.provider, candidate.model]), [
    ['opencode:mwapi', 'claude-haiku-4-5-20251001'],
    ['opencode:lebang', 'qwen3.8-flash'],
    ['opencode:lebang', 'glm-5.3-flash']
  ]);
  const mimoCandidates = scriptGenerationCandidatesForRetry({
    environment: {},
    externalProviders: [{ id: 'xiaomi', route: 'mimocode', models: ['mimo-v2.6-flash', 'mimo-v2.6-pro'] }]
  });
  assert.deepEqual(mimoCandidates.map(candidate => candidate.provider), ['mimocode:xiaomi', 'mimocode:xiaomi']);
  assert.equal(mimoCandidates[0].model, 'mimo-v2.6-flash');
});

test('factual review keeps two Gemini reviewers available after NVIDIA quota exhaustion', () => {
  const candidates = scriptReviewCandidatesForRetry({
    environment: { NVIDIA_API_KEY: 'configured', GEMINI_API_KEY: 'configured' },
    disabledProviders: ['nvidia']
  });
  assert.equal(candidates.length, 3);
  assert(candidates[0].id.includes('gemini-3.5-flash-lite'));
  assert(candidates[1].id.includes('gemini-3.7-flash'));
  assert(candidates.every(candidate => candidate.provider === 'gemini'));
});

test('targeted repair includes the rejected draft, source and exact correction together', () => {
  const script = {
    title: 'Modernização do mercado',
    hook: 'Como a modernização pode mudar o mercado da cidade?',
    sections: [{ title: 'Capacidade', content: 'A obra garante energia suficiente.', imagePrompt: 'A local market building.' }],
    conclusion: 'Acompanhe o projeto.'
  };
  const context = 'A subestação poderá atender à demanda do mercado.';
  const feedback = 'Substitua "garante energia suficiente" por "busca atender à demanda".';
  const prompt = buildScriptRepairPrompt({ script, feedback, context, topic: script.title });
  assert(prompt.includes(JSON.stringify(script)));
  assert(prompt.includes(context));
  assert(prompt.includes(feedback));
  assert.match(prompt, /não uma fonte/);
  assert.match(prompt, /não reescreva o assunto do zero/);
  assert.match(prompt, /fonte é a única base factual/i);
});

test('the deployed provider-qualified Gemini preference overrides NVIDIA order without deleting fallbacks', () => {
  const candidates = scriptGenerationCandidatesForRetry({
    environment: { NVIDIA_API_KEY: 'configured', GEMINI_API_KEY: 'configured' },
    preferredModel: 'gemini:gemini-3.5-flash-lite'
  });
  assert.equal(candidates[0].provider, 'gemini');
  assert.equal(candidates[0].model, 'gemini-3.5-flash-lite');
  assert(candidates.some(candidate => candidate.provider === 'nvidia'));
});

test('pipelined YouTube scripts target six-minute long form while honoring only safe minimum budgets', () => {
  const context = 'palavra '.repeat(2000);
  assert.equal(sourceBoundedWordTarget(950, context, { PULSO_PIPELINED_PRODUCTION: '1' }), 950);
  assert.equal(sourceBoundedWordTarget(950, context, { PULSO_PIPELINED_PRODUCTION: '0' }), 950);
  assert.equal(sourceBoundedWordTarget(300, context, { PULSO_PIPELINED_PRODUCTION: '1' }), 300);
  assert.equal(sourceBoundedWordTarget(950, context, { PULSO_PIPELINED_PRODUCTION: '1', PULSO_NARRATIVE_WORD_BUDGET: '-1' }), 950);
  assert.equal(sourceBoundedWordTarget(950, context, { PULSO_PIPELINED_PRODUCTION: '1', PULSO_NARRATIVE_WORD_BUDGET: '850' }), 850);
  assert.equal(YOUTUBE_LONGFORM_TARGET_WORDS, 950);
  assert.equal(YOUTUBE_LONGFORM_MIN_WORDS, 850);
});

test('repair tasks enumerate every invalid claim and map sentence paths to editable fields', () => {
  const script = { title: 'O estudo garante a cura.', hook: 'O estudo garante a cura para todos os pacientes?',
    sections: [{ title: 'O estudo garante a cura', content: 'O estudo garante a cura. O estudo garante resultado em três dias.' }],
    conclusion: 'O estudo garante a cura.', claimEvidence: [] };
  const context = 'O estudo não demonstrou redução dos erros de medição e não estabelece cura para pacientes. '.repeat(4);
  const tasks = buildScriptRepairTasks(script, context);
  assert(tasks.some(t => t.path === 'conclusion#1' && t.editPath === 'conclusion'));
  assert.equal(tasks.filter(t => t.editPath === 'sections.0.content').length, 2);
  assert(tasks.every(t => t.text && t.errors.length && !t.editPath.includes('#')));
});

test('a global freshness failure names the exact supported sentence that needs repair', () => {
  const quote = 'A equipe publicou um estudo sobre as substâncias responsáveis pela fluorescência.';
  const context = `${quote} `.repeat(6);
  const script = { sections: [{ content: `Hoje ${quote.charAt(0).toLowerCase()}${quote.slice(1)}` }],
    claimEvidence: [{ path: 'sections.0.content#1', quote }] };
  assert.deepEqual(buildScriptRepairTasks(script, context, 0), []);
  const tasks = buildScriptRepairTasks(script, context, 36);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].editPath, 'sections.0.content');
  assert(tasks[0].errors.includes('stale_relative_freshness'));
  const repaired = { ...script, sections: [{ content: quote }] };
  assert.deepEqual(buildScriptRepairTasks(repaired, context, 36), []);
});

test('review parser accepts NVIDIA structured JSON content without stringifying it', () => {
  const response = { verdict: 'aprovado', feedback: '' };
  assert.deepEqual(parseReviewResponseContent(response), response);
  assert.deepEqual(parseReviewChoice({ finish_reason: 'stop', message: { content: response } }), response);
});

test('review parser unwraps JSON and text response envelopes', () => {
  assert.deepEqual(parseReviewResponseContent({ type: 'json', json: { verdict: 'reprovado', feedback: 'Ajuste a afirmação.' } }), {
    verdict: 'reprovado', feedback: 'Ajuste a afirmação.'
  });
  assert.deepEqual(parseReviewResponseContent([{ type: 'text', text: '{"verdict":"aprovado","feedback":""}' }]), {
    verdict: 'aprovado', feedback: ''
  });
});

test('review parser rejects truncated and malformed responses with safe error codes', () => {
  assert.throws(
    () => parseReviewChoice({ finish_reason: 'length', message: { content: { verdict: 'aprovado' } } }),
    error => error.code === 'INCOMPLETE_REVIEW_RESPONSE'
  );
  assert.throws(
    () => parseReviewResponseContent('[object Object]'),
    error => error.code === 'INVALID_REVIEW_RESPONSE'
  );
});

test('script length is bounded by the available source so the prompt does not force invented facts', () => {
  const conciseSource = Array(362).fill('evidence').join(' ');
  const longSource = Array(1000).fill('evidence').join(' ');
  assert.equal(sourceBoundedWordTarget(950, conciseSource), 325);
  assert.equal(sourceBoundedWordTarget(950, longSource), 900);
  assert.equal(sourceBoundedWordTarget(500, ''), 500);
});

test('factual repair asks for a shorter script and prioritizes removing unsupported details', () => {
  const source = Array(800).fill('evidence').join(' ');
  assert.equal(factRepairWordTarget(950, source), 600);
  assert.equal(factRepairWordTarget(500, source), 500);
  assert.equal(factRepairWordTarget(950, ''), 950);
  assert.equal(factRepairWordTarget(950, 'evidence '.repeat(945)), 850);
  const guidance = factRepairGuidance('Remova testes e entrevistas não citados.');
  assert.match(guidance, /não substitua uma alegação rejeitada por outra inferência/);
  assert.match(guidance, /Entregue uma versão mais curta/);
  assert.match(guidance, /no mínimo metade \(até quatro\) das palavras de conteúdo distintas/);
  assert.match(guidance, /usando os termos da fonte em vez de sinônimos/);
  assert.match(guidance, /Remova testes e entrevistas não citados/);
  const quotedCorrection = factRepairGuidance('Corrija "permissões" para "permissionários" e prefira "encontros corporativos e de negócios".');
  assert.match(quotedCorrection, /substitua-a literalmente/);
  assert.match(quotedCorrection, /use exatamente essa formulação/);
  assert.match(quotedCorrection, /Corrija "permissões" para "permissionários"/);
  assert.equal(factRepairGuidance(''), '');
});

test('lexical evidence feedback explains the deterministic same-language overlap rule', () => {
  const { feedbackForEvidenceErrors } = require('../utils/deterministic-script-review');
  const feedback = feedbackForEvidenceErrors([{ path: 'title', code: 'claim_words_not_in_quote' }]);
  assert.match(feedback, /no mínimo metade \(até quatro\) das palavras de conteúdo distintas/);
  assert.match(feedback, /prefira os termos da fonte a sinônimos/);
});

test('six-minute scripts split into enough chapters for sentence-linked animated scenes', () => {
  assert.equal(narrativeSectionCount(950), 6);
  assert.equal(narrativeSectionCount(700), 4);
  assert.equal(narrativeSectionCount(400), 3);
});

test('YouTube long-form gate checks spoken words and leaves manual short clips alone', () => {
  assert.equal(scriptGateFailure({ status: 'approved' }, true, 9, {
    spokenWordCount: 849, minimumSpokenWords: 850
  }), 'youtube_longform_narrative_too_short');
  assert.equal(scriptGateFailure({ status: 'approved' }, true, 9, {
    spokenWordCount: 850, minimumSpokenWords: 850
  }), null);
  assert.equal(scriptGateFailure({ status: 'approved' }, false, 9, { spokenWordCount: 100 }), null);
  assert.equal(countNarrativeSpokenWords({ hook: 'Gancho aqui.',
    sections: [{ title: 'Não narrado', content: 'Dois fatos são explicados.' }],
    conclusion: { finalThought: 'Fim da história.' } }), 9);
});

test('script generation uses per-model token and reasoning budgets with bounded timeouts', () => {
  assert.equal(SCRIPT_GENERATION_MODELS[0].id, 'openai/gpt-oss-20b');
  assert(SCRIPT_GENERATION_MODELS.every(model => model.timeoutMs <= 120_000));
  assert(SCRIPT_GENERATION_MIN_TOKENS >= 6000);
  assert(SCRIPT_REVIEW_MAX_TOKENS >= 4096);
  assert.deepEqual(scriptGenerationRequestOptions(SCRIPT_GENERATION_MODELS[0], 950), {
    stream: false,
    max_tokens: 4096,
    reasoning_effort: 'low'
  });
  assert.deepEqual(scriptGenerationRequestOptions(SCRIPT_GENERATION_MODELS[2], 950), {
    stream: false,
    max_tokens: 6000,
    reasoning_budget: 1024
  });
  assert.deepEqual(scriptReviewReasoningOptions(SCRIPT_REVIEW_MODELS[0]), {
    reasoning_effort: 'low', chat_template_kwargs: { clear_thinking: true }
  });
  assert.deepEqual(scriptReviewReasoningOptions(SCRIPT_REVIEW_MODELS[1]), { reasoning_budget: 512 });
  assert.equal(SCRIPT_REVIEW_MODELS[0], 'z-ai/glm-5.3');
  assert.equal(SCRIPT_REVIEW_MODELS[1], 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning');
  assert.equal(SCRIPT_REVIEW_CONCURRENCY, 2);
  assert(SCRIPT_REVIEW_MODELS.length >= 6);
  assert.equal(SCRIPT_REVIEW_MODELS.at(-1), 'nvidia/nemotron-3-ultra-550b-a55b');
  assert.deepEqual(scriptReviewReasoningOptions(SCRIPT_REVIEW_MODELS.at(-1)), { reasoning_effort: 'medium' });
  assert.deepEqual(scriptReviewRequestOptions(SCRIPT_REVIEW_MODELS[1]), {
    stream: false, max_tokens: 4096, reasoning_budget: 512
  });
  assert.equal(scriptReviewTimeoutMs(SCRIPT_REVIEW_MODELS[0]), 60_000);
  assert.equal(scriptReviewTimeoutMs(SCRIPT_REVIEW_MODELS[1]), 60_000);
  assert.equal(scriptReviewTimeoutMs(SCRIPT_REVIEW_MODELS.at(-1)), 180_000);
  assert.equal(SCRIPT_REVIEW_CONCURRENCY, 2);
  assert.equal(SCRIPT_REVISION, 'retention-emotions-v29-inline-source-evidence');
});

test('a hook outside 7–12 words is rejected before any remote review request', async () => {
  const previousApiKey = process.env.NVIDIA_API_KEY;
  const previousNoCritic = process.env.NO_SCRIPT_CRITIC;
  process.env.NVIDIA_API_KEY = 'test-key-for-deterministic-review';
  delete process.env.NO_SCRIPT_CRITIC;
  try {
    const review = await critiqueScript({
      title: 'Título',
      hook: 'Uma pauta importante apresenta um resultado concreto que o vídeo consegue responder com evidência'
    }, 'pauta', '', '', '', null);
    assert.equal(review.verdict, 'reprovado');
    assert.match(review.feedback, /7–12 palavras/);
    assert.match(review.feedback, /tem 14/);
  } finally {
    if (previousApiKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousApiKey;
    if (previousNoCritic === undefined) delete process.env.NO_SCRIPT_CRITIC;
    else process.env.NO_SCRIPT_CRITIC = previousNoCritic;
  }
});

test('joint funding cannot be attributed to one organization in a generated headline', () => {
  const source = 'Under a partnership, the Simons Foundation, Anthropic and OpenAI will commit $15 million in combined funding and resources.';
  assert.equal(hasUnsupportedSingleFunderTitle(
    'Simons Foundation invests 15 million for mathematics', source
  ), true);
  assert.equal(hasUnsupportedSingleFunderTitle(
    'Partnership between Simons Foundation, Anthropic and OpenAI combines $15 million', source
  ), false);
});

test('numeric visual scores are removed unless each label and value occur together in source text', () => {
  const source = 'A Simons Foundation e a Anthropic anunciaram recursos no valor de 15 milhões de dólares.';
  const unsupported = {
    title: 'Fundação Simons',
    hook: 'O que mudou?',
    sections: [{
      title: 'Investimento',
      content: 'A fundação anunciou recursos.',
      visual: {
        type: 'score-compare',
        items: [
          { label: 'Fundação Simons', score: 9.1 },
          { label: 'Anthropic', score: 8.7 }
        ]
      }
    }]
  };

  assert.equal(visualItemIsSourceGrounded(unsupported.sections[0].visual.items[0], source), false);
  assert.equal(stripUnsupportedScriptVisuals(unsupported, source).sections[0].visual, null);
  assert.equal(normalizeScript(unsupported, source).mainContent.sections[0].visual, null);

  const groundedSource = 'O índice Acme recebeu nota 9,1. O índice Boreal recebeu nota 8,7.';
  assert.equal(visualItemIsSourceGrounded({ label: 'Índice Acme', score: 9.1 }, groundedSource), true);
  const grounded = normalizeScript({
    title: 'Índices',
    hook: 'Quais foram as notas?',
    sections: [{
      title: 'Notas publicadas',
      content: 'O relatório publicou as duas notas.',
      visual: {
        type: 'score-compare',
        items: [
          { label: 'Índice Acme', score: 9.1 },
          { label: 'Índice Boreal', score: 8.7 }
        ]
      }
    }]
  }, groundedSource);
  assert.equal(grounded.mainContent.sections[0].visual.items.length, 2);
});

test('process graph labels and narration cue must be grounded in source and script text', () => {
  const source = 'The DeepSeek documentation describes Search and Fetch endpoints for web pages.';
  const valid = normalizeScript({
    title: 'DeepSeek Search e Fetch',
    hook: 'Como a documentação organiza a busca?',
    sections: [{
      title: 'Busca e recuperação',
      content: 'Use Search para encontrar páginas; depois use Fetch para recuperar o conteúdo.',
      visual: { type: 'node-graph', nodes: ['Search', 'Fetch'], cue: 'Search para encontrar páginas' }
    }]
  }, source);
  assert.deepEqual(valid.mainContent.sections[0].visual, {
    type: 'node-graph', nodes: ['Search', 'Fetch'], cue: 'Search para encontrar páginas'
  });

  const unsupported = normalizeScript({
    title: 'DeepSeek Search e Fetch',
    hook: 'Como a documentação organiza a busca?',
    sections: [{
      title: 'Busca e recuperação',
      content: 'Use Search para encontrar páginas; depois use Fetch para recuperar o conteúdo.',
      visual: { type: 'node-graph', nodes: ['Search', 'Diagnóstico médico'], cue: 'Search para encontrar páginas' }
    }]
  }, source);
  assert.equal(unsupported.mainContent.sections[0].visual, null);
});

test('metric chart values require official source support and literal cues in the narration', () => {
  const source = 'The Meta Llama 3.1 collection is available in 8B, 70B and 405B sizes. The model card lists these parameter sizes.';
  const visual = {
    type: 'metric-compare', title: 'Tamanho dos modelos', unitLabel: 'Bilhões de parâmetros',
    items: [
      { label: 'Llama 3.1 8B', value: 8, unit: 'B', cue: 'oito bilhões' },
      { label: 'Llama 3.1 70B', value: 70, unit: 'B', cue: 'setenta bilhões' },
      { label: 'Llama 3.1 405B', value: 405, unit: 'B', cue: 'quatrocentos e cinco bilhões' }
    ]
  };
  const content = 'O Llama 3.1 8B tem oito bilhões de parâmetros. O Llama 3.1 70B tem setenta bilhões. O Llama 3.1 405B chega a quatrocentos e cinco bilhões.';
  const script = { title: 'Llama', hook: 'Qual é a diferença?', sections: [{ title: 'Tamanho', content, visual }] };

  assert.ok(visual.items.every(item => visualItemIsSourceGrounded(item, source)));
  assert.deepEqual(stripUnsupportedScriptVisuals(structuredClone(script), source).sections[0].visual, visual);
  assert.deepEqual(normalizeScript(structuredClone(script), source).mainContent.sections[0].visual.items, visual.items);

  const wrongCue = structuredClone(script);
  wrongCue.sections[0].visual.items[1].cue = 'noventa bilhões';
  assert.equal(stripUnsupportedScriptVisuals(wrongCue, source).sections[0].visual, null);
});

test('automatic scripts rejected by factual review never advance to render', () => {
  assert.equal(automaticReviewFailure({ status: 'approved' }, true), null);
  assert.equal(automaticReviewFailure({ status: 'unavailable' }, true), 'publication_review_unavailable');
  assert.equal(automaticReviewFailure({ status: 'rejected' }, false), null);
  assert.equal(automaticReviewFailure({ status: 'rejected' }, true), 'source_claims_unverified');
});

test('automatic factual holds take precedence over secondary hook-shape errors', () => {
  assert.equal(scriptGateFailure({ status: 'rejected' }, true, 4), 'source_claims_unverified');
  assert.equal(scriptGateFailure({ status: 'unavailable' }, true, 10), 'publication_review_unavailable');
  assert.equal(scriptGateFailure({ status: 'approved' }, true, 4), 'hook_word_count_out_of_range');
  assert.equal(scriptGateFailure({ status: 'approved' }, true, 9), null);
  assert.equal(scriptGateFailure({ status: 'rejected' }, false, 9, { sourceEligible: true }), 'source_claims_unverified');
  assert.equal(scriptGateFailure({ status: 'rejected' }, false, 9), null);
});

test('short source context tries same-story coverage before the factual gate blocks it', () => {
  assert.equal(shouldTryAlternativeCoverage(''), true);
  assert.equal(shouldTryAlternativeCoverage('resumo curto de 78 caracteres'), true);
  assert.equal(shouldTryAlternativeCoverage('longword '.repeat(39)), true);
  assert.equal(shouldTryAlternativeCoverage('relato com quarenta palavras diferentes e contexto suficiente para validar detalhes específicos publicados pelo veículo independente nesta reportagem '.repeat(4)), false);
});

test('script response parser rejects truncation and accepts structured content blocks', () => {
  assert.throws(() => parseScriptChoice({ finish_reason: 'length', message: { content: '{"title":"cortado"}' } }), {
    code: 'INCOMPLETE_SCRIPT_RESPONSE'
  });
  assert.deepEqual(parseScriptChoice({ finish_reason: 'stop', message: { content: [{ type: 'text', text: '{"title":"Roteiro","sections":[]}' }] } }), {
    title: 'Roteiro', sections: []
  });
  assert.deepEqual(parseScriptResponseContent({ type: 'json', json: { title: 'Roteiro', sections: [] } }), {
    title: 'Roteiro', sections: []
  });
});

test('writer model timeout keeps sibling fallbacks; provider-wide account/quota errors stop them', () => {
  const { scriptFailureDisablesProvider } = require('../scripts/generate-animated-video');
  for (const error of [{ code: 'REQUEST_TIMEOUT' }, { status: 408 }, { status: 503 }, { code: 'ECONNRESET' }]) {
    assert.equal(scriptFailureDisablesProvider(error), false);
  }
  for (const error of [{ status: 401 }, { status: 402 }, { status: 403 }, { status: 429 },
    { code: 'SCRIPT_PROVIDER_BUDGET_EXHAUSTED' }, { code: 'ENOTFOUND' }]) {
    assert.equal(scriptFailureDisablesProvider(error), true);
  }
});
