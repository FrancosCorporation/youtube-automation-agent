'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getMediaDuration } = require('./ffmpeg');
const { createPublicationResult } = require('./publication-status');
const { recoverAndroidInternalStorage } = require('./social-readiness');
const { instagramCaptionForInput, instagramTextInputChunks } = require('./instagram-upload-flow');

const PREFIX = 'com.zhiliaoapp.musically:id/';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const visible = nodes => (Array.isArray(nodes) ? nodes : []).filter(node => node.visible !== false);
const unique = (nodes, predicate, label) => {
  const found = visible(nodes).filter(predicate);
  if (found.length !== 1) throw new Error(`TikTok: ${label} não identificado de forma única`);
  return found[0];
};
async function waitUi(control, predicate, { wait = sleep, timeoutMs = 30000, label = 'tela esperada' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let nodes;
  do {
    nodes = await control.dumpUi();
    if (predicate(nodes)) return nodes;
    await wait(500);
  } while (Date.now() < deadline);
  throw new Error(`TikTok: ${label} não apareceu`);
}

async function stageTikTokVideo(control, source, { wait = sleep } = {}) {
  const stat = fs.statSync(source);
  if (!stat.isFile() || stat.size <= 0) throw new Error('TikTok: vídeo local inválido');
  const hash = await new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const stream = fs.createReadStream(source);
    stream.on('data', data => h.update(data));
    stream.on('error', reject);
    stream.on('end', () => resolve(h.digest('hex')));
  });
  const free = async mount => {
    const output = String(await control.shell(['df', '-Pk', mount])).trim().split(/\r?\n/).at(-1)?.trim().split(/\s+/);
    const value = Number(output?.[3]);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('TikTok: espaço livre não pôde ser verificado');
    return value * 1024;
  };
  await recoverAndroidInternalStorage(control, 64 * 1024 * 1024);
  if (await free('/data') < 64 * 1024 * 1024 || await free('/sdcard') < stat.size + 48 * 1024 * 1024) {
    throw Object.assign(new Error('TikTok: espaço insuficiente no Android'), { code: 'ANDROID_STORAGE_INSUFFICIENT' });
  }
  const albumName = `Pulso_TT_${hash.slice(0, 12)}`;
  const directory = `/sdcard/Movies/${albumName}`;
  const remote = `${directory}/pulso-${hash.slice(0, 12)}.mp4`;
  const remoteHash = String(await control.shell(['toybox', 'sha256sum', remote], { allowFailure: true })).trim().split(/\s+/)[0];
  if (remoteHash && remoteHash !== hash) throw new Error('TikTok: hash do arquivo existente não corresponde');
  if (!remoteHash) {
    await control.shell(['mkdir', '-p', directory]);
    const partial = `${remote}.${process.pid}.partial`;
    try {
      control.run(['push', source, partial], { timeout: 300000 });
      const copiedHash = String(await control.shell(['toybox', 'sha256sum', partial])).trim().split(/\s+/)[0];
      if (copiedHash !== hash) throw new Error('TikTok: hash da cópia não corresponde');
      await control.shell(['mv', partial, remote]);
    } finally { await control.shell(['rm', '-f', partial], { allowFailure: true }); }
  }
  await control.shell(['am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${remote}`]);
  await wait(1000);
  return { albumName, remote, hash };
}

function durationLabelSeconds(text) {
  const parts = String(text || '').trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some(value => !/^\d{1,2}$/.test(value))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

async function publishTikTok({ control, videoPath, caption, accountHandle, wait = sleep,
  stage = stageTikTokVideo, duration = getMediaDuration, timeoutMs = 30000,
  screenshotDir = path.join(__dirname, '..', 'logs', 'snaps') } = {}) {
  const source = path.resolve(String(videoPath || ''));
  let submitStarted = false;
  let artifactSha256 = null;
  try {
    const message = instagramCaptionForInput(caption);
    const seconds = Number(await duration(source));
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('TikTok: duração indisponível');
    const staged = await stage(control, source, { wait });
    if (/^[a-f0-9]{64}$/i.test(String(staged.hash || ''))) artifactSha256 = staged.hash;
    let nodes = await waitUi(control, current => visible(current)
      .filter(node => node.resourceId === PREFIX + 'ond' && node.clickable).length === 1,
    { wait, timeoutMs, label: 'botão Criar' });
    let button = unique(nodes, x => x.resourceId === PREFIX + 'ond' && x.clickable, 'botão Criar');
    await control.tap(button.x, button.y);
    nodes = await waitUi(control, n => visible(n).some(x => x.resourceId === PREFIX + 'upload_hot_area' && x.clickable), { wait, timeoutMs, label: 'atalho de mídia' });
    button = unique(nodes, x => x.resourceId === PREFIX + 'upload_hot_area' && x.clickable, 'atalho de mídia');
    await control.tap(button.x, button.y);
    nodes = await waitUi(control, n => visible(n).some(x => x.resourceId === PREFIX + 'dw6' && x.clickable), { wait, timeoutMs, label: 'menu de álbuns' });
    button = unique(nodes, x => x.resourceId === PREFIX + 'dw6' && x.clickable, 'menu de álbuns');
    await control.tap(button.x, button.y);
    nodes = await waitUi(control, n => visible(n).some(x => x.resourceId === PREFIX + 'l29'), { wait, timeoutMs, label: 'lista de álbuns' });
    // MediaStore can append the isolated album below older imported media.
    // Scroll the album list; never select a different album as a fallback.
    for (let scroll = 0; scroll < 12
      && !visible(nodes).some(x => x.resourceId === PREFIX + 'l29' && x.text === staged.albumName); scroll++) {
      await control.shell(['input', 'swipe', '360', '1080', '360', '400', '350']);
      await wait(500);
      nodes = await control.dumpUi();
    }
    button = unique(nodes, x => x.resourceId === PREFIX + 'l29' && x.text === staged.albumName, 'álbum isolado');
    await control.tap(button.x, button.y);
    nodes = await waitUi(control, n => visible(n).some(x => x.resourceId === PREFIX + 'tv_title' && x.text === staged.albumName), { wait, timeoutMs, label: 'álbum selecionado' });
    const durations = visible(nodes).filter(x => x.resourceId === PREFIX + 'gre');
    const selections = visible(nodes).filter(x => x.resourceId === PREFIX + 'l37' && x.clickable);
    const observedDuration = durations.length === 1 ? durationLabelSeconds(durations[0].text) : null;
    if (selections.length !== 1 || observedDuration == null || Math.abs(observedDuration - seconds) > 1.5) {
      throw new Error('TikTok: álbum não contém exatamente o vídeo esperado');
    }
    await control.tap(selections[0].x, selections[0].y);
    nodes = await waitUi(control, n => visible(n).some(x => x.resourceId === PREFIX + 'y1v' && /^next\s*\(1\)$/i.test(x.text || '') && x.clickable), { wait, timeoutMs, label: 'confirmação da seleção' });
    button = unique(nodes, x => x.resourceId === PREFIX + 'y1v' && /^next\s*\(1\)$/i.test(x.text || '') && x.clickable, 'confirmação da seleção');
    await control.tap(button.x, button.y);
    nodes = await waitUi(control, n => visible(n).some(x => x.resourceId === PREFIX + 'q0y' && /^next$/i.test(x.text || ''))
      && visible(n).some(x => x.resourceId === PREFIX + 'q0w' && x.clickable), { wait, timeoutMs, label: 'editor de vídeo' });
    button = unique(nodes, x => x.resourceId === PREFIX + 'q0w' && x.clickable, 'próximo do editor');
    await control.tap(button.x, button.y);
    nodes = await waitUi(control, n => visible(n).some(x => x.resourceId === PREFIX + 'h9x' && x.clickable), { wait, timeoutMs, label: 'campo de legenda' });
    const field = unique(nodes, x => x.resourceId === PREFIX + 'h9x' && x.clickable, 'legenda');
    await control.tap(field.x, field.y);
    for (const chunk of instagramTextInputChunks(message)) await control.shell(['input', 'text', chunk]);
    // A trailing hashtag leaves TikTok's suggestions covering the final
    // controls. End the token with a space; caption comparison trims it.
    if (/(?:^|\s)#[^\s]+$/.test(message)) await control.shell(['input', 'text', '%s']);
    await control.press('BACK');
    nodes = await control.dumpUi();
    const observed = unique(nodes, x => x.resourceId === PREFIX + 'h9x', 'legenda preenchida');
    if (instagramCaptionForInput(observed.text) !== message) throw new Error('TikTok: legenda digitada não corresponde');
    if (!visible(nodes).some(x => x.resourceId === PREFIX + 'tjf' && x.clickable)) {
      // On the configured 720px device the blank title bar clears caption
      // focus and hashtag suggestions. BACK would return to the video editor.
      await control.tap(360, 172);
      nodes = await waitUi(control, current => visible(current)
        .some(x => x.resourceId === PREFIX + 'tjf' && x.clickable), { wait, timeoutMs, label: 'Post após fechar sugestões' });
      const settledCaption = unique(nodes, x => x.resourceId === PREFIX + 'h9x', 'legenda após fechar sugestões');
      if (instagramCaptionForInput(settledCaption.text) !== message) throw new Error('TikTok: legenda mudou ao fechar sugestões');
    }
    if (!visible(nodes).some(x => x.description === 'Everyone can view this post')) {
      throw new Error('TikTok: privacidade pública não confirmada');
    }
    button = unique(nodes, x => x.resourceId === PREFIX + 'tjf' && /^post$/i.test(x.text || '') && x.clickable, 'botão Post');
    submitStarted = true;
    await control.tap(button.x, button.y);
    return createPublicationResult({ platform: 'tiktok', videoPath: source, account: accountHandle,
      artifactSha256,
      status: 'unknown', failureCode: 'attempt_outcome_unknown',
      evidence: { kind: 'attempt_outcome_unknown', observed: 'Post acionado; verificar o perfil e a legenda antes de repetir ou excluir o arquivo' } });
  } catch (error) {
    let screenshotPath;
    try {
      if (typeof control?.screenshot === 'function') {
        fs.mkdirSync(screenshotDir, { recursive: true });
        const name = `tiktok_${crypto.createHash('sha256').update(source).digest('hex').slice(0, 10)}_${Date.now()}_failure.png`;
        const target = path.resolve(screenshotDir, name);
        fs.writeFileSync(target, control.screenshot());
        screenshotPath = path.relative(path.join(__dirname, '..'), target);
      }
    } catch (_error) { /* Screenshot failure must not hide the publication result. */ }
    return createPublicationResult({ platform: 'tiktok', videoPath: source, account: accountHandle,
      artifactSha256,
      status: submitStarted ? 'unknown' : 'failed',
      failureCode: submitStarted ? 'attempt_outcome_unknown' : error?.code === 'ANDROID_STORAGE_INSUFFICIENT' ? 'android_storage_insufficient' : 'pre_submit_ui_error',
      evidence: { kind: submitStarted ? 'attempt_outcome_unknown' : 'confirmed_no_send',
        observed: submitStarted ? 'Post acionado; resultado exige reconciliação' : `Interrompido antes de Post: ${String(error?.message || error).slice(0, 150)}`,
        ...(screenshotPath ? { screenshotPath } : {}) } });
  }
}

module.exports = { durationLabelSeconds, publishTikTok, stageTikTokVideo };
