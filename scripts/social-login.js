#!/usr/bin/env node
/**
 * Login social — abre o navegador com perfil persistente para você logar 1×.
 * Depois disso os uploaders usam o mesmo perfil, headless.
 *
 * Uso: node scripts/social-login.js --platform tiktok|instagram|kwai|x|telegram|youtube
 *      node scripts/social-login.js --all   (abre todos, um por um)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');

const PLATFORMS = {
  tiktok: { url: 'https://www.tiktok.com/login/phone-or-email/phone', hint: 'TikTok — digite seu TELEFONE com DDD → chega SMS com código → digite o código (sem QR!)' },
  instagram: { url: 'https://www.instagram.com/accounts/login/', hint: 'Instagram — faça login e feche a janela quando terminar' },
  kwai: { url: 'https://www.kwai.com/login', hint: 'Kwai — faça login e feche a janela quando terminar' },
  x: { url: 'https://x.com/i/flow/login', hint: 'X (Twitter) — faça login e feche a janela quando terminar' },
  telegram: { url: 'https://web.telegram.org/', hint: 'Telegram Web — faça login e feche a janela quando terminar' },
  youtube: { url: 'https://www.youtube.com/', hint: 'YouTube — faça login (só se quiser backup além do OAuth)' }
};

async function login(platform) {
  const cfg = PLATFORMS[platform];
  if (!cfg) throw new Error(`plataforma desconhecida: ${platform}`);
  const profileDir = path.join(__dirname, '..', 'data', 'browser-profiles', platform);
  fs.mkdirSync(profileDir, { recursive: true });

  const { chromium } = require('playwright');
  // Chrome REAL (canal instalado) — não acende flags de automação,
  // então TikTok/Instagram/Kwai mostram o form de email/senha normal.
  const browser = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled']
  });
  const page = browser.pages()[0] || await browser.newPage();
  await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log(`\n▶ ${cfg.hint}`);
  console.log('  (perfil salvo em ' + profileDir + ')');
  console.log('  Aguardando você fazer login... (janela se fecha sozinha em 15 min)\n');

  // Espera a janela ser fechada pelo usuário OU 15 minutos
  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 15 * 60 * 1000);
    browser.on('close', () => { clearTimeout(timeout); resolve(); });
  });
  try { await browser.close(); } catch (_e) { /* já fechou */ }
  console.log(`✅ login ${platform} concluído (perfil salvo)`);
}

(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--all')) {
    for (const platform of Object.keys(PLATFORMS)) {
      if (platform === 'youtube') continue; // youtube usa OAuth oficial
      await login(platform);
    }
    console.log('\n🎉 Todos os logins feitos! Os uploaders já podem usar os perfis.');
    return;
  }
  const i = args.indexOf('--platform');
  const platform = i >= 0 ? args[i + 1] : null;
  if (!platform) {
    console.log('uso: node scripts/social-login.js --platform tiktok|instagram|kwai|x|telegram');
    console.log('     node scripts/social-login.js --all');
    process.exit(1);
  }
  await login(platform);
})().catch(error => { console.error('ERRO:', error.message); process.exit(1); });
