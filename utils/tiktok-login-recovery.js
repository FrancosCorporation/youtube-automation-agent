'use strict';

const { normalizeAccountHandle } = require('./android-session-state');

// Only resume the exact saved TikTok profile approved for this destination.
// Never choose between multiple Google accounts or handle passwords/2FA.
async function recoverSavedTikTokLogin(control, expectedHandle, { wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let expected;
  try { expected = normalizeAccountHandle(expectedHandle); } catch { return false; }
  if (!expected || typeof control.tap !== 'function') return false;
  let nodes = await control.dumpUi();
  const visible = nodes.filter(node => node.visible !== false);
  const text = visible.map(node => `${node.text || ''} ${node.description || ''}`).join(' ').toLowerCase();
  const credentialEmails = visible.filter(node => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(node.text || '').trim()));
  const continueButton = visible.find(node => /^(continue|continuar)$/i.test(String(node.text || '').trim())
    && Number.isFinite(node.x) && Number.isFinite(node.y));
  if (/sign in with google|entrar com o google/i.test(text) && /account for tiktok|conta para o tiktok/i.test(text)
    && credentialEmails.length === 1 && continueButton) {
    await control.tap(continueButton.x, continueButton.y);
    await wait(3000);
    return true; // The normal probe still requires the exact expected TikTok handle.
  }
  const escaped = expected.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const welcome = /welcome back|bem.vindo de volta/i.test(text)
    && new RegExp(`(?:^|[^a-z0-9._])@?${escaped}(?:$|[^a-z0-9._])`, 'i').test(text);
  const button = visible.find(node => node.clickable && /^(log in|entrar)$/i.test(String(node.text || '').trim()));
  if (!welcome || !button) return false;
  await control.tap(button.x, button.y);
  await wait(1500);
  nodes = await control.dumpUi();
  const current = nodes.filter(node => node.visible !== false);
  const pickerText = current.map(node => `${node.text || ''} ${node.description || ''}`).join(' ');
  const accounts = current.filter(node => node.resourceId === 'com.google.android.gms:id/account_name');
  if (/continue to tiktok|continuar para o tiktok/i.test(pickerText) && accounts.length === 1) {
    await control.tap(accounts[0].x, accounts[0].y);
    await wait(3000);
  }
  return true;
}


module.exports = { recoverSavedTikTokLogin };
