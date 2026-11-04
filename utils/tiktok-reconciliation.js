'use strict';

const { inspectAndroidAppSession } = require('./android-emulator-control');
const { normalizeAccountHandle } = require('./android-session-state');
const { emptyTikTokCameraClose } = require('./tiktok-navigation');
const PREFIX = 'com.zhiliaoapp.musically:id/';
const visible = nodes => (nodes || []).filter(n => n.visible !== false);
const byId = (nodes, id) => visible(nodes).filter(n => n.resourceId === PREFIX + id);
const normalizeCaption = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f\u200b-\u200f\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function publicTikTokPrivacy(nodes) {
  const labels = byId(nodes, 'zhu').filter(n => /^(Everyone|Todos)$/i.test(n.text || ''));
  const checked = byId(nodes, 'tss').filter(n => n.checked === true);
  return byId(nodes, 'jpv').some(n => /Who can watch this video|Quem pode assistir/i.test(n.text || ''))
    && labels.length === 1 && checked.length === 1 && Math.abs(checked[0].y - labels[0].y) < 24;
}

function uniqueCaptionCandidate(candidates, actual) {
  const text = normalizeCaption(actual);
  if (!text || /(?:…|\.{3})\s*more\s*$/i.test(text)) return null;
  const matches = candidates.filter(c => normalizeCaption(c.caption) === text);
  return matches.length === 1 ? matches[0] : null;
}

async function scanTikTokPublicPosts({ control, accountHandle, candidates, maxPosts = 6,
  pageOffset = 0, wait = sleep, capture = async () => null, timeoutMs = 45000, onConfirmed = async () => {} }) {
  const expected = normalizeAccountHandle(accountHandle);
  if (!expected) throw new Error('TikTok: identidade configurada ausente');
  const until = async (predicate, label = 'perfil/vídeo') => {
    const deadline = Date.now() + timeoutMs;
    do { const nodes = await control.dumpUi(); if (predicate(nodes)) return nodes; await wait(500); } while (Date.now() < deadline);
    throw new Error(`TikTok: tela de reconciliação indisponível (${label})`);
  };
  const closePrivacy = async initial => {
    let current = initial;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!byId(current, 'jpv').length && byId(current, 'syp').length === 1) return current;
      const closes = visible(current).filter(n => n.clickable && /^(Close|Fechar)$/i.test(n.description || ''));
      if (byId(current, 'jpv').length !== 1 || closes.length !== 1) break;
      await control.tap(closes[0].x, closes[0].y);
      await wait(1000);
      current = await control.dumpUi();
    }
    if (!byId(current, 'jpv').length && byId(current, 'syp').length === 1) return current;
    throw new Error('TikTok: fechamento da privacidade não confirmado');
  };
  let nodes = await control.dumpUi();
  // Leave only positively identified read-only screens. No draft/editor is discarded.
  if (byId(nodes, 'jpv').some(n => /Who can watch this video|Quem pode assistir/i.test(n.text || ''))) {
    nodes = await closePrivacy(nodes);
  }
  if (byId(nodes, 'syp').length === 1 && byId(nodes, 'desc').length === 1) {
    const back = byId(nodes, 'bs_').filter(n => n.clickable && /^(Back|Voltar)$/i.test(n.description || ''));
    if (back.length !== 1) throw new Error('TikTok: retorno do vídeo próprio ambíguo');
    await control.tap(back[0].x, back[0].y);
  } else {
    const close = emptyTikTokCameraClose(nodes);
    if (close) await control.tap(close.x, close.y);
  }
  const session = await inspectAndroidAppSession({ control, platform: 'tiktok', timeoutMs, wait });
  if (session.status !== 'logged_in') throw new Error(`TikTok: inspeção do perfil inconclusiva (${session.status})`);
  if (normalizeAccountHandle(session.accountHandle) !== expected) {
    throw new Error('TikTok: perfil de reconciliação não corresponde à conta configurada');
  }
  nodes = await control.dumpUi();
  const videos = visible(nodes).filter(n => n.clickable && /^(Videos|Vídeos)$/i.test(n.description || ''));
  if (videos.length !== 1) throw new Error('TikTok: aba pública de vídeos não identificada');
  await control.tap(videos[0].x, videos[0].y);
  nodes = await until(n => byId(n, 'f2t').length > 0 || byId(n, 'tv_draft').length > 0);
  // Rotate through older pages across scheduled scans rather than inspecting
  // only the newest posts forever. Never swipe inside a video/editor.
  for (let page = 0; page < Math.min(7, Math.max(0, pageOffset)); page++) {
    if (!byId(nodes, 'f2t').length || byId(nodes, 'desc').length) break;
    await control.shell(['input', 'swipe', '360', '1080', '360', '470', '350']);
    await wait(800);
    nodes = await control.dumpUi();
  }
  const confirmed = [];
  // The observed f2t tiles are posts; draft cover has a different resource ID.
  const tiles = byId(nodes, 'f2t').filter(n => n.clickable && n.y < 1150)
    .sort((a, b) => a.y - b.y || a.x - b.x).slice(0, maxPosts);
  for (const tile of tiles) {
    await control.tap(tile.x, tile.y);
    nodes = await until(n => byId(n, 'desc').length === 1 && byId(n, 'syp').length === 1 && !byId(n, 'jpv').length, 'abrir publicação');
    let caption = byId(nodes, 'desc')[0];
    if (/(?:…|\.{3}).*more\s*$/i.test(normalizeCaption(caption.text)) && caption.clickable) {
      await control.tap(caption.x, caption.y);
      nodes = await until(n => byId(n, 'desc').length === 1 && !/(?:…|\.{3}).*more\s*$/i.test(normalizeCaption(byId(n, 'desc')[0].text)));
      caption = byId(nodes, 'desc')[0];
    }
    const match = uniqueCaptionCandidate(candidates, caption.text);
    if (match && !confirmed.some(item => item.id === match.id)) {
      const captionScreenshot = await capture('caption');
      const privacy = byId(nodes, 'syp')[0];
      await control.tap(privacy.x, privacy.y);
      nodes = await until(n => byId(n, 'jpv').length === 1, 'ler privacidade');
      const isPublic = publicTikTokPrivacy(nodes);
      const privacyScreenshot = isPublic ? await capture('privacy') : null;
      nodes = await closePrivacy(nodes);
      if (isPublic) {
        const proof = { id: match.id, account: expected, caption: normalizeCaption(caption.text), captionScreenshot, privacyScreenshot };
        await onConfirmed(proof);
        confirmed.push(proof);
      }
    }
    const back = byId(nodes, 'bs_').filter(n => n.clickable && /^(Back|Voltar)$/i.test(n.description || ''));
    if (back.length !== 1) throw new Error('TikTok: retorno ao perfil não identificado');
    await control.tap(back[0].x, back[0].y);
    await wait(350);
    nodes = await until(n => byId(n, 'f2t').length > 0 && !byId(n, 'desc').length && !byId(n, 'jpv').length, 'retornar à grade');
    if (confirmed.length === candidates.length) break;
  }
  return confirmed;
}

module.exports = { normalizeCaption, publicTikTokPrivacy, uniqueCaptionCandidate, scanTikTokPublicPosts };
