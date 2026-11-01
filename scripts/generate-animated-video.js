#!/usr/bin/env node
/**
 * End-to-end animated video generator (Linear/Vercel style + AI images).
 *   G1 (--from-g1) ou tema -> roteiro contextual (NVIDIA) -> narração sincronizada
 *   (edge-tts + SRT) -> imagens de cena Gemini quando disponível, ou gráficos
 *   baseados no roteiro e prints reais de artigos -> cenas variadas, cartões
 *   editoriais e legendas sincronizadas -> mp4
 *
 * Usage:
 *   node scripts/generate-animated-video.js --from-g1 [--words 950] [--out data/videos/x.mp4]
 *   node scripts/generate-animated-video.js --topic "..." [--words 1100] [--no-images]
 *   Rebuild visual rejeitado: acrescente --visual-critique-manifest <qa.json>
 *   --visual-critique-sha256 <sha256> --out <novo-caminho-inexistente.mp4>.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');
const sharp = require('sharp');
const { NarrativeEpisodeRenderer, assertRenderCapacity } = require('../utils/narrative-episode-renderer');
const { createNarrativeEpisodePlan, sha256: sha256Buffer, stableJson } = require('../utils/narrative-episode-plan');
const { authorNarrativeScenes } = require('../utils/narrative-scene-author');
const { loadPinnedNarrativePlan, savePinnedNarrativePlan } = require('../utils/narrative-resume-plan');
const { fetchSourceCoverImage } = require('../utils/source-cover-image');
const { assertSafeVisualRebuildOutput } = require('../utils/hyperframes-video-renderer');
const { GeminiImageProvider } = require('../utils/gemini-image-provider');
const { buildThumbnailHtml, buildPortraitThumbnailHtml, chooseLocalizedThumbnailHeadline, selectThumbnailHeroImage,
  THUMBNAIL_CANVAS, THUMBNAIL_RENDER_POLICY, PORTRAIT_THUMBNAIL_CANVAS, PORTRAIT_THUMBNAIL_RENDER_POLICY } = require('../utils/thumbnail-design');
const { buildGroundedThumbnailArtInput, generateThumbnailArt } = require('../utils/thumbnail-art');
const { selectThemePalette } = require('../utils/theme-visuals');
const { getMediaDuration, checkFFmpeg, probeVideoHealth } = require('../utils/ffmpeg');
const { updateTopicLedger } = require('../utils/topic-ledger');
const { Logger } = require('../utils/logger');
const { safeErrorTag } = require('../utils/safe-error-tag');
const { withProcessFileLock } = require('../utils/process-file-lock');
const { selectRecentTopicCandidates, formatTopicAgeLabel } = require('../utils/topic-freshness');
const { collectUsedTopicSignals } = require('../utils/topic-history');
const { resolveEditorialFormat, editorialFormatPrompt } = require('../utils/editorial-formats');
const { fetchWithTimeout } = require('../utils/fetch-with-timeout');
const { requestNvidiaChatCompletion } = require('../utils/nvidia-chat-completions');
const { AITextService, PROVIDERS, GEMINI_MODELS } = require('../utils/ai-text-service');
const {
  getConfiguredMimoCodeProvider,
  getConfiguredOpenCodeProvider,
  loadConfiguredMimoCodeProvider,
  loadConfiguredOpenCodeProviders
} = require('../utils/opencode-providers');
const { extractArticleContext } = require('../utils/article-context');
const { resolveGoogleNewsUrl, filterSameStoryNewsReferences, sameStoryTitle, publisherDisplayName } = require('../utils/news-hunter');
const { findNarrativeReadyCandidate } = require('../utils/narrative-source-candidate');
const { createJobId, videoIdForPath } = require('../utils/observability-ids');
const { logGenerationFinished } = require('../utils/generation-observability');
const { buildGroupTimings, partitionNarrationCues, expandEdgeTtsBoundaryEvents } = require('../utils/narration-timing');
const { isGttsFallbackAllowed } = require('../utils/tts-provider-policy');
const { findNarrationCueOffset, normalizeMetricComparisonItems } = require('../utils/scene-visuals');
const { narrationInputHash, narrationCacheMetadata, narrationCacheMatches, narrationCacheArtifactsMatch } = require('../utils/narration-cache');
const { countHookWords, hookStructureGuidance, isHookWordCountValid, selectHookStructure } = require('../utils/hook-structure');
const { audienceGrowthGuidance } = require('../utils/audience-growth-guidance');
const { assessArticleScreenshot } = require('../utils/article-screenshot-quality');
const { alignArticlePrints, getNewsReferenceIndex } = require('../utils/article-print-routing');
const { articleScreenshotCachePath } = require('../utils/article-screenshot-cache');
const { prepareArticleScreenshotPage } = require('../utils/article-screenshot-page');
const { writeVideoQaManifest } = require('../utils/video-qa-manifest');
const { loadVisualRebuildCritique, resolveVisualRebuildEditorial } = require('../utils/video-qa-review');
const { buildSceneImageBase, buildSceneImagePrompt, selectNarrativeBeat, narrativeBeatSha256 } = require('../utils/scene-image-prompt');
const { buildSourceFreshnessGuidance, hasStaleRelativeFreshnessWording } = require('../utils/source-freshness');
const { VERIFIER_ID, feedbackForEvidenceErrors, splitSentences, verifyEditorialMetadata, verifyScriptEvidence } = require('../utils/deterministic-script-review');
const { buildSourceEvidenceCatalog, renderSourceEvidenceCatalog, resolveScriptEvidenceIds, compileScriptEvidenceBlocks } = require('../utils/source-evidence-catalog');
const {
  DEFAULT_MINIMUM_CONTEXT_CHARS,
  DEFAULT_MINIMUM_CONTEXT_WORDS,
  assessSourceEvidence,
  countWords,
  createTopicRecord,
  hashSourceContext
} = require('../utils/source-evidence');
const { callWithModelFallback, findPreclinicalScopeViolation, reviewScriptWithRepair, reviewWithModelConsensus } = require('../utils/script-review');
const { applyScriptRepair, withScriptValidationRetry } = require('../utils/script-repair');
const { createGenerationAttemptStore, generationArticleAgeHours, isCompletedResumeOutput, validateGenerationArticle } = require('../utils/generation-attempt');
const {
  createRecapBrief
} = require('../utils/recap-schedule');
const SCRIPT_REVISION = 'retention-emotions-v29-inline-source-evidence';
const SCRIPT_GENERATION_MIN_TOKENS = 6000;
const SCRIPT_GENERATION_MAX_FALLBACKS = 10;
const SCRIPT_GENERATION_MAX_CALLS = SCRIPT_GENERATION_MAX_FALLBACKS + 1;
const SCRIPT_REVIEW_MAX_REPAIRS = 2;
const SCRIPT_REVIEW_MAX_TOKENS = 4096;
const SCRIPT_REVIEW_CONCURRENCY = 2;
const SCRIPT_GENERATION_MODELS = Object.freeze([
  Object.freeze({ id: 'openai/gpt-oss-20b', timeoutMs: 120_000, maxTokens: 4096, reasoningEffort: 'low' }),
  Object.freeze({ id: 'z-ai/glm-5.3-flash', timeoutMs: 90_000, reasoningEffort: 'low' }),
  Object.freeze({ id: 'nvidia/nemotron-3.5-lightning-30b-a3b', timeoutMs: 60_000, reasoningBudget: 1024 }),
  Object.freeze({ id: 'nvidia/nemotron-3-super-120b-a12b', timeoutMs: 90_000, reasoningEffort: 'low' }),
  Object.freeze({ id: 'nvidia/nemotron-3-ultra-550b-a55b', timeoutMs: 120_000 })
]);
const SCRIPT_REVIEW_MODELS = Object.freeze([
  'z-ai/glm-5.3',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'z-ai/glm-5.3-flash',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3-ultra-550b-a55b'
]);
// The low-latency Gemini model was live-verified on the configured key and is
// the first cross-provider fallback when NVIDIA is exhausted.
const SCRIPT_GEMINI_FALLBACK_MODELS = Object.freeze([
  'gemini-3.5-flash-lite',
  ...GEMINI_MODELS.filter(model => model !== 'gemini-3.5-flash-lite')
]);
const RENDERER_ID = 'remotion-4.0.537-narrative-episode-v2-approved-robot';
const configuredCacheTtl = Number(process.env.SCRIPT_CACHE_TTL_HOURS || 24);
const SCRIPT_CACHE_TTL_HOURS = Number.isFinite(configuredCacheTtl) && configuredCacheTtl >= 1 ? configuredCacheTtl : 24;
const JOB_ID = /^[A-Za-z0-9_-]{8,80}$/.test(process.env.VIDEO_JOB_ID || '') ? process.env.VIDEO_JOB_ID : createJobId();
const pipelineLogger = new Logger('VideoPipeline');
let activeVideoId = null;
let generationStartedAt = null;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function writeFileAtomic(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tempPath, content);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

// Limpa o texto ANTES de narrar e exibir: remove markdown (asteriscos viravam
// "asterisco" na voz), links, bullets e ampersands. Usado no texto falado E nas
// legendas (mesmo texto = sincronia preservada).
function cleanText(text) {
  return String(text || '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')   // [texto](url) -> texto
    .replace(/[*_`#>~]+/g, ' ')                 // markdown
    .replace(/&/g, ' e ')
    .replace(/^\s*[-–—•]+\s*/gm, '')            // bullets no início da linha
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const EMOTIONS = new Set(['curiosity', 'surprise', 'tension', 'empathy', 'wonder', 'confidence', 'focus']);
const EMOTION_ALIASES = {
  curiosidade: 'curiosity', surpresa: 'surprise', tensão: 'tension', tensao: 'tension',
  empatia: 'empathy', encanto: 'wonder', admiração: 'wonder', admiracao: 'wonder',
  confiança: 'confidence', confianca: 'confidence'
};
function inferEmotion(text, fallback = 'curiosity') {
  const value = String(text || '').toLowerCase();
  const cues = [
    ['surprise', /surpreend|inacredit|chocante|revel|ningu[eé]m esperava|fora do comum/g],
    ['tension', /perigo|amea[cç]|risco|crime|desaparec|mist[eé]rio|assustador|urgente/g],
    ['empathy', /v[ií]tima|perdeu|dor|solid[aã]o|fam[ií]lia|sofreu|ajudou/g],
    ['wonder', /universo|oceano|gigante|antigo|imenso|raro|inexplic[aá]vel/g],
    ['confidence', /solu[cç][aã]o|consegue|resultado|melhor|funciona|passo a passo/g],
    ['curiosity', /por que|como|segredo|descob|o que acontece|a verdade/g]
  ];
  let winner = null;
  let max = 0;
  for (const [emotion, pattern] of cues) {
    const score = (value.match(pattern) || []).length;
    if (score > max) { winner = emotion; max = score; }
  }
  return winner || (EMOTIONS.has(fallback) ? fallback : 'curiosity');
}

function normalizeEmotion(value, text = '') {
  const emotion = String(value || '').trim().toLowerCase();
  if (EMOTIONS.has(emotion)) return emotion;
  const alias = EMOTION_ALIASES[emotion];
  return alias || inferEmotion(text);
}

/* ---------------- G1: notícia real de IA ---------------- */

// Detector de idioma: garante roteiro 100% em PT-BR (pautas gringas
// faziam o modelo responder em inglês).
function isEnglish(text) {
  const t = String(text || '').slice(0, 600);
  const en = (t.match(/\b(the|and|of|to|with|that|this|from|will|what|imagine)\b/gi) || []).length;
  const pt = (t.match(/\b(que|não|para|com|uma|dos|mais|como|vai|vão|hoje|imaginar)\b/gi) || []).length;
  return en > pt + 1;
}

async function fetchG1Article() {
  const res = await fetchWithTimeout('https://g1.globo.com/rss/g1/tecnologia/', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  }, 15000);
  if (!res.ok) throw new Error(`g1 rss ${res.status}`);
  const { readBoundedResponseText } = require('../utils/news-hunter');
  const xml = await readBoundedResponseText(res);
  const ai = /ia\b|intelig[êe]ncia artificial|\bgpt\b|claude|gemini|algoritmo|chatbot|rob[oô]|machine learning|deepseek|openai|anthropic/i;
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const title = ((m[1].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '').trim();
    const link = ((m[1].match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
    const description = ((m[1].match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || '').trim();
    const pubDate = ((m[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim();
    if (title && link) items.push({ title, link, description, pubDate });
  }
  const article = items.find(it => ai.test(`${it.title} ${it.description}`)) || items[0];
  if (!article) throw new Error('G1 sem itens no RSS');
  article.time = article.pubDate ? new Date(article.pubDate).toLocaleDateString('pt-BR') : 'hoje';
  return article;
}

/* ---------------- roteiro (NVIDIA) ---------------- */

function parseScriptJson(text) {
  if (text && typeof text === 'object' && !Array.isArray(text)) return text;
  let t = String(text);
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw Object.assign(new Error('resposta sem JSON'), { code: 'SCRIPT_JSON_MISSING' });
  t = t.slice(start, end + 1);
  const noTrailing = t.replace(/,\s*([}\]])/g, '$1');
  const openCurly = (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length;
  const openSquare = (t.match(/\[/g) || []).length - (t.match(/\]/g) || []).length;
  const balanced = noTrailing + ']'.repeat(Math.max(0, openSquare)) + '}'.repeat(Math.max(0, openCurly));
  const candidates = [t, noTrailing, balanced, balanced.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')]; // eslint-disable-line no-control-regex -- regex intencional: limpa caracteres de controle que quebram o JSON.parse
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch (_e) { /* try the next repair */ }
  }
  throw Object.assign(new Error('JSON irreparável'), { code: 'SCRIPT_JSON_INVALID' });
}

function parseScriptResponseContent(value, depth = 0) {
  if (depth > 4) throw Object.assign(new Error('invalid_script_response'), { code: 'INVALID_SCRIPT_RESPONSE' });
  if (typeof value === 'string') return parseScriptJson(value);
  if (Array.isArray(value)) {
    const text = value.map(part => typeof part === 'string'
      ? part
      : typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n');
    if (text) return parseScriptJson(text);
    for (const part of value) {
      try { return parseScriptResponseContent(part, depth + 1); } catch { /* inspect the next block */ }
    }
  }
  if (value && typeof value === 'object') {
    if (['title', 'hook', 'sections', 'conclusion'].some(key => Object.hasOwn(value, key))) return value;
    for (const key of ['json', 'output', 'result', 'content', 'text', 'value']) {
      if (value[key] === undefined) continue;
      try { return parseScriptResponseContent(value[key], depth + 1); } catch { /* inspect known wrappers */ }
    }
  }
  throw Object.assign(new Error('invalid_script_response'), { code: 'INVALID_SCRIPT_RESPONSE' });
}

function parseScriptChoice(choice) {
  if (choice?.finish_reason === 'length') {
    throw Object.assign(new Error('incomplete_script_response'), { code: 'INCOMPLETE_SCRIPT_RESPONSE' });
  }
  return parseScriptResponseContent(choice?.message?.content);
}

function parseReviewResponseContent(value, depth = 0) {
  if (depth > 4) throw Object.assign(new Error('invalid_review_response'), { code: 'INVALID_REVIEW_RESPONSE' });
  if (typeof value === 'string') {
    try { return parseScriptJson(value); }
    catch { throw Object.assign(new Error('invalid_review_response'), { code: 'INVALID_REVIEW_RESPONSE' }); }
  }
  if (Array.isArray(value)) {
    const text = value.map(part => typeof part === 'string'
      ? part
      : typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n');
    if (text) return parseReviewResponseContent(text, depth + 1);
    for (const part of value) {
      try { return parseReviewResponseContent(part, depth + 1); } catch { /* inspect the next content block */ }
    }
  }
  if (value && typeof value === 'object') {
    if (typeof value.verdict === 'string') return value;
    for (const key of ['json', 'output', 'result', 'content', 'text', 'value']) {
      if (value[key] === undefined) continue;
      try { return parseReviewResponseContent(value[key], depth + 1); } catch { /* inspect known wrappers */ }
    }
  }
  throw Object.assign(new Error('invalid_review_response'), { code: 'INVALID_REVIEW_RESPONSE' });
}

function parseReviewChoice(choice) {
  if (choice?.finish_reason === 'length') {
    throw Object.assign(new Error('incomplete_review_response'), { code: 'INCOMPLETE_REVIEW_RESPONSE' });
  }
  return parseReviewResponseContent(choice?.message?.content);
}

function sourceBoundedWordTarget(targetWords, sourceContext, environment = process.env) {
  const originalRequest = Number.isSafeInteger(targetWords) && targetWords > 0 ? targetWords : 0;
  const configuredBudget = Number(environment.PULSO_NARRATIVE_WORD_BUDGET || 450);
  const cadenceBudget = Number.isSafeInteger(configuredBudget) && configuredBudget >= 150 && configuredBudget <= 650
    ? configuredBudget : 450;
  const requested = environment.PULSO_PIPELINED_PRODUCTION === '1' ? Math.min(originalRequest, cadenceBudget) : originalRequest;
  const sourceWords = countWords(sourceContext);
  if (!sourceWords) return requested;
  // A generated script should leave room for narration without asking the
  // writer to expand beyond the facts present in the extracted source.
  return Math.min(requested, Math.floor(sourceWords * 0.9));
}

function factRepairWordTarget(targetWords, sourceContext) {
  const boundedTarget = sourceBoundedWordTarget(targetWords, sourceContext);
  const sourceWords = countWords(sourceContext);
  if (!sourceWords) return boundedTarget;
  // After a factual rejection, a shorter rewrite reduces pressure to fill gaps
  // with plausible but unsupported details. Accuracy takes precedence over
  // the original length target.
  return Math.min(boundedTarget, Math.floor(sourceWords * 0.75));
}

function factRepairGuidance(feedback) {
  const editorFeedback = String(feedback || '').trim();
  if (!editorFeedback) return '';
  return `MODO DE CORREÇÃO FACTUAL: o feedback do editor identifica conteúdo que deve sair ou ser corrigido. Trate-o como bloqueio: não substitua uma alegação rejeitada por outra inferência, não complete espaços com etapas ou conselhos genéricos e remova detalhes que a fonte não confirma. Entregue uma versão mais curta se necessário; a precisão importa mais que a duração. Releia cada frase contra o texto da fonte antes de responder. Para cada caminho reprovado, compare a fala à citação literal ligada ao sourceId; quando a fonte e a fala estiverem no mesmo idioma, mantenha na fala no mínimo metade (até quatro) das palavras de conteúdo distintas presentes na citação, usando os termos da fonte em vez de sinônimos. Preserve números, unidades, negação e incerteza; não mude apenas o sourceId para esconder uma fala ainda sem suporte. Se o feedback disser para corrigir uma expressão, substitua-a literalmente pela expressão corrigida; se recomendar uma formulação entre aspas, use exatamente essa formulação. Depois confira que nenhuma expressão incorreta apontada continua no roteiro.\nFEEDBACK DO EDITOR-CHEFE (corrija isto na sua nova versão): ${editorFeedback}`;
}

function narrativeSectionCount(targetWords) {
  const words = Number.isSafeInteger(targetWords) && targetWords > 0 ? targetWords : 0;
  return Math.max(3, Math.min(5, Math.round(words / 200)));
}

function scriptGenerationRequestOptions(model, targetWords) {
  const words = Number.isSafeInteger(targetWords) && targetWords > 0 ? targetWords : 0;
  const requestedTokens = Math.max(SCRIPT_GENERATION_MIN_TOKENS, Math.ceil(words * 6));
  const configuredCap = Number.isSafeInteger(model?.maxTokens) && model.maxTokens > 0 ? model.maxTokens : 10000;
  return {
    stream: false,
    max_tokens: Math.min(configuredCap, requestedTokens),
    ...(model?.reasoningEffort ? { reasoning_effort: model.reasoningEffort } : {}),
    ...(Number.isSafeInteger(model?.reasoningBudget) ? { reasoning_budget: model.reasoningBudget } : {})
  };
}

function scriptReviewReasoningOptions(model) {
  if (model === 'z-ai/glm-5.3') {
    return { reasoning_effort: 'low', chat_template_kwargs: { clear_thinking: true } };
  }
  if (model === 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning') return { reasoning_budget: 512 };
  if (model === 'nvidia/nemotron-3.5-lightning-30b-a3b') return { reasoning_budget: 512 };
  if (model === 'z-ai/glm-5.3-flash') {
    return { reasoning_effort: 'low', chat_template_kwargs: { clear_thinking: true } };
  }
  if (model === 'nvidia/nemotron-3-super-120b-a12b') {
    return { reasoning_effort: 'low' };
  }
  if (model === 'nvidia/nemotron-3-ultra-550b-a55b') return { reasoning_effort: 'medium' };
  return {};
}

function scriptReviewRequestOptions(model) {
  return {
    stream: false,
    max_tokens: SCRIPT_REVIEW_MAX_TOKENS,
    ...scriptReviewReasoningOptions(model)
  };
}

function scriptReviewTimeoutMs(model) {
  if (model === 'z-ai/glm-5.3' || model === 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning') return 60_000;
  if (model === 'z-ai/glm-5.3-flash' || model === 'nvidia/nemotron-3-ultra-550b-a55b') return 180_000;
  if (model === 'nvidia/nemotron-3.5-lightning-30b-a3b'
    || model === 'nvidia/nemotron-3-super-120b-a12b') return 120_000;
  return 90_000;
}

function shouldTryAlternativeCoverage(context) {
  const value = String(context || '').replace(/\s+/g, ' ').trim();
  return value.length < DEFAULT_MINIMUM_CONTEXT_CHARS || countWords(value) < DEFAULT_MINIMUM_CONTEXT_WORDS;
}

function automaticReviewFailure(review, automatic) {
  if (!automatic || review?.status === 'approved') return null;
  return review?.status === 'rejected' ? 'source_claims_unverified' : 'publication_review_unavailable';
}

function scriptGateFailure(review, automatic, hookWordCount, { sourceEligible = false } = {}) {
  // A source-backed narrative plan cannot be built with a rejected review,
  // even for manual runs. Stop before generating TTS or screenshots.
  const reviewFailure = automaticReviewFailure(review, automatic || sourceEligible);
  if (reviewFailure) return reviewFailure;
  return isHookWordCountValid(hookWordCount) ? null : 'hook_word_count_out_of_range';
}

function scriptProviderUsageService(provider) {
  const normalized = String(provider || '').trim().replace(/[^A-Za-z0-9_.-]/g, '-');
  if (!normalized) throw new TypeError('provedor de roteiro inválido para o contador de chamadas');
  return normalized === 'nvidia' ? 'nvidia' : `script-${normalized}`;
}

function reviewScriptDeterministically(script, sourceContext, sourceAgeHours) {
  const resolvedEvidence = resolveScriptEvidenceIds(script, sourceContext);
  script = resolvedEvidence.script;
  const localFeedback = [];
  const sections = Array.isArray(script?.sections) ? script.sections : script?.mainContent?.sections || [];
  const conclusion = typeof script?.conclusion === 'string' ? script.conclusion : script?.conclusion?.finalThought;
  const languageUnits = [script?.title, ...splitSentences(script?.hook),
    ...sections.flatMap(section => [section?.title, ...splitSentences(section?.content)]),
    ...splitSentences(conclusion)].filter(Boolean);
  if (languageUnits.some(isEnglish)) {
    localFeedback.push('Todo o título, gancho, seções e conclusão deve estar em português do Brasil. Traduza o título que ainda estiver no idioma da fonte.');
  }
  if (hasStaleRelativeFreshnessWording(script, sourceAgeHours)) {
    localFeedback.push('Remova referências relativas de atualidade que já venceram; use a data da reportagem ou omita a referência temporal.');
  }
  if (hasUnsupportedSingleFunderTitle(script.title, sourceContext)) {
    localFeedback.push('O título atribui sozinho um valor que a fonte apresenta como financiamento conjunto; identifique a parceria ou remova o valor.');
  }
  const scopeFeedback = findPreclinicalScopeViolation(script, sourceContext);
  if (scopeFeedback) localFeedback.push(scopeFeedback);
  const hookWordCount = countHookWords(typeof script?.hook === 'string' ? script.hook : '');
  if (!isHookWordCountValid(hookWordCount)) {
    localFeedback.push(`Ajuste o gancho para 7–12 palavras; o atual tem ${hookWordCount}.`);
  }
  const verification = verifyScriptEvidence(script, sourceContext);
  if (resolvedEvidence.repairs.length) verification.literalCitationRepairs = resolvedEvidence.repairs;
  if (resolvedEvidence.errors.length || localFeedback.length) {
    verification.errors = [...verification.errors, ...resolvedEvidence.errors,
      ...localFeedback.map((message, index) => ({ path: `local-rule-${index + 1}`, code: 'local_script_rule_failed', message }))]
      .filter((error, index, errors) => errors.findIndex(item => item.path === error.path && item.code === error.code) === index);
    verification.status = 'rejected';
    verification.verdict = 'reprovado';
    verification.feedback = [localFeedback.join(' '), feedbackForEvidenceErrors(verification.errors.filter(e => e.code !== 'local_script_rule_failed'))].filter(Boolean).join(' ');
  }
  if (verification.errors.length) {
    const affected = new Set(verification.errors.map(error => error.path));
    const selected = (script.claimEvidence || []).filter(item => affected.has(item.path));
    verification.feedback += ` Evidências atuais dos caminhos reprovados: ${JSON.stringify(selected)}. Corrija o texto ou a referência para corresponder à fonte.`;
  }
  return { ...verification, reviewer: VERIFIER_ID, verification };
}

function hasUnsupportedSingleFunderTitle(title, sourceContext) {
  const source = normalizeEvidenceText(sourceContext);
  const headline = normalizeEvidenceText(title);
  const sourceDescribesJointFunding = /\b(partnership|combined|joint|parceria|conjunto)\b/.test(source)
    && /\b(funding|funds|resources|financing|financiamento|recursos|aporte)\b/.test(source);
  const headlineClaimsAmount = /\b(invest\w*|aporte|aporta\w*|financia\w*|destina\w*|funding)\b/.test(headline)
    && /(\bus\$\s*\d+(?:[.,]\d+)?|\$\s*\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s*(?:milhoes?|million|m)\b)/.test(headline);
  const headlineAcknowledgesJointFunding = /\b(parceria|conjunt\w*|combinad\w*|em conjunto|anthropic|openai)\b/.test(headline);
  return sourceDescribesJointFunding && headlineClaimsAmount && !headlineAcknowledgesJointFunding;
}

function scriptFailureDisablesProvider(error) {
  // Authentication, billing and quota errors affect the provider. A model
  // timeout/5xx can be isolated to that model; bounded fallback must still run.
  const status = Number(error?.status);
  return [401, 402, 403, 429].includes(status)
    || /resource_exhausted|quota|rate.?limit|budget.?exhausted/i.test(`${error?.code || ''} ${error?.message || ''}`)
    || /econnrefused|eai_again|enotfound/i.test(String(error?.code || ''));
}

function scriptGenerationModelsForRetry(excludeModels = [], preferredModel = null) {
  const excluded = new Set(Array.isArray(excludeModels) ? excludeModels.map(model => String(model)) : []);
  const alternatives = SCRIPT_GENERATION_MODELS.filter(model => !excluded.has(model.id));
  const originalWriters = SCRIPT_GENERATION_MODELS.filter(model => excluded.has(model.id));
  // Prefer a different writer for factual repair, but keep the original as the
  // final fallback when every alternative times out. The independent review
  // gate still decides whether the repaired script can render or publish.
  const ordered = [...alternatives, ...originalWriters];
  // An edit can use the writer that just responded; factual reviewers remain
  // independent. Do not wait through unavailable alternatives on every edit.
  return [...ordered.filter(model => model.id === preferredModel),
    ...ordered.filter(model => model.id !== preferredModel)];
}

// A successful writer can make a bounded repair to its own draft; a local
// deterministic evidence verifier still rejects any unsupported statement.
function repairExcludedWriters(attemptedModels, preferredModel) {
  return [...attemptedModels].filter(model => model !== preferredModel);
}

/** Builds only routes whose credentials exist; a provider key is never guessed from API_KEY. */
function scriptGenerationCandidatesForRetry({
  excludeModels = [],
  preferredModel = null,
  environment = process.env,
  disabledProviders = [],
  externalProviders = []
} = {}) {
  const disabled = new Set(disabledProviders);
  const excluded = new Set(Array.isArray(excludeModels) ? excludeModels.map(String) : []);
  const candidates = [];

  if (environment.NVIDIA_API_KEY && !disabled.has('nvidia')) {
    candidates.push(...scriptGenerationModelsForRetry(excludeModels, null)
      .map(model => ({ ...model, provider: 'nvidia', model: model.id })));
  }
  if (environment.GEMINI_API_KEY && !disabled.has('gemini')) {
    candidates.push(...SCRIPT_GEMINI_FALLBACK_MODELS.map((model, index) => ({
      id: model,
      model,
      provider: 'gemini',
      timeoutMs: index === 1 ? 120_000 : 90_000,
      maxTokens: 8192
    })));
  }
  for (const [provider, preset] of Object.entries(PROVIDERS)) {
    if (provider === 'nvidia' || !environment[preset.envKey] || disabled.has(provider)) continue;
    candidates.push(...preset.models.map((model, index) => ({
      id: `${provider}:${model}`,
      model,
      provider,
      timeoutMs: index === 0 ? 120_000 : 90_000
    })));
  }
  for (const provider of externalProviders) {
    const routeId = `${provider?.route || 'opencode'}:${provider?.id}`;
    if (!provider?.id || !Array.isArray(provider.models) || disabled.has(routeId)) continue;
    candidates.push(...provider.models.map((model, index) => ({
      id: `${routeId}:${model}`,
      model,
      provider: routeId,
      timeoutMs: index === 0 ? 120_000 : 90_000
    })));
  }

  const unique = candidates.filter((candidate, index, all) =>
    !excluded.has(candidate.id)
    && !excluded.has(candidate.model)
    && all.findIndex(other => other.id === candidate.id) === index);
  const preferredId = unique.find(candidate => candidate.id === preferredModel
    || `${candidate.provider}:${candidate.model}` === preferredModel)?.id;
  return [
    ...unique.filter(candidate => candidate.id === preferredId),
    ...unique.filter(candidate => candidate.id !== preferredId)
  ];
}

/** Builds independent fact reviewers only for providers with explicit keys. */
function scriptReviewCandidatesForRetry({ environment = process.env, disabledProviders = [] } = {}) {
  const disabled = new Set(disabledProviders);
  const candidates = [];
  if (environment.NVIDIA_API_KEY && !disabled.has('nvidia')) {
    candidates.push(...SCRIPT_REVIEW_MODELS.map(model => ({
      id: `nvidia:${model}`,
      model,
      provider: 'nvidia',
      timeoutMs: scriptReviewTimeoutMs(model)
    })));
  }
  if (environment.GEMINI_API_KEY && !disabled.has('gemini')) {
    candidates.push(...SCRIPT_GEMINI_FALLBACK_MODELS.map((model, index) => ({
      id: `gemini:${model}`,
      model,
      provider: 'gemini',
      timeoutMs: index === 1 ? 120_000 : 90_000
    })));
  }
  for (const [provider, preset] of Object.entries(PROVIDERS)) {
    if (provider === 'nvidia' || !environment[preset.envKey] || disabled.has(provider)) continue;
    candidates.push(...preset.models.map((model, index) => ({
      id: `${provider}:${model}`,
      model,
      provider,
      timeoutMs: index === 0 ? 120_000 : 90_000
    })));
  }
  return candidates.slice(0, SCRIPT_GENERATION_MAX_CALLS);
}

function buildScriptRepairTasks(script, context, sourceAgeHours) {
  const { scriptClaims } = require('../utils/deterministic-script-review');
  const claims = new Map(scriptClaims(script).map(item => [item.path, item.claim]));
  const resolved = resolveScriptEvidenceIds(script, context);
  const review = reviewScriptDeterministically(script, context, sourceAgeHours);
  const errors = [...review.verification.errors];
  // A global freshness warning also needs concrete editable paths. Otherwise
  // a writer repairing the listed factual fields can leave stale "hoje/agora"
  // in a different, factually supported sentence through both repairs.
  if (hasStaleRelativeFreshnessWording(script, sourceAgeHours)) {
    for (const [claimPath, text] of claims) {
      if (/\.title$/.test(claimPath)) continue;
      if (hasStaleRelativeFreshnessWording({ title: text }, sourceAgeHours)) {
        errors.push({ path: claimPath, code: 'stale_relative_freshness' });
      }
    }
  }
  return [...new Set(errors.map(error => error.path))].filter(claimPath => claims.has(claimPath)).map(claimPath => {
    const evidence = resolved.script.claimEvidence?.find(item => item.path === claimPath);
    return { path: claimPath, editPath: claimPath.replace(/#\d+$/, ''), text: claims.get(claimPath) || '',
      errors: errors.filter(error => error.path === claimPath).map(error => error.code),
      sourceIds: evidence?.sourceIds || [], currentQuote: evidence?.quote || '' };
  });
}

function buildScriptRepairPrompt({ script, feedback, topic, context, sourceAgeHours, sourceCatalog = buildSourceEvidenceCatalog(context) }) {
  return `Você é editor de roteiros em português do Brasil. Corrija o ROTEIRO ATUAL abaixo para a pauta "${topic}". O texto da fonte é a única base factual; o roteiro atual é um rascunho, não uma fonte.
CATÁLOGO IMUTÁVEL DA FONTE (cada ID aponta para um trecho literal; não invente nem altere IDs):
${renderSourceEvidenceCatalog(sourceCatalog)}
${buildSourceFreshnessGuidance(sourceAgeHours)}
${factRepairGuidance(feedback)}
TAREFAS OBRIGATÓRIAS POR CAMPO (geradas pelo verificador local; corrija todos os editPath, sem repetir caminhos):
${JSON.stringify(buildScriptRepairTasks(script, context, sourceAgeHours))}
Para números/causas sem apoio, retire a alegação ou escolha uma citação que realmente a sustente. Não mantenha sinônimos quando o erro pedir palavras da fonte. IDs não consecutivos não formam uma citação: divida a conclusão em frases separadas, cada uma com seu sourceId, ou escolha um único trecho. Uma correção de content deve preservar as demais frases corretas da seção e fornecer evidência para cada frase.
Se um ID contém outra oração de propósito experimental, pode usar sourceQuote: copie a sentença completa ou somente a oração inicial antes de "para testar/avaliar/medir/investigar" ou "to test/evaluate/measure/investigate", com 4–80 palavras literais no idioma original. Recortes arbitrários são rejeitados; não recorte negação, condição, incerteza nem escala. Exemplo de formato: {"text":"fala em português", "sourceIds":["S002"], "sourceQuote":"oração completa literal da fonte no idioma original"}. sourceQuote é evidência, nunca narração.
Faça uma edição pontual do roteiro atual, aplicando todas as correções do editor. Preserve os trechos corretos, a ordem e os campos existentes; não reescreva o assunto do zero nem substitua o texto por outro resumo. Remova uma alegação sem suporte se não houver correção sustentada. Preserve as correções já presentes na versão atual e não acrescente fatos, números, exemplos ou conclusões. Não transforme possibilidade em certeza.
Confira título, gancho, seções e conclusão. O gancho precisa ter 7–12 palavras e uma promessa sustentada pela fonte. Não acrescente "hoje", "agora" ou outra referência de atualidade. O texto falado permanece em PT-BR; preserve os imagePrompt em inglês dos trechos mantidos.
ROTEIRO ATUAL A CORRIGIR: ${JSON.stringify(script)}
Responda SOMENTE JSON: {"edits":[{"path":"hook","value":{"text":"gancho corrigido em sete a doze palavras?","sourceIds":["S001"]}},{"path":"sections.0.content","value":[{"text":"Frase corrigida completa.","sourceIds":["S002"]}]}]}. Caminhos permitidos: title, hook, conclusion, sections.N.title e sections.N.content. Cada valor deve trazer text e sourceIds; content e conclusion aceitam listas de frases completas. Não escreva nem conte caminhos #N: o compilador gera o mapa de evidências e preserva os campos não alterados. Para corrigir apenas uma evidência, repita o texto correto com os IDs corrigidos. Use somente IDs existentes. Não devolva imagePrompt, emoção nem outros campos. PT-BR e JSON sem markdown.`;
}

function productionMotionVisualGuidance() {
  return `MOTION GRAPHICS NA PRODUÇÃO: para um processo ou sequência de 2 a 4 etapas explicitamente narradas, inclua visual={"type":"node-graph","nodes":["etapa 1","etapa 2"],"cue":"frase completa e literal da narração"}; use nomes presentes no texto e não invente conexões ou causalidade. Para uma comparação de duas ou mais medidas numéricas com a mesma unidade sustentadas explicitamente pela fonte, inclua visual={"type":"metric-compare","title":"...","unitLabel":"...","sourceLabel":"Fonte: ...","items":[{"label":"...","value":8,"unit":"B","cue":"frase literal da narração"}]}; cada cue sincroniza a entrada da barra com a fala. A unidade pode estar omitida no segundo número quando a frase a compartilha claramente, como “4 GPUs para prefill e 64 para decode”; nesse caso mantenha a mesma unidade e cues literais separados para os dois valores. Só inclua rótulo, valor, unidade e relações presentes na fonte. Pontuações só podem usar score-compare se forem notas comparáveis publicadas. Não fabrique números, pontuações, rankings, relações nem etapas; se o conteúdo não sustentar um gráfico ou diagrama, omita visual. O renderizador anima essas estruturas sincronizado à narração.`;
}

async function writeScriptWithNvidia({ topic, targetWords, context, extraFeedback, theme, sourceAgeHours, formatId, excludeModels = [], attemptedModels = new Set(), draft = null, preferredModel = process.env.SCRIPT_WRITER_PREFERRED_MODEL || null, callBudget = { remaining: SCRIPT_GENERATION_MAX_CALLS } }) {
  // Cada episódio tem no máximo 11 chamadas reais: a inicial e até 10 fallbacks.
  const { reserveCall, usedToday } = require('../utils/api-usage');
  const configuredNvidiaLimit = Number(process.env.NVIDIA_CALLS_PER_DAY || 200);
  const nvidiaLimit = Number.isSafeInteger(configuredNvidiaLimit) && configuredNvidiaLimit > 0 ? configuredNvidiaLimit : 200;
  const disabledProviders = new Set();
  if (process.env.NVIDIA_API_KEY && await usedToday('nvidia') >= nvidiaLimit) disabledProviders.add('nvidia');
  const externalProviders = loadConfiguredOpenCodeProviders();
  if (!process.env.MIMO_API_KEY) {
    const mimoCodeProvider = loadConfiguredMimoCodeProvider();
    if (mimoCodeProvider) externalProviders.push(mimoCodeProvider);
  }
  const modelCandidates = scriptGenerationCandidatesForRetry({
    excludeModels,
    preferredModel,
    disabledProviders,
    externalProviders
  });
  if (!modelCandidates.length) {
    throw Object.assign(new Error('Nenhum provedor de roteiro configurado com cota local disponível'), {
      code: 'NO_SCRIPT_PROVIDER_CONFIGURED'
    });
  }

  const sourceWords = countWords(context);
  if (context && sourceWords < 150) {
    throw Object.assign(new Error('source_context_too_short_for_narrative'), { code: 'SOURCE_CONTEXT_TOO_SHORT_FOR_NARRATIVE' });
  }
  const narrativeTargetWords = extraFeedback
    ? factRepairWordTarget(targetWords, context)
    : sourceBoundedWordTarget(targetWords, context);
  const freshnessGuidance = buildSourceFreshnessGuidance(sourceAgeHours);
  const sourceCatalog = buildSourceEvidenceCatalog(context);
  const sourceBlock = context
    ? `PAUTA: "${topic}". A ÚNICA BASE FACTUAL deste roteiro é o catálogo literal abaixo. Não atribua esta matéria a um veículo diferente do informado nos dados.${freshnessGuidance}\nCATÁLOGO IMUTÁVEL DA FONTE (IDs para referenciar cada alegação):\n${renderSourceEvidenceCatalog(sourceCatalog)}`
    : `Tema atual: "${topic}".`;

  const visualRule = `DADOS VISUAIS: "visual" é opcional somente quando a seção não sustentar um gráfico ou diagrama. Para cada processo/etapas ou comparação numérica explicitamente sustentados pela fonte, escolha o visual correspondente sem acrescentar fatos. Nunca invente notas, pontuações, rankings, valores ou relações. ${productionMotionVisualGuidance()}`;
  const formatGuidance = editorialFormatPrompt(formatId);
  const growthGuidance = audienceGrowthGuidance(theme?.id);

  const persona = theme?.persona || 'roteirista de um canal de YouTube em PORTUGUÊS DO BRASIL sobre tecnologia/atualidades';
  const sectionCount = narrativeSectionCount(narrativeTargetWords);
  const sectionWordTarget = Math.max(1, Math.round(narrativeTargetWords / sectionCount));
  const prompt = draft ? buildScriptRepairPrompt({ script: draft, feedback: extraFeedback, topic, context, sourceAgeHours, sourceCatalog }) : `Você é ${persona}.
${sourceBlock}
${formatGuidance}
${growthGuidance}
Escreva um roteiro narrado com cerca de ${narrativeTargetWords} palavras (aprox. ${Math.max(1, Math.round(narrativeTargetWords / 150))} minutos). A duração é secundária à precisão: se a fonte não sustentar o tamanho pedido, entregue menos texto em vez de completar com fatos externos.
IDIOMA — REGRA INVIOLÁVEL: TODO o conteúdo (title, hook, sections, conclusion) deve estar 100% em PORTUGUÊS DO BRASIL. Se o tema/artigo estiver em inglês, TRADUZA e ADAPTE para PT-BR. É PROIBIDO escrever qualquer parte em inglês.
ESTRUTURA — RETENÇÃO COM PAYOFF: o hook deve ter 7–12 palavras, ser específico e criar uma pergunta mental ou consequência concreta que a fonte responda; nunca prometa algo que o vídeo não responde. Sem saudação, apresentação do canal ou frases como "você não vai acreditar". Até 15 segundos, explique por que o assunto importa. Cada seção acrescenta informação sustentada pela fonte e fecha com uma ponte curta. Use exemplos concretos apenas quando estiverem na fonte; analogias inventadas devem ser identificadas como hipotéticas e não podem introduzir números, locais ou comportamentos como fatos. Plante perguntas e responda dentro do vídeo; não empilhe cliffhangers.
${hookStructureGuidance(topic)}
RITMO DE FALA: alterne frases curtas e médias, corte contexto óbvio e repetições. A cada seção, mude o foco visual sem encurtar artificialmente a cena. Não force suspense em temas leves, nem dramatize fatos sem evidência. A conclusão paga a promessa do hook e termina com CTA natural de uma frase.
REGRAS FACTUAIS: cada número, data, citação, causa, comportamento atribuído a um grupo, detalhe técnico, exemplo real ou promessa precisa estar explícito no texto da fonte. Não use conhecimento externo como fato, nem acrescente marcas, projetos, cidades, práticas ou efeitos que a fonte não menciona. Não transforme percentuais de consumidores em percentuais de compras. Não infira causalidade a partir de correlação. Se o valor for conjunto entre parceiros, não atribua o total a uma única organização. Evite conclusões como "mudança de paradigma", "garante acesso" ou "o futuro será" sem declaração explícita da fonte. Se não houver conteúdo suficiente, faça um roteiro curto e direto.
DATA DE REFERÊNCIA EDITORIAL: ${new Date().toLocaleDateString('pt-BR')}. Nunca narre uma entrevista, prazo ou evento passado como futuro/próximo. Em listas de vagas, diferencie data de publicação, data de entrevista e validade da vaga; só diga que uma vaga continua aberta ou que a pessoa deve comparecer se a fonte confirmar. Não adicione dicas genéricas de currículo/entrevista, recomendações, promessa de emprego ou afirmações sobre impacto na carreira.
Regras: fala natural em PT-BR (sem "Seção 1"), explicação clara e contexto correto. ${visualRule}${extraFeedback ? `\n\n${factRepairGuidance(extraFeedback)}` : ''}
Responda SOMENTE JSON válido e COMPLETO: {"title":{"text":"...","sourceIds":["S001"]},"hook":{"text":"...","sourceIds":["S002"]},"hookEmotion":"curiosity","sections":[{"title":{"text":"...","sourceIds":["S003"]},"content":[{"text":"Frase completa sustentada pela fonte.","sourceIds":["S004"]}],"emotion":"curiosity","imagePrompt":"..."}],"conclusion":[{"text":"Conclusão sustentada pela fonte.","sourceIds":["S005"]}]}. Exatamente ${sectionCount} seções, cerca de ${sectionWordTarget} palavras por seção e ${narrativeTargetWords} palavras no total, sem preencher com fatos externos. Cada frase deve trazer sua evidência junto ao texto. Para processos narrados, visual opcional {"type":"node-graph","nodes":["etapa 1","etapa 2"],"cue":"frase literal da narração"}. Para medidas comparáveis: visual={"type":"metric-compare","items":[{"label":"...","value":8,"unit":"B","cue":"frase literal da narração"}]}. Somente dados sustentados pela fonte. Emoção: curiosity, surprise, tension, empathy, wonder ou confidence.
OBRIGATÓRIO em cada seção: imagePrompt em inglês, 25–45 palavras, descrevendo uma ação ou transformação visual concreta que traduza o trecho narrado em cena. Faça a cena evoluir com os fatos da seção (por exemplo, envio pode mostrar um dispositivo de origem, um pacote de dados em trânsito e o dispositivo receptor, somente se esses elementos forem sustentados pelo trecho). Pessoas anônimas só podem aparecer quando a narração sustentar explicitamente a pessoa ou ação; nunca retrate o mascote nesse campo, pois ele é renderizado separadamente. Telas e mensagens devem ser abstratas e ilegíveis, sem texto inventado, marcas, nomes, instituições ou detalhes não narrados. Uma única cena contínua com foco claro; nunca colagem, tela dividida, díptico ou comparação lado a lado. Evite arte abstrata e cenário futurista genérico.
Nunca use markdown (sem asteriscos, _, #) no texto falado.
EVIDÊNCIA OBRIGATÓRIA: todos os campos editoriais usam {text, sourceIds}; content e conclusion são listas desses blocos. Use uma sentença completa por bloco, com pontuação final. Escolha um ID que sustente aquela frase; IDs consecutivos só quando necessários. Não forneça claimEvidence nem caminhos #N: o compilador gera esse mapa. Preserve números, negação, incerteza e limites da fonte. Se nenhum trecho sustentar a alegação, remova-a ou reformule-a. sourceQuote opcional aceita a sentença completa do ID ou sua oração inicial antes de um propósito experimental explícito (para testar/avaliar/medir/investigar; to test/evaluate/measure/investigate), com 4–80 palavras literais no idioma original. Outros recortes são rejeitados; não corte condição, negação, incerteza nem escala. sourceQuote é evidência, não texto falado. Evite juntar fatos distantes no título/gancho/conclusão: prefira uma afirmação sustentada por um único trecho. A verificação de evidências é local.`;

  const generationFailureTags = [];
  let languageStrikes = 0;
  const generated = await callWithModelFallback({
    models: modelCandidates,
    request: modelConfig => withScriptValidationRetry(async validationFeedback => {
      const { provider, model: apiModel, timeoutMs } = modelConfig;
      if (disabledProviders.has(provider)) {
        throw Object.assign(new Error(`provedor ${provider} indisponível nesta execução`), { code: 'SCRIPT_PROVIDER_UNAVAILABLE' });
      }
      // A single episode shares a bounded budget across writer/validation/repairs.
      if (callBudget.remaining <= 0) throw Object.assign(new Error('script_call_budget_exhausted'), { code: 'SCRIPT_CALL_BUDGET_EXHAUSTED' });
      const usageService = scriptProviderUsageService(provider);
      const providerLimitKey = `${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_CALLS_PER_DAY`;
      const configuredProviderLimit = Number(process.env[providerLimitKey] || process.env.AI_PROVIDER_CALLS_PER_DAY || 200);
      const providerLimit = Number.isSafeInteger(configuredProviderLimit) && configuredProviderLimit > 0 ? configuredProviderLimit : 200;
      try {
        // Reservar somente no provedor que será chamado; quota NVIDIA não bloqueia os demais.
        await reserveCall(usageService, provider === 'nvidia' ? nvidiaLimit : providerLimit, {
          jobId: JOB_ID,
          operation: draft ? 'script-repair' : 'script-generation'
        });
      } catch (error) {
        if (error?.code !== 'BUDGET_EXHAUSTED') throw error;
        disabledProviders.add(provider);
        throw Object.assign(error, { code: 'SCRIPT_PROVIDER_BUDGET_EXHAUSTED' });
      }
      attemptedModels.add(modelConfig.id);
      callBudget.remaining--;
      const enforce = languageStrikes > 0
        ? '\n\nATENÇÃO: sua resposta anterior saiu em INGLÊS. Responda obrigatoriamente em PORTUGUÊS DO BRASIL.'
        : '';
      let response;
      if (provider === 'nvidia') {
        const res = await requestNvidiaChatCompletion({
          apiKey: process.env.NVIDIA_API_KEY,
          timeoutMs,
          body: {
            model: apiModel,
            messages: [{ role: 'user', content: prompt + enforce + validationFeedback }],
            ...scriptGenerationRequestOptions(modelConfig, narrativeTargetWords),
            temperature: 0.4
          }
        });
        if (!res.ok) {
          const error = new Error(`NVIDIA HTTP ${res.status}`);
          error.status = res.status;
          throw error;
        }
        response = parseScriptChoice((await res.json()).choices?.[0]);
      } else {
        let credentials;
        if (provider === 'gemini') {
          credentials = { gemini: { apiKey: process.env.GEMINI_API_KEY, model: apiModel, timeoutMs } };
        } else if (provider.startsWith('opencode:') || provider.startsWith('mimocode:')) {
          const [route, id] = provider.split(':');
          const configured = route === 'opencode'
            ? getConfiguredOpenCodeProvider(id)
            : getConfiguredMimoCodeProvider();
          if (!configured) throw Object.assign(new Error('configured_opencode_provider_unavailable'), { code: 'OPENCODE_PROVIDER_UNAVAILABLE' });
          credentials = { aiProvider: {
            provider: 'openai-compatible',
            apiKey: configured.apiKey,
            baseURL: configured.baseURL,
            name: configured.name,
            model: apiModel,
            timeoutMs
          } };
        } else {
          const preset = PROVIDERS[provider];
          if (!preset) throw Object.assign(new Error('configured_ai_provider_unavailable'), { code: 'AI_PROVIDER_UNAVAILABLE' });
          credentials = { aiProvider: { provider, apiKey: process.env[preset.envKey], model: apiModel, timeoutMs } };
        }
        const service = new AITextService(credentials);
        const text = await service.generateText(prompt + enforce + validationFeedback, {
          model: apiModel,
          maxTokens: scriptGenerationRequestOptions(modelConfig, narrativeTargetWords).max_tokens,
          temperature: 0.4
        });
        response = parseScriptChoice({ message: { content: text } });
      }
      const script = draft ? applyScriptRepair(draft, response) : compileScriptEvidenceBlocks(response);
      // Guard de idioma: roteiro em inglês é reprovado na hora.
      const languageUnits = [script.title, script.hook, ...(script.sections || []).flatMap(section => [section.title, section.content]), script.conclusion];
      if (languageUnits.some(isEnglish)) {
        languageStrikes++;
        throw Object.assign(new Error(`roteiro saiu em inglês (strike ${languageStrikes})`), { code: 'SCRIPT_LANGUAGE_MISMATCH' });
      }
      return script;
    }, error => console.warn(`      ${modelConfig.id}: corrigindo resposta inválida uma vez (${safeErrorTag(error)})`)),
    onFailure: (config, error) => {
      const failureTag = safeErrorTag(error);
      generationFailureTags.push(failureTag);
      if (scriptFailureDisablesProvider(error)) {
        disabledProviders.add(config.provider);
      }
      console.warn(`      ${config.id} falhou (${failureTag}); tentando próximo modelo`);
    }
  });
  if (generated) {
    console.log(`      roteiro gerado com ${generated.model}`);
    return { script: generated.value, model: generated.model };
  }
  const unavailable = new Error('SCRIPT_GENERATION_UNAVAILABLE');
  unavailable.code = 'SCRIPT_GENERATION_UNAVAILABLE';
  unavailable.failureTags = [...new Set(generationFailureTags)];
  throw unavailable;
}

// Normalize the NVIDIA script to the shape the renderer expects.
function normalizeEvidenceText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function visualItemIsSourceGrounded(item, sourceContext) {
  if (item?.value != null) {
    const labelTokens = normalizeEvidenceText(item?.label).match(/[a-z0-9]+/g)?.filter(token => token.length >= 2) || [];
    const value = Number(item.value);
    const unit = String(item.unit || '').trim();
    const source = String(sourceContext || '');
    if (!labelTokens.length || !Number.isFinite(value) || value < 0 || !/^[a-z%]{1,8}$/i.test(unit) || !source.trim()) return false;
    const normalizedSource = normalizeEvidenceText(source);
    const number = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\./g, '[.,]');
    const unitPattern = unit.split('').map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
    const valuePattern = new RegExp(`(?<![\\d])${number}\\s*${unitPattern}(?![\\p{L}\\d])`, 'iu');
    return labelTokens.every(token => normalizedSource.includes(token)) && valuePattern.test(normalizedSource);
  }
  const labelTokens = normalizeEvidenceText(item?.label)
    .match(/[a-z0-9]+/g)
    ?.filter(token => token.length >= 3) || [];
  const score = Number(item?.score);
  if (!labelTokens.length || !Number.isFinite(score) || !String(sourceContext || '').trim()) return false;

  const integer = Math.trunc(Math.abs(score));
  const fraction = Math.round((Math.abs(score) - integer) * 10);
  const scorePattern = fraction
    ? new RegExp('(?<![\\\\d])' + integer + '[.,]' + fraction + '(?![\\\\d])')
    : new RegExp('(?<![\\\\d])' + integer + '(?![\\\\d])');
  const sentences = String(sourceContext).split(/(?<=[.!?])\s+|[;\n]+/);
  return sentences.some(sentence => {
    const normalized = normalizeEvidenceText(sentence);
    return labelTokens.every(token => normalized.includes(token)) && scorePattern.test(sentence);
  });
}

function stripUnsupportedScriptVisuals(script, sourceContext = '') {
  const sections = Array.isArray(script?.sections)
    ? script.sections
    : Array.isArray(script?.mainContent?.sections) ? script.mainContent.sections : [];
  for (const section of sections) {
    if (!section?.visual || !Array.isArray(section.visual.items) || section.visual.items.length < 2) continue;
    const metric = section.visual.type === 'metric-compare';
    const supported = section.visual.items.every(item => visualItemIsSourceGrounded(item, sourceContext)
      && (!metric || findNarrationCueOffset(item.cue, [{ text: section.content }]) !== null));
    if (!supported || (metric && normalizeMetricComparisonItems(section.visual.items).length < 2)) section.visual = null;
  }
  return script;
}

function normalizeSectionVisual(section, sourceContext, content) {
  const visual = section?.visual;
  if (visual?.type === 'node-graph' && Array.isArray(visual.nodes)) {
    const nodes = visual.nodes.map(node => cleanText(node)).filter(Boolean).slice(0, 4);
    const cue = cleanText(visual.cue || '');
    const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
    const sectionText = fold(content);
    const grounded = nodes.length >= 2 && cue && fold(cue).split(' ').every(word => sectionText.includes(word))
      && nodes.every(node => sectionText.includes(fold(node)));
    return grounded ? { type: 'node-graph', nodes, cue } : null;
  }
  if (!visual || !Array.isArray(visual.items) || visual.items.length < 2
    || !visual.items.every(item => visualItemIsSourceGrounded(item, sourceContext))
    || (visual.type === 'metric-compare'
      && (normalizeMetricComparisonItems(visual.items).length < 2
        || !visual.items.every(item => findNarrationCueOffset(item.cue, [{ text: section?.content }]) !== null)))) {
    return null;
  }
  return visual.type === 'metric-compare'
    ? { ...visual, items: normalizeMetricComparisonItems(visual.items).map(item => ({
        label: cleanText(item.label), value: item.value, unit: item.unit, cue: cleanText(item.cue)
      })) }
    : { ...visual, items: visual.items.map(item => ({ label: cleanText(item.label).slice(0, 18), score: Number(item.score) })) };
}

function normalizeScript(script, sourceContext = '') {
  script.title = cleanText(script.title);
  script.mainContent = {
    sections: (script.sections || []).map(s => ({
      title: cleanText(s.title) || 'Seção',
      content: cleanText(typeof s.content === 'string' ? s.content : JSON.stringify(s.content || '')),
      emotion: normalizeEmotion(s.emotion, `${s.title || ''} ${s.content || ''}`),
      visual: normalizeSectionVisual(s, sourceContext, cleanText(typeof s.content === 'string' ? s.content : JSON.stringify(s.content || ''))),
      imagePrompt: cleanText(s.imagePrompt || '')
    }))
  };
  script.hook = cleanText(typeof script.hook === 'string' ? script.hook : JSON.stringify(script.hook || ''));
  script.hookEmotion = normalizeEmotion(script.hookEmotion, script.hook);
  if (typeof script.conclusion === 'string') script.conclusion = { finalThought: cleanText(script.conclusion) };
  else script.conclusion = { ...script.conclusion, finalThought: cleanText(script.conclusion && script.conclusion.finalThought) };
  script.conclusion.emotion = normalizeEmotion(script.conclusion.emotion, script.conclusion.finalThought);
  return script;
}

// Ledger de temas já usados (compartilhado com o scheduler) — evita repetição.
async function loadUsedTopics() {
  const ledgerPath = path.join(__dirname, '..', process.env.STATE_DIR || 'data/state', 'topics.json');
  try {
    const raw = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) throw new Error('estrutura de entries inválida');
    return collectUsedTopicSignals(raw.entries);
  } catch (error) {
    if (error.code === 'ENOENT') return { titles: [], urls: [] };
    throw new Error(`ledger de pautas ilegível; geração cancelada para evitar repetição: ${error.message}`);
  }
}

async function recordTopic(entry) {
  const ledgerPath = path.join(__dirname, '..', process.env.STATE_DIR || 'data/state', 'topics.json');
  await updateTopicLedger(ledgerPath, raw => {
    raw.entries = raw.entries || [];
    raw.entries.push(createTopicRecord(entry));
    raw.entries = raw.entries.slice(-400);
    return raw;
  });
}

async function loadRecentTopics(days = 7) {
  const ledgerPath = path.join(__dirname, '..', process.env.STATE_DIR || 'data/state', 'topics.json');
  try {
    const raw = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) throw new Error('estrutura de entries inválida');
    const cutoff = Date.now() - days * 86400000;
    return (raw.entries || []).filter(e => new Date(e.generatedAt).getTime() >= cutoff);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`ledger de pautas ilegível; contexto recente indisponível: ${error.message}`);
  }
}

/**
 * Crítico de roteiro — verifica afirmações e estrutura antes de narrar.
 * Falha ou ausência de revisão mantém o material como rascunho não publicável.
 */
async function critiqueScript(script, topic, sourceTitle, sourceUrl, sourceContext, sourceAgeHours, { excludeModels = [] } = {}) {
  const localFeedback = [];
  if (hasStaleRelativeFreshnessWording(script, sourceAgeHours)) {
    localFeedback.push('A fonte foi publicada em outra data local. No roteiro, remova “hoje”, “agora”, “atualmente”, “neste momento” e “nesta/desta [dia da semana]”. Para manter um estado descrito pela fonte, atribua-o com “segundo a reportagem” ou “a matéria relata que”; para evento concluído, use o passado. Preserve a alegação apenas se o texto-fonte a sustentar.');
  }
  if (hasUnsupportedSingleFunderTitle(script.title, sourceContext)) {
    localFeedback.push('O título atribui sozinho à Fundação Simons um valor que a fonte descreve como financiamento e recursos combinados em parceria. Inclua a parceria no título ou retire essa atribuição.');
  }
  const preclinicalScopeFeedback = findPreclinicalScopeViolation(script, sourceContext);
  if (preclinicalScopeFeedback) localFeedback.push(preclinicalScopeFeedback);
  const hookWordCount = countHookWords(typeof script?.hook === 'string' ? script.hook : '');
  if (!isHookWordCountValid(hookWordCount)) {
    localFeedback.push(`Reescreva o gancho com 7–12 palavras (o atual tem ${hookWordCount}); mantenha uma promessa específica que o roteiro responde e que a fonte sustenta.`);
  }
  if (localFeedback.length) return { verdict: 'reprovado', feedback: localFeedback.join(' ') };
  if (process.env.NO_SCRIPT_CRITIC === '1') return null;
  // Sem revisão disponível o roteiro continua como rascunho e não pode ser publicado.
  const { reserveCall, usedToday } = require('../utils/api-usage');
  const nvidiaLimitRaw = Number(process.env.NVIDIA_CALLS_PER_DAY || 200);
  const nvidiaLimit = Number.isSafeInteger(nvidiaLimitRaw) && nvidiaLimitRaw > 0 ? nvidiaLimitRaw : 200;
  const nvidiaRemaining = process.env.NVIDIA_API_KEY
    ? nvidiaLimit - await usedToday('nvidia')
    : 0;
  // The consensus requires two successful reviewers. Avoid starting NVIDIA
  // calls when its local daily budget cannot cover both approvals.
  const disabledProviders = nvidiaRemaining >= 2 ? [] : ['nvidia'];
  const reviewCandidates = scriptReviewCandidatesForRetry({ disabledProviders })
    .filter(candidate => !excludeModels.includes(candidate.model));
  if (!reviewCandidates.length) return null;
  const reviewCandidateById = new Map(reviewCandidates.map(candidate => [candidate.id, candidate]));
  const resumo = JSON.stringify({
    title: script.title,
    hook: script.hook,
    hookEmotion: script.hookEmotion,
    sections: (script.sections || script.mainContent?.sections || []).map(s => ({
      title: s.title, content: s.content, emotion: s.emotion, visual: s.visual
    })),
    conclusion: script.conclusion,
    publicationMetadata: script.publicationMetadata || null
  }).slice(0, 9000);
  const source = String(sourceContext || '').replace(/\s+/g, ' ').trim().slice(0, 16000);
  const freshnessNote = buildSourceFreshnessGuidance(sourceAgeHours);
  const prompt = `Você é editor-chefe e verificador factual de um canal de YouTube em português do Brasil. Avalie o roteiro para a pauta "${topic}".
FONTE PRIMÁRIA: ${sourceTitle || '(título ausente)'}${sourceUrl ? `\nURL: ${sourceUrl}` : ''}
TEXTO EXTRAÍDO DA FONTE: """${source}"""
${freshnessNote}
Compare com a fonte o título, gancho, cada afirmação, número, causalidade, comparação/nota visual e conclusão. APROVE somente se as afirmações específicas do roteiro estiverem sustentadas pelo material acima; contexto genérico não pode introduzir novos fatos, números ou certezas. Preserve negação, dúvida, datas e limites. Se a fonte estiver curta, ambígua ou não sustentar uma afirmação central, REPROVE com correção concreta.
Também verifique PT-BR natural, gancho sem promessa vazia, seções que acrescentam informação e conclusão que paga o gancho. A chamada visual da thumbnail é separada e não faz parte deste roteiro.
Responda SOMENTE JSON: {"verdict":"aprovado"|"reprovado","feedback":"máx. 2 frases com correção concreta; vazio apenas se aprovado"}
ROTEIRO: ${resumo}`;
  let lastFailure = 'no_valid_review';
  const review = await reviewWithModelConsensus({
    models: reviewCandidates.map(candidate => candidate.id),
    requiredApprovals: 2,
    concurrency: SCRIPT_REVIEW_CONCURRENCY,
    timeoutMs: modelId => reviewCandidateById.get(modelId)?.timeoutMs || 90_000,
    request: async (modelId, { signal } = {}) => {
      const candidate = reviewCandidateById.get(modelId);
      if (!candidate) throw Object.assign(new Error('reviewer_route_unavailable'), { code: 'REVIEWER_ROUTE_UNAVAILABLE' });
      const { provider, model } = candidate;
      const usageService = provider === 'nvidia' ? 'nvidia' : `script-review-${provider}`;
      const providerLimitRaw = Number(process.env.AI_PROVIDER_CALLS_PER_DAY || 200);
      const providerLimit = Number.isSafeInteger(providerLimitRaw) && providerLimitRaw > 0 ? providerLimitRaw : 200;
      try {
        await reserveCall(usageService, provider === 'nvidia' ? nvidiaLimit : providerLimit, {
          jobId: JOB_ID,
          operation: 'script-review'
        });
      } catch (error) {
        if (error?.code === 'BUDGET_EXHAUSTED') {
          throw Object.assign(error, { code: 'SCRIPT_PROVIDER_BUDGET_EXHAUSTED' });
        }
        throw error;
      }

      if (provider === 'nvidia') {
        const res = await requestNvidiaChatCompletion({
          apiKey: process.env.NVIDIA_API_KEY,
          timeoutMs: candidate.timeoutMs,
          signal,
          body: {
            model,
            messages: [{ role: 'user', content: prompt }],
            ...scriptReviewRequestOptions(model),
            temperature: 0.2
          }
        });
        if (!res.ok) {
          const error = new Error(`NVIDIA HTTP ${res.status}`);
          error.status = res.status;
          throw error;
        }
        const data = await res.json();
        return parseReviewChoice(data.choices?.[0]);
      }

      const credentials = provider === 'gemini'
        ? { gemini: { apiKey: process.env.GEMINI_API_KEY, model, timeoutMs: candidate.timeoutMs } }
        : { aiProvider: { provider, apiKey: process.env[PROVIDERS[provider].envKey], model, timeoutMs: candidate.timeoutMs } };
      const service = new AITextService(credentials);
      const text = await service.generateText(prompt, {
        model,
        maxTokens: SCRIPT_REVIEW_MAX_TOKENS,
        temperature: 0.2,
        timeoutMs: candidate.timeoutMs,
        signal
      });
      return parseReviewChoice({ message: { content: text } });
    },
    onFailure: (model, error) => {
      lastFailure = safeErrorTag(error);
      console.warn(`      revisor factual ${model} falhou (${lastFailure}); tentando outro modelo independente`);
    }
  });
  if (review) return review;
  if (lastFailure === 'BUDGET_EXHAUSTED') {
    console.log('      crítico indisponível: orçamento diário da NVIDIA esgotado; publicação ficará bloqueada');
  } else {
    console.warn(`      crítico indisponível após fallback de modelos; publicação ficará bloqueada (${lastFailure})`);
  }
  return null;
}

/**
 * SEO dinâmico — título virado para CTR + descrição + hashtags geradas
 * por notícia (nada de descrição/hashtags fixas no scheduler).
 */
async function generateSEO({ script, topic, article, theme, sourceAgeHours }) {
  const key = process.env.NVIDIA_API_KEY;
  if (!key || process.env.NO_SEO === '1') return null;
  // SEO é opcional: sem orçamento sobrando, usa fallback (não bloqueia).
  const { reserveCall } = require('../utils/api-usage');
  const nvidiaLimit = Number(process.env.NVIDIA_CALLS_PER_DAY || 200);
  const freshnessGuidance = buildSourceFreshnessGuidance(sourceAgeHours);
  const modelo = 'nvidia/nemotron-3.5-lightning-30b-a3b';
  // Persona do SEO também segue o tema da instância (réplica).
  const seoPromptPersona = theme?.persona || 'especialista em SEO de YouTube em português do Brasil (canal de notícias de IA)';
  const prompt = `Você é ${seoPromptPersona}.
Pauta: "${topic}"${article && article.source ? ` (fonte: ${article.source})` : ''}${freshnessGuidance}
Título do roteiro: "${script.title}"
Responda SOMENTE JSON: {"youtubeTitle":"título para CTR máximo, até 70 caracteres, português do Brasil, promessa clara sem clickbait mentiroso","thumbnailHeadline":"chamada curta e forte para a capa, 2-5 palavras e até 34 caracteres; use somente termos e afirmações já presentes no título/roteiro, preserve negação e incerteza, sem inventar números, quotes, cenas ou resultado","description":"2-3 frases descrevendo o vídeo + convite de inscrição; sem hashtags no texto","hashtags":"3 hashtags com # separadas por espaço, relevantes à notícia"}
Use conhecimento do conteúdo abaixo para precisão factual:
HOOK: ${String(script.hook).slice(0, 300)}
PRIMEIRA SEÇÃO: ${String(script.mainContent?.sections?.[0]?.content || '').slice(0, 400)}
A capa deve ser específica desta pauta e deste nicho: inclua o nome exato do modelo/produto quando ele for o assunto central, junto do tema ou novidade abordada, sem trocar por uma chamada genérica. Exemplo de estrutura, não de conteúdo a copiar: NOME DO MODELO + ASSUNTO. Desperte curiosidade sem prometer algo que o vídeo não entrega.
A chamada da thumbnail é apenas texto da imagem, não muda roteiro nem vídeo. Se não der para escrever uma chamada curta e fiel usando as palavras do conteúdo, use null.`;
  try {
    await reserveCall('nvidia', nvidiaLimit, { jobId: JOB_ID, operation: 'seo-metadata' });
    const res = await fetchWithTimeout('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelo, messages: [{ role: 'user', content: prompt }], max_tokens: 500, temperature: 0.4 })
    }, 45_000);
    if (!res.ok) throw new Error(`NVIDIA HTTP ${res.status}`);
    const data = await res.json();
    const seo = parseScriptJson(data.choices?.[0]?.message?.content || '');
    // Sanity: título válido em PT-BR (não vazio, não inglês) — senão usa o do roteiro.
    if (!seo.youtubeTitle || isEnglish(seo.youtubeTitle)) seo.youtubeTitle = script.title;
    if (typeof seo.description !== 'string' || seo.description.length < 20) seo.description = null;
    if (typeof seo.hashtags !== 'string' || !/#/.test(seo.hashtags)) seo.hashtags = null;
    return seo;
  } catch (error) {
    if (error.code === 'BUDGET_EXHAUSTED') {
      console.log('      SEO pulado: orçamento diário da NVIDIA esgotado');
      return null;
    }
    console.warn(`      SEO dinâmico falhou (usando fallback): ${safeErrorTag(error)}`);
    return null;
  }
}

async function loadOrWriteScript({
  topic,
  targetWords,
  slug,
  context,
  sourceTitle,
  sourceUrl,
  sourceAgeHours,
  source,
  sourceEvidence,
  originTitle,
  originUrl,
  theme,
  formatId,
  visualRebuild = null,
  automatic = false,
  allowCache = true
}) {
  const cachePath = visualRebuild?.scriptCache?.scriptPath
    || path.join(__dirname, '..', 'data', 'scripts', `${slug}-${SCRIPT_REVISION}.json`);
  const cacheMetaPath = visualRebuild?.scriptCache?.metadataPath || `${cachePath}.meta.json`;
  const contextHash = hashSourceContext(context);
  const cacheStat = await fs.stat(cachePath).catch(() => null);
  let script = null;
  let generationModel = null;
  const callBudget = { remaining: SCRIPT_GENERATION_MAX_CALLS };
  const attemptedWriterModels = new Set();
  if (visualRebuild) {
    if (!cacheStat) {
      throw Object.assign(new Error('visual rebuild source script cache is missing'), { code: 'visual_rebuild_script_cache_missing' });
    }
    let cached;
    let meta;
    try {
      [cached, meta] = await Promise.all([
        fs.readFile(cachePath, 'utf8').then(JSON.parse),
        fs.readFile(cacheMetaPath, 'utf8').then(JSON.parse)
      ]);
    } catch (error) {
      throw Object.assign(new Error(`visual rebuild source script cache is invalid: ${safeErrorTag(error)}`), {
        code: 'visual_rebuild_script_cache_invalid'
      });
    }
    const cacheMatches = meta?.revision === visualRebuild.sourceEditorial.scriptRevision
      && meta?.topic === topic && meta?.targetWords === targetWords && meta?.formatId === formatId
      && meta?.contextHash === contextHash
      && typeof cached?.hook === 'string' && Array.isArray(cached.sections) && cached.sections.length > 0;
    const cachedHook = String(cached.hook || '').replace(/\s+/g, ' ').trim();
    if (!cacheMatches || (visualRebuild.hook && cachedHook !== visualRebuild.hook)) {
      throw Object.assign(new Error('visual rebuild source script cache does not match the QA manifest inputs'), {
        code: 'visual_rebuild_script_cache_mismatch'
      });
    }
    script = stripUnsupportedScriptVisuals(cached, context);
    script.formatId = formatId;
    script.formatVersion = visualRebuild.sourceEditorial.formatVersion;
    return {
      script,
      publicationReview: {
        status: visualRebuild.sourceReview.factualReviewStatus,
        reviewer: visualRebuild.sourceReview.reviewer,
        sourceHash: visualRebuild.sourceReview.sourceHash
      },
      reviewHistory: Array.isArray(meta.reviewHistory) ? meta.reviewHistory : [],
      reviewFeedback: null,
      regenerated: false,
      reusedForVisualRebuild: true,
      cachePath,
      cacheMetaPath
    };
  }
  if (cacheStat && allowCache) {
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
      let meta = null;
      try { meta = JSON.parse(await fs.readFile(cacheMetaPath, 'utf8')); } catch (_e) { /* cache anterior à metadata */ }
      const cachedAt = meta?.createdAt ? new Date(meta.createdAt).getTime() : cacheStat.mtimeMs;
      const ageHours = (Date.now() - cachedAt) / 3600000;
      const contextMatches = meta?.contextHash ? meta.contextHash === contextHash : !context;
      const requestMatches = !meta || (meta.topic === topic && meta.targetWords === targetWords && meta.formatId === formatId);
      const validShape = cached && typeof cached.title === 'string' && typeof cached.hook === 'string'
        && Array.isArray(cached.sections) && cached.sections.length > 0
        && Array.isArray(cached.claimEvidence) && cached.claimEvidence.length > 0;
      const reviewerMetadataAvailable = !automatic || Boolean(meta?.generationModel);
      if (ageHours >= 0 && ageHours <= SCRIPT_CACHE_TTL_HOURS && contextMatches && requestMatches && validShape && reviewerMetadataAvailable) {
        console.log(`      roteiro em cache ${SCRIPT_REVISION} — reutilizando (${ageHours.toFixed(1)}h)`);
        script = cached;
        generationModel = meta?.generationModel || null;
      } else {
        const reason = ageHours > SCRIPT_CACHE_TTL_HOURS ? `expirado (${ageHours.toFixed(1)}h)`
          : !contextMatches ? 'contexto da fonte mudou' : !requestMatches ? 'pauta, tamanho ou formato editorial mudou'
            : !validShape ? 'formato antigo ou sem evidências de fonte' : !reviewerMetadataAvailable ? 'modelo gerador ausente para auditoria' : 'data inválida';
        console.log(`      roteiro em cache descartado: ${reason}; gerando novamente`);
      }
    } catch (error) {
      console.warn(`      cache de roteiro inválido (${safeErrorTag(error)}); gerando novamente`);
    }
  } else if (cacheStat && !allowCache) {
    console.log('      roteiro em cache ignorado: pauta automática sem contexto verificável');
  }
  if (!script) {
    const generated = await writeScriptWithNvidia({ topic, targetWords, context, theme, sourceAgeHours, formatId, attemptedModels: attemptedWriterModels, callBudget });
    script = generated.script;
    generationModel = generated.model;
  }
  script = stripUnsupportedScriptVisuals(script, context);

  const reviewer = VERIFIER_ID;
  const review = await reviewScriptWithRepair({
    script,
    topic,
    sourceTitle,
    sourceContext: context,
    reviewer,
    // The source evidence checker is local and deterministic. Only the writer
    // is called again, with bounded repairs; unresolved evidence stays blocked.
    maxRepairs: SCRIPT_REVIEW_MAX_REPAIRS,
    critique: draft => reviewScriptDeterministically(draft, context, sourceAgeHours),
    regenerate: async (feedback, { script: currentDraft, attempt }) => {
      const previousGenerationModel = generationModel;
      try {
        console.log(`      reparo factual ${attempt}/${SCRIPT_REVIEW_MAX_REPAIRS} sobre o roteiro reprovado; writer funcional primeiro`);
        const generated = await writeScriptWithNvidia({
          topic,
          targetWords,
          context,
          extraFeedback: feedback,
          theme,
          sourceAgeHours,
          formatId,
          draft: currentDraft,
          excludeModels: repairExcludedWriters(attemptedWriterModels, previousGenerationModel),
          attemptedModels: attemptedWriterModels,
          preferredModel: attempt > 1 && process.env.GEMINI_API_KEY && !/^gemini(?::|-)/.test(String(previousGenerationModel))
            ? `gemini:${SCRIPT_GEMINI_FALLBACK_MODELS[0]}` : previousGenerationModel,
          callBudget
        });
        generationModel = generated.model;
        return stripUnsupportedScriptVisuals(generated.script, context);
      } catch (error) {
        const failureTags = Array.isArray(error.failureTags) ? [...new Set(error.failureTags)].join(',') : safeErrorTag(error);
        console.warn(`      reescrita factual não gerada (${failureTags}); roteiro reprovado permanece bloqueado`);
        throw error;
      }
    }
  });
  review.script = resolveScriptEvidenceIds(review.script, context).script;
  if (review.regenerated) console.log('      roteiro reparado e validado novamente por evidências locais; histórico guardado nos metadados');
  if (review.publicationReview.status !== 'approved') {
    console.warn(`      publicação automática bloqueada: revisão factual ${review.publicationReview.status}`);
  } else {
    console.log(`      revisão factual determinística aprovada (${review.publicationReview.reviewer})`);
  }

  const hookWordCount = countHookWords(review.script?.hook);
  const gateFailure = scriptGateFailure(review.publicationReview, automatic, hookWordCount, {
    sourceEligible: sourceEvidence?.eligible === true
  });
  if (gateFailure === 'hook_word_count_out_of_range') {
    const error = new Error('hook_word_count_out_of_range');
    error.code = 'hook_word_count_out_of_range';
    throw error;
  }
  review.script.hookStructureId = selectHookStructure(topic).id;
  review.script.formatId = formatId;
  review.script.formatVersion = 1;

  await writeFileAtomic(cachePath, JSON.stringify(review.script, null, 2));
  await writeFileAtomic(cacheMetaPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    topic,
    targetWords,
    contextHash,
    writingWordTarget: sourceBoundedWordTarget(targetWords, context),
    formatId,
    formatVersion: 1,
    revision: SCRIPT_REVISION,
    generationModel,
    sourceTitle,
    sourceUrl,
    sourceName: source,
    sourceAgeHours,
    reviewer: review.publicationReview.reviewer,
    reviewHistory: review.reviewHistory,
    ...(review.reviewFeedback ? { reviewFeedback: cleanText(review.reviewFeedback).slice(0, 600) } : {})
  }, null, 2));
  const reviewFailure = gateFailure;
  if (reviewFailure) {
    await recordTopic({
      jobId: JOB_ID,
      videoId: activeVideoId,
      renderer: RENDERER_ID,
      theme: theme.id,
      title: sourceTitle || topic,
      url: sourceUrl,
      source: source || 'Imprensa',
      sourceEvidence,
      publicationEligible: false,
      publicationReview: review.publicationReview,
      publicationHold: { reason: reviewFailure },
      originTitle: originTitle || sourceTitle || topic,
      originUrl: originUrl || sourceUrl
    });
    throw Object.assign(new Error(reviewFailure), { code: reviewFailure });
  }
  return { script: review.script, publicationReview: review.publicationReview, cachePath, cacheMetaPath };
}

/* ---------------- narração sincronizada (edge-tts + SRT) ---------------- */

let edgeTtsUnavailable = false;

function findEdgeTts() {
  if (/^(gtts|g-tts)$/i.test(process.env.TTS_PROVIDER || '')) return null;
  const candidates = process.env.EDGE_TTS_PATH
    ? [process.env.EDGE_TTS_PATH]
    : [path.join(os.homedir(), '.local', 'bin', 'edge-tts'), 'edge-tts'];
  for (const cmd of candidates) {
    const probe = spawnSync(cmd, ['--help'], { timeout: 15000 });
    if (!probe.error && probe.status === 0) return cmd;
  }
  return null;
}

// edge-tts depende do serviço WebSocket da Microsoft (sem chave) e às vezes
// responde 403/serviço fora do ar. gTTS (Google Translate) é a alternativa
// gratuita e sem chave — não devolve legendas, então o SRT é sintetizado com
// um único cue cobrindo a duração real do áudio (o timing por palavra acaba
// distribuído uniformemente, como no fallback já existente).
function synthesizeWithGtts(text, mp3Path) {
  return new Promise((resolve, reject) => {
    const py = 'from gtts import gTTS; import sys; gTTS(sys.argv[1], lang="pt-br").save(sys.argv[2])';
    const child = spawn(process.env.PYTHON_PATH || 'python3', ['-c', py, String(text), mp3Path], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`gTTS saiu com código ${code}: ${stderr.slice(0, 300)}`)));
  });
}

async function writeSyntheticSrt(text, mp3Path, srtPath) {
  const durMs = await getMediaDuration(mp3Path).then(d => Math.round(d * 1000)).catch(() => 0);
  const end = Math.max(1000, durMs || 4000);
  const hh = String(Math.floor(end / 3600000)).padStart(2, '0');
  const mm = String(Math.floor((end % 3600000) / 60000)).padStart(2, '0');
  const ss = String(Math.floor((end % 60000) / 1000)).padStart(2, '0');
  const mmm = String(end % 1000).padStart(3, '0');
  await fs.writeFile(srtPath, `1\n00:00:00,000 --> ${hh}:${mm}:${ss},${mmm}\n${text}\n`, 'utf8');
}

function srtTimestamp(milliseconds) {
  const value = Math.max(0, Math.round(Number(milliseconds) || 0));
  const hh = String(Math.floor(value / 3600000)).padStart(2, '0');
  const mm = String(Math.floor((value % 3600000) / 60000)).padStart(2, '0');
  const ss = String(Math.floor((value % 60000) / 1000)).padStart(2, '0');
  const mmm = String(value % 1000).padStart(3, '0');
  return `${hh}:${mm}:${ss},${mmm}`;
}

function wordBoundariesToSrt(words) {
  if (!Array.isArray(words) || !words.length) throw new Error('Edge TTS não retornou tempos de palavra');
  return words.map((word, index) => {
    const start = Number(word.startMs), end = Number(word.endMs);
    const text = String(word.text || '').trim();
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error(`Limite de palavra inválido na posição ${index + 1}`);
    }
    return `${index + 1}\n${srtTimestamp(start)} --> ${srtTimestamp(end)}\n${text}\n`;
  }).join('\n');
}

async function synthesizeEdgeWithWordBoundaries(text, mp3Path, srtPath, wordTimingsPath, { voice, rate, pitch }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-edge-word-boundaries-'));
  const textPath = path.join(tempDir, 'narration.txt');
  await fs.writeFile(textPath, text, 'utf8');
  const python = process.env.PYTHON_PATH || 'python3';
  const helper = path.join(__dirname, 'synthesize-edge-tts-word-boundaries.py');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(python, [helper, '--text-file', textPath, '--audio', mp3Path,
        '--timings', wordTimingsPath, '--voice', voice, '--rate', rate, '--pitch', pitch],
      { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      const timeout = setTimeout(() => child.kill('SIGTERM'), 180_000);
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.on('error', error => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', code => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error(`Edge TTS word-boundary helper exited ${code}: ${stderr.slice(0, 300)}`));
      });
    });
    const rawTimingData = JSON.parse(await fs.readFile(wordTimingsPath, 'utf8'));
    if (rawTimingData.alignment !== 'edge-tts-word-boundary-events' || !Array.isArray(rawTimingData.events)) {
      throw new Error('Edge TTS word-boundary metadata is invalid');
    }
    const timingData = { ...rawTimingData, ...expandEdgeTtsBoundaryEvents(rawTimingData.events, text) };
    await fs.writeFile(wordTimingsPath, JSON.stringify(timingData), 'utf8');
    await fs.writeFile(srtPath, wordBoundariesToSrt(timingData.words), 'utf8');
    return timingData;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function writeFallbackWordTimingMetadata(filePath, provider) {
  await fs.writeFile(filePath, JSON.stringify({
    version: 1,
    alignment: provider === 'edge-tts' ? 'subtitle-cue' : 'uniform-estimate',
    words: []
  }), 'utf8');
}

async function synthesize(text, cmd, mp3Path, srtPath, wordTimingsPath,
  { voice = process.env.TTS_VOICE || 'pt-BR-FranciscaNeural', rate = '-3%', pitch = '-1Hz' } = {}) {
  const allowGttsFallback = isGttsFallbackAllowed({
    provider: process.env.TTS_PROVIDER,
    allowFallback: process.env.TTS_ALLOW_PROVIDER_FALLBACK
  });
  if (!cmd || edgeTtsUnavailable) {
    if (!allowGttsFallback) throw Object.assign(new Error('edge_tts_unavailable'), { code: 'NARRATION_PROVIDER_UNAVAILABLE' });
    const provider = await synthesizeViaGtts(text, mp3Path, srtPath);
    await writeFallbackWordTimingMetadata(wordTimingsPath, provider);
    return provider;
  }
  try {
    await synthesizeEdgeWithWordBoundaries(text, mp3Path, srtPath, wordTimingsPath, { voice, rate, pitch });
    return 'edge-tts';
  } catch (error) {
    console.warn(`      Edge TTS word-boundary indisponível (${safeErrorTag(error)}); usando cues SRT`);
    await Promise.all([fs.unlink(mp3Path).catch(() => {}), fs.unlink(srtPath).catch(() => {}), fs.unlink(wordTimingsPath).catch(() => {})]);
  }
  const run = () => new Promise((resolve, reject) => {
    const args = ['--voice', voice,
      '--rate', rate, '--pitch', pitch, '--text', text,
      '--write-media', mp3Path, '--write-subtitles', srtPath];
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`edge-tts saiu com código ${code}: ${stderr.slice(0, 300)}`)));
  });
  try {
    await run()
      .then(() => 'edge-tts')
      .catch(async error => {
        console.warn(`      edge-tts retry (${safeErrorTag(error)})`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        return run().then(() => 'edge-tts');
      })
      .then(async provider => {
        await writeFallbackWordTimingMetadata(wordTimingsPath, provider);
      });
    return 'edge-tts';
  } catch (error) {
    edgeTtsUnavailable = true;
    if (!allowGttsFallback) throw Object.assign(new Error('edge_tts_unavailable'), { code: 'NARRATION_PROVIDER_UNAVAILABLE' });
    console.warn(`      edge-tts indisponível (${safeErrorTag(error)}) — usando gTTS`);
    const provider = await synthesizeViaGtts(text, mp3Path, srtPath);
    await writeFallbackWordTimingMetadata(wordTimingsPath, provider);
    return provider;
  }
}

async function synthesizeViaGtts(text, mp3Path, srtPath) {
  await synthesizeWithGtts(text, mp3Path);
  await writeSyntheticSrt(text, mp3Path, srtPath);
  return 'gtts';
}

function parseSrt(srt) {
  const toMs = t => {
    const m = String(t).trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
    return m ? (+m[1] * 3600000) + (+m[2] * 60000) + (+m[3] * 1000) + (+m[4]) : 0;
  };
  const cues = [];
  for (const block of String(srt).replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean);
    const timeLine = lines.find(l => l.includes('-->'));
    if (!timeLine) continue;
    const [a, b] = timeLine.split('-->');
    const text = lines.slice(lines.indexOf(timeLine) + 1).join(' ').trim();
    if (text) cues.push({ startMs: toMs(a), endMs: toMs(b), text });
  }
  return cues;
}

async function synthesizeNarration(script, slug, outDir, replayNarration = null) {
  const groups = [
    { text: script.hook },
    ...script.mainContent.sections.map(s => ({ text: s.content })),
    { text: script.conclusion.finalThought || '' }
  ];
  const normalizedGroups = groups.map(group => ({ text: String(group.text || '').trim() }));
  const fullText = normalizedGroups.map(group => group.text).filter(Boolean).join(' ');
  if (!fullText) throw new Error('Roteiro vazio: narração contínua não foi iniciada');

  const voice = process.env.TTS_VOICE || 'pt-BR-FranciscaNeural';
  const rate = process.env.TTS_RATE || '-3%';
  const pitch = process.env.TTS_PITCH || '-1Hz';
  const providerMode = /^(gtts|g-tts)$/i.test(process.env.TTS_PROVIDER || '') ? 'gtts' : 'auto';
  const cmd = replayNarration ? null : findEdgeTts();
  const ttsDir = replayNarration?.path
    ? path.dirname(path.resolve(replayNarration.path))
    : path.join(outDir, `${slug}-${SCRIPT_REVISION}_tts`);
  if (!replayNarration) await fs.mkdir(ttsDir, { recursive: true });
  const mp3 = replayNarration?.path ? path.resolve(replayNarration.path) : path.join(ttsDir, 'narration.mp3');
  const srt = path.join(ttsDir, 'narration.srt');
  const wordTimingsPath = path.join(ttsDir, 'narration.word-timings.json');
  const providerMetadataPath = `${mp3}.meta.json`;
  const inputHash = narrationInputHash(fullText, { voice, provider: providerMode, rate, pitch });
  const [audio, subtitles, wordTimings, metadata] = await Promise.all([
    fs.readFile(mp3).catch(() => null), fs.readFile(srt).catch(() => null),
    fs.readFile(wordTimingsPath).catch(() => null),
    fs.readFile(providerMetadataPath, 'utf8').then(JSON.parse).catch(() => null)
  ]);
  let cached = replayNarration
    ? narrationCacheArtifactsMatch(metadata, { audio, subtitles, wordTimings })
      && metadata?.inputSha256 === replayNarration.inputSha256
      && metadata?.audioSha256 === replayNarration.sha256
    : narrationCacheMatches(metadata, { inputHash, audio, subtitles, wordTimings })
      && (providerMode === 'gtts' || metadata?.provider === 'edge-tts');
  if (cached) {
    try {
      const timing = JSON.parse(wordTimings.toString('utf8'));
      const hint = ['edge-tts-word-boundary', 'edge-tts-word-boundary-mixed'].includes(timing.alignment) ? timing.alignment : null;
      partitionNarrationCues(normalizedGroups, parseSrt(subtitles.toString('utf8')), hint);
    } catch {
      if (replayNarration) throw Object.assign(new Error('replay narration alignment is invalid'), {
        code: 'visual_rebuild_narration_cache_mismatch'
      });
      cached = false;
      console.warn('      cache de narração sem alinhamento válido; refazendo áudio/tempos antes do render');
    }
  }
  let provider = metadata?.provider;
  if (!cached) {
    if (replayNarration) {
      throw Object.assign(new Error('visual rebuild source narration cache is missing or changed'), {
        code: 'visual_rebuild_narration_cache_mismatch'
      });
    }
    const suffix = `${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
    const stagedMp3 = `${mp3}.${suffix}.mp3`;
    const stagedSrt = `${srt}.${suffix}.srt`;
    const stagedWordTimings = `${wordTimingsPath}.${suffix}.json`;
    try {
      provider = await synthesize(fullText, cmd, stagedMp3, stagedSrt, stagedWordTimings, { voice, rate, pitch });
      const nextMetadata = narrationCacheMetadata({ inputHash, provider,
        audio: await fs.readFile(stagedMp3), subtitles: await fs.readFile(stagedSrt),
        wordTimings: await fs.readFile(stagedWordTimings) });
      await fs.rename(stagedMp3, mp3);
      await fs.rename(stagedSrt, srt);
      await fs.rename(stagedWordTimings, wordTimingsPath);
      await writeFileAtomic(providerMetadataPath, JSON.stringify(nextMetadata));
    } finally {
      await Promise.all([fs.unlink(stagedMp3).catch(() => {}), fs.unlink(stagedSrt).catch(() => {}),
        fs.unlink(stagedWordTimings).catch(() => {})]);
    }
  }

  const measured = await getMediaDuration(mp3).catch(() => 0);
  const audioDurationMs = Number.isFinite(measured) && measured > 0 ? Math.round(measured * 1000) : 0;
  const alignmentData = JSON.parse(await fs.readFile(wordTimingsPath, 'utf8'));
  const cues = parseSrt(await fs.readFile(srt, 'utf8'));
  const alignmentHint = alignmentData.alignment === 'edge-tts-word-boundary'
    || alignmentData.alignment === 'edge-tts-word-boundary-mixed'
    ? alignmentData.alignment
    : null;
  let partitions;
  try { partitions = partitionNarrationCues(normalizedGroups, cues, alignmentHint); }
  catch { throw Object.assign(new Error('narration alignment failed; approved script retained for retry'), {
    code: 'NARRATION_PROVIDER_UNAVAILABLE'
  }); }
  const timings = partitions.map((partition, index) => {
    const groupText = normalizedGroups[index].text;
    const durationMs = partition.durationMs || 1;
    const groupTimings = buildGroupTimings(groupText, partition.cues, durationMs, provider, partition.alignment);
    return {
      ...groupTimings,
      alignment: partition.alignment,
      audioOffsetMs: partition.audioOffsetMs
    };
  });
  timings.forEach((timing, index) => {
    console.log(`      grupo ${index + 1}/${groups.length}: ${(timing.durationMs / 1000).toFixed(1)}s, ${timing.sentences.length} frases, ${timing.provider}, ${timing.alignment}`);
  });

  const audioPath = replayNarration ? path.resolve(replayNarration.path)
    : path.join(outDir, `${slug}-${SCRIPT_REVISION}_narracao.mp3`);
  if (replayNarration) {
    const sourceAudio = await fs.readFile(audioPath).catch(() => null);
    if (!sourceAudio || crypto.createHash('sha256').update(sourceAudio).digest('hex') !== replayNarration.sha256) {
      throw Object.assign(new Error('visual rebuild narration audio is missing or changed'), {
        code: 'visual_rebuild_narration_audio_mismatch'
      });
    }
  } else {
    const stagedOutput = `${audioPath}.${process.pid}.tmp`;
    try {
      await fs.copyFile(mp3, stagedOutput);
      await fs.rename(stagedOutput, audioPath);
    } finally {
      await fs.unlink(stagedOutput).catch(() => {});
    }
  }
  console.log(`      narração contínua: ${(audioDurationMs / 1000).toFixed(1)}s, voz ${voice} (${rate}, ${pitch})`);
  return { audioPath, timings, totalDurationMs: audioDurationMs,
    narrationInputSha256: replayNarration?.inputSha256 || inputHash,
    narrationCachePath: mp3 };
}

/* ---------------- imagens (Gemini web, 6 por seção) ---------------- */

function sceneVisualMode(scenes, groupCount) {
  const availableGroups = Object.values(scenes || {})
    .filter(group => Array.isArray(group?.sources) && group.sources.length > 0).length;
  if (availableGroups === 0) return 'graphics-and-source-prints';
  if (availableGroups >= Math.max(1, Number(groupCount) || 0)) return 'ai-generated-scenes';
  return 'mixed-generated-scenes';
}

function shouldStopSceneImageAttempts(error, failures) {
  const tag = safeErrorTag(error);
  return failures >= 2 || ['gemini_not_logged_in', 'gemini_editor_not_ready', 'gemini_image_timeout',
    'gemini_android_device_not_ready', 'gemini_android_browser_missing', 'gemini_android_login_required',
    'gemini_android_login_expired', 'gemini_android_editor_not_ready',
    'gemini_android_ui_unavailable', 'gemini_android_generation_timeout', 'gemini_android_cdp_image_timeout',
    'gemini_android_download_confirmation_missing',
    'gemini_android_downloaded_file_missing', 'gemini_android_transfer_failed'].includes(tag);
}

async function generateSceneImages(script, slug, topic, options = {}) {
  const provider = options.provider || (options.reuseOnly ? null : new GeminiImageProvider({}));
  const run = () => generateSceneImagesUnlocked(script, slug, topic, { ...options, provider });
  const withDeviceSession = () => provider?.withDeviceSessionLock
    ? provider.withDeviceSessionLock(run)
    : run();
  if (options.browserSessionLockHeld) return withDeviceSession();
  return withProcessFileLock(withDeviceSession, {
    lockPath: options.browserLockPath || path.join(__dirname, '..', 'data', 'gemini-image-generation.lock'),
    owner: 'Gemini narrative image generation',
    timeoutMs: Math.max(60000, Number(process.env.GEMINI_IMAGE_LOCK_TIMEOUT_MS || 60 * 60 * 1000)),
    pollIntervalMs: 500
  });
}

async function generateSceneImagesUnlocked(script, slug, topic, {
  sourceTitle = '',
  sourceUrl = '',
  sourceContext = '',
  provider = null,
  cacheDirectory = null,
  imageLibraryDirectory = null,
  reuseOnly = false,
  replaySceneImages = null
} = {}) {
  const web = provider || (reuseOnly ? null : new GeminiImageProvider({}));
  const cacheDir = cacheDirectory || path.join(__dirname, '..', 'data', 'images', slug);
  if (!reuseOnly) await fs.mkdir(cacheDir, { recursive: true });

  const groups = [
    { title: 'Abertura', text: script.hook, imagePrompt: script.imagePrompt || '', emotion: script.hookEmotion },
    ...script.mainContent.sections.map(s => ({ title: s.title, text: s.content, imagePrompt: s.imagePrompt || '', emotion: s.emotion })),
    { title: 'Conclusão', text: script.conclusion.finalThought || '', imagePrompt: script.conclusion?.imagePrompt || '', emotion: script.conclusion.emotion }
  ];

  let available = reuseOnly;
  if (!reuseOnly) {
    try { available = await web.isAvailable(); }
    catch (error) { console.warn(`      verificação Gemini falhou (${safeErrorTag(error)}); seguindo com fontes e gráficos`); }
  }
  if (!available) {
    await web.close?.();
    console.warn('      Gemini indisponível; usando prints das fontes e gráficos do roteiro, sem inserir imagens fictícias');
    return { scenes: {}, thumbnailImage: '', portraitThumbnailImage: '', visualMode: 'graphics-and-source-prints' };
  }

  const imageStyleId = crypto.createHash('sha1').update(`${SCRIPT_REVISION}:${RENDERER_ID}:narrative-scenes-v3`).digest('hex').slice(0, 8);
  const shots = {
    a: 'wide 3D editorial establishing shot with one clear focal object and layered depth',
    b: 'cinematic close-up of the most important real object or environment detail from the story',
    c: 'isometric 3D visualization of the story concept using tangible, carefully arranged objects',
    d: 'low-angle close detail on the main physical subject, with foreground depth and a clean, distinct outline',
    e: 'wide contextual documentary scene with meaningful physical story details and layered depth',
    f: 'tactile macro detail of a relevant object, material or surface, with natural cinematic bokeh'
  };
  const perGroup = Math.max(2, Math.min(6, Number(process.env.IMAGES_PER_GROUP || 6)));
  const variants = ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, perGroup);

  const images = {};
  const sceneImageAssets = [];
  const library = reuseOnly ? null : new (require('../utils/image-library').ImageLibrary)({ directory: imageLibraryDirectory
    || (cacheDirectory ? path.join(cacheDirectory, '.image-library') : undefined) });
  let libraryReady = false;
  let libraryFailed = false;
  let consecutiveFails = 0;
  let providerCircuitOpen = false;
  outer:
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const durationMs = Number(script.timings?.[i]?.durationMs);
    const { SOCIAL_IMAGE_TARGET_MS, SOCIAL_IMAGE_MAX_MS } = require('../utils/scene-plan-builder');
    const timedSentences = Array.isArray(script.timings?.[i]?.sentences)
      ? script.timings[i].sentences.filter(sentence => String(sentence?.text || '').trim())
      : String(group.text || '').split(/(?<=[.!?…])\s+/).filter(Boolean).map(text => ({ text }));
    const narrativeBeatImages = Math.min(6, Math.max(1, timedSentences.length));
    const durationImages = durationMs > 0 ? Math.max(1, Math.round(durationMs / SOCIAL_IMAGE_TARGET_MS),
      Math.ceil(durationMs / SOCIAL_IMAGE_MAX_MS)) : 1;
    const neededImages = Math.min(variants.length, Math.max(durationImages, narrativeBeatImages));
    const groupImageAssets = Array.isArray(replaySceneImages)
      ? replaySceneImages.filter(asset => asset.groupIndex === i)
      : variants.slice(0, neededImages).map(variant => ({ groupIndex: i, variant }));
    for (const [assetIndex, asset] of groupImageAssets.entries()) {
      const variant = asset.variant;
      try {
        const selectedBeat = selectNarrativeBeat(timedSentences, assetIndex, groupImageAssets.length);
        let prompt = '';
        if (!asset.path) {
          const base = buildSceneImageBase({ topic, sourceTitle, sectionTitle: group.title, sectionText: group.text,
            visualBeatText: selectedBeat || group.text, visualDirection: group.imagePrompt });
          const subject = 'Turn this exact narrated beat into a concrete, explanatory visual action. Depict the named objects and supported actions from this beat; a separate recurring presenter is rendered by the video engine.';
          prompt = buildSceneImagePrompt({ base, subject, shot: shots[variant], narrative: true });
        }
        // A cache entry is specific to the complete prompt. Older unbound
        // caches and replays remain usable but are never assigned a beat.
        const promptHash = crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
        const pngPath = asset.path ? path.resolve(asset.path)
          : path.join(cacheDir, `g${i}${variant}-visual-${imageStyleId}-${promptHash}.png`);
        const stat = await fs.lstat(pngPath).catch(() => null);
        const hasVariant = Boolean(stat?.isFile() && !stat.isSymbolicLink());
        if (!reuseOnly && stat && !hasVariant) {
          throw Object.assign(new Error(`scene image cache path is not a regular file: ${path.basename(pngPath)}`), {
            code: 'scene_image_cache_path_unsafe'
          });
        }
        if (reuseOnly && (!hasVariant || !asset.sha256
          || crypto.createHash('sha256').update(await fs.readFile(pngPath)).digest('hex') !== asset.sha256)) {
          throw Object.assign(new Error(`visual rebuild image cache missing or changed: ${path.basename(pngPath)}`), {
            code: 'visual_rebuild_image_cache_mismatch'
          });
        }
        if (!hasVariant) {
          if (reuseOnly) {
            throw Object.assign(new Error(`visual rebuild image cache missing: ${path.basename(pngPath)}`), {
              code: 'visual_rebuild_image_cache_missing'
            });
          }
          await web.generateImage(prompt, pngPath);
        }
        consecutiveFails = 0;
        const imageSha256 = asset.sha256 || crypto.createHash('sha256').update(await fs.readFile(pngPath)).digest('hex');
        const beatSha256 = asset.path ? asset.beatSha256 : narrativeBeatSha256(selectedBeat);
        sceneImageAssets.push({ groupIndex: i, variant, path: path.relative(path.join(__dirname, '..'), pngPath), sha256: imageSha256,
          ...(/^[a-f0-9]{64}$/.test(String(beatSha256 || '')) ? { beatSha256 } : {}) });
        const buf = await sharp(pngPath).resize({ width: 1536 }).jpeg({ quality: 86 }).toBuffer();
        if (!reuseOnly && !libraryFailed) {
          try {
            if (!libraryReady) { await library.initialize(); libraryReady = true; }
            await library.archive({ imagePath: pngPath, theme: script.themeId || script.theme?.id
              || (typeof script.theme === 'string' ? script.theme : '') || process.env.THEME || 'ia',
            topic, sectionTitle: group.title, sectionText: group.text, sourceTitle, sourceUrl,
            generator: 'gemini', jobId: JOB_ID, renderBytes: buf, usageKnown: !hasVariant });
          } catch (error) {
            libraryFailed = true;
            console.warn(`      banco de imagens indisponível; originais preservados no cache (${safeErrorTag(error)})`);
          }
        }
        const imageData = `data:image/jpeg;base64,${buf.toString('base64')}`;
        images[i] = images[i] || { sources: [], thumbnailImage: '', thumbnailCandidates: [] };
        images[i].sources.push(imageData);
        images[i].thumbnailCandidates.push({ variant, image: imageData });
        // Variant b remains the compatibility fallback. The thumbnail selector
        // prefers variant c, whose isometric composition looked cleaner in the theme review.
        if (i === 0 && variant === 'b') images[i].thumbnailImage = imageData;
      } catch (error) {
        if (reuseOnly) throw error;
        consecutiveFails++;
        console.warn(`      imagem ${i + 1}.${variant}/${groups.length} falhou (${safeErrorTag(error)})`);
        if (shouldStopSceneImageAttempts(error, consecutiveFails)) {
          providerCircuitOpen = true;
          console.warn('      Gemini sem condição de entregar imagens; encerrando tentativas deste job e seguindo com fontes e gráficos');
          break outer;
        }
      }
    }
    if (images[i] && !images[i].sources.length) delete images[i];
  }
  const missingGroups = groups.filter((_group, index) => !images[index]?.sources?.length).map(group => group.title);
  if (missingGroups.length) {
    console.warn(`      ${missingGroups.length}/${groups.length} seção(ões) sem imagem Gemini; essas cenas usarão prints disponíveis e gráficos do roteiro`);
  }
  let thumbnailImage = '';
  let portraitThumbnailImage = '';
  if (!reuseOnly && !process.argv.includes('--no-thumb') && !providerCircuitOpen) {
    try {
      const sourceArtInput = buildGroundedThumbnailArtInput({ topic, sourceTitle, sourceContext });
      thumbnailImage = await generateThumbnailArt({
        web,
        cacheDirectory: cacheDir,
        aspectRatio: '16:9',
        ...sourceArtInput
      });
      console.log('      arte horizontal exclusiva da capa pronta (não usada nas cenas do vídeo)');
    } catch (error) {
      console.warn(`      arte horizontal da capa falhou; usando fallback contextual: ${safeErrorTag(error)}`);
    }
    try {
      const sourceArtInput = buildGroundedThumbnailArtInput({ topic, sourceTitle, sourceContext });
      portraitThumbnailImage = await generateThumbnailArt({
        web,
        cacheDirectory: cacheDir,
        aspectRatio: '9:16',
        sceneDirection: 'Compose a dedicated portrait 9:16 editorial photograph. Keep the main subject large in the upper two thirds and leave the lower third calm and dark for a separate Portuguese headline. Recompose for portrait; do not crop or extend a horizontal scene.',
        ...sourceArtInput
      });
      console.log('      arte vertical exclusiva da capa pronta (com composição própria)');
    } catch (error) {
      console.warn(`      arte vertical da capa falhou; usando fallback contextual: ${safeErrorTag(error)}`);
    }
  }
  try { await web?.close?.(); }
  finally { await library?.close().catch(error => console.warn(`      banco de imagens: ${safeErrorTag(error)}`)); }
  console.log(`      ${Object.keys(images).length}/${groups.length} grupos, ${Object.values(images).reduce((n, g) => n + g.sources.length, 0)} imagens no total`);
  return { scenes: images, thumbnailImage, portraitThumbnailImage, visualMode: sceneVisualMode(images, groups.length), sceneImageAssets };
}

/* ---------------- referências reais (Google News RSS) ---------------- */

async function fetchNewsReferences(query, limit = 8) {
  try {
    const q = encodeURIComponent(query.slice(0, 90));
    const res = await fetchWithTimeout(`https://news.google.com/rss/search?q=${q}&hl=pt-BR&gl=BR&ceid=BR:pt-419`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' }
    }, 15000);
    if (!res.ok) throw new Error(`news ${res.status}`);
    const { readBoundedResponseText } = require('../utils/news-hunter');
    const xml = await readBoundedResponseText(res);
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    const now = Date.now();
    while ((m = re.exec(xml)) && items.length < limit) {
      const block = m[1];
      const rawTitle = ((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
      const link = ((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
      const sourceTag = block.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
      const source = (sourceTag?.[2] || 'Imprensa').replace(/&amp;/g, '&').trim();
      const sourceUrl = sourceTag?.[1]?.match(/\burl=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, '&') || '';
      const pub = ((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim();
      const description = ((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '').trim();
      if (!rawTitle) continue;
      // Skip stale coverage — Google News can return years-old items.
      let time = 'recente';
      if (pub) {
        const ts = new Date(pub).getTime();
        if (Number.isFinite(ts)) {
          const days = (now - ts) / 86400000;
          if (days > 120) continue;
          time = days < 1 ? 'hoje' : days < 2 ? 'ontem' : new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        }
      }
      const title = rawTitle.replace(/ - [^-]{2,28}$/, '').slice(0, 150);
      items.push({ title, source: source.slice(0, 24), sourceUrl, link, description, time });
    }
    return items;
  } catch (error) {
    console.warn(`      news falhou (${safeErrorTag(error)})`);
    return [];
  }
}

/* ---------------- prints reais (screenshots de artigos) ---------------- */

async function screenshotArticles(shots, cacheDir, { launchBrowser } = {}) {
  if (!shots.length) return [];
  const prints = new Array(shots.length).fill(null);
  let browser;
  try {
    const launch = launchBrowser || (() => require('playwright').chromium.launch({
      args: ['--disable-dev-shm-usage', '--disable-gpu-sandbox']
    }));
    browser = await launch();
  } catch (error) {
    console.warn(`      prints indisponíveis: navegador não iniciou (${safeErrorTag(error)})`);
    return prints;
  }
  try {
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const pngPath = articleScreenshotCachePath(cacheDir, shot.url);
      try {
        // Cache: print já capturado em execução anterior é reaproveitado
        // (evita reabrir o browser e redesenhar páginas de terceiros).
        if (await fs.stat(pngPath).then(s => s.size > 10 * 1024).catch(() => false)) {
          const evidence = await fs.readFile(`${pngPath}.json`, 'utf8').then(JSON.parse).catch(() => null);
          const quality = await assessArticleScreenshot(pngPath, sharp);
          const digest = crypto.createHash('sha256').update(await fs.readFile(pngPath)).digest('hex');
          if (quality.ok && evidence?.contentVerified === true && evidence.sha256 === digest
            && sameStoryTitle(evidence.heading, shot.title, 0.25)) {
            const buf = await sharp(pngPath).resize({ width: 1120 }).jpeg({ quality: 84 }).toBuffer();
            prints[i] = { src: `data:image/jpeg;base64,${buf.toString('base64')}`, source: shot.source, time: shot.time, title: shot.title, readingWords: evidence.readingWords };
            console.log(`      print ${i + 1}/${shots.length} em cache (${shot.source})`);
            continue;
          }
        }
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.goto(shot.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // LGPD/cookie banners (G1 e veículos brasileiros)
        for (const label of [/aceitar/i, /aceito/i, /^ok$/i, /concordo/i, /entendi/i, /continuar/i]) {
          const btn = page.getByRole('button', { name: label }).first();
          if (await btn.isVisible({ timeout: 600 }).catch(() => false)) { await btn.click().catch(() => {}); break; }
        }
        // Esconde overlays de consentimento conhecidos e dispara lazy-load
        await page.addStyleTag({ content: [
          '#onetrust-banner-sdk', '.qc-cmp2-container', '.cookie-banner', '[class*="lgpd" i]',
          '[class*="consent" i]', '[id*="consent" i]'
        ].join(', ') + ' { display: none !important; visibility: hidden !important; }' }).catch(() => {});
        await page.waitForTimeout(2800);
        const capture = await prepareArticleScreenshotPage(page);
        if (!sameStoryTitle(capture.headingText, shot.title, 0.25)) {
          throw Object.assign(new Error('article_screenshot_heading_mismatch'), { code: 'ARTICLE_SCREENSHOT_HEADING_MISMATCH' });
        }
        await page.screenshot({ path: pngPath, clip: capture.clip });
        await page.close();
        // Página em branco/banner não vira "card vazio": valida tamanho,
        // dimensões, variação e a cobertura espacial real do conteúdo.
        const quality = await assessArticleScreenshot(pngPath, sharp);
        if (!quality.ok) throw new Error('screenshot em branco (página não renderizou)');
        await writeFileAtomic(`${pngPath}.json`, JSON.stringify({ contentVerified: true,
          heading: capture.headingText, readingWords: capture.readingWords,
          sha256: crypto.createHash('sha256').update(await fs.readFile(pngPath)).digest('hex') }));
        const buf = await sharp(pngPath).resize({ width: 1120 }).jpeg({ quality: 84 }).toBuffer();
        prints[i] = { src: `data:image/jpeg;base64,${buf.toString('base64')}`, source: shot.source, time: shot.time, title: shot.title, readingWords: capture.readingWords };
        console.log(`      print ${i + 1}/${shots.length} ok (${shot.source})`);
      } catch (error) {
        console.warn(`      print ${i + 1}/${shots.length} falhou (${safeErrorTag(error)})`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return prints;
}

/* ---------------- thumbnail (capa do filme, mesmo sistema visual) ---------------- */

/**
 * Capa de alto contraste com chamada curta separada do título/metadados do vídeo.
 * Usa a imagem contextual da abertura e não inventa fatos fora do roteiro.
 */
async function renderThumbnail({ title, headline, accent, brand, heroImage, topic, hook, outPath, portrait = false }) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu-sandbox'] });
  try {
    const page = await browser.newPage();
    const canvas = portrait ? PORTRAIT_THUMBNAIL_CANVAS : THUMBNAIL_CANVAS;
    const policy = portrait ? PORTRAIT_THUMBNAIL_RENDER_POLICY : THUMBNAIL_RENDER_POLICY;
    const html = portrait
      ? buildPortraitThumbnailHtml({ title, headline, accent, brand, heroImage, topic, hook })
      : buildThumbnailHtml({ title, headline, accent, brand, heroImage, topic, hook });
    await page.setViewportSize(canvas);
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async ({ initialFontSize, minimumFontSize, maximumTextHeight, maximumTextWidth }) => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
      const headline = document.querySelector('h1');
      for (let size = initialFontSize; size >= minimumFontSize; size -= 2) {
        headline.style.fontSize = `${size}px`;
        if (headline.scrollHeight <= maximumTextHeight && headline.scrollWidth <= maximumTextWidth) break;
      }
    }, policy);
    await page.screenshot({ path: outPath, type: 'png' });
    console.log(`      thumbnail gerada: ${path.basename(outPath)}`);
    return outPath;
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ---------------- main ---------------- */

async function main() {
  assertRenderCapacity();
  const visualCritiqueManifestPath = arg('visual-critique-manifest', null);
  const visualCritiqueManifestSha256 = arg('visual-critique-sha256', null);
  const requestedOut = arg('out', null);
  if (Boolean(visualCritiqueManifestPath) !== Boolean(visualCritiqueManifestSha256)) {
    throw new TypeError('--visual-critique-manifest requires --visual-critique-sha256');
  }
  if (visualCritiqueManifestPath && process.argv.includes('--resume')) {
    throw new Error('visual rebuild cannot be combined with --resume');
  }
  if (visualCritiqueManifestPath && !requestedOut) {
    throw new Error('visual rebuild requires --out with a new, nonexistent output path');
  }
  let visualRebuild = null;
  if (visualCritiqueManifestPath) {
    const loadedCritique = await loadVisualRebuildCritique({
      root: path.join(__dirname, '..'),
      manifestPath: visualCritiqueManifestPath,
      expectedManifestSha256: visualCritiqueManifestSha256
    });
    const sourceEditorial = resolveVisualRebuildEditorial(loadedCritique.sourceEditorial, {
      sourceReview: loadedCritique.sourceReview,
      themeId: arg('theme', null),
      topic: arg('topic', null),
      targetWords: arg('words', null),
      formatId: arg('format', null),
      seed: arg('seed', null)
    });
    if (sourceEditorial.scriptRevision !== SCRIPT_REVISION) {
      throw Object.assign(new Error('visual rebuild source script revision differs from the active renderer revision'), {
        code: 'visual_rebuild_script_revision_mismatch'
      });
    }
    if (process.argv.includes('--from-g1') || process.argv.includes('--auto') || process.argv.includes('--recap')) {
      throw new Error('visual rebuild requires fixed source inputs; live topic selection is not allowed');
    }
    if (loadedCritique.sourceReview.sourceUrl && arg('article', null)
      && arg('article', null) !== loadedCritique.sourceReview.sourceUrl) {
      throw new Error('visual rebuild article URL conflicts with the source QA manifest');
    }
    if (process.argv.includes('--no-images')
      && sourceEditorial.visualMode !== 'graphics-and-source-prints') {
      throw new Error('--no-images conflicts with the source QA visual mode');
    }
    await assertSafeVisualRebuildOutput(path.resolve(requestedOut), loadedCritique.sourceMasterPath);
    if (path.dirname(path.resolve(requestedOut)) !== path.dirname(path.resolve(loadedCritique.sourceMasterPath))) {
      throw new Error('visual rebuild output must stay beside the source master so narration cache can be reused');
    }
    visualRebuild = {
      ...loadedCritique,
      sourceEditorial,
      hook: sourceEditorial.hook
    };
  }
  if (!(await checkFFmpeg())) throw new Error('ffmpeg ausente');
  const fromG1 = process.argv.includes('--from-g1');
  const recap = process.argv.includes('--recap');
  const targetWords = Number(visualRebuild?.sourceEditorial.targetWords ?? arg('words', recap ? 400 : 950));
  const noImages = process.argv.includes('--no-images');

  // TEMA DA INSTÂNCIA (parâmetro): carregado ANTES de qualquer uso.
  // Cada vídeo é gerado com a persona, fontes e branding do tema.
  const themeId = visualRebuild?.sourceEditorial.themeId || arg('theme', process.env.THEME || 'ia');
  const { getTheme } = require('../utils/news-hunter');
  const theme = getTheme(themeId);

  let topic, context = '', article = null, sourceAgeHours = null;
  let originTitle = '', originUrl = '';
  const explicitUrl = arg('article', visualRebuild?.sourceReview.sourceUrl || '');
  const auto = process.argv.includes('--auto');
  const sourceDates = new Map();
  const rejectedSourceDates = new Set();
  const configuredSourceAge = Number(process.env.MAX_TOPIC_FALLBACK_AGE_HOURS || 168);
  const maximumSourceAge = Number.isFinite(configuredSourceAge) && configuredSourceAge >= 1 ? configuredSourceAge : 168;
  const extractNarrativeContext = async url => {
    let publishedAt = null;
    const text = await extractArticleContext(url, { onPublicationDate: value => { publishedAt = value; } });
    if (publishedAt) {
      sourceDates.set(url, publishedAt);
      const age = (Date.now() - Date.parse(publishedAt)) / 3600000;
      if (age > maximumSourceAge || age < -1 / 12) {
        rejectedSourceDates.add(url);
        console.warn('      fonte descartada: publicação original fora da janela editorial, apesar da data do feed');
        return '';
      }
    }
    return text;
  };
  if (visualRebuild) {
    topic = visualRebuild.sourceEditorial.topic;
    context = visualRebuild.sourceContext;
    const sourceUrl = visualRebuild.sourceReview.sourceUrl || explicitUrl;
    if (sourceUrl) {
      article = {
        title: visualRebuild.sourceReview.sourceTitle || topic,
        link: sourceUrl,
        source: visualRebuild.sourceReview.sourceName,
        time: visualRebuild.sourceReview.sourceTimeLabel || 'data não informada'
      };
      originTitle = article.title;
      originUrl = sourceUrl;
    }
  } else if (recap) {
    const days = Number(arg('days', 7));
    const brief = await createRecapBrief({
      entries: await loadRecentTopics(days),
      theme,
      days,
      extractContext: extractArticleContext
    });
    console.log(`[0/5] RESUMO SEMANAL de ${theme.name} — ${brief.entries.length} pauta(s) elegível(is) do ledger nos últimos ${days} dias`);
    topic = brief.title;
    context = brief.context;
  } else if (auto && !explicitUrl) {
    const { huntHotTopics, candidateSignalLabel } = require('../utils/news-hunter');
    const used = await loadUsedTopics();
    console.log(`[0/5] Caçando a pauta MAIS QUENTE do tema "${theme.name}" entre várias fontes...`);
    const candidates = await huntHotTopics(used, theme.id);
    const configuredMaxTopicAge = Number(process.env.MAX_TOPIC_AGE_HOURS || 36);
    const maxTopicAgeHours = Number.isFinite(configuredMaxTopicAge) && configuredMaxTopicAge >= 1 ? configuredMaxTopicAge : 36;
    const configuredFallbackTopicAge = Number(process.env.MAX_TOPIC_FALLBACK_AGE_HOURS || 168);
    const fallbackTopicAgeHours = Number.isFinite(configuredFallbackTopicAge) && configuredFallbackTopicAge >= maxTopicAgeHours
      ? configuredFallbackTopicAge : Math.max(maxTopicAgeHours, 168);
    const topicSelection = selectRecentTopicCandidates(candidates, {
      primaryMaxAgeHours: maxTopicAgeHours,
      fallbackMaxAgeHours: fallbackTopicAgeHours
    });
    const freshCandidates = topicSelection.candidates;
    if (!freshCandidates.length) {
      console.warn(`      nenhuma pauta recente utilizável: ${candidates.length} candidata(s), 0 até ${maxTopicAgeHours}h e 0 até ${fallbackTopicAgeHours}h; o próximo ciclo tentará outra pauta`);
      const error = new Error('nenhuma pauta recente utilizável');
      error.code = 'no_fresh_topic_candidates';
      throw error;
    }
    if (topicSelection.usedFallback) {
      console.warn(`      sem pauta até ${maxTopicAgeHours}h; usando fonte de até ${fallbackTopicAgeHours}h e indicando a idade no vídeo`);
    }
    const corroboratedCandidates = freshCandidates.filter(candidate => Number(candidate.independentSources) >= 2);
    const rankedCandidates = corroboratedCandidates.length ? corroboratedCandidates : freshCandidates;
    let top = rankedCandidates[0];
    sourceAgeHours = Number(top.ageHours);
    if (!corroboratedCandidates.length) console.warn('      pauta sem segunda fonte independente disponível; seguindo com a melhor fonte recente');
    originTitle = top.title;
    originUrl = top.url || top.link || '';
    console.log(`      🔥 [${top.source}] score ${top.score.toFixed(2)} · ${top.ageHours.toFixed(0)}h · ${candidateSignalLabel(top)}`);
    console.log(`      "${top.title.slice(0, 100)}"`);
    // Use first-party links from the configured corroborating feeds. Google News
    // wrapper pages are only accepted when they resolve to the named publisher.
    let directUrl = '';
    let articleSource = top.source;
    const directCandidates = [
      ...(top.corroboratingArticles || []),
      { url: top.url || top.link || '', publisherUrl: top.publisherUrl || '', source: top.source }
    ];
    for (const candidate of directCandidates) {
      let candidateUrl = candidate.url || '';
      if (/news\.google\.com/i.test(candidateUrl)) {
        candidateUrl = await resolveGoogleNewsUrl(candidateUrl, candidate.publisherUrl || top.publisherUrl || '');
      }
      if (!candidateUrl) continue;
      const candidateContext = await extractNarrativeContext(candidateUrl);
      if (!directUrl) directUrl = candidateUrl;
      if (candidateContext.length > context.length) {
        directUrl = candidateUrl;
        context = candidateContext;
        articleSource = candidate.source || articleSource;
      }
      if (context.length >= 300 && context.split(/\s+/).filter(Boolean).length >= 40) break;
    }
    // Cobertura em PT: só adota se o título confirmar que é a mesma história.
    let ptCoverage = await fetchNewsReferences(top.title, 6);
    if (!ptCoverage.length) {
      const entities = top.title.split(/\s+/).filter(w => /^[A-Z]/.test(w) && w.length > 2).slice(0, 3).join(' ');
      ptCoverage = await fetchNewsReferences(`${entities} IA`, 6);
    }
    const matchingPtCoverage = ptCoverage
      .filter(candidate => !/hacker news|reddit/i.test(candidate.source))
      .filter(candidate => sameStoryTitle(candidate.title, top.title, 0.25));
    let pt = matchingPtCoverage[0] || null;
    topic = pt ? pt.title : top.title;
    if (shouldTryAlternativeCoverage(context) && matchingPtCoverage.length) {
      for (const candidate of matchingPtCoverage) {
        const ptUrl = await resolveGoogleNewsUrl(candidate.link, candidate.sourceUrl || '');
        if (!ptUrl) continue;
        const ptContext = await extractNarrativeContext(ptUrl);
        if (ptContext.length > context.length) {
          directUrl = ptUrl;
          context = ptContext;
          articleSource = candidate.source || articleSource;
          pt = candidate;
          topic = candidate.title;
        }
        if (context.length >= DEFAULT_MINIMUM_CONTEXT_CHARS
            && countWords(context) >= DEFAULT_MINIMUM_CONTEXT_WORDS) break;
      }
    }
    if (countWords(context) < 150) {
      const alternative = await findNarrativeReadyCandidate(
        rankedCandidates.slice(1).filter(candidate => !sameStoryTitle(top.title, candidate.title, 0.6)),
        {
          resolveGoogleNewsUrl,
          extractArticleContext: extractNarrativeContext,
          // RSS descriptions and some publisher pages are often too short for
          // a fact-reviewed narration. Search more distinct primary sources
          // before failing this theme's cycle; the 150-word evidence gate stays.
          maxFetches: 8,
          minimumWords: 150
        }
      );
      if (!alternative.candidate) {
        console.warn(`      pauta descartada: contexto extraído tem ${countWords(context)} palavra(s); ${alternative.fetches} fonte(s) alternativa(s) também não sustentaram uma narração`);
        const error = new Error('source_context_too_short');
        error.code = 'source_context_too_short';
        throw error;
      }
      top = alternative.candidate;
      topic = top.title;
      directUrl = alternative.url;
      articleSource = alternative.source || top.source;
      context = alternative.context;
      sourceAgeHours = Number(top.ageHours);
      originTitle = top.title;
      originUrl = top.url || top.link || alternative.url;
      console.warn(`      pauta de maior score descartada por contexto curto; usando ${articleSource} com ${alternative.contextWords} palavras verificáveis (${Number(top.ageHours).toFixed(0)}h)`);
    }
    article = { title: topic, link: directUrl, time: formatTopicAgeLabel(sourceAgeHours), source: articleSource };
    if (sourceDates.has(directUrl)) {
      sourceAgeHours = Math.max(0, (Date.now() - Date.parse(sourceDates.get(directUrl))) / 3600000);
      article.time = formatTopicAgeLabel(sourceAgeHours);
    }
    console.log(`      tema: "${topic.slice(0, 90)}" (${article.source})`);
    console.log(`      contexto: ${context.length} caracteres`);
  } else if (explicitUrl) {
    topic = arg('topic', '') || 'Atualizações de inteligência artificial';
    let pinnedSource = null;
    if (auto) {
      pinnedSource = validateGenerationArticle({ url: explicitUrl, title: topic,
        source: arg('source', ''), ageHoursAtCapture: Number(arg('source-age-hours', 'NaN')),
        capturedAt: arg('source-captured-at', ''), contextHash: arg('source-context-hash', '') });
      sourceAgeHours = generationArticleAgeHours(pinnedSource);
      if (sourceAgeHours > maximumSourceAge) throw Object.assign(new Error('source_snapshot_expired'), { code: 'source_snapshot_expired' });
    }
    console.log(`[0/5] Artigo indicado: ${explicitUrl}`);
    context = auto ? await extractNarrativeContext(explicitUrl) : await extractArticleContext(explicitUrl, {
      onPublicationDate: value => { if (value) sourceDates.set(explicitUrl, value); }
    });
    if (rejectedSourceDates.has(explicitUrl)) throw Object.assign(new Error('source_publication_date_expired'), { code: 'source_publication_date_expired' });
    if (pinnedSource && hashSourceContext(context) !== pinnedSource.contextHash) {
      throw Object.assign(new Error('source_context_changed'), { code: 'source_context_changed' });
    }
    if (!pinnedSource && sourceDates.has(explicitUrl)) {
      const age = (Date.now() - Date.parse(sourceDates.get(explicitUrl))) / 3600000;
      if (Number.isFinite(age) && age >= 0) sourceAgeHours = age;
    }
    article = { title: topic, link: explicitUrl, source: pinnedSource?.source || arg('source', ''),
      time: pinnedSource ? formatTopicAgeLabel(sourceAgeHours) : 'data não informada' };
    originTitle = topic;
    originUrl = explicitUrl;
    console.log(`      contexto extraído: ${context.length} caracteres`);
  } else if (fromG1) {
    console.log('[0/5] Buscando a primeira notícia de IA no G1...');
    article = await fetchG1Article();
    topic = article.title;
    console.log(`      "${topic.slice(0, 90)}"`);
    console.log(`      ${article.link}`);
    context = await extractArticleContext(article.link);
    console.log(`      contexto extraído: ${context.length} caracteres`);
  } else {
    topic = arg('topic', '5 avanços de IA que vão mudar 2026');
  }

  const sourceTitle = article?.title || topic;
  const sourceEvidence = assessSourceEvidence({
    sourceTitle,
    sourceUrl: article?.link,
    context,
    mode: recap ? 'recap' : auto ? 'auto' : article ? 'article' : 'manual_topic'
  });
  if (visualRebuild?.sourceReview.sourceHash
    && sourceEvidence.contextHash !== visualRebuild.sourceReview.sourceHash) {
    throw Object.assign(new Error('visual rebuild source context differs from the source QA manifest'), {
      code: 'visual_rebuild_source_context_mismatch'
    });
  }
  if (article?.link && sourceDates.has(article.link)) {
    sourceEvidence.publishedAt = sourceDates.get(article.link);
    sourceEvidence.dateProvenance = 'publisher';
  }
  if (recap && !sourceEvidence.eligible) {
    const error = new Error(`contexto de recap insuficiente para sustentar o roteiro: ${sourceEvidence.reason}`);
    error.code = sourceEvidence.reason || 'recap_source_context_insufficient';
    throw error;
  }
  if (!sourceEvidence.eligible) {
    console.warn(`      publicação automática bloqueada: ${sourceEvidence.reason}`);
    if (auto) {
      const error = new Error(sourceEvidence.reason || 'source_evidence_missing');
      error.code = sourceEvidence.reason || 'source_evidence_missing';
      throw error;
    }
  }

  // Slug do tema + output path
  const slug = (fromG1 ? 'g1_' : `${theme.id}_`) + topic.toLowerCase().replace(/[^a-z0-9]+/gi, '_').slice(0, 44);
  const outputName = `${slug}-gps-v2-${JOB_ID.slice(-10)}_animado.mp4`;
  const out = path.resolve(requestedOut || path.join(__dirname, '..', 'data', 'videos', outputName));
  const editorialFormat = resolveEditorialFormat({
    formatId: visualRebuild?.sourceEditorial.formatId || arg('format', null), seed: out
  });
  if (auto && article?.link && article.source && Number.isFinite(sourceAgeHours)) {
    const root = path.join(__dirname, '..');
    const store = createGenerationAttemptStore({ root,
      filePath: path.join(path.resolve(root, process.env.STATE_DIR || 'data/state'), 'generation-in-flight.json') });
    const attempt = await store.read();
    if (attempt?.jobId === JOB_ID && path.resolve(root, attempt.outPath) === out) {
      await store.write({ ...attempt, formatId: editorialFormat.id,
        article: { url: article.link, title: topic, source: article.source,
          ageHoursAtCapture: sourceAgeHours, capturedAt: new Date().toISOString(), contextHash: sourceEvidence.contextHash } });
    }
  }
  console.log(`[formato] ${editorialFormat.id} — ${editorialFormat.name}`);
  activeVideoId = videoIdForPath(out);
  generationStartedAt = Date.now();
  await fs.mkdir(path.dirname(out), { recursive: true });

  pipelineLogger.logContentPipeline('generation_started', activeVideoId, 'started', {
    jobId: JOB_ID, destination: 'local_render'
  });

  const boundedTargetWords = sourceBoundedWordTarget(targetWords, context);
  const targetLabel = boundedTargetWords < targetWords
    ? `até ${boundedTargetWords} (pedido ${targetWords})`
    : String(targetWords);
  console.log(`[1/5] Roteiro (${targetLabel} palavras) sobre: ${topic.slice(0, 70)}`);
  // Um master parcial pode existir antes de vertical, QA e ledger. Só pular
  // quando o checkpoint e uma entrada concluída do mesmo job forem comprovados.
  let resumeCompleted = false;
  if (process.argv.includes('--resume')) {
    const root = path.join(__dirname, '..');
    const stateRoot = path.resolve(root, process.env.STATE_DIR || 'data/state');
    const store = createGenerationAttemptStore({ root, filePath: path.join(stateRoot, 'generation-in-flight.json') });
    const attempt = await store.read();
    resumeCompleted = await isCompletedResumeOutput({ attempt, jobId: JOB_ID, outPath: out, root,
      ledgerPath: path.join(stateRoot, 'topics.json'), probeVideoHealth,
      isManagedVideo: async candidate => {
        const stat = await fs.lstat(candidate).catch(() => null);
        const real = await fs.realpath(candidate).catch(() => '');
        const relative = path.relative(path.join(root, 'data', 'videos'), real);
        return Boolean(stat?.isFile() && !stat.isSymbolicLink() && relative && !relative.startsWith('..') && !path.isAbsolute(relative));
      }
    });
  }
  if (resumeCompleted) {
    pipelineLogger.logContentPipeline('generation_resumed', activeVideoId, 'already_rendered', {
      jobId: JOB_ID, destination: 'local_render'
    });
    logGenerationFinished(pipelineLogger, {
      videoId: activeVideoId,
      jobId: JOB_ID,
      startedAt: generationStartedAt,
      status: 'completed'
    });
    console.log('[resume] vídeo já renderizado nesta execução — pulando geração');
    return;
  }
  // Scene generation owns the optional Gemini probe and its source-led
  // fallback. An image-provider outage must not abort factual script review.
  const reviewedScript = await loadOrWriteScript({
    topic,
    targetWords,
    slug,
    context,
    sourceTitle,
    sourceUrl: article?.link || '',
    sourceAgeHours,
    source: article?.source || '',
    sourceEvidence,
    originTitle,
    originUrl,
    theme,
    formatId: editorialFormat.id,
    visualRebuild,
    automatic: auto,
    // Context hash, request and TTL must match, and every cached script still
    // receives fresh deterministic source/evidence validation, including current freshness checks.
    allowCache: !auto || context.trim().length >= 300
  });
  const script = normalizeScript(reviewedScript.script, context);
  script.formatId = editorialFormat.id;
  script.formatVersion = visualRebuild?.sourceEditorial.formatVersion || 1;
  let publicationReview = reviewedScript.publicationReview;
  // Título canônico em PT-BR: o roteirista gera o título em português —
  // quando a pauta é de fonte gringa sem cobertura BR, é ele que aparece
  // no YouTube/TikTok/X (tudo voltado pro público do Brasil).
  const displayTitle = cleanText(script.title) || topic;
  console.log(`      título PT: "${displayTitle.slice(0, 80)}"`);
  // Seed por vídeo: garante que layouts, gráficos, cores e ordem de imagens
  // sejam diferentes em cada execução (vídeos únicos).
  script.channel = theme.brand || 'Pulso IA'; // marca do tema → watermark das cenas
  script.sourceLabel = article?.source || '';
  script.themeId = theme.id;
  script.visualPalettes = theme.visualPalettes || null;
  const requestedSeed = arg('seed', null);
  const parsedSeed = requestedSeed == null ? null : Number(requestedSeed);
  if (parsedSeed != null && (!Number.isSafeInteger(parsedSeed) || parsedSeed < 0)) {
    throw new Error(`--seed precisa ser um inteiro não negativo; recebido: ${requestedSeed}`);
  }
  script.seed = visualRebuild?.sourceEditorial.seed ?? parsedSeed ?? Math.floor(Math.random() * 1e9);
  console.log(`      seed: ${script.seed}`);
  const words = [script.hook, ...script.mainContent.sections.map(s => s.content), script.conclusion.finalThought].join(' ').split(/\s+/).filter(Boolean).length;
  console.log(`      ${script.mainContent.sections.length} seções | ~${words} palavras | ${script.mainContent.sections.filter(s => s.visual).length} gráficos`);

  console.log('[1.5/5] SEO dinâmico (título CTR + descrição + hashtags por notícia)');
  let seo = visualRebuild ? null : await generateSEO({ script, topic, article, theme, sourceAgeHours });
  if (seo && publicationReview?.status === 'approved') {
    const metadataReview = verifyEditorialMetadata(seo, script);
    if (!metadataReview.valid) {
      // SEO is optional. Keep the already-reviewed script title/description fallback
      // instead of publishing an unsupported generated claim or description.
      console.warn(`      metadados SEO sem sustentação local (${metadataReview.errors.map(error => error.code).join(',')}); usando fallback revisado`);
      seo = null;
    }
  }
  if (seo) console.log(`      título SEO: "${String(seo.youtubeTitle).slice(0, 80)}"`);

  // References overlap narration. Images wait for measured speech durations
  // so a short opening does not request unused variants in advance.
  console.log('[2-3.5/5] Narração e referências em paralelo; imagens conforme a duração narrada');
  const cacheDir = path.join(__dirname, '..', 'data', 'images', slug);
  const parallelT0 = Date.now();
  const narrationPromise = (async () => {
      const r = await synthesizeNarration(script, slug, path.dirname(out), visualRebuild?.narrationAudio || null);
      console.log(`      [tts] pronto em ${((Date.now() - parallelT0) / 60000).toFixed(1)} min`);
      return r;
  })();
  const [ttsResult, imagesResult, refsResult] = await Promise.all([
    narrationPromise,
    (async () => {
      if (noImages || visualRebuild?.sourceEditorial.visualMode === 'graphics-and-source-prints') {
        return { scenes: {}, thumbnailImage: '', portraitThumbnailImage: '', visualMode: 'graphics-and-source-prints', sceneImageAssets: [] };
      }
      const narration = await narrationPromise;
      const imgs = await generateSceneImages({ ...script, timings: narration.timings }, slug, topic, {
        sourceTitle,
        sourceUrl: article?.link || '',
        sourceContext: context,
        reuseOnly: Boolean(visualRebuild),
        replaySceneImages: visualRebuild?.sceneImageAssets || null
      });
      console.log(`      [imagens] prontas em ${((Date.now() - parallelT0) / 60000).toFixed(1)} min`);
      return imgs;
    })(),
    (async () => {
      if (visualRebuild) {
        script.news = visualRebuild.sceneReferences.newsItems;
        script.prints = visualRebuild.sceneReferences.prints;
        return visualRebuild.sceneReferences;
      }
      const candidateNewsItems = await fetchNewsReferences(topic).catch(() => []);
      const newsItems = filterSameStoryNewsReferences(candidateNewsItems, sourceTitle || topic);
      script.news = newsItems;
      const shots = [];
      if (article && article.link) shots.push({ url: article.link, source: publisherDisplayName(article.source, article.link), time: article.time, title: article.title, referenceIndex: -1 });
      for (const [referenceIndex, item] of newsItems.slice(0, 4).entries()) {
        if (shots.length >= 3) break;
        if (item.source === 'G1') continue;
        const realUrl = await resolveGoogleNewsUrl(item.link, item.sourceUrl || '');
        if (realUrl) {
          item.source = publisherDisplayName(item.source, realUrl);
          shots.push({ url: realUrl, source: item.source, time: item.time, title: item.title, referenceIndex });
        }
      }
      const renderedPrints = await screenshotArticles(shots, cacheDir);
      const prints = alignArticlePrints(shots, renderedPrints, newsItems.length);
      console.log(`      [prints] prontos em ${((Date.now() - parallelT0) / 60000).toFixed(1)} min (${shots.length} fonte(s) e ${newsItems.length}/${candidateNewsItems.length} manchetes da mesma pauta)`);
      const displayedNews = newsItems.length ? newsItems : article?.link
        ? [{ title: sourceTitle, source: publisherDisplayName(article.source, article.link), time: article.time, link: article.link,
          referenceLabel: 'Fonte da reportagem' }]
        : [];
      script.news = displayedNews;
      return { newsItems: displayedNews, prints };
    })()
  ]);
  const { audioPath, timings } = ttsResult;
  script.timings = timings;
  const total = ttsResult.totalDurationMs || timings.reduce((n, t) => n + t.durationMs, 0);
  const images = imagesResult.scenes;
  const thumbnailArt = imagesResult.thumbnailImage;
  const portraitThumbnailArt = imagesResult.portraitThumbnailImage;
  script.visualMode = imagesResult.visualMode || sceneVisualMode(images, script.mainContent.sections.length + 2);
  script.prints = refsResult.prints;
  if (visualRebuild && !['narrative-episode-v1', 'narrative-episode-v2'].includes(visualRebuild.sourceEditorial.visualMode)
    && script.visualMode !== visualRebuild.sourceEditorial.visualMode) {
    throw Object.assign(new Error('visual rebuild scene image mode differs from the source QA manifest'), {
      code: 'visual_rebuild_visual_mode_mismatch'
    });
  }
  console.log(`      modo visual: ${script.visualMode}`);
  console.log(`      duração do áudio: ${(total / 60000).toFixed(1)} min`);
  script.mainContent.sections.forEach((s, k) => {
    const referenceIndex = getNewsReferenceIndex(k, refsResult.newsItems.length);
    s.news = referenceIndex === null ? null : refsResult.newsItems[referenceIndex];
    s.print = referenceIndex === null ? null : script.prints[referenceIndex + 1] || null;
  });

  console.log('[4/5] Autoria do plano narrativo e render Remotion horizontal + vertical');
  // Long image/TTS preparation can overlap a background training job. Recheck
  // before paying for remote scene authorship when the host can no longer render.
  assertRenderCapacity();
  const baseEpisodePlan = await createNarrativeEpisodePlan({
    jobId: JOB_ID, script, themeId: theme.id, fps: Number(process.env.ANIMATED_FPS || 24),
    durationMs: total, timings, audioPath,
    sourceEvidence, publicationReview,
    sceneImageAssets: imagesResult.sceneImageAssets || [],
    root: path.join(__dirname, '..')
  }).catch(error => {
    if (error?.code && error.code !== 'Error' && error.code !== error.name) throw error;
    throw Object.assign(new Error('plano base do episódio narrativo não pôde ser compilado'), {
      code: 'NARRATIVE_EPISODE_PLAN_BUILD_FAILED', cause: error,
      causeFailureCode: safeErrorTag(error)
    });
  });
  console.log(`      plano base validado: ${baseEpisodePlan.chapters.length} capítulos, ${baseEpisodePlan.sentences.length} frases`);
  const projectRoot = path.join(__dirname, '..');
  const resumeStateDir = path.resolve(projectRoot, process.env.STATE_DIR || 'data/state');
  let episodePlan = await loadPinnedNarrativePlan({ root: projectRoot, stateDir: resumeStateDir, outputPath: out, basePlan: baseEpisodePlan });
  const { assertNarrativeIllustration, authorWithIllustrationRepair } = require('../utils/narrative-illustration-audit');
  if (episodePlan) console.log('      plano visual fixado para esta saída reutilizado após validar roteiro, áudio e fonte');
  else {
    episodePlan = await authorWithIllustrationRepair({
      author: authorNarrativeScenes,
      options: { plan: baseEpisodePlan, sourceContext: context, logger: console },
      visualCritique: visualRebuild?.findings || []
    }).catch(error => {
      if (error?.code && error.code !== 'Error' && error.code !== error.name) throw error;
      throw Object.assign(new Error('autoria visual narrativa não pôde ser validada'), {
        code: 'NARRATIVE_SCENE_AUTHOR_FAILED', cause: error,
        causeFailureCode: safeErrorTag(error)
      });
    });
    await savePinnedNarrativePlan({ root: projectRoot, stateDir: resumeStateDir, outputPath: out, plan: episodePlan });
  }
  // Literal words on an otherwise empty stage are not an illustration.
  // Recheck pinned plans too: an old cached plan is not evidence of quality.
  assertNarrativeIllustration(episodePlan);
  script.visualMode = 'narrative-episode-v2';
  console.log(`      ${episodePlan.scenes.length} cenas narrativas; ${episodePlan.sentences.length}/${episodePlan.sentences.length} frases vinculadas a ações ou câmera`);
  const renderStartedAt = Date.now();
  pipelineLogger.logContentPipeline('render_started', activeVideoId, 'started', {
    jobId: JOB_ID, destination: 'local_render'
  });
  const portraitOut = out.replace(/\.mp4$/i, '-portrait.mp4');
  const renderer = new NarrativeEpisodeRenderer({ logger: console });
  await renderer.renderEpisode({
    plan: episodePlan, audioPath, outputPath: out, portraitOutputPath: portraitOut
  }).catch(error => {
    if (error?.code && error.code !== 'Error' && error.code !== error.name) throw error;
    throw Object.assign(new Error('renderer narrativo falhou sem código de diagnóstico'), {
      code: 'NARRATIVE_RENDER_FAILED', cause: error,
      causeFailureCode: safeErrorTag(error)
    });
  });
  const episodePlanSha256 = sha256Buffer(Buffer.from(stableJson(episodePlan)));
  const scenePlanAudit = {
    schemaVersion: 1, sha256: episodePlanSha256, baseSha256: episodePlanSha256,
    sceneIds: episodePlan.scenes.map(scene => scene.id),
    visualRhythm: { schemaVersion: 1, rule: 'long-cue-shot-variation-v1', status: 'passed', planSha256: episodePlanSha256 }
  };
  if (visualRebuild) {
    const correctionSetSha256 = sha256Buffer(Buffer.from(stableJson(visualRebuild.findings)));
    scenePlanAudit.baseSha256 = visualRebuild.sourceScenePlanSha256;
    scenePlanAudit.rebuild = {
      sourceQaManifestSha256: visualRebuild.sourceQaManifestSha256,
      critiqueManifestSha256: visualRebuild.critiqueManifestSha256,
      correctionSetSha256,
      sourceScenePlanSha256: visualRebuild.sourceScenePlanSha256,
      sceneIds: scenePlanAudit.sceneIds,
      correctionsApplied: visualRebuild.findings.length
    };
  }
  const st = await fs.stat(out);
  const portraitStat = await fs.stat(portraitOut);
  pipelineLogger.logContentPipeline('render_finished', activeVideoId, 'completed', {
    jobId: JOB_ID, destination: 'local_render_pair', durationMs: Date.now() - renderStartedAt
  });
  console.log(`      masters concluídos: horizontal ${st.size} bytes; vertical ${portraitStat.size} bytes`);

  // Render the cover only after the video is complete. Its short hook and image grade
  // stay in the PNG and never enter the script, narration, clips, or rendered video.
  let thumbPath = '';
  let portraitThumbPath = '';
  let thumbnailSource = null;
  if (!process.argv.includes('--no-thumb')) {
    const thumbnailStartedAt = Date.now();
    try {
      const thumbOut = path.join(path.dirname(out), `thumb_${path.basename(out, '.mp4')}.png`);
      const palette = selectThemePalette(script.visualPalettes, script.seed);
      const thumbnailHeadline = chooseLocalizedThumbnailHeadline({
        candidate: seo?.thumbnailHeadline,
        seoTitle: seo?.youtubeTitle,
        displayTitle,
        sourceTitle,
        script
      });
      const generatedHero = selectThumbnailHeroImage(images[0], thumbnailArt);
      const sourceCover = (!generatedHero || !portraitThumbnailArt) && article?.link
        ? await fetchSourceCoverImage(article.link) : null;
      if (sourceCover) {
        const imageSha256 = sha256Buffer(sourceCover.bytes);
        await fs.mkdir(cacheDir, { recursive: true });
        const sourceImagePath = path.join(cacheDir, `cover-source-${imageSha256}.img`);
        try { await fs.writeFile(sourceImagePath, sourceCover.bytes, { flag: 'wx', mode: 0o600 }); }
        catch (error) {
          if (error.code !== 'EEXIST' || sha256Buffer(await fs.readFile(sourceImagePath)) !== imageSha256) throw error;
        }
        thumbnailSource = { articleUrl: sourceCover.articleUrl, imageUrl: sourceCover.sourceUrl,
          imageSha256, imagePath: path.relative(projectRoot, sourceImagePath), ...(sourceCover.credit ? { credit: sourceCover.credit } : {}) };
      }
      await renderThumbnail({
        title: displayTitle,
        headline: thumbnailHeadline,
        accent: palette?.accents?.[0] || script.background?.accent,
        brand: script.channel,
        heroImage: generatedHero || sourceCover?.dataUrl || '',
        topic: displayTitle || theme.name,
        hook: thumbnailHeadline,
        outPath: thumbOut
      });
      const portraitThumbOut = path.join(path.dirname(out), `thumb_${path.basename(out, '.mp4')}-portrait.png`);
      await renderThumbnail({
        title: displayTitle,
        headline: thumbnailHeadline,
        accent: palette?.accents?.[0] || script.background?.accent,
        brand: script.channel,
        heroImage: portraitThumbnailArt || sourceCover?.dataUrl || '',
        topic: displayTitle || theme.name,
        hook: thumbnailHeadline,
        outPath: portraitThumbOut,
        portrait: true
      });
      thumbPath = path.relative(path.join(__dirname, '..'), thumbOut);
      portraitThumbPath = path.relative(path.join(__dirname, '..'), portraitThumbOut);
      pipelineLogger.logContentPipeline('thumbnail_finished', activeVideoId, 'completed', {
        jobId: JOB_ID, destination: 'cover_art_pair', durationMs: Date.now() - thumbnailStartedAt
      });
    } catch (error) {
      pipelineLogger.logContentPipeline('thumbnail_finished', activeVideoId, 'failed', {
        jobId: JOB_ID, destination: 'cover_art', durationMs: Date.now() - thumbnailStartedAt,
        errorCode: error.code || error.name || 'thumbnail_error'
      });
      console.warn(`      par de capas incompleto; publicação permanece retida (vídeo mantido): ${safeErrorTag(error)}`);
    }
  }

  // Partes sociais narrativas verticais, com duração e enquadramento por destino.
  let clips = [];
  if (!process.argv.includes('--no-clips')) {
    console.log('[4.5/5] Partes narrativas verticais por plataforma');
    const { makeNarrativeSocialParts } = require('../utils/clip-maker');
    const clipsDir = path.join(path.dirname(out), 'clips', JOB_ID);
    try {
      clips = await makeNarrativeSocialParts({
        script,
        images: imagesResult.scenes,
        outDir: path.join(clipsDir, 'narrative'),
        baseName: JOB_ID,
        portraitVideoPath: portraitOut,
        visualMode: 'explanatory'
      });
      const platformParts = new Map();
      for (const clip of clips) {
        for (const platform of clip.platforms || []) platformParts.set(platform, (platformParts.get(platform) || 0) + 1);
      }
      console.log(`      ${clips.length} partes narrativas 1080x1920 geradas a 30 fps (${[...platformParts].map(([platform, count]) => `${platform}: ${count}`).join(', ') || 'nenhum destino elegível'})`);
    } catch (error) {
      console.warn(`      partes narrativas sociais não geradas; master preservado (${safeErrorTag(error)})`);
    }
  }

  const qa = await writeVideoQaManifest({
    root: path.join(__dirname, '..'),
    videoPath: out,
    relatedMasters: [{ path: portraitOut, role: 'portrait_master' }],
    clips,
    videoId: activeVideoId,
    jobId: JOB_ID,
    themeId: theme.id,
    topic,
    targetWords,
    formatId: script.formatId,
    formatVersion: script.formatVersion,
    scriptRevision: SCRIPT_REVISION,
    seed: script.seed,
    hook: script.hook?.text || script.hook,
    hookStructureId: script.hookStructureId,
    narrationTimings: script.timings,
    narrationAudio: { path: ttsResult.narrationCachePath || audioPath, inputSha256: ttsResult.narrationInputSha256 },
    sourceContext: context,
    scriptCache: { path: reviewedScript.cachePath, metadataPath: reviewedScript.cacheMetaPath },
    sceneImageAssets: imagesResult.sceneImageAssets || [],
    sceneReferences: refsResult,
    thumbnailPath: thumbPath ? path.join(__dirname, '..', thumbPath) : null,
    portraitThumbnailPath: portraitThumbPath ? path.join(__dirname, '..', portraitThumbPath) : null,
    thumbnailSource,
    sourceEvidence,
    sourceName: article?.source || '',
    sourceTimeLabel: article?.time || '',
    publicationReview,
    renderer: RENDERER_ID,
    experimentId: process.env.VIDEO_EXPERIMENT_ID || null,
    visualMode: script.visualMode,
    scenePlan: scenePlanAudit
  });
  if (qa.manifest.technicalStatus !== 'passed') {
    const error = new Error('video_technical_qa_failed');
    error.code = 'video_technical_qa_failed';
    throw error;
  }
  console.log(`      QA técnico por hash: aprovado (${qa.manifest.assets.length} artefato(s))`);

  await recordTopic({
    jobId: JOB_ID,
    videoId: activeVideoId,
    renderer: RENDERER_ID,
    formatId: script.formatId,
    formatVersion: script.formatVersion,
    hook: script.hook?.text || script.hook || '',
    experimentId: process.env.VIDEO_EXPERIMENT_ID || null,
    theme: theme.id, // réplica: rastreio de qual canal gerou
    title: displayTitle,
    url: article ? article.link : '',
    source: article ? article.source : (recap ? 'RESUMO' : 'tema'),
    sourceEvidence,
    qaManifestPath: qa.manifestPath,
    qaManifestSha256: qa.manifestSha256,
    publicationEligible: sourceEvidence.eligible
      && publicationReview?.status === 'approved'
      && publicationReview?.sourceHash === sourceEvidence.contextHash,
    publicationReview,
    ...(!(sourceEvidence.eligible && publicationReview?.status === 'approved'
      && publicationReview?.sourceHash === sourceEvidence.contextHash)
      ? { publicationHold: { reason: sourceEvidence.reason || (publicationReview?.status === 'rejected'
        ? 'source_claims_unverified' : 'publication_review_unverified') } } : {}),
    originTitle, originUrl,
    videoPath: out,
    portraitVideoPath: portraitOut,
    clips: clips.map(c => ({
      path: c.path,
      title: c.title,
      ...(Array.isArray(c.platforms) ? { platforms: c.platforms } : {}),
      ...(Number.isInteger(c.partIndex) ? { partIndex: c.partIndex } : {}),
      ...(Number.isInteger(c.partCount) ? { partCount: c.partCount } : {}),
      ...(typeof c.kind === 'string' ? { kind: c.kind } : {}),
      formatId: script.formatId,
      formatVersion: script.formatVersion,
      experimentId: process.env.VIDEO_EXPERIMENT_ID || null
    })),
    ...(thumbPath ? { thumbnailPath: thumbPath } : {}),
    ...(portraitThumbPath ? { portraitThumbnailPath: portraitThumbPath } : {}),
    ...(thumbnailSource ? { thumbnailSource } : {}),
    ...(seo ? { seo: { youtubeTitle: seo.youtubeTitle, description: seo.description, hashtags: seo.hashtags } } : {})
  });
  if (visualCritiqueManifestPath) {
    console.log('      reconstrução visual concluída; QA visual permanece pendente e sem liberação automática');
  } else {
    try {
      const { applyDelegatedPublicationReview } = require('../utils/delegated-publication-review');
      const release = await applyDelegatedPublicationReview({
        root: path.join(__dirname, '..'), manifestPath: qa.manifestPath
      });
      console.log(`      Política de revisão: ${release.status}${release.reason ? ` (${release.reason})` : ''}`);
    } catch (error) {
      // Preserve the completed job. A review failure holds publication, and must
      // never make the producer generate a second copy of the same completed video.
      console.warn(`      liberação automática não concluída; mídia preservada (${safeErrorTag(error)})`);
    }
  }
  logGenerationFinished(pipelineLogger, {
    videoId: activeVideoId,
    jobId: JOB_ID,
    startedAt: generationStartedAt,
    status: 'completed'
  });
  console.log(`[5/5] OK -> ${out} (${(st.size / 1048576).toFixed(1)} MB)`);
}

if (require.main === module) {
  main().catch(error => {
    logGenerationFinished(pipelineLogger, {
      videoId: activeVideoId || 'unassigned',
      jobId: JOB_ID,
      startedAt: generationStartedAt,
      status: 'failed',
      errorCode: safeErrorTag(error)
    });
    pipelineLogger.logErrorWithContext({
      name: error.name, failureCode: safeErrorTag(error),
      ...(error.causeFailureCode ? { causeFailureCode: error.causeFailureCode } : {})
    }, {
      jobId: JOB_ID, ...(activeVideoId ? { videoId: activeVideoId } : {}), destination: 'local_render',
      ...(error.code ? { stage: error.code } : {})
    });
    console.error('FALHA: geração interrompida', safeErrorTag(error),
      error.causeFailureCode ? `(causa ${error.causeFailureCode})` : '');
    process.exit(1);
  });
}

module.exports = {
  critiqueScript,
  parseScriptJson,
  parseScriptResponseContent,
  parseScriptChoice,
  narrativeSectionCount,
  parseReviewResponseContent,
  parseReviewChoice,
  sourceBoundedWordTarget,
  factRepairWordTarget,
  factRepairGuidance,
  buildScriptRepairPrompt,
  buildScriptRepairTasks,
  scriptGenerationRequestOptions,
  scriptGenerationModelsForRetry,
  repairExcludedWriters,
  scriptGenerationCandidatesForRetry,
  scriptFailureDisablesProvider,
  scriptProviderUsageService,
  scriptReviewCandidatesForRetry,
  SCRIPT_GENERATION_MAX_FALLBACKS,
  SCRIPT_GENERATION_MAX_CALLS,
  SCRIPT_REVIEW_MAX_REPAIRS,
  scriptReviewRequestOptions,
  scriptReviewReasoningOptions,
  scriptReviewTimeoutMs,
  shouldTryAlternativeCoverage,
  automaticReviewFailure,
  scriptGateFailure,
  generateSEO,
  loadOrWriteScript,
  SCRIPT_GENERATION_MODELS,
  SCRIPT_GENERATION_MIN_TOKENS,
  SCRIPT_REVIEW_MAX_TOKENS,
  SCRIPT_REVIEW_CONCURRENCY,
  SCRIPT_REVIEW_MODELS,
  SCRIPT_REVISION,
  synthesizeNarration,
  generateSceneImages,
  screenshotArticles,
  shouldStopSceneImageAttempts,
  sceneVisualMode,
  normalizeScript,
  productionMotionVisualGuidance,
  visualItemIsSourceGrounded,
  stripUnsupportedScriptVisuals,
  hasUnsupportedSingleFunderTitle,
  reviewScriptDeterministically
};
