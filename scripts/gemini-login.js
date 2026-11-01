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
const sqlite3 = require('sqlite3');

const PROFILE_DIR = process.env.GEMINI_WEB_PROFILE || path.join(__dirname, '..', 'data', 'browser-profiles', 'gemini');
const SUBPROFILE = process.env.GEMINI_WEB_SOURCE_SUBPROFILE || 'Default';

async function sourceCandidates() {
  const candidates = [];
  if (process.env.GEMINI_WEB_SOURCE_PROFILE) candidates.push(process.env.GEMINI_WEB_SOURCE_PROFILE);
  candidates.push(path.join(os.homedir(), '.linkedin-automation-profile'));
  candidates.push(path.join(os.homedir(), '.config', 'google-chrome'));
  return candidates;
}

async function cloneSession(sourceDir, targetDir, subprofile = SUBPROFILE) {
  const resolvedTarget = path.resolve(targetDir);
  const stagingDir = `${resolvedTarget}.import-${process.pid}-${Date.now()}`;
  const cookieCandidates = [
    path.join(sourceDir, subprofile, 'Network', 'Cookies'),
    path.join(sourceDir, subprofile, 'Cookies')
  ];
  const sourceCookies = await cookieCandidates.reduce(async (foundPromise, candidate) => {
    const found = await foundPromise;
    if (found) return found;
    return await fs.access(candidate).then(() => candidate).catch(() => null);
  }, Promise.resolve(null));
  if (!sourceCookies) throw new Error('perfil Google sem banco de cookies Chromium');

  await fs.mkdir(path.dirname(resolvedTarget), { recursive: true, mode: 0o700 });
  await fs.mkdir(stagingDir, { recursive: false, mode: 0o700 });
  try {
    await fs.copyFile(path.join(sourceDir, 'Local State'), path.join(stagingDir, 'Local State'));
    await fs.chmod(path.join(stagingDir, 'Local State'), 0o600).catch(() => {});
    const defaultDir = path.join(stagingDir, 'Default');
    await fs.mkdir(defaultDir, { mode: 0o700 });
    const targetCookies = path.join(defaultDir, 'Cookies');
    await backupSqliteDatabase(sourceCookies, targetCookies);
    await filterGoogleCookies(targetCookies);
    await fs.chmod(targetCookies, 0o600).catch(() => {});
    await fs.chmod(defaultDir, 0o700).catch(() => {});
    await fs.chmod(stagingDir, 0o700).catch(() => {});

    let previousProfilePath = null;
    const targetExists = await fs.access(resolvedTarget).then(() => true).catch(() => false);
    if (targetExists) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      previousProfilePath = `${resolvedTarget}.previous-${stamp}`;
      await fs.rename(resolvedTarget, previousProfilePath);
    }
    try {
      await fs.rename(stagingDir, resolvedTarget);
    } catch (error) {
      if (previousProfilePath) await fs.rename(previousProfilePath, resolvedTarget).catch(() => {});
      throw error;
    }
    return { previousProfilePath };
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function backupSqliteDatabase(sourcePath, targetPath) {
  return new Promise((resolve, reject) => {
    const source = new sqlite3.Database(sourcePath, sqlite3.OPEN_READONLY, error => {
      if (error) {
        reject(error);
        return;
      }
      const backup = source.backup(targetPath, initError => {
        if (initError) {
          source.close(() => reject(initError));
          return;
        }
        backup.step(-1, stepError => {
          backup.finish(finishError => {
            source.close(closeError => {
              const failure = stepError || finishError || closeError;
              if (failure) reject(failure);
              else resolve();
            });
          });
        });
      });
    });
  });
}

function filterGoogleCookies(cookiePath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(cookiePath, error => {
      if (error) {
        reject(error);
        return;
      }
      const chromeEpochOffset = 11644473600000000;
      const now = Date.now() * 1000 + chromeEpochOffset;
      database.run(
        `DELETE FROM cookies
         WHERE host_key NOT IN (?, ?, ?, ?, ?)
            OR (has_expires = 1 AND expires_utc > 0 AND expires_utc <= ?)`,
        ['.google.com', 'google.com', 'accounts.google.com', '.gemini.google.com', 'gemini.google.com', now],
        error => {
          if (error) {
            database.close(() => reject(error));
            return;
          }
          database.exec('VACUUM', vacuumError => {
            database.close(closeError => {
              const failure = vacuumError || closeError;
              if (failure) {
                reject(failure);
                return;
              }
              const verify = new sqlite3.Database(cookiePath, sqlite3.OPEN_READONLY, verifyError => {
                if (verifyError) {
                  reject(verifyError);
                  return;
                }
                verify.get('SELECT COUNT(*) AS count FROM cookies', [], (countError, row) => {
                  verify.close(closeVerifyError => {
                    const verifyFailure = countError || closeVerifyError;
                    if (verifyFailure) reject(verifyFailure);
                    else if (!Number(row?.count)) reject(new Error('perfil Google sem cookies ativos de autenticação'));
                    else resolve();
                  });
                });
              });
            });
          });
        }
      );
    });
  });
}

async function verifyHeadless(profileDir = PROFILE_DIR) {
  const { GeminiWebImageGenerator } = require('../utils/gemini-web-image');
  const provider = new GeminiWebImageGenerator({ profileDir, cdpUrl: '', headless: true, timeoutMs: 30000 });
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

async function setupGeminiLogin({
  headlessOnly = process.env.GEMINI_LOGIN_HEADLESS_ONLY === '1',
  forceImport = process.env.GEMINI_LOGIN_FORCE === '1',
  forceWindow = process.env.GEMINI_LOGIN_WINDOW === '1',
  verify = verifyHeadless,
  getSources = sourceCandidates,
  importSession = cloneSession,
  openLoginWindow = interactiveLogin,
  profileDir = PROFILE_DIR,
  subprofile = SUBPROFILE,
  output = console
} = {}) {
  if (!forceImport && await verify(profileDir)) {
    output.log('Perfil do Gemini web já está logado — nada a fazer. (GEMINI_LOGIN_FORCE=1 força reimportação)');
    return true;
  }

  // The explicit no-window mode is the stronger safety constraint: even if
  // a stale force-window flag is present, try existing sessions headlessly.
  if (!forceWindow || headlessOnly) {
    for (const source of await getSources()) {
      const exists = await fs.access(path.join(source, subprofile)).then(() => true).catch(() => false);
      if (!exists) continue;
      output.log(`Importando sessão Google de ${source} (${subprofile})...`);
      const candidateDir = `${path.resolve(profileDir)}.candidate-${process.pid}-${Date.now()}`;
      try {
        await importSession(source, candidateDir, subprofile);
        if (await verify(candidateDir)) {
          await promoteImportedProfile(candidateDir, profileDir);
          output.log('Login importado com sucesso. O provider web já gera imagens.');
          return true;
        }
        output.log('Essa sessão não carrega o Gemini logado; tentando a próxima fonte...');
      } catch (error) {
        output.warn(`Falha ao importar de ${source}: ${error.message}`);
      } finally {
        await fs.rm(candidateDir, { recursive: true, force: true }).catch(() => {});
      }
    }
    if (!headlessOnly) output.log('Nenhuma sessão Google existente funcionou; abrindo janela para login manual.');
  }

  if (headlessOnly) {
    output.warn('Nenhuma sessão Gemini válida foi encontrada; modo somente background não abriu navegador.');
    return false;
  }

  await openLoginWindow();
  if (await verify(profileDir)) {
    output.log('Login confirmado. O provider web já gera imagens.');
    return true;
  }
  output.warn('Ainda não detectei login no Gemini. Rode novamente se precisar.');
  return false;
}

async function promoteImportedProfile(candidateDir, profileDir) {
  const candidate = path.resolve(candidateDir);
  const target = path.resolve(profileDir);
  const candidateExists = await fs.access(candidate).then(() => true).catch(() => false);
  if (!candidateExists) return null;
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  let previousProfilePath = null;
  const targetExists = await fs.access(target).then(() => true).catch(() => false);
  if (targetExists) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    previousProfilePath = `${target}.previous-${stamp}`;
    await fs.rename(target, previousProfilePath);
  }
  try {
    await fs.rename(candidate, target);
    await fs.chmod(target, 0o700).catch(() => {});
    return previousProfilePath;
  } catch (error) {
    if (previousProfilePath) await fs.rename(previousProfilePath, target).catch(() => {});
    throw error;
  }
}

async function main() {
  if (!await setupGeminiLogin()) process.exitCode = 1;
}

if (require.main === module) main().catch(error => {
  console.error('Falha no setup do Gemini web:', error.message);
  process.exit(1);
});

module.exports = { cloneSession, promoteImportedProfile, setupGeminiLogin };
