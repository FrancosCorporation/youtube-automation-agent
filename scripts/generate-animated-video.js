#!/usr/bin/env node
/**
 * End-to-end animated video generator (Linear/Vercel style + AI images).
 *   G1 (--from-g1) ou tema -> roteiro contextual (NVIDIA) -> narração sincronizada
 *   (edge-tts + SRT) -> imagens IA (Gemini web, 6/seção) -> prints reais de artigos
 *   -> cenas com gráficos variados + news-cards + legendas sincronizadas -> mp4
 *
 * Usage:
 *   node scripts/generate-animated-video.js --from-g1 [--words 950] [--out data/videos/x.mp4]
 *   node scripts/generate-animated-video.js --topic "..." [--words 1100] [--no-images]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');
const sharp = require('sharp');
const { HyperFramesVideoRenderer } = require('../utils/hyperframes-video-renderer');
const { GeminiWebImageGenerator } = require('../utils/gemini-web-image');
const { getMediaDuration, checkFFmpeg, runFFmpeg } = require('../utils/ffmpeg');
const { updateTopicLedger } = require('../utils/topic-ledger');
const SCRIPT_REVISION = 'retention-emotions-v4-robot3d';
const RENDERER_ID = 'hyperframes-0.8.149-pulso-robot-v1';
const configuredCacheTtl = Number(process.env.SCRIPT_CACHE_TTL_HOURS || 24);
const SCRIPT_CACHE_TTL_HOURS = Number.isFinite(configuredCacheTtl) && configuredCacheTtl >= 1 ? configuredCacheTtl : 24;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const stripTags = html => String(html || '')
  .replace(/<[^>]+>/g, ' ').replace(/&\w+;/g, ' ').replace(/\s+/g, ' ').trim();

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

// Strongest content words — steer the image prompts toward the real subject.
function topKeywords(text, n = 5) {
  const stop = new Set(['para', 'com', 'uma', 'dos', 'das', 'que', 'não', 'por', 'sobre', 'como', 'mais', 'mas',
    'seus', 'suas', 'esse', 'essa', 'isso', 'entre', 'ainda', 'quando', 'onde', 'pelo', 'pela', 'ser', 'são',
    'está', 'têm', 'foi', 'the', 'and', 'for', 'este', 'esta', 'àquela', 'depois', 'antes', 'também', 'pode',
    'todo', 'toda', 'muito', 'sem', 'nos', 'nas', 'aos', 'ele', 'ela', 'você']);
  const counts = {};
  for (const w of String(text).toLowerCase().replace(/[^\wà-ú\s]/g, ' ').split(/\s+/)) {
    if (w.length > 4 && !stop.has(w)) counts[w] = (counts[w] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
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
  const res = await fetch('https://g1.globo.com/rss/g1/tecnologia/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`g1 rss ${res.status}`);
  const xml = await res.text();
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

async function extractArticleContext(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' } });
    if (!res.ok) return '';
    const html = await res.text();
    const paragraphs = [];
    const re = /<p[^>]*>([\s\S]*?)<\/p>/g;
    let m;
    while ((m = re.exec(html)) && paragraphs.join(' ').length < 2600) {
      const text = stripTags(m[1]);
      if (text.length > 40) paragraphs.push(text);
    }
    return paragraphs.join(' ').slice(0, 2600);
  } catch (_e) {
    return '';
  }
}

/* ---------------- roteiro (NVIDIA) ---------------- */

function parseScriptJson(text) {
  let t = String(text);
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('resposta sem JSON');
  t = t.slice(start, end + 1);
  const noTrailing = t.replace(/,\s*([}\]])/g, '$1');
  const openCurly = (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length;
  const openSquare = (t.match(/\[/g) || []).length - (t.match(/\]/g) || []).length;
  const balanced = noTrailing + ']'.repeat(Math.max(0, openSquare)) + '}'.repeat(Math.max(0, openCurly));
  const candidates = [t, noTrailing, balanced, balanced.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')]; // eslint-disable-line no-control-regex -- regex intencional: limpa caracteres de controle que quebram o JSON.parse
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch (_e) { /* try the next repair */ }
  }
  throw new Error('JSON irreparável');
}

async function writeScriptWithNvidia({ topic, targetWords, context, extraFeedback, theme }) {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error('NVIDIA_API_KEY ausente');
  // Controle de custo: gate ANTES de gastar (não só relatório pós-fato).
  const { recordCall, assertBudget } = require('../utils/api-usage');
  const nvidiaLimit = Number(process.env.NVIDIA_CALLS_PER_DAY || 200);
  await assertBudget('nvidia', nvidiaLimit);

  const sourceBlock = context
    ? `Baseie o vídeo nesta NOTÍCIA REAL (fonte: G1): "${topic}". Trecho do artigo: """${context}""" Aprofunde e explique esse fato para o público geral; use informações do artigo como a base factual.`
    : `Tema atual: "${topic}".`;

  const isComparison = /compar|guerra|versus|\bvs\b|melhor|contra|rival|avalia|nota|benchmark|test/i.test(topic + ' ' + (context || ''));
  const visualRule = isComparison
    ? `O tema envolve comparação/avaliação. Quando natural na narração, cite NOTAS ou métricas (de preferência números REAIS do artigo; se não houver, avaliações típicas de especialistas) e em CADA seção onde opções são comparadas adicione "visual": {"type":"score-compare","title":"critério curto","items":[{"label":"NomeCurto","score":9.2},...]} com 2 a 4 itens — as notas DEVEM ser as mesmas citadas na narração.`
    : `O tema é explicativo. Não invente estatísticas; use números do artigo quando existirem.`;

  const persona = theme?.persona || 'roteirista de um canal de YouTube em PORTUGUÊS DO BRASIL sobre tecnologia/atualidades';
  const sectionCount = Math.max(3, Math.min(7, Math.round(targetWords / 130)));
  const sectionWordTarget = Math.round(targetWords / sectionCount);
  const prompt = `Você é ${persona}.
${sourceBlock}
Escreva um roteiro narrado para um vídeo de ~${Math.round(targetWords / 150)} minutos (${targetWords} palavras).
IDIOMA — REGRA INVIOLÁVEL: TODO o conteúdo (title, hook, sections, conclusion) deve estar 100% em PORTUGUÊS DO BRASIL. Se o tema/artigo estiver em inglês, TRADUZA e ADAPTE para PT-BR. É PROIBIDO escrever qualquer parte em inglês.
ESTRUTURA — RETENÇÃO COM PAYOFF: o hook deve ter 7–12 palavras, ser específico e criar uma pergunta mental ou consequência concreta; nunca prometa algo que o vídeo não responde. Sem saudação, apresentação do canal ou frases como "você não vai acreditar". Até 15 segundos, explique por que o assunto importa. Cada seção introduz informação nova, usa ao menos um exemplo concreto e fecha com uma ponte curta para a próxima. Plante perguntas e responda dentro do vídeo; não empilhe cliffhangers.
RITMO DE FALA: alterne frases curtas e médias, corte contexto óbvio e repetições. A cada seção, inclua uma mudança de ideia, escala ou perspectiva que possa virar um novo plano visual. Não force suspense em temas leves, nem dramatize fatos sem evidência. A conclusão paga a promessa do hook e termina com CTA natural de uma frase.
Regras: fala natural em PT-BR (sem "Seção 1"), explicação clara, contexto correto e exemplos visuais concretos. Não invente estatísticas, falas, causas ou detalhes para aumentar o drama. ${visualRule}${extraFeedback ? `\n\nFEEDBACK DO EDITOR-CHEFE (corrija isto na sua nova versão): ${extraFeedback}` : ''}
Responda SOMENTE um objeto JSON válido e COMPLETO: {"title":"...","hook":"...","hookEmotion":"curiosity","sections":[{"title":"...","content":"parágrafo falado com cerca de ${sectionWordTarget} palavras","emotion":"curiosity","visual":{"type":"score-compare","title":"...","items":[{"label":"...","score":9.1}]},"imagePrompt":"..."}],"conclusion":"..."} com exatamente ${sectionCount} seções e cerca de ${targetWords} palavras no total. Use um único valor de emoção entre curiosity, surprise, tension, empathy, wonder e confidence. O campo "visual" é opcional. Escolha a emoção pelo sentimento real da seção, sem forçar drama.
OBRIGATÓRIO em cada seção: imagePrompt em inglês, 25–45 palavras, descrevendo o assunto, os objetos e o local de forma específica e cinematográfica. Não descreva pessoas nem expressões nesse campo; o estúdio aplica uma apresentadora recorrente depois. Evite arte abstrata e cenário futurista genérico. Sem texto nas imagens.
Nunca use markdown (sem asteriscos, _, #) no texto falado.`;

  const MODELS = [
    'nvidia/nemotron-3-ultra-550b-a55b',
    'nvidia/nemotron-3-super-120b-a12b',
    'nvidia/nemotron-3.5-lightning-30b-a3b',
    'openai/gpt-oss-20b',
    'mistralai/mistral-large-2-instruct'
  ];
  let lastError = null;
  let languageStrikes = 0;
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const enforce = languageStrikes > 0
          ? `\n\nATENÇÃO: sua resposta anterior saiu em INGLÊS. Responda obrigatoriamente em PORTUGUÊS DO BRASIL.`
          : '';
        const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt + enforce }], max_tokens: 12000, temperature: attempt === 1 ? 0.6 : 0.3 })
        });
        await recordCall('nvidia');
        if (!res.ok) {
          const error = new Error(`nvidia ${res.status} (${model})`);
          error.status = res.status;
          throw error;
        }
        const data = await res.json();
        const script = parseScriptJson(data.choices?.[0]?.message?.content || '');
        // Guard de idioma: roteiro em inglês é reprovado na hora.
        const sample = [script.title, script.hook, ...(script.sections || []).map(s => s.content)].join(' ');
        if (isEnglish(sample)) {
          languageStrikes++;
          throw new Error(`roteiro saiu em inglês (strike ${languageStrikes})`);
        }
        return script;
      } catch (error) {
        lastError = error;
        console.warn(`      ${model} tentativa ${attempt} falhou: ${error.message}`);
        // Backoff exponencial com mais paciência em rate-limit (429):
        // base 1.5s; 429 dobra o tempo base (3s/6s) — repetir rápido só piora.
        const base = error.status === 429 ? 3000 : 1500;
        await new Promise(r => setTimeout(r, base * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw new Error(`roteiro inválido: ${lastError && lastError.message}`);
}

// Normalize the NVIDIA script to the shape the renderer expects.
function normalizeScript(script) {
  script.title = cleanText(script.title);
  script.mainContent = {
    sections: (script.sections || []).map(s => ({
      title: cleanText(s.title) || 'Seção',
      content: cleanText(typeof s.content === 'string' ? s.content : JSON.stringify(s.content || '')),
      emotion: normalizeEmotion(s.emotion, `${s.title || ''} ${s.content || ''}`),
      visual: s.visual && Array.isArray(s.visual.items) && s.visual.items.length >= 2
        ? { ...s.visual, items: s.visual.items.map(it => ({ label: cleanText(it.label).slice(0, 18), score: Number(it.score) || 5 })) }
        : null,
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
    const entries = (raw.entries || []).slice(-80);
    return {
      titles: entries.map(e => e.title).filter(Boolean),
      urls: entries.map(e => e.origUrl || e.url).filter(Boolean)
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { titles: [], urls: [] };
    throw new Error(`ledger de pautas ilegível; geração cancelada para evitar repetição: ${error.message}`);
  }
}

async function recordTopic(entry) {
  const ledgerPath = path.join(__dirname, '..', process.env.STATE_DIR || 'data/state', 'topics.json');
  await updateTopicLedger(ledgerPath, raw => {
    raw.entries = raw.entries || [];
    raw.entries.push({ ...entry, generatedAt: new Date().toISOString() });
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
 * Crítico de roteiro — segunda passada de LLM ANTES de narrar (ninguém filma
 * o primeiro rascunho). Verifica gancho, idioma, coerência e tamanho.
 * Falha do crítico nunca bloqueia: segue com o rascunho original.
 */
async function critiqueScript(script, topic) {
  const key = process.env.NVIDIA_API_KEY;
  if (!key || process.env.NO_SCRIPT_CRITIC === '1') return null;
  // Crítico é opcional: sem orçamento sobrando, segue sem revisão (não bloqueia).
  const { recordCall, usedToday } = require('../utils/api-usage');
  const nvidiaLimit = Number(process.env.NVIDIA_CALLS_PER_DAY || 200);
  if (!(await usedToday('nvidia') < nvidiaLimit)) {
    console.log('      crítico pulado: orçamento diário da NVIDIA esgotado');
    return null;
  }
  const modelo = 'nvidia/nemotron-3.5-lightning-30b-a3b';
  const resumo = JSON.stringify({
    title: script.title,
    hook: script.hook,
    hookEmotion: script.hookEmotion,
    sections: (script.sections || []).map(s => ({ title: s.title, content: s.content, emotion: s.emotion })),
    conclusion: script.conclusion
  }).slice(0, 9000);
  const prompt = `Você é editor-chefe exigente de um canal de YouTube em português do Brasil. Avalie o roteiro JSON abaixo (pauta: "${topic}").
Critérios: (1) hook curto, específico e compreensível nos primeiros segundos, sem clickbait ou promessa sem payoff? (2) até 15 segundos fica claro por que isso importa? (3) cada seção acrescenta informação, exemplo concreto e transição sem repetição? (4) tom e emoção combinam com os fatos? (5) texto PT-BR falado natural e sem detalhes inventados? (6) conclusão paga o hook e fecha com CTA curto? (7) tamanho equilibrado (seções de ~90-150 palavras)?
Responda SOMENTE JSON: {"verdict":"aprovado"|"reprovado","feedback":"máx 2 frases, instrução concreta de correção; se aprovado, string vazia"}
ROTEIRO: ${resumo}`;
  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelo, messages: [{ role: 'user', content: prompt }], max_tokens: 400, temperature: 0.2 })
    });
    await recordCall('nvidia');
    if (!res.ok) throw new Error(`nvidia ${res.status}`);
    const data = await res.json();
    return parseScriptJson(data.choices?.[0]?.message?.content || '');
  } catch (error) {
    console.warn(`      crítico indisponível (seguindo sem revisão): ${error.message}`);
    return null;
  }
}

/**
 * SEO dinâmico — título virado para CTR + descrição + hashtags geradas
 * por notícia (nada de descrição/hashtags fixas no scheduler).
 */
async function generateSEO({ script, topic, article, theme }) {
  const key = process.env.NVIDIA_API_KEY;
  if (!key || process.env.NO_SEO === '1') return null;
  // SEO é opcional: sem orçamento sobrando, usa fallback (não bloqueia).
  const { recordCall, usedToday } = require('../utils/api-usage');
  const nvidiaLimit = Number(process.env.NVIDIA_CALLS_PER_DAY || 200);
  if (!(await usedToday('nvidia') < nvidiaLimit)) {
    console.log('      SEO pulado: orçamento diário da NVIDIA esgotado');
    return null;
  }
  const modelo = 'nvidia/nemotron-3.5-lightning-30b-a3b';
  // Persona do SEO também segue o tema da instância (réplica).
  const seoPromptPersona = theme?.persona || 'especialista em SEO de YouTube em português do Brasil (canal de notícias de IA)';
  const prompt = `Você é ${seoPromptPersona}.
Pauta: "${topic}"${article && article.source ? ` (fonte: ${article.source})` : ''}
Título do roteiro: "${script.title}"
Responda SOMENTE JSON: {"youtubeTitle":"título para CTR máximo, até 70 caracteres, português do Brasil, promessa clara sem clickbait mentiroso","description":"2-3 frases descrevendo o vídeo + convite de inscrição; sem hashtags no texto","hashtags":"3 hashtags com # separadas por espaço, relevantes à notícia"}
Use conhecimento do conteúdo abaixo para precisão factual:
HOOK: ${String(script.hook).slice(0, 300)}
PRIMEIRA SEÇÃO: ${String(script.mainContent?.sections?.[0]?.content || '').slice(0, 400)}`;
  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelo, messages: [{ role: 'user', content: prompt }], max_tokens: 500, temperature: 0.4 })
    });
    await recordCall('nvidia');
    if (!res.ok) throw new Error(`nvidia ${res.status}`);
    const data = await res.json();
    const seo = parseScriptJson(data.choices?.[0]?.message?.content || '');
    // Sanity: título válido em PT-BR (não vazio, não inglês) — senão usa o do roteiro.
    if (!seo.youtubeTitle || isEnglish(seo.youtubeTitle)) seo.youtubeTitle = script.title;
    if (typeof seo.description !== 'string' || seo.description.length < 20) seo.description = null;
    if (typeof seo.hashtags !== 'string' || !/#/.test(seo.hashtags)) seo.hashtags = null;
    return seo;
  } catch (error) {
    console.warn(`      SEO dinâmico falhou (usando fallback): ${error.message}`);
    return null;
  }
}

async function loadOrWriteScript({ topic, targetWords, slug, context, theme, allowCache = true }) {
  const cachePath = path.join(__dirname, '..', 'data', 'scripts', `${slug}-${SCRIPT_REVISION}.json`);
  const cacheMetaPath = `${cachePath}.meta.json`;
  const contextHash = crypto.createHash('sha256').update(String(context || '').trim()).digest('hex');
  const cacheStat = await fs.stat(cachePath).catch(() => null);
  if (cacheStat && allowCache) {
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
      let meta = null;
      try { meta = JSON.parse(await fs.readFile(cacheMetaPath, 'utf8')); } catch (_e) { /* cache anterior à metadata */ }
      const cachedAt = meta?.createdAt ? new Date(meta.createdAt).getTime() : cacheStat.mtimeMs;
      const ageHours = (Date.now() - cachedAt) / 3600000;
      const contextMatches = meta?.contextHash ? meta.contextHash === contextHash : !context;
      const requestMatches = !meta || (meta.topic === topic && meta.targetWords === targetWords);
      const validShape = cached && typeof cached.title === 'string' && typeof cached.hook === 'string'
        && Array.isArray(cached.sections) && cached.sections.length > 0;
      if (ageHours >= 0 && ageHours <= SCRIPT_CACHE_TTL_HOURS && contextMatches && requestMatches && validShape) {
        console.log(`      roteiro em cache — reutilizando (${ageHours.toFixed(1)}h)`);
        return cached;
      }
      const reason = ageHours > SCRIPT_CACHE_TTL_HOURS ? `expirado (${ageHours.toFixed(1)}h)`
        : !contextMatches ? 'contexto da fonte mudou' : !requestMatches ? 'pauta ou tamanho mudou'
          : !validShape ? 'formato inválido' : 'data inválida';
      console.log(`      roteiro em cache descartado: ${reason}; gerando novamente`);
    } catch (error) {
      console.warn(`      cache de roteiro inválido (${error.message}); gerando novamente`);
    }
  } else if (cacheStat && !allowCache) {
    console.log('      roteiro em cache ignorado: pauta automática sem contexto verificável');
  }
  let script = await writeScriptWithNvidia({ topic, targetWords, context, theme });
  // Passada de editor: se o crítico reprovar, regenera UMA vez com o feedback.
  const review = await critiqueScript(script, topic);
  if (review && review.verdict === 'reprovado' && review.feedback) {
    console.log(`      crítico reprovou o rascunho: "${String(review.feedback).slice(0, 120)}"`);
    try {
      script = await writeScriptWithNvidia({ topic, targetWords, context, extraFeedback: review.feedback, theme });
      console.log('      nova versão escrita com feedback do crítico');
    } catch (error) {
      console.warn('      regeneração falhou — seguindo com o rascunho original');
    }
  }
  await writeFileAtomic(cachePath, JSON.stringify(script, null, 2));
  await writeFileAtomic(cacheMetaPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    topic,
    targetWords,
    contextHash,
    revision: SCRIPT_REVISION
  }, null, 2));
  return script;
}

/* ---------------- narração sincronizada (edge-tts + SRT) ---------------- */

function findEdgeTts() {
  const candidates = [path.join(os.homedir(), '.local', 'bin', 'edge-tts'), 'edge-tts'];
  for (const cmd of candidates) {
    const probe = spawnSync(cmd, ['--help'], { timeout: 15000 });
    if (!probe.error && probe.status === 0) return cmd;
  }
  throw new Error('edge-tts não encontrado');
}

function synthesize(text, cmd, mp3Path, srtPath) {
  const run = () => new Promise((resolve, reject) => {
    const args = ['--voice', process.env.TTS_VOICE || 'pt-BR-FranciscaNeural',
      '--text', text, '--write-media', mp3Path, '--write-subtitles', srtPath];
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`edge-tts saiu com código ${code}: ${stderr.slice(0, 300)}`)));
  });
  return run().catch(error => { console.warn(`      edge-tts retry (${error.message.slice(0, 80)})`); return run(); });
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

const normToken = w => w.toLowerCase().replace(/[^\wÀ-ÿ-]/g, '');

// Word-level timings: SRT cues carry real speech spans; words spread inside.
function buildWordTimings(text, cues, groupMs) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const flat = [];
  for (const cue of cues) {
    const cw = cue.text.split(/\s+/).filter(Boolean);
    const step = Math.max(60, (cue.endMs - cue.startMs) / Math.max(1, cw.length));
    cw.forEach((w, k) => flat.push({ w, startMs: cue.startMs + k * step, endMs: cue.startMs + (k + 1) * step }));
  }
  const matches = flat.length >= words.length &&
    words.every((w, i) => i >= flat.length || normToken(flat[i].w) === normToken(w));
  if (matches) {
    return words.map((w, i) => ({ w, startMs: flat[i].startMs, endMs: flat[i].endMs }));
  }
  const step = Math.max(60, (groupMs - 200) / words.length);
  return words.map((w, i) => ({ w, startMs: 100 + i * step, endMs: 100 + (i + 1) * step }));
}

// Sentence spans derived from real word timings — scenes tile the speech.
function buildGroupTimings(text, cues, groupMs) {
  const words = buildWordTimings(text, cues, groupMs);
  const sentences = String(text).split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);
  const out = [];
  let cursor = 0;
  for (const sentence of sentences) {
    const sw = sentence.split(/\s+/).filter(Boolean);
    const slice = words.slice(cursor, cursor + sw.length);
    if (slice.length < sw.length) break;
    const startMs = slice[0].startMs;
    const endMs = slice[slice.length - 1].endMs;
    out.push({
      text: sentence, words: sw,
      startMs: Math.round(startMs), endMs: Math.round(endMs),
      wordTimes: slice.map(w => Math.max(0, Math.round(w.startMs - startMs)))
    });
    cursor += sw.length;
  }
  if (!out.length) {
    const ws = String(text).split(/\s+/).filter(Boolean);
    const step = Math.max(60, (groupMs - 200) / Math.max(1, ws.length));
    return {
      durationMs: Math.round(groupMs),
      sentences: [{ text: String(text), words: ws, startMs: 100, endMs: Math.round(groupMs), durationMs: Math.round(groupMs), wordTimes: ws.map((w, i) => Math.round(i * step)) }]
    };
  }
  for (let i = 0; i < out.length - 1; i++) out[i].endMs = Math.max(out[i].endMs, out[i + 1].startMs);
  out[out.length - 1].endMs = Math.max(out[out.length - 1].endMs, Math.round(groupMs));
  for (const s of out) s.durationMs = Math.max(400, Math.round(s.endMs - s.startMs));
  return { durationMs: Math.round(groupMs), sentences: out };
}

async function synthesizeNarration(script, slug, outDir) {
  const groups = [
    { text: script.hook },
    ...script.mainContent.sections.map(s => ({ text: s.content })),
    { text: script.conclusion.finalThought || '' }
  ];
  const cmd = findEdgeTts();
  const ttsDir = path.join(outDir, `${slug}-${SCRIPT_REVISION}_tts`);
  await fs.mkdir(ttsDir, { recursive: true });

  // TTS dos grupos em PARALELO (pool): edge-tts é rede/WebSocket — 4
  // simultâneos é seguro e corta essa etapa ~4x (antes: sequencial).
  const TTS_CONCURRENCY = Math.max(1, Number(process.env.TTS_CONCURRENCY || 4));
  const synthesizeGroup = async (i) => {
    const mp3 = path.join(ttsDir, `g${i}.mp3`);
    const srt = path.join(ttsDir, `g${i}.srt`);
    const fsize = p => fs.stat(p).then(st => st.size).catch(() => 0);
    const cached = (await fsize(mp3)) > 1000 && (await fsize(srt)) > 20;
    if (!cached) await synthesize(groups[i].text, cmd, mp3, srt);
    let durMs = 0;
    const measured = await getMediaDuration(mp3).catch(() => 0);
    if (Number.isFinite(measured) && measured > 0) durMs = Math.round(measured * 1000);
    const cues = parseSrt(await fs.readFile(srt, 'utf8'));
    const lastCue = cues.length ? cues[cues.length - 1].endMs : 0;
    return { i, timings: buildGroupTimings(groups[i].text, cues, durMs || lastCue || 4000), mp3 };
  };
  const results = new Array(groups.length);
  const queue = groups.map((_, i) => i);
  const pool = Array.from({ length: Math.min(TTS_CONCURRENCY, groups.length) }, async () => {
    while (queue.length) {
      const i = queue.shift();
      const r = await synthesizeGroup(i);
      results[i] = r;
      console.log(`      grupo ${i + 1}/${groups.length}: ${(r.timings.durationMs / 1000).toFixed(1)}s, ${r.timings.sentences.length} frases`);
    }
  });
  await Promise.all(pool);

  let audioOffsetMs = 0;
  const timings = results.map(r => {
    const timing = { ...r.timings, audioOffsetMs };
    audioOffsetMs += Number(r.timings.durationMs) || 0;
    return timing;
  });
  const listLines = results.map(r => `file '${r.mp3.replace(/'/g, "'\\''")}'`);

  const listPath = path.join(ttsDir, 'list.txt');
  await fs.writeFile(listPath, listLines.join('\n'));
  const audioPath = path.join(outDir, `${slug}-${SCRIPT_REVISION}_narracao.mp3`);
  await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', audioPath]);
  return { audioPath, timings };
}

/* ---------------- imagens (Gemini web, 6 por seção) ---------------- */

async function generateSceneImages(script, slug) {
  const web = new GeminiWebImageGenerator({});
  const cacheDir = path.join(__dirname, '..', 'data', 'images', slug);
  await fs.mkdir(cacheDir, { recursive: true });

  const groups = [
    { title: 'Abertura', text: script.hook, imagePrompt: script.imagePrompt || '', emotion: script.hookEmotion },
    ...script.mainContent.sections.map(s => ({ title: s.title, text: s.content, imagePrompt: s.imagePrompt || '', emotion: s.emotion })),
    { title: 'Conclusão', text: script.conclusion.finalThought || '', imagePrompt: '', emotion: script.conclusion.emotion }
  ];

  const available = await web.isAvailable();
  if (!available) {
    console.warn('      Gemini web indisponível ( rode `npm run gemini-login` ) — seguindo sem imagens');
    await web.close();
    return {};
  }

  const imageStyleId = crypto.createHash('sha1').update(`${SCRIPT_REVISION}:${RENDERER_ID}:3d-editorial-backgrounds`).digest('hex').slice(0, 8);
  const shots = {
    a: 'wide 3D editorial establishing shot with one clear focal object and layered depth',
    b: 'cinematic close-up of the most important real object or environment detail from the story',
    c: 'isometric 3D visualization of the story concept using tangible, carefully arranged objects',
    d: 'low-angle 3D detail shot with foreground depth and a readable silhouette',
    e: 'wide contextual documentary b-roll showing the real-world setting and meaningful story details',
    f: 'tactile macro detail of a relevant object, material or surface, with natural cinematic bokeh'
  };
  const perGroup = Math.max(2, Math.min(6, Number(process.env.IMAGES_PER_GROUP || 6)));
  const variants = ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, perGroup);

  const images = {};
  let consecutiveFails = 0;
  outer:
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const keywords = topKeywords(`${group.title} ${group.text}`, 5).join(', ');
    for (const variant of variants) {
      // A versioned filename prevents old cached images with the former
      // "no people" prompt from silently bypassing the new visual direction.
      const pngPath = path.join(cacheDir, `g${i}${variant}-visual-${imageStyleId}.png`);
      try {
        const hasVariant = await fs.stat(pngPath).then(() => true).catch(() => false);
        if (!hasVariant) {
          const firstSentence = String(group.text || '').split(/[.!?]/)[0].slice(0, 140);
          // imagePrompt específico do roteirista quando existir; senão, keywords.
          const base = group.imagePrompt
            ? group.imagePrompt
            : `Editorial scene about "${group.title}". Recognizable details: ${keywords}. Story context: ${firstSentence}`;
          const shot = shots[variant];
          const subject = 'No people or human silhouettes; keep attention on the real objects and environment relevant to the story. The separate recurring presenter is rendered as an actual 3D character by the video engine.';
          const prompt = `${base}. ${subject} Premium dimensional 3D editorial still with believable materials, tactile surfaces, grounded scale, soft cinematic lighting, contact shadows, atmospheric depth and a strong foreground-to-background composition. Shot: ${shot}. Follow the actual topic; do not add generic sci-fi, holograms or unrelated props. No text, letters, logos or watermark.`;
          await web.generateImage(prompt, pngPath);
        }
        consecutiveFails = 0;
        const buf = await sharp(pngPath).resize({ width: 1536 }).jpeg({ quality: 86 }).toBuffer();
        images[i] = images[i] || { sources: [] };
        images[i].sources.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
      } catch (error) {
        consecutiveFails++;
        console.warn(`      imagem ${i + 1}.${variant}/${groups.length} falhou: ${error.message}`);
        if (consecutiveFails >= 5) {
          console.warn('      5 falhas seguidas — cota do Gemini esgotada/indisponível, abortando geração de imagens');
          break outer;
        }
      }
    }
    if (images[i] && !images[i].sources.length) delete images[i];
  }
  await web.close();
  console.log(`      ${Object.keys(images).length}/${groups.length} grupos, ${Object.values(images).reduce((n, g) => n + g.sources.length, 0)} imagens no total`);
  return images;
}

/* ---------------- referências reais (Google News RSS) ---------------- */

async function fetchNewsReferences(query, limit = 8) {
  try {
    const q = encodeURIComponent(query.slice(0, 90));
    const res = await fetch(`https://news.google.com/rss/search?q=${q}&hl=pt-BR&gl=BR&ceid=BR:pt-419`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' } });
    if (!res.ok) throw new Error(`news ${res.status}`);
    const xml = await res.text();
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    const now = Date.now();
    while ((m = re.exec(xml)) && items.length < limit) {
      const block = m[1];
      const rawTitle = ((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
      const link = ((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
      const source = ((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || 'Imprensa').trim();
      const pub = ((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim();
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
      items.push({ title, source: source.slice(0, 24), link, time });
    }
    return items;
  } catch (error) {
    console.warn(`      news falhou: ${error.message}`);
    return [];
  }
}

// Google News links are redirect pages — resolve to the real publisher URL.
async function resolveNewsUrl(link) {
  if (!link || !link.includes('news.google.com')) return link || '';
  try {
    const res = await fetch(link, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });
    const html = await res.text();
    const m = html.match(/https?:\/\/(?!news\.google\.|accounts\.google\.|www\.google\.|fonts\.|ssl\.|www\.gstatic)([a-z0-9-]+\.)+[a-z]{2,}(\/[^"'<\s]*)?/i);
    return m ? m[0] : '';
  } catch (_e) {
    return '';
  }
}

/* ---------------- prints reais (screenshots de artigos) ---------------- */

async function screenshotArticles(shots, cacheDir) {
  if (!shots.length) return [];
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu-sandbox'] });
  const prints = [];
  try {
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const pngPath = path.join(cacheDir, `print_${i}.png`);
      try {
        // Cache: print já capturado em execução anterior é reaproveitado
        // (evita reabrir o browser e redesenhar páginas de terceiros).
        if (await fs.stat(pngPath).then(s => s.size > 10 * 1024).catch(() => false)) {
          const stats = await sharp(pngPath).stats();
          const std = Math.max(...stats.channels.map(c => c.stdev));
          if (std >= 18) {
            const buf = await sharp(pngPath).resize({ width: 1120 }).jpeg({ quality: 84 }).toBuffer();
            prints.push({ src: `data:image/jpeg;base64,${buf.toString('base64')}`, source: shot.source, time: shot.time, title: shot.title });
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
          '[class*="consent" i]', '[id*="consent" i]', '[class*="paywall" i]', '[class*="captcha" i]'
        ].join(', ') + ' { display: none !important; visibility: hidden !important; }' }).catch(() => {});
        await page.waitForTimeout(2800);
        await page.evaluate(() => window.scrollTo(0, Math.round(window.innerHeight * 0.6))).catch(() => {});
        await page.waitForTimeout(900);
        await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: 1280, height: 820 } });
        await page.close();
        // Página em branco/banner não vira "card vazio": valida variância da imagem.
        const stats = await sharp(pngPath).stats();
        const std = Math.max(...stats.channels.map(c => c.stdev));
        if (std < 18) throw new Error('screenshot em branco (página não renderizou)');
        const buf = await sharp(pngPath).resize({ width: 1120 }).jpeg({ quality: 84 }).toBuffer();
        prints.push({ src: `data:image/jpeg;base64,${buf.toString('base64')}`, source: shot.source, time: shot.time, title: shot.title });
        console.log(`      print ${i + 1}/${shots.length} ok (${shot.source})`);
      } catch (error) {
        console.warn(`      print ${i + 1}/${shots.length} falhou: ${error.message}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return prints;
}

/* ---------------- thumbnail (capa do filme, mesmo sistema visual) ---------------- */

// Quebra o título em ~2 linhas equilibradas para a capa.
function splitTitleTwoLines(title, maxLine = 26) {
  const words = String(title || '').split(/\s+/).filter(Boolean);
  const all = words.join(' ');
  if (all.length <= maxLine) return [all, ''];
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (a.length > maxLine + 8 || b.length > maxLine + 8) continue;
    const diff = Math.abs(a.length - b.length);
    if (!best || diff < best.diff) best = { a, b, diff };
  }
  if (best) return [best.a, best.b];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

/**
 * Thumbnail YouTube gerada com o MESMO kit visual do vídeo (bento + highlight
 * + watermark, paleta dark premium) — hoje o YouTube usava o frame automático.
 * Uma cena estática 1280x720, renderizada via Playwright com o kit.
 */
async function renderThumbnail({ title, accent, outPath }) {
  const { chromium } = require('playwright');
  const [l1, l2] = splitTitleTwoLines(title);
  const scene = {
    id: 'thumb',
    durationMs: 1000,
    background: { type: 'grid', accent: accent || '#60A5FA' },
    components: [
      { type: 'bento-card', title: l1, subtitle: l2 || undefined, revealAtMs: 0 },
      { type: 'watermark', text: 'Pulso IA', revealAtMs: 0 }
    ]
  };
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });
    const [css, js] = await Promise.all([
      fs.readFile(path.join(__dirname, '..', 'assets', 'scenes', 'kit.css'), 'utf8'),
      fs.readFile(path.join(__dirname, '..', 'assets', 'scenes', 'kit.js'), 'utf8')
    ]);
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${css}
      :root{--w:1280px;--h:720px} html,body{margin:0;width:1280px;height:720px;overflow:hidden}
      #scene-root{width:1280px;height:720px}.scene{justify-content:center}
      .bento .b-title{font-size:calc(var(--h) * .1)} .bento .b-sub{font-size:calc(var(--h) * .05)}
      .bento{max-width:92%;padding:calc(var(--h) * .07) calc(var(--w) * .05)}
      .watermark{font-size:calc(var(--h) * .03)}
    </style></head><body><div id="scene-root"></div><script>${js}</script></body></html>`;
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(sceneData => window.buildScene(sceneData), scene);
    await page.evaluate(() => window.renderAt(700)); // tweens assentadas
    await page.screenshot({ path: outPath, type: 'png' });
    console.log(`      thumbnail gerada: ${path.basename(outPath)}`);
    return outPath;
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ---------------- main ---------------- */

async function main() {
  if (!(await checkFFmpeg())) throw new Error('ffmpeg ausente');
  const fromG1 = process.argv.includes('--from-g1');
  const recap = process.argv.includes('--recap');
  const targetWords = Number(arg('words', recap ? 400 : 950));
  const noImages = process.argv.includes('--no-images');

  // TEMA DA INSTÂNCIA (parâmetro): carregado ANTES de qualquer uso.
  // Cada vídeo é gerado com a persona, fontes e branding do tema.
  const themeId = arg('theme', process.env.THEME || 'ia');
  const { getTheme } = require('../utils/news-hunter');
  const theme = getTheme(themeId);

  let topic, context = '', article = null;
  let originTitle = '', originUrl = '';
  const explicitUrl = arg('article', '');
  const auto = process.argv.includes('--auto');
  if (recap) {
    const entries = await loadRecentTopics(Number(arg('days', 7)));
    console.log(`[0/5] RESUMO SEMANAL — ${entries.length} vídeos nos últimos 7 dias`);
    topic = process.env.RECAP_TITLE || 'Resumo da semana na IA: o que realmente importou';
    context = 'Destaques da semana (resuma de forma ágil, conectando os assuntos e destacando o que importa):\n'
      + entries.map(e => `- ${e.title}`).join('\n');
    if (!entries.length) {
      context = 'Resumo geral dos principais acontecimentos recentes de inteligência artificial.';
    }
  } else if (auto) {
    const { huntHotTopics, overlap } = require('../utils/news-hunter');
    const used = await loadUsedTopics();
    console.log(`[0/5] Caçando a pauta MAIS QUENTE do tema "${theme.name}" entre várias fontes...`);
    const candidates = await huntHotTopics(used, theme.id);
    const configuredMaxTopicAge = Number(process.env.MAX_TOPIC_AGE_HOURS || 36);
    const maxTopicAgeHours = Number.isFinite(configuredMaxTopicAge) && configuredMaxTopicAge >= 1 ? configuredMaxTopicAge : 36;
    const freshCandidates = candidates.filter(candidate => Number.isFinite(Number(candidate.ageHours))
      && Number(candidate.ageHours) >= -1 && Number(candidate.ageHours) <= maxTopicAgeHours);
    if (!freshCandidates.length) {
      throw new Error(`nenhuma pauta inédita com até ${maxTopicAgeHours}h encontrada (candidatas: ${candidates.length})`);
    }
    const corroboratedCandidates = freshCandidates.filter(candidate => Number(candidate.independentSources) >= 2);
    const rankedCandidates = corroboratedCandidates.length ? corroboratedCandidates : freshCandidates;
    const top = rankedCandidates[0];
    if (!corroboratedCandidates.length) console.warn('      pauta sem segunda fonte independente disponível; seguindo com a melhor fonte recente');
    originTitle = top.title;
    originUrl = top.url || top.link || '';
    console.log(`      🔥 [${top.source}] score ${top.score.toFixed(2)} · ${top.ageHours.toFixed(0)}h · ${top.comments} comentários`);
    console.log(`      "${top.title.slice(0, 100)}"`);
    // Melhor link direto para contexto/print
    let directUrl = top.url && !top.url.includes('news.google.com') ? top.url : await resolveNewsUrl(top.url || top.link || '');
    context = directUrl ? await extractArticleContext(directUrl) : '';
    // Cobertura em PT: só adota se for A MESMA história (entidade/termos em comum).
    let ptCoverage = await fetchNewsReferences(top.title, 6);
    if (!ptCoverage.length) {
      const entities = top.title.split(/\s+/).filter(w => /^[A-Z]/.test(w) && w.length > 2).slice(0, 3).join(' ');
      ptCoverage = await fetchNewsReferences(`${entities} IA`, 6);
    }
    const ents = t => new Set(String(t).split(/\s+/).filter(w => /^[A-Za-zÀ-ú]/.test(w) && w.length > 3).map(w => w.toLowerCase().replace(/[^\wà-ú]/g, '')));
    const sharesEntity = (a, b) => {
      const A = ents(a), B = ents(b);
      for (const t of A) if (t.length > 3 && B.has(t)) return true;
      return false;
    };
    let pt = ptCoverage.find(p => !/hacker news|reddit/i.test(p.source)) || ptCoverage[0];
    if (pt && overlap(pt.title, top.title) < 0.25 && !sharesEntity(pt.title, top.title)) pt = null;
    topic = pt ? pt.title : top.title;
    if (!directUrl && pt) directUrl = await resolveNewsUrl(pt.link);
    if (!context && directUrl) context = await extractArticleContext(directUrl);
    if (!context && pt) {
      const ptUrl = await resolveNewsUrl(pt.link);
      if (ptUrl) { directUrl = directUrl || ptUrl; context = await extractArticleContext(ptUrl); }
    }
    article = { title: topic, link: directUrl || top.url || '', time: 'hoje', source: pt ? pt.source : top.source };
    console.log(`      tema: "${topic.slice(0, 90)}" (${article.source})`);
    console.log(`      contexto: ${context.length} caracteres`);
  } else if (explicitUrl) {
    topic = arg('topic', '') || 'Atualizações de inteligência artificial';
    console.log(`[0/5] Artigo indicado: ${explicitUrl}`);
    context = await extractArticleContext(explicitUrl);
    article = { title: topic, link: explicitUrl, time: 'hoje' };
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

  // Slug do tema + output path
  const slug = (fromG1 ? 'g1_' : `${theme.id}_`) + topic.toLowerCase().replace(/[^a-z0-9]+/gi, '_').slice(0, 44);
  const out = path.resolve(arg('out', path.join(__dirname, '..', 'data', 'videos', `${slug}_animado.mp4`)));
  await fs.mkdir(path.dirname(out), { recursive: true });

  console.log(`[1/5] Roteiro (${targetWords} palavras) sobre: ${topic.slice(0, 70)}`);
  // Idempotência: --resume + arquivo já renderizado = geração já concluiu
  // numa execução anterior; pula direto pro fim (scheduler só publica).
  if (process.argv.includes('--resume') && await fs.stat(out).then(() => true).catch(() => false)) {
    console.log('[resume] vídeo já renderizado nesta execução — pulando geração');
    return;
  }
  const script = normalizeScript(await loadOrWriteScript({
    topic,
    targetWords,
    slug,
    context,
    theme,
    // Pautas automáticas sem contexto extraído não podem reutilizar um roteiro
    // anterior como se ele ainda estivesse ancorado na notícia atual.
    allowCache: !auto || context.trim().length >= 300
  }));
  // Título canônico em PT-BR: o roteirista gera o título em português —
  // quando a pauta é de fonte gringa sem cobertura BR, é ele que aparece
  // no YouTube/TikTok/X (tudo voltado pro público do Brasil).
  const displayTitle = cleanText(script.title) || topic;
  console.log(`      título PT: "${displayTitle.slice(0, 80)}"`);
  // Seed por vídeo: garante que layouts, gráficos, cores e ordem de imagens
  // sejam diferentes em cada execução (vídeos únicos).
  script.channel = theme.brand || 'Pulso IA'; // marca do tema → watermark das cenas
  script.themeId = theme.id;
  script.visualPalettes = theme.visualPalettes || null;
  const requestedSeed = arg('seed', null);
  const parsedSeed = requestedSeed == null ? null : Number(requestedSeed);
  if (parsedSeed != null && (!Number.isSafeInteger(parsedSeed) || parsedSeed < 0)) {
    throw new Error(`--seed precisa ser um inteiro não negativo; recebido: ${requestedSeed}`);
  }
  script.seed = parsedSeed ?? Math.floor(Math.random() * 1e9);
  console.log(`      seed: ${script.seed}`);
  const words = [script.hook, ...script.mainContent.sections.map(s => s.content), script.conclusion.finalThought].join(' ').split(/\s+/).filter(Boolean).length;
  console.log(`      ${script.mainContent.sections.length} seções | ~${words} palavras | ${script.mainContent.sections.filter(s => s.visual).length} gráficos`);

  console.log('[1.5/5] SEO dinâmico (título CTR + descrição + hashtags por notícia)');
  const seo = await generateSEO({ script, topic, article, theme });
  if (seo) console.log(`      título SEO: "${String(seo.youtubeTitle).slice(0, 80)}"`);

  // ETAPAS EM PARALELO: narração (TTS), imagens (Gemini) e referências/prints
  // são independentes entre si — todas só precisam do roteiro. Antes eram
  // sequenciais; agora sobrepõem e economizam ~10-15 min por vídeo.
  console.log('[2-3.5/5] Em paralelo: narração (TTS) + imagens (Gemini) + referências/prints');
  const cacheDir = path.join(__dirname, '..', 'data', 'images', slug);
  const parallelT0 = Date.now();
  const [ttsResult, imagesResult, refsResult] = await Promise.all([
    (async () => {
      const r = await synthesizeNarration(script, slug, path.dirname(out));
      console.log(`      [tts] pronto em ${((Date.now() - parallelT0) / 60000).toFixed(1)} min`);
      return r;
    })(),
    (async () => {
      if (noImages) return {};
      const imgs = await generateSceneImages(script, slug);
      console.log(`      [imagens] prontas em ${((Date.now() - parallelT0) / 60000).toFixed(1)} min`);
      return imgs;
    })(),
    (async () => {
      const newsItems = await fetchNewsReferences(topic).catch(() => []);
      script.news = newsItems;
      const shots = [];
      if (article && article.link) shots.push({ url: article.link, source: article.source || 'Imprensa', time: article.time, title: article.title });
      for (const item of newsItems.slice(0, 4)) {
        if (shots.length >= 3) break;
        if (item.source === 'G1') continue;
        const realUrl = await resolveNewsUrl(item.link);
        if (realUrl) shots.push({ url: realUrl, source: item.source, time: item.time, title: item.title });
      }
      const prints = await screenshotArticles(shots, cacheDir);
      console.log(`      [prints] prontos em ${((Date.now() - parallelT0) / 60000).toFixed(1)} min (${newsItems.length} manchetes)`);
      return { newsItems, prints };
    })()
  ]);
  const { audioPath, timings } = ttsResult;
  script.timings = timings;
  const total = timings.reduce((n, t) => n + t.durationMs, 0);
  const images = imagesResult;
  script.prints = refsResult.prints;
  console.log(`      duração do áudio: ${(total / 60000).toFixed(1)} min`);
  script.mainContent.sections.forEach((s, k) => {
    s.news = refsResult.newsItems.length ? refsResult.newsItems[(k + 1) % refsResult.newsItems.length] : null;
    s.print = script.prints[k + 1] || null;
  });

  console.log('[4/5] Render HyperFrames (mascote 3D aprovado + imagens + gráficos + legendas)');
  const renderer = new HyperFramesVideoRenderer({
    fps: Number(process.env.ANIMATED_FPS || 24),
    width: Number(process.env.ANIMATED_WIDTH || 1920),
    height: Number(process.env.ANIMATED_HEIGHT || 1080)
  });
  await renderer.render({ script, audioPath, outputPath: out, images });
  const st = await fs.stat(out);

  // Thumbnail customizada (mesmo kit visual do vídeo) — capa do upload.
  let thumbPath = '';
  if (!process.argv.includes('--no-thumb')) {
    try {
      const thumbOut = path.join(path.dirname(out), `thumb_${path.basename(out, '.mp4')}.png`);
      const variants = script.visualPalettes?.variants || [];
      const palette = variants.length ? variants[script.seed % variants.length] : null;
      await renderThumbnail({ title: displayTitle, accent: palette?.accents?.[0] || script.background?.accent, outPath: thumbOut });
      thumbPath = path.relative(path.join(__dirname, '..'), thumbOut);
    } catch (error) {
      console.warn(`      thumbnail falhou (vídeo mantido): ${error.message}`);
    }
  }

  // Cortes verticais NATIVOS (9:16, formato de celular) — Shorts/TikTok/Reels
  let clips = [];
  if (!process.argv.includes('--no-clips')) {
    console.log('[4.5/5] Cortes verticais nativos 9:16');
    const { makeVerticalClips } = require('../utils/clip-maker');
    clips = await makeVerticalClips({
      script,
      imagesDir: path.join(__dirname, '..', 'data', 'images', slug),
      ttsDir: path.join(path.dirname(out), `${slug}-${SCRIPT_REVISION}_tts`),
      outDir: path.join(path.dirname(out), 'clips'),
      maxClips: Number(process.env.MAX_CLIPS || 3),
      baseName: displayTitle.toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 40) || 'pulso_ia'
    });
    console.log(`      ${clips.length} cortes 1080x1920 gerados`);
  }

  await recordTopic({
    renderer: RENDERER_ID,
    theme: theme.id, // réplica: rastreio de qual canal gerou
    title: displayTitle,
    url: article ? article.link : '',
    source: article ? article.source : (recap ? 'RESUMO' : 'tema'),
    originTitle, originUrl,
    videoPath: out,
    clips: clips.map(c => ({ path: c.path, title: c.title })),
    ...(thumbPath ? { thumbnailPath: thumbPath } : {}),
    ...(seo ? { seo: { youtubeTitle: seo.youtubeTitle, description: seo.description, hashtags: seo.hashtags } } : {})
  });
  console.log(`[5/5] OK -> ${out} (${(st.size / 1048576).toFixed(1)} MB)`);
}

main().catch(error => { console.error('FALHA:', error.message); process.exit(1); });
