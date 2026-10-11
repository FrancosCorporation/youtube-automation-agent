#!/usr/bin/env node
/**
 * Uploaders sociais — publica vídeo longo + cortes em todas as plataformas
 * usando os perfis logados (data/browser-profiles/<plataforma>).
 *
 * YouTube: API oficial (upload-to-youtube.js)
 * TikTok/Kwai/Instagram/X/Telegram: automação de browser (Chrome real)
 *
 * API:
 *   const { uploadToAll } = require('./upload-to-socials');
 *   await uploadToAll({ videoPath, clips, title, hashtags, sourceUrl });
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { uploadVideo } = require('./upload-to-youtube');

// PERFIL POR RÉPLICA: cada tema publica com suas PRÓPRIAS contas. A instância
// define PROFILES_DIR (default = original Pulso IA). Nunca compartilhar perfis
// entre temas — 1 nicho = 1 conta.
const PROFILES_ROOT = process.env.PROFILES_DIR
  ? path.resolve(process.env.PROFILES_DIR)
  : path.join(ROOT, 'data', 'browser-profiles');
const PROFILE_DIR = platform => path.join(PROFILES_ROOT, platform);
// Plataformas desligadas via SOCIALS_DISABLED=kwai,x — não tentam upload e não bloqueiam a limpeza
const DISABLED_PLATFORMS = (process.env.SOCIALS_DISABLED || '').split(',').map(s => s.trim()).filter(Boolean);

// Kwai não usa mais browser: publica pelo app dentro do emulador Android (redroid).
// "Logado" = flag escrita depois do login manual (scripts/kwai-emulator.js login|confirm).
const kwaiEmu = () => require('./kwai-emulator');

function isLogged(platform) {
  if (platform === 'kwai') return kwaiEmu().isLoggedApp();
  try {
    const cookies = path.join(PROFILE_DIR(platform), 'Default', 'Cookies');
    return fs.existsSync(cookies) && fs.statSync(cookies).size > 10000;
  } catch (_e) {
    return false;
  }
}

// Chrome grava SingletonLock apontando para o PID do processo; quando o browser
// é morto à força (timeout do orçamento/pkill), o lock fica órfão e o PRÓXIMO
// launch falha com "Target page, context or browser has been closed".
// Limpeza: se o PID no lock não existe mais, apaga os Singletons.
function clearStaleProfileLock(platform) {
  const dir = PROFILE_DIR(platform);
  const lockPath = path.join(dir, 'SingletonLock');
  try {
    const target = fs.readlinkSync(lockPath);
    const pid = Number(String(target).split('-').pop());
    if (Number.isFinite(pid) && pid > 0) {
      try { process.kill(pid, 0); return; } // processo vivo → perfil em uso legítimo
      catch (e) { if (e.code === 'EPERM') return; } // vivo sem permissão → não mexe
    }
    for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      fs.rmSync(path.join(dir, f), { force: true });
    }
    console.log(`  [${platform}] lock de perfil órfão removido (pid ${pid || '?'} morto)`);
  } catch (_e) { /* sem lock — nada a fazer */ }
}

async function launch(platform, { headless, timeoutMs = 45000 } = {}) {
  const { chromium } = require('playwright');
  if (!isLogged(platform)) throw new Error(`${platform}: não logado (rode npm run social:login -- --platform ${platform})`);
  clearStaleProfileLock(platform);
  // Headless por padrão; plataformas em HEADED_PLATFORMS abrem janela
  // (TikTok/X validados com janela — invisível o render muda e o fluxo trava).
  const headed = (process.env.HEADED_PLATFORMS || 'tiktok,x').split(',').map(s => s.trim()).includes(platform);
  const headlessNow = headless ?? !headed;
  const browser = await chromium.launchPersistentContext(PROFILE_DIR(platform), {
    headless: headlessNow,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled']
  });
  browser.setDefaultTimeout(45000); // ações travadas falham rápido (não bloqueiam o pipeline)
  return browser;
}

const step = (platform, msg) => console.log(`  [${platform}] ${msg}`);

/* ---------------- orçamento de tempo por plataforma ---------------- */

const UPLOAD_TIMEOUT_MS = Number(process.env.PLATFORM_UPLOAD_TIMEOUT_MS || 8 * 60 * 1000);
// TikTok pode recomeçar o fluxo inteiro 2x (crash recovery); YouTube/Telegram
// sobem arquivos grandes pela API — orçamentos maiores para esses casos.
const PLATFORM_BUDGET_MS = {
  tiktok: 14 * 60 * 1000,
  youtube: 15 * 60 * 1000,
  telegram: 15 * 60 * 1000
};
const { execFileSync } = require('child_process');

// Mata o browser órfão de uma plataforma travada (identifica pelo user-data-dir).
function killBrowserByProfile(platform) {
  try { execFileSync('pkill', ['-f', `browser-profiles/${platform}`], { stdio: 'ignore' }); }
  catch (_e) { /* nenhum processo */ }
}

/**
 * Nenhuma plataforma pode travar o pipeline inteiro: orçamento de tempo DURO.
 * O page.evaluate do Playwright NÃO respeita defaultTimeout — se o renderer
 * congelar (página crashou), a promessa fica pendurada pra sempre; aqui o
 * timeout mata o browser órfão e segue com as demais plataformas.
 */
function withBudget(promise, platform, ms = UPLOAD_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      killBrowserByProfile(platform);
      reject(new Error(`timeout ${(ms / 60000).toFixed(0)}min (browser órfão morto)`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Digita APAGANDO o que já existe no campo (caption padrão, filename pré-definido).
// IMPORTANTE: só EVENTOS DE TECLADO (Ctrl+A/Backspace/keyboard.type) — o
// execCommand('insertText') mutava o DOM por baixo do React do TikTok e
// derrubava o formulário inteiro ("removeChild" → "pageCrash form unmount"
// → "Algo deu errado"). O campo também fica desabilitado enquanto o vídeo
// processa: rounds com espera maior cobrem isso.
async function setEditableText(page, target, text, { label = 'caption' } = {}) {
  const wanted = String(text);
  for (let round = 1; round <= 6; round++) {
    await target.click().catch(() => {});
    await page.keyboard.press('Control+a').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.waitForTimeout(300);
    await page.keyboard.type(wanted, { delay: 8 });
    await page.waitForTimeout(800);
    const after = String(await target.innerText().catch(() => '')).trim();
    if (after.startsWith(wanted.trim().slice(0, 12))) return true;
    console.warn(`  [${label}] campo sujo após tentativa ${round}: "${after.slice(0, 50)}"`);
    await page.waitForTimeout(4000); // processando → campo desabilitado; espera e tenta de novo
  }
  return false;
}

// Acha o editor de legenda do TikTok Studio. O editor de legenda é o único
// contenteditable que CONTÉM o filename auto-preenchido após o upload.
async function findTikTokCaptionBox(page) {
  const selectors = [
    'div[contenteditable="true"][data-placeholder*="escrev" i]',
    'div[contenteditable="true"][aria-label*="escrev" i]',
    'div[contenteditable="true"][data-placeholder*="descri" i]',
    'div[contenteditable="true"][data-placeholder*="legenda" i]'
  ];
  for (const sel of selectors) {
    const loc = page.locator(sel).last();
    if (await loc.isVisible({ timeout: 1200 }).catch(() => false)) return loc;
  }
  // pelo conteúdo: o que tem o filename é o caption
  try {
    const boxes = page.locator('div[contenteditable="true"]');
    const n = await boxes.count();
    for (let i = 0; i < n; i++) {
      const txt = String(await boxes.nth(i).innerText().catch(() => '')).trim();
      if (/\.mp4|\.mov|_corte|auto_\d/i.test(txt)) return boxes.nth(i);
    }
    // senão: o último com MUITO texto (não a busca)
    let best = null;
    for (let i = 0; i < n; i++) {
      const txt = String(await boxes.nth(i).innerText().catch(() => '')).trim();
      if (txt.length > 0) best = boxes.nth(i);
    }
    if (best) return best;
  } catch (_e) { /* segue pro fallback */ }
  return page.locator('div[contenteditable="true"]:visible').last();
}
const captionOf = ({ title, hashtags }) => `${title} ${hashtags}\n\n#ia #inteligenciaartificial #tecnologia`;

/* ---------------- TikTok ---------------- */

// Screenshots de debug em cada etapa — salvos em logs/snaps/
const SNAP_DIR = path.join(ROOT, 'logs', 'snaps');
fs.mkdirSync(SNAP_DIR, { recursive: true });
async function snap(page, platform, name) {
  try {
    const file = path.join(SNAP_DIR, `${platform}_${name}_${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: false });
    step(platform, `print: ${path.basename(file)}`);
    return file;
  } catch (_e) { return null; }
}

// O TikTok abre modais que interceptam o clique em Postar. Já vistos:
//  - "Ativar verificações automáticas de conteúdo?" → botões Ativar/Cancelar
//  - "Vamos analisar automaticamente seu vídeo…" → Continuar
async function confirmModals(page) {
  for (let i = 0; i < 4; i++) {
    // :visible — evita cair em portals vazios (há vários na página)
    const visibleModals = await page.locator('[data-floating-ui-portal]:visible, .TUXModal-overlay:visible').count().catch(() => 0);
    if (!visibleModals) return;
    await snap(page, 'tiktok', `modal${i}`);
    let clicked = false;
    for (const pattern of [/^ativar$/i, /^continuar$/i, /^ok$/i, /^entendi(do)?$/i, /^cancelar$/i, /continuar|concordo|próximo|next|aceito/i]) {
      const btn = page.getByRole('button', { name: pattern }).first();
      if (await btn.isVisible({ timeout: 1200 }).catch(() => false)) {
        step('tiktok', `confirmando modal ("${pattern.source}")…`);
        await btn.click().catch(() => {});
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      // último recurso: último botão visível dentro do modal
      const fallback = page.locator('[data-floating-ui-portal]:visible button, .TUXModal-overlay:visible button').last();
      await fallback.click().catch(() => {});
    }
    await page.waitForTimeout(1500);
  }
}

// O TikTok Studio às vezes crasha ("Algo deu errado / Tente novamente") e o editor
// desaparece — martelar a página morta é inútil (era o loop infinito no log).
// Retorna 'ok' se a página está viva (ou voltou após "Tentar novamente"),
// 'crash' se o editor NÃO voltou — nesse caso o upload inteiro recomeça.
async function recoverTikTokCrash(page) {
  const crashed = await page.getByText(/algo deu errado|something went wrong/i).first().isVisible({ timeout: 1200 }).catch(() => false);
  if (!crashed) return 'ok';
  step('tiktok', 'página crashou ("Algo deu errado") — Tentar novamente…');
  const retry = page.getByRole('button', { name: /tentar novamente|try again/i }).first();
  if (await retry.isVisible({ timeout: 2000 }).catch(() => false)) await retry.click().catch(() => {});
  // Espera o EDITOR real voltar (não só a mensagem sumir) — pode levar dezenas de segundos.
  const editorBack = await page.waitForSelector('div[contenteditable="true"]:visible', { timeout: 30000 }).then(() => true).catch(() => false);
  if (!editorBack) { step('tiktok', 'crash persistente (editor não voltou)'); return 'crash'; }
  return 'ok';
}

// Um fluxo completo de upload. Retorna 'ok' | 'crash' | 'fail'.
async function uploadTikTokOnce({ videoPath, caption }) {
  const browser = await launch('tiktok');
  try {
    const page = await browser.newPage();
    step('tiktok', 'abrindo studio de upload…');
    await page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    await snap(page, 'tiktok', 'carregado');
    const input = await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 45000 });
    step('tiktok', 'enviando arquivo…');
    await input.setInputFiles(videoPath);
    await page.waitForTimeout(10000);
    await snap(page, 'tiktok', 'apos_arquivo');
    await confirmModals(page);
    await confirmModals(page);
    if ((await recoverTikTokCrash(page)) === 'crash') { await snap(page, 'tiktok', 'final'); return 'crash'; }
    step('tiktok', 'aguardando editor de legenda…');
    // último contenteditable visível = campo de legenda (o 1º é a busca lateral)
    const editor = await page.waitForSelector('div[contenteditable="true"]:visible', { timeout: 90000 }).catch(() => null);
    await snap(page, 'tiktok', 'editor');
    if (!editor) { step('tiktok', 'editor de legenda não apareceu'); return 'crash'; }
    const captionBox = await findTikTokCaptionBox(page);
    await setEditableText(page, captionBox, String(caption).slice(0, 2200), { label: 'tiktok' });
    await page.waitForTimeout(2500);
    await snap(page, 'tiktok', 'legenda_digitada');
    await page.waitForTimeout(4000);
    await confirmModals(page);
    await snap(page, 'tiktok', 'antes_post');
    step('tiktok', 'clicando em Postar…');
    let posted = false;
    for (let attempt = 0; attempt < 3 && !posted; attempt++) {
      // VERIFICAÇÃO FINAL: se o filename/aperto sujo reapareceu, limpa ANTES de publicar
      const box = await findTikTokCaptionBox(page);
      const content = String(await box.innerText().catch(() => '')).trim();
      if (!content.startsWith(String(caption).trim().slice(0, 12))) {
        if ((await recoverTikTokCrash(page)) === 'crash') return 'crash';
        step('tiktok', 'caption sujo no fim — limpando e redigitando…');
        await setEditableText(page, box, String(caption).slice(0, 2200), { label: 'tiktok-final' });
        await page.waitForTimeout(800);
      }
      for (const label of [/^post(ar)?$/i, /^publicar/i]) {
        const btn = page.getByRole('button', { name: label }).last();
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await btn.click({ timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(5000);
          await snap(page, 'tiktok', `apos_click_post${attempt}`);
          await confirmModals(page);
          posted = true;
          break;
        }
      }
      if (!posted) { await confirmModals(page); await page.waitForTimeout(3000); }
    }
    if (!posted) return 'fail';
    step('tiktok', 'publicado!');
    await snap(page, 'tiktok', 'final');
    await page.waitForTimeout(8000);
    return 'ok';
  } finally {
    await browser.close().catch(() => {});
  }
}

async function uploadTikTok({ videoPath, caption }) {
  // Crash do Studio = o upload PERDE-SE inteiro: recomeçar do zero é a única
  // recuperação real. Antes o retry martelava a página morta até o orçamento estourar.
  const maxFlows = Number(process.env.TIKTOK_FLOW_ATTEMPTS || 2);
  for (let flow = 1; flow <= maxFlows; flow++) {
    if (flow > 1) step('tiktok', `recomeçando o upload do zero (fluxo ${flow}/${maxFlows})`);
    const outcome = await uploadTikTokOnce({ videoPath, caption });
    if (outcome !== 'crash') {
      if (outcome === 'fail') throw new Error('não confirmou o Post (crash ou botão indisponível)');
      return;
    }
  }
  throw new Error(`TikTok Studio crashou ${maxFlows}x seguidas — upload não confirmado`);
}

/* ---------------- Instagram (Reels) ---------------- */

async function uploadInstagram({ videoPath, caption }) {
  const browser = await launch('instagram');
  try {
    const page = await browser.newPage();
    step('instagram', 'abrindo feed…');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);

    // "Novo post": aria-label fica no SVG — clica no ancestral clicável
    step('instagram', 'abrindo menu Novo post…');
    await page.evaluate(() => {
      const svg = document.querySelector('svg[aria-label*="novo post" i], svg[aria-label*="new post" i], svg[aria-label*="nova publica" i], svg[aria-label*="novo" i]');
      if (svg) { const c = svg.closest('a, button, [role="button"], div[tabindex]') || svg; c.click(); }
    }).catch(() => {});
    await page.waitForTimeout(2500);

    // menu: "Selecionar do computador"
    const sel = page.getByText(/selecionar do computador|select from computer/i).first();
    if (await sel.isVisible({ timeout: 8000 }).catch(() => false)) {
      await sel.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
    const input = await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 30000 });
    step('instagram', 'enviando arquivo…');
    await input.setInputFiles(videoPath);

    // aguarda o diálogo e fecha popups informativos ("…são compartilhados como reels" → OK)
    await page.waitForTimeout(8000);
    for (let i = 0; i < 3; i++) {
      const okBtn = page.getByRole('button', { name: /^(ok|entendi|entendido|beleza)$/i }).first();
      if (await okBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
        step('instagram', 'fechando popup informativo…');
        await okBtn.click().catch(() => {});
        await page.waitForTimeout(2500);
      } else break;
    }
    await snap(page, 'instagram', 'pos_upload');

    // avança as telas (Continuar/Avançar) até a de legenda — clique via DOM (role API falha)
    for (let i = 0; i < 4; i++) {
      const advanced = await page.evaluate(() => {
        const cands = [...document.querySelectorAll('[role="dialog"] [role="button"], [role="dialog"] button, [role="button"], button')];
        const btn = cands.find(b => /^(avançar|continuar|next)$/i.test((b.textContent || '').trim()));
        if (btn) { btn.click(); return (btn.textContent || '').trim(); }
        return null;
      }).catch(() => null);
      if (advanced) {
        step('instagram', `avançou: "${advanced}"`);
        await page.waitForTimeout(5000);
        // popups podem aparecer a cada tela
        const okBtn = page.getByRole('button', { name: /^(ok|entendi)$/i }).first();
        if (await okBtn.isVisible({ timeout: 2000 }).catch(() => false)) { await okBtn.click().catch(() => {}); await page.waitForTimeout(2000); }
      } else {
        await page.waitForTimeout(3000);
      }
    }
    await snap(page, 'instagram', 'pos_avancar');

    // caption: editor contenteditable ("Escreva uma legenda")
    const editor = page.locator('div[contenteditable="true"]').first();
    if (await editor.isVisible({ timeout: 30000 }).catch(() => false)) {
      await setEditableText(page, editor, String(caption).slice(0, 2200), { label: 'instagram' });
      step('instagram', 'legenda ok');
    } else {
      step('instagram', 'editor de legenda não apareceu');
    }
    // Compartilhar
    const share = page.getByRole('button', { name: /compartilhar|share/i }).first();
    if (!(await share.isVisible({ timeout: 15000 }).catch(() => false))) {
      throw new Error('Instagram: botão Compartilhar não encontrado');
    }
    const composer = page.getByRole('dialog').last();
    const composerWasVisible = await composer.isVisible().catch(() => false);
    await share.click();
    step('instagram', 'compartilhando…');
    await page.waitForTimeout(4000);
    const deadline = Date.now() + 180000;
    let progressObserved = false;
    let shareConfirmed = false;
    while (Date.now() < deadline) {
      const sharing = await page.getByText(/compartilhando/i).first().isVisible({ timeout: 1000 }).catch(() => false);
      const spinner = await page.locator('[role="progressbar"], [aria-busy="true"]').first().isVisible({ timeout: 1000 }).catch(() => false);
      if (sharing || spinner) progressObserved = true;
      const successMessage = await page.getByText(/publicação foi compartilhada|reel foi compartilhado|compartilhado com sucesso|your post has been shared|post shared successfully/i).first().isVisible({ timeout: 500 }).catch(() => false);
      const composerVisible = await composer.isVisible().catch(() => false);
      const shareButtonVisible = await share.isVisible().catch(() => false);
      if (successMessage || (!sharing && !spinner && (progressObserved || (composerWasVisible && !composerVisible) || !shareButtonVisible))) {
        shareConfirmed = true;
        step('instagram', 'compartilhamento confirmado');
        break;
      }
      await page.waitForTimeout(5000);
    }
    await page.waitForTimeout(5000);
    await snap(page, 'instagram', 'final');
    if (!shareConfirmed) throw new Error('Instagram: não confirmou a conclusão do compartilhamento em 180s');
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ---------------- Kwai (app no emulador Android on-demand) ---------------- */

// Kwai removeu o upload web (/upload = 404). Publica pelo APP dentro do
// emulador redroid: adquire → posta → solta (emulador derruba sozinho e libera RAM).
async function uploadKwai({ videoPath, caption }) {
  const kwai = kwaiEmu();
  await kwai.acquire(); // 1º uso do ciclo sobe o emulador
  try {
    step('kwai', 'enviando vídeo pra galeria do emulador…');
    await kwai.pushVideo(videoPath);

    step('kwai', 'abrindo app…');
    await kwai.openApp();
    await kwai.screencap('01_aberto');

    // permissões de primeira execução (câmera/fotos/armazenamento)
    for (let i = 0; i < 5; i++) {
      const concedida = await kwai.tapText(/while using the app|only this time|allow all|^(permitir|allow|enquanto usa)/i, { timeoutMs: 4000 });
      if (!concedida) break;
      step('kwai', 'permissão concedida');
      await new Promise(r => setTimeout(r, 2500));
    }

    // botão de postar: id_record_layout (ícone central da barra, sem texto).
    // Validado no Kwai Lite: (360,1133) em 720x1280 — NUNCA y>=1200 (zona de
    // gestos do Android 14 = vai pra home).
    const bar = (await kwai.dumpUI({ timeoutMs: 15000 }));
    const record = bar.find(n => /id_record_layout/i.test(n.rid || '')) || bar.find(n => /postar|câmera|criar/i.test(n.text || n.desc || ''));
    if (record) await kwai.tap(record.x, record.y);
    else await kwai.tap(360, 1133);
    await kwai.screencap('02_tela_post');
    await new Promise(r => setTimeout(r, 4000));

    // primeira vez: o Lite pede pra baixar o módulo de câmera — confirma
    if (await kwai.tapText(/^download$/i, { timeoutMs: 6000 })) {
      step('kwai', 'módulo de câmera: download confirmado');
      await new Promise(r => setTimeout(r, 30000));
      for (let i = 0; i < 4; i++) {
        const p = await kwai.tapText(/while using the app|allow all|^(permitir|allow)/i, { timeoutMs: 4000 });
        if (!p) break;
        await new Promise(r => setTimeout(r, 2500));
      }
    }
    // prompt de atalho "ADD TO HOME SCREEN" — cancela
    await kwai.tapText(/^cancel$|^cancelar$/i, { timeoutMs: 4000 });

    // abre o Album (galeria) — botão inferior esquerdo da tela de câmera
    const galeria = await kwai.tapText(/^(album|álbum|galeria|gallery)$/i, { timeoutMs: 20000 });
    if (!galeria) await kwai.tap(105, 1122);
    await kwai.screencap('03_galeria');
    await new Promise(r => setTimeout(r, 2500));

    // aba "Videos" pra filtrar
    await kwai.tapText(/^(videos?|vídeos)$/i, { timeoutMs: 8000 });
    await new Promise(r => setTimeout(r, 2000));

    // escolhe o item mais recente (maior card clicável da grade)
    const nodes = await kwai.dumpUI({ timeoutMs: 20000 });
    const item = nodes.filter(n => n.clickable && n.w >= 150 && n.h >= 150 && n.y > 200)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x))[0];
    if (!item) throw new Error('vídeo não achado na galeria');
    await kwai.tap(item.x, item.y);
    step('kwai', 'vídeo selecionado');
    await kwai.screencap('04_selecionado');
    await new Promise(r => setTimeout(r, 2000));

    // confirma com "Select" (topo direito) — sem isso não avança pro editor
    const sel = await kwai.tapText(/^select$|^selecionar$|^ok$/i, { timeoutMs: 15000 });
    if (!sel) await kwai.tap(632, 97);
    step('kwai', 'seleção confirmada');
    await new Promise(r => setTimeout(r, 6000));
    await kwai.screencap('05_editor');

    // legenda: procura EditText na tela (pode precisar de foco primeiro)
    const editor = (await kwai.dumpUI({ timeoutMs: 15000 })).find(n => /EditText/i.test(n.cls || ''))
      || (await kwai.findByText(/descri|legenda|caption|fale sobre/i, { timeoutMs: 8000, alsoDesc: true, alsoRid: true }));
    if (editor) {
      await kwai.tap(editor.x, editor.y);
      await new Promise(r => setTimeout(r, 1500));
      await kwai.text(String(caption).slice(0, 2000));
      step('kwai', 'legenda digitada');
    } else {
      step('kwai', 'campo de legenda não achado — segue sem legenda extra');
    }
    await kwai.screencap('06_legenda');

    // publica (botão do topo direito "Publicar")
    const pub = await kwai.tapText(/^publicar$|^postar$|^post$|^public$/i, { timeoutMs: 20000 });
    if (!pub) {
      const top = (await kwai.dumpUI({ timeoutMs: 10000 }))
        .filter(n => n.clickable && n.y < 250 && n.x > 500).sort((a, b) => b.x - a.x)[0];
      if (top) await kwai.tap(top.x, top.y);
      else throw new Error('botão Publicar não encontrado');
    }
    step('kwai', 'publicado!');
    await kwai.screencap('07_publicando');
    await new Promise(r => setTimeout(r, 12000));
    await kwai.screencap('08_final');
  } finally {
    kwai.release(); // último uso derruba o emulador → RAM liberada
  }
}

/* ---------------- X (Twitter) ---------------- */

async function uploadX({ videoPath, caption }) {
  const browser = await launch('x');
  try {
    const page = await browser.newPage();
    step('x', 'abrindo compositor…');
    await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    const fileInput = await page.waitForSelector('input[type=file][data-testid="fileInput"], input[type=file]', { timeout: 45000, state: 'attached' });
    step('x', 'enviando vídeo…');
    await fileInput.setInputFiles(videoPath);
    step('x', 'processando vídeo…');
    await page.waitForTimeout(12000);
    const editor = await page.waitForSelector('div[data-testid="tweetTextarea_0"], div[contenteditable="true"]', { timeout: 30000 }).catch(() => null);
    if (editor) {
      await setEditableText(page, editor, String(caption).slice(0, 280), { label: "caption" });
    }
    const post = page.getByRole('button', { name: /^post(ar)?$/i }).first();
    if (await post.isVisible({ timeout: 10000 }).catch(() => false)) {
      await post.click().catch(() => {});
      step('x', 'publicado!');
    }
    await page.waitForTimeout(6000);
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ---------------- Telegram (canal) ---------------- */

async function uploadTelegram({ videoPath, caption }) {
  const channel = process.env.TELEGRAM_CHANNEL;
  if (!channel) throw new Error('x: TELEGRAM_CHANNEL não configurado (.env)');
  const browser = await launch('telegram');
  try {
    const page = await browser.newPage();
    step('telegram', 'abrindo…');
    await page.goto('https://web.telegram.org/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
    // busca o canal
    const search = page.getByPlaceholder(/pesquis/i).first();
    if (await search.isVisible({ timeout: 12000 }).catch(() => false)) {
      await search.click().catch(() => {});
      await page.keyboard.type(channel.slice(0, 40), { delay: 20 });
      await page.waitForTimeout(3000);
      const hit = page.getByText(channel, { exact: false }).first();
      if (await hit.isVisible({ timeout: 8000 }).catch(() => false)) await hit.click().catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(2000);
    const fileInput = await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 30000 });
    step('telegram', 'enviando vídeo…');
    await fileInput.setInputFiles(videoPath);
    await page.waitForTimeout(3000);
    const editor = await page.waitForSelector('div[contenteditable="true"], textarea', { timeout: 20000 }).catch(() => null);
    if (editor) {
      await setEditableText(page, editor, String(caption).slice(0, 1000), { label: "caption" });
    }
    const send = page.getByRole('button', { name: /enviar|send/i }).first();
    if (await send.isVisible({ timeout: 8000 }).catch(() => false)) await send.click().catch(() => page.keyboard.press('Enter'));
    else await page.keyboard.press('Enter');
    step('telegram', 'publicado!');
    await page.waitForTimeout(5000);
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ---------------- orquestrador ---------------- */

async function uploadToAll({ videoPath, clips = [], title, hashtags = '#ia #inteligenciaartificial #tecnologia', sourceUrl = '', skipYouTube = false, maxShorts = 1, seo = null, thumbnailPath = '' }) {
  const caption = captionOf({ title, hashtags });
  const results = { long: {}, clips: {} };

  // 1) YouTube — vídeo longo (API oficial). SEO dinâmico + thumbnail entram
  //    AQUI (o caminho principal de publicação), não só no upload manual.
  if (skipYouTube) {
    results.long.youtube = 'pulado (cota)';
  } else {
    try {
      const ytDescription = [
        seo?.description || title,
        sourceUrl ? `Fonte: ${sourceUrl}` : '',
        seo?.hashtags || caption
      ].filter(Boolean).join('\n\n');
      const r = await withBudget(uploadVideo({
        videoPath, title, description: ytDescription,
        tags: ['inteligência artificial', 'IA', 'tecnologia', 'notícias'],
        privacyStatus: process.env.YT_PRIVACY || 'public',
        ...(thumbnailPath ? { thumbnailPath } : {})
      }), 'youtube', 15 * 60 * 1000);
      results.long.youtube = r.url;
      console.log(`  [youtube] ${r.url}`);
    } catch (e) { results.long.youtube = `ERRO: ${e.message}`; console.warn(`  [youtube] ${e.message}`); }
  }

  // 2) Cortes → Shorts (API, limitado p/ cota) + TikTok + Kwai + IG + X
  const shortsCount = Math.min(clips.length, Math.max(0, maxShorts));
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const clipTitle = `${clip.title} ${hashtags} #shorts`;
    results.clips[clip.path] = {};

    if (!skipYouTube && i < shortsCount) {
      try {
        const r = await uploadVideo({ videoPath: clip.path, title: clipTitle.slice(0, 100), description: `${title}\n\n${caption}`, tags: ['shorts', 'ia', 'inteligencia artificial'], privacyStatus: process.env.YT_PRIVACY || 'public' });
        results.clips[clip.path].shorts = r.url;
        console.log(`  [shorts ${i + 1}] ${r.url}`);
      } catch (e) { results.clips[clip.path].shorts = `ERRO: ${e.message}`; console.warn(`  [shorts ${i + 1}] ${e.message}`); }
    } else {
      results.clips[clip.path].shorts = i < shortsCount ? 'pulado (cota)' : 'desativado';
    }

    for (const [platform, fn] of [['tiktok', uploadTikTok], ['kwai', uploadKwai], ['instagram', uploadInstagram], ['x', uploadX]]) {
      if (DISABLED_PLATFORMS.includes(platform)) { results.clips[clip.path][platform] = 'desativado'; continue; }
      if (!isLogged(platform)) { results.clips[clip.path][platform] = 'não logado'; continue; }
      try {
        await withBudget(fn({ videoPath: clip.path, caption: `${clipTitle}\n\n${sourceUrl ? 'Fonte: ' + sourceUrl : ''}` }), platform, PLATFORM_BUDGET_MS[platform] || UPLOAD_TIMEOUT_MS);
        results.clips[clip.path][platform] = 'ok';
      } catch (e) {
        results.clips[clip.path][platform] = `ERRO: ${e.message.slice(0, 120)}`;
        console.warn(`  [${platform} ${i + 1}] ${e.message.slice(0, 120)}`);
      }
    }
  }

  // 3) Longo nas redes de vídeo longo (Telegram só se configurado no .env)
  if (process.env.TELEGRAM_CHANNEL) {
    if (!isLogged('telegram')) { results.long.telegram = 'não logado'; }
    else {
      try {
        await withBudget(uploadTelegram({ videoPath, caption: `${title}\n\n${sourceUrl ? 'Fonte: ' + sourceUrl : ''}` }), 'telegram', PLATFORM_BUDGET_MS.telegram);
        results.long.telegram = 'ok';
      } catch (e) {
        results.long.telegram = `ERRO: ${e.message.slice(0, 120)}`;
        console.warn(`  [telegram longo] ${e.message.slice(0, 120)}`);
      }
    }
  }

  return results;
}

module.exports = { uploadToAll, uploadTikTok, uploadKwai, uploadInstagram, uploadX, uploadTelegram, isLogged };
