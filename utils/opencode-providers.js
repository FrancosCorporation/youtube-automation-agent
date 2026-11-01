'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// These OpenAI-compatible gateways are explicitly configured for this host.
// Keep this allowlist narrow: unrelated OpenCode providers may be local tools,
// image APIs, or credentials that should never be used by the video scheduler.
const ALLOWED_OPENCODE_PROVIDERS = Object.freeze({
  atria: 'https://api.atria-asi.ai/v1',
  mwapi: 'https://api.mwapi.dev/v1',
  lebang: 'https://lebang.si/v1'
});
const OPENCODE_MODEL_OVERRIDES = Object.freeze({
  // Authenticated `/models` reports the current Atria model without the old
  // preview suffix kept in the OpenCode profile.
  atria: Object.freeze(['Atria-Dawn'])
});

function defaultOpenCodeConfigPath() {
  return process.env.OPENCODE_CONFIG_PATH
    || path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
}

function loadConfiguredOpenCodeProviders({ configPath = defaultOpenCodeConfigPath() } = {}) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return [];
  }

  const providers = config?.provider;
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return [];

  return Object.entries(ALLOWED_OPENCODE_PROVIDERS).flatMap(([id, allowedBaseURL]) => {
    const source = providers[id];
    const apiKey = typeof source?.options?.apiKey === 'string' ? source.options.apiKey.trim() : '';
    const baseURL = typeof source?.options?.baseURL === 'string' ? source.options.baseURL.trim().replace(/\/$/, '') : '';
    if (!apiKey || baseURL !== allowedBaseURL) return [];

    const models = OPENCODE_MODEL_OVERRIDES[id] || (
      source.models && typeof source.models === 'object' && !Array.isArray(source.models)
        ? Object.keys(source.models).filter(model => model && model.length <= 200)
        : []
    );
    if (!models.length) return [];

    return [{
      id,
      route: 'opencode',
      name: `OpenCode ${id}`,
      baseURL,
      apiKey,
      models
    }];
  });
}

const MIMOCODE_AUTH_PATH = path.join(os.homedir(), '.local', 'share', 'mimocode', 'auth.json');
const MIMOCODE_BASE_URL = 'https://api.xiaomimimo.com/v1';

function loadConfiguredMimoCodeProvider({ authPath = MIMOCODE_AUTH_PATH } = {}) {
  let auth;
  try {
    auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
  } catch {
    return null;
  }

  const xiaomi = auth?.xiaomi;
  const apiKey = typeof xiaomi?.key === 'string' ? xiaomi.key.trim() : '';
  const baseURL = typeof xiaomi?.metadata?.base_url === 'string'
    ? xiaomi.metadata.base_url.trim().replace(/\/$/, '')
    : '';
  if (xiaomi?.type !== 'api' || !apiKey || baseURL !== MIMOCODE_BASE_URL) return null;

  const { PROVIDERS } = require('./ai-text-service');
  return {
    id: 'xiaomi',
    route: 'mimocode',
    name: PROVIDERS.mimo.name,
    baseURL,
    apiKey,
    models: [...PROVIDERS.mimo.models]
  };
}

function getConfiguredMimoCodeProvider(options) {
  return loadConfiguredMimoCodeProvider(options);
}

function getConfiguredOpenCodeProvider(id, options) {
  return loadConfiguredOpenCodeProviders(options).find(provider => provider.id === id) || null;
}

module.exports = {
  ALLOWED_OPENCODE_PROVIDERS,
  OPENCODE_MODEL_OVERRIDES,
  defaultOpenCodeConfigPath,
  getConfiguredOpenCodeProvider,
  getConfiguredMimoCodeProvider,
  loadConfiguredMimoCodeProvider,
  loadConfiguredOpenCodeProviders
};
