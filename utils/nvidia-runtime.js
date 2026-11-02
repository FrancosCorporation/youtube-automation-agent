'use strict';

const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { defaultOpenCodeConfigPath } = require('./opencode-providers');

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const CAPABLE_MODELS = Object.freeze([
  'nvidia/nemotron-3.5-super-vl-120b-a12b',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'mistralai/mistral-large-4-1t-a52b',
  'stepfun-ai/step-5-preview',
  'minimaxai/minimax-m3.1-flash',
  'moonshotai/kimi-k2.6',
  'deepseek-ai/deepseek-v4.1-flash',
  'nvidia/llama-3.1-nemotron-70b-instruct',
  'nvidia/nemotron-3.5-lightning-30b-a3b'
]);
let catalogModels = null;

function nvidiaDailyLimit(environment = process.env) {
  const raw = environment.NVIDIA_CALLS_PER_DAY ?? '0';
  if (raw === 'unlimited' || Number(raw) === 0) return null;
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('NVIDIA_CALLS_PER_DAY inválido');
  return limit;
}

function nvidiaRouteIdentity(environment = process.env) {
  return crypto.createHash('sha256').update(`${NVIDIA_BASE_URL}:${environment.NVIDIA_API_KEY || ''}:${nvidiaDailyLimit(environment)}`).digest('hex');
}

function nvidiaSceneModels() {
  return catalogModels === null ? [...CAPABLE_MODELS] : CAPABLE_MODELS.filter(model => catalogModels.includes(model));
}

async function initializeNvidiaRuntime({ environment = process.env, configPath = defaultOpenCodeConfigPath(),
  fetchImpl = globalThis.fetch, logger = console } = {}) {
  let configured;
  try { configured = JSON.parse(await fs.readFile(configPath, 'utf8'))?.provider?.nvidia; }
  catch { /* Explicit environment credential remains supported without OpenCode. */ }
  if (configured?.options?.baseURL?.replace(/\/$/, '') === NVIDIA_BASE_URL
    && typeof configured.options.apiKey === 'string' && configured.options.apiKey.trim()) {
    environment.NVIDIA_API_KEY = configured.options.apiKey.trim();
    logger.info?.('NVIDIA: credencial da configuração OpenCode selecionada');
  }
  if (!environment.NVIDIA_API_KEY) return { available: false, models: [] };
  try {
    const response = await fetchImpl(`${NVIDIA_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${environment.NVIDIA_API_KEY}` }, signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('catalog unavailable');
    const data = await response.json();
    if (!Array.isArray(data.data)) throw new Error('catalog invalid');
    catalogModels = data.data.map(item => item.id).filter(id => typeof id === 'string' && /^[a-zA-Z0-9._/-]{1,200}$/.test(id));
    logger.info?.(`NVIDIA: ${catalogModels.length} modelos no catálogo; ${nvidiaSceneModels().length} alternativas de autoria`);
  } catch { logger.warn?.('NVIDIA: catálogo temporariamente indisponível; usando seleção de modelos conhecida'); }
  return { available: true, models: nvidiaSceneModels() };
}

module.exports = { NVIDIA_BASE_URL, CAPABLE_MODELS, nvidiaDailyLimit, nvidiaRouteIdentity, nvidiaSceneModels, initializeNvidiaRuntime };
