#!/usr/bin/env node
/**
 * Atualiza o PERFIL das redes (avatar + nome + bio) com a identidade do canal.
 * Uso: node scripts/update-social-profiles.js --platform tiktok|x|instagram|kwai
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const LOGO = path.join(ROOT, 'data', 'assets', 'logo_pulso_ia.png');

const NAME = process.env.CHANNEL_NAME || 'Pulso IA';
const BIO = process.env.CHANNEL_BIO || 'Notícias de inteligência artificial em português: casos reais, o que muda na sua vida e o pulso da tech. Novos vídeos todos os dias.';

const SNAP_DIR = path.join(ROOT, 'logs', 'snaps');
fs.mkdirSync(SNAP_DIR, { recursive: true });

// Digita APAGANDO o que já existe no campo
async function clearAndType(page, target, text, { delay = 4 } = {}) {
  await target.click().catch(() => {});
  await page.keyboard.press('Control+a').catch(() => {});
  await page.waitForTimeout(150);
  await page.keyboard.press('Delete').catch(() => {});
  await page.waitForTimeout(150);
  await page.keyboard.type(String(text), { delay });
}

const snap = (page, tag) => page.screenshot({ path: path.join(SNAP_DIR, `profile_${tag}_${Date.now()}.png`) }).catch(() => {});
const log = m => console.log(m);

async function launch(platform) {
  const { chromium } = require('playwright');
  const profile = path.join(ROOT, 'data', 'browser-profiles', platform);
  return chromium.launchPersistentContext(profile, { headless: false, channel: 'chrome', viewport: { width: 1280, height: 900 } });
}

async function setAvatarIfInput(page) {
  const input = await page.waitForSelector('input[type=file][accept*="image"], input[type=file][accept*="photo"], input[type=file][accept*="png"]', { state: 'attached', timeout: 6000 }).catch(() => null);
  if (input) {
    await input.setInputFiles(LOGO);
    log('  avatar enviado');
    await page.waitForTimeout(2500);
    return true;
  }
  return false;
}

/* ---------------- TikTok ---------------- */
async function tiktok() {
  const browser = await launch('tiktok');
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(40000);
    const handle = process.env.TT_HANDLE || 'cinedarkdolphin';
    log(`[tiktok] abrindo perfil @${handle}…`);
    await page.goto(`https://www.tiktok.com/@${handle}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6000);
    log('  url: ' + page.url().slice(0, 70));
    await snap(page, 'tiktok_perfil');

    const editBtn = page.getByRole('button', { name: /editar perfil|edit profile/i }).first();
    if (await editBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await editBtn.click().catch(() => {});
      log('  → editor acionado (resolva o CAPTCHA na tela se aparecer!)');
    } else {
      log('  ⚠️ Editar perfil não visível');
    }
    await page.waitForTimeout(3000);
    await snap(page, 'tiktok_editor');

    // MODO ASSISTIDO: espera você resolver o captcha (até 3 min) até surgir o form
    log('  aguardando captcha/form… (resolva o quebra-cabeça na janela)');
    let formReady = false;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const fieldsProbe = page.locator('input[placeholder]:not([placeholder*="esquis" i]):not([placeholder*="earch" i]), textarea');
      const n = await fieldsProbe.count().catch(() => 0);
      if (n > 0) { formReady = true; log('  ✅ form aberto!'); break; }
      await page.waitForTimeout(4000);
    }
    if (!formReady) log('  ⚠️ form não apareceu em 3 min');

    // avatar: "Trocar foto" abre o input
    if (!(await setAvatarIfInput(page))) {
      const change = page.getByText(/trocar foto|alterar foto|change photo|editar foto/i).first();
      if (await change.isVisible({ timeout: 5000 }).catch(() => false)) {
        await change.click().catch(() => {});
        await page.waitForTimeout(1200);
        await setAvatarIfInput(page);
      }
    }
    await snap(page, 'tiktok_avatar');

    // campos do modal (nome, usuário, bio)
    const fields = page.locator('input[placeholder], textarea[placeholder], input[type="text"], textarea');
    const count = await fields.count().catch(() => 0);
    log(`  ${count} campos no modal`);
    for (let i = 0; i < Math.min(count, 6); i++) {
      const el = fields.nth(i);
      const ph = (await el.getAttribute('placeholder').catch(() => '')) || '';
      const val = await el.inputValue().catch(() => '');
      log(`    campo ${i}: ph="${ph}" val="${String(val).slice(0, 26)}"`);
      if (/bio/i.test(ph)) {
        await clearAndType(page, el, BIO);
        log('    → bio preenchida');
      } else if (val && String(val).length < 40 && String(val) !== NAME) {
        await clearAndType(page, el, NAME);
        log('    → nome preenchido');
      }
    }
    await snap(page, 'tiktok_campos');
    const save = page.getByRole('button', { name: /salvar|save/i }).first();
    if (await save.isVisible({ timeout: 6000 }).catch(() => false)) { await save.click().catch(() => {}); log('  salvo'); }
    await page.waitForTimeout(4000);
    await snap(page, 'tiktok_final');
  } finally { await browser.close().catch(() => {}); }
}

/* ---------------- X (Twitter) ---------------- */
async function x() {
  const browser = await launch('x');
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    log('[x] abrindo configurações de perfil…');
    await page.goto('https://x.com/settings/profile', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    await snap(page, 'x_tela');
    const edit = page.getByRole('button', { name: /editar perfil|edit profile/i }).first();
    if (await edit.isVisible({ timeout: 8000 }).catch(() => false)) await edit.click().catch(() => {});
    await page.waitForTimeout(2000);
    await snap(page, 'x_editor');

    // avatar
    const avatarBtn = page.getByRole('button', { name: /adicionar avatar|add avatar|alterar foto|change photo/i }).first();
    if (await avatarBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await avatarBtn.click().catch(() => {});
      await setAvatarIfInput(page);
    } else {
      await setAvatarIfInput(page);
    }
    // nome e bio
    const nameField = page.getByLabel(/nome|name/i).first();
    if (await nameField.isVisible({ timeout: 4000 }).catch(() => false)) { await nameField.fill(NAME); log('  nome ok'); }
    const bioField = page.getByLabel(/bio|descrição/i).first();
    if (await bioField.isVisible({ timeout: 4000 }).catch(() => false)) { await bioField.fill(BIO); log('  bio ok'); }
    await snap(page, 'x_campos');
    const save = page.getByRole('button', { name: /salvar|save/i }).first();
    if (await save.isVisible({ timeout: 6000 }).catch(() => false)) { await save.click().catch(() => {}); log('  salvo'); }
    await page.waitForTimeout(4000);
    await snap(page, 'x_final');
  } finally { await browser.close().catch(() => {}); }
}

/* ---------------- Instagram ---------------- */
async function instagram() {
  const browser = await launch('instagram');
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    log('[instagram] abrindo edição de perfil…');
    await page.goto('https://www.instagram.com/accounts/edit/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6000);
    log('  url: ' + page.url().slice(0, 60));
    await snap(page, 'ig_edit_page');

    // avatar: "Alterar foto do perfil" → "Carregar foto" → input
    const changeBtn = page.getByRole('button', { name: /alterar foto|change photo|editar foto/i }).first();
    if (await changeBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
      await changeBtn.click().catch(() => {});
      await page.waitForTimeout(1500);
      const upItem = page.getByRole('button', { name: /carregar foto|upload photo/i }).first();
      if (await upItem.isVisible({ timeout: 5000 }).catch(() => false)) await upItem.click().catch(() => {});
    }
    const fileInput = await page.waitForSelector('input[type=file][accept*="image"], input[type=file]', { state: 'attached', timeout: 8000 }).catch(() => null);
    if (fileInput) {
      await fileInput.setInputFiles(LOGO);
      log('  logo enviado');
      await page.waitForTimeout(4000);
      // cortador: "Concluir" / "Feito"
      for (const pat of [/concluir/i, /^feito$/i, /^done$/i, /^aplicar$/i, /^aplicar$/i]) {
        const btn = page.getByRole('button', { name: pat }).first();
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) { await btn.click().catch(() => {}); log('  cortador confirmado'); break; }
      }
    }
    await snap(page, 'ig_avatar');

    // Nome e biografia (seletores reais do formulário IG: #pepBio etc.)
    const nameField = page.locator('#pepName, input[name="pepName"], label:has-text("Nome") input, div:has(> label:has-text("Nome")) input').first();
    if (await nameField.isVisible({ timeout: 6000 }).catch(() => false)) {
      await nameField.click().catch(() => {});
      await page.keyboard.press('Control+a').catch(() => {});
      await page.keyboard.type(NAME, { delay: 8 }).catch(() => {});
      log('  nome preenchido');
    } else {
      // fallback: 2º input sem rótulo da página de edição
      const inputs = page.locator('input:not([placeholder]):not([type="checkbox"])');
      const n = await inputs.count().catch(() => 0);
      log(`  (fallback: ${n} inputs sem rótulo)`);
      for (let i = 0; i < Math.min(n, 3); i++) {
        const el = inputs.nth(i);
        const v = await el.inputValue().catch(() => '');
        if (v && v.length < 40 && !/^linktr/.test(v)) {
          await el.click().catch(() => {});
          await page.keyboard.press('Control+a').catch(() => {});
          await page.keyboard.type(NAME, { delay: 8 }).catch(() => {});
          log(`  nome preenchido (input #${i})`);
          break;
        }
      }
    }
    const bioField = page.locator('#pepBio, textarea').first();
    if (await bioField.isVisible({ timeout: 6000 }).catch(() => false)) {
      await bioField.click().catch(() => {});
      await page.keyboard.press('Control+a').catch(() => {});
      await page.keyboard.type(BIO, { delay: 4 }).catch(() => {});
      log('  bio preenchida');
    }
    await snap(page, 'ig_campos');
    // submit: várias estratégias (o role-lookup às vezes não vê o "Enviar")
    let submitted = false;
    for (const sel of [
      page.getByRole('button', { name: /^enviar$/i }),
      page.locator('button[type="submit"]'),
      page.getByText(/^enviar$/i),
      page.getByRole('button', { name: /salvar|submit/i })
    ]) {
      const el = sel.first();
      if (await el.isVisible({ timeout: 4000 }).catch(() => false)) {
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await el.click().catch(() => {});
        submitted = true;
        log('  enviado (salvo)');
        break;
      }
    }
    if (!submitted) log('  ⚠️ submit não encontrado');
    await page.waitForTimeout(4000);
    await snap(page, 'ig_final');
  } finally { await browser.close().catch(() => {}); }
}

(async () => {
  const i = process.argv.indexOf('--platform');
  const p = i >= 0 ? process.argv[i + 1] : null;
  if (p === 'tiktok') await tiktok();
  else if (p === 'x') await x();
  else if (p === 'instagram') await instagram();
  else { log('plataformas suportadas: tiktok | x | instagram'); process.exit(1); }
  log('✅ perfil atualizado');
  process.exit(0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
