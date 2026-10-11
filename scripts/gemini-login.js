#!/usr/bin/env node
/**
 * Configura o provider Gemini web (gemini.google.com).
 *
 * Por padrão importa a sessão Google de um perfil Chromium já logado
 * (automação do LinkedIn ou o Chrome do usuário) para o perfil dedicado
 * data/browser-profiles/gemini, e valida o login headless — sem abrir janela.
 *
 * Se nenhum perfil logado for encontrado, abre uma janela para login manual
 * (uma única vez). Para forçar a janela: GEMINI_LOGIN_WINDOW=1.
 *
 * Fonte da sessão (ordem):
 *   GEMINI_WEB_SOURCE_PROFILE=/caminho/do/perfil
 *   ~/.linkedin-automation-profile
 *   ~/.config/google-chrome
 */
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const readline = require('readline');

const PROFILE_DIR = process.env.GEMINI_WEB_PROFILE || path.join(__dirname, '..', 'data', 'browser-profiles', 'gemini');
const SUBPROFILE = process.env.GEMINI_WEB_SOURCE_SUBPROFILE || 'Default';

async function sourceCandidates() {
  const candidates = [];
  if (process.env.GEMINI_WEB_SOURCE_PROFILE) candidates.push(process.env.GEMINI_WEB_SOURCE_PROFILE);
  candidates.push(path.join(os.homedir(), '.linkedin-automation-profile'));
  candidates.push(path.join(os.homedir(), '.config', 'google-chrome'));
  return candidates;
}

async function cloneSession(sourceDir, targetDir) {
  const skip = new Set(['Cache', 'Code Cache', 'GPUCache', 'Crash Reports', 'DawnGraphiteCache', 'DawnWebGPUCache', 'ShaderCache', 'GrShaderCache', 'GraphiteDawnCache', 'Service Worker', 'Sessions', 'Current Session', 'Current Tabs']);
  await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(targetDir, { recursive: true });
  await fs.copyFile(path.join(sourceDir, 'Local State'), path.join(targetDir, 'Local State'));
  await fs.cp(path.join(sourceDir, SUBPROFILE), path.join(targetDir, 'Default'), {
    recursive: true,
    filter: source => {
      const name = path.basename(source);
      return !skip.has(name) && !name.startsWith('Singleton') && name !== 'lockfile';
    }
  });
}

async function verifyHeadless() {
  const { GeminiWebImageGenerator } = require('../utils/gemini-web-image');
  const provider = new GeminiWebImageGenerator({ profileDir: PROFILE_DIR, timeoutMs: 30000 });
  try {
    return await provider.isAvailable();
  } finally {
    await provider.close();
  }
}

async function interactiveLogin() {
  const { chromium } = require('playwright');
  console.log('Abrindo janela no gemini.google.com — faça login com a conta Google.');
  console.log('Feche a janela (ou pressione ENTER) quando o Gemini aparecer logado.');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled']
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\nPressione ENTER quando terminar... ', () => { rl.close(); resolve(); });
    context.on('close', resolve);
  });
  await context.close().catch(() => {});
}

async function main() {
  if (process.env.GEMINI_LOGIN_FORCE !== '1' && await verifyHeadless()) {
    console.log('Perfil do Gemini web já está logado — nada a fazer. (GEMINI_LOGIN_FORCE=1 força reimportação)');
    return;
  }

  if (process.env.GEMINI_LOGIN_WINDOW !== '1') {
    for (const source of await sourceCandidates()) {
      const exists = await fs.access(path.join(source, SUBPROFILE)).then(() => true).catch(() => false);
      if (!exists) continue;
      console.log(`Importando sessão Google de ${source} (${SUBPROFILE})...`);
      try {
        await cloneSession(source, PROFILE_DIR);
        if (await verifyHeadless()) {
          console.log('Login importado com sucesso. O provider web já gera imagens.');
          return;
        }
        console.log('Essa sessão não carrega o Gemini logado; tentando a próxima fonte...');
      } catch (error) {
        console.warn(`Falha ao importar de ${source}: ${error.message}`);
      }
    }
    console.log('Nenhuma sessão Google existente funcionou; abrindo janela para login manual.');
  }

  await interactiveLogin();
  if (await verifyHeadless()) {
    console.log('Login confirmado. O provider web já gera imagens.');
  } else {
    console.log('Ainda não detectei login no Gemini. Rode novamente se precisar.');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Falha no setup do Gemini web:', error.message);
  process.exit(1);
});
