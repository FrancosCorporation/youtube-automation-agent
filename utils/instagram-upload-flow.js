'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createPublicationResult } = require('./publication-status');

const INSTAGRAM_PACKAGE = 'com.instagram.android';
const INSTAGRAM_STAGING_HEADROOM_BYTES = 64 * 1024 * 1024;
const INSTAGRAM_EXTERNAL_STAGING_HEADROOM_BYTES = 48 * 1024 * 1024;
const INSTAGRAM_IDS = Object.freeze({
  feedTab: `${INSTAGRAM_PACKAGE}:id/feed_tab`,
  profileTab: `${INSTAGRAM_PACKAGE}:id/profile_tab`,
  createButton: `${INSTAGRAM_PACKAGE}:id/action_bar_left_button`,
  folderButton: `${INSTAGRAM_PACKAGE}:id/gallery_folder_menu_tv`,
  menuItem: `${INSTAGRAM_PACKAGE}:id/context_menu_item`,
  mediaThumbnail: `${INSTAGRAM_PACKAGE}:id/gallery_grid_item_thumbnail`,
  reelDestination: `${INSTAGRAM_PACKAGE}:id/cam_dest_clips`,
  reelNext: `${INSTAGRAM_PACKAGE}:id/clips_right_action_button`,
  caption: `${INSTAGRAM_PACKAGE}:id/caption_input_text_view`,
  nextOrShare: `${INSTAGRAM_PACKAGE}:id/share_button`,
  audioReuseShare: `${INSTAGRAM_PACKAGE}:id/clips_original_audio_nux_sheet_share_button`
});

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function valueText(node) {
  return `${node?.text || ''} ${node?.description || ''}`.trim();
}

function findInstagramNodes(nodes, { id, text, description, clickable } = {}) {
  const textPattern = text instanceof RegExp ? text : text == null ? null : new RegExp(`^${escapeRegExp(String(text))}$`, 'i');
  const descriptionPattern = description instanceof RegExp ? description
    : description == null ? null : new RegExp(`^${escapeRegExp(String(description))}$`, 'i');
  return (Array.isArray(nodes) ? nodes : []).filter(node => node.visible !== false
    && (!id || node.resourceId === id)
    && (!textPattern || textPattern.test(String(node.text || '').trim()))
    && (!descriptionPattern || descriptionPattern.test(String(node.description || '').trim()))
    && (clickable == null || node.clickable === clickable));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function instagramAlbumName(videoPath, contentSha256 = null) {
  const absolutePath = path.resolve(videoPath);
  const identity = contentSha256 == null ? absolutePath
    : `${absolutePath}\0${String(contentSha256).toLowerCase()}`;
  if (contentSha256 != null && !/^[a-f0-9]{64}$/i.test(String(contentSha256))) {
    throw new TypeError('Instagram exige SHA-256 válido para versionar o álbum');
  }
  const digest = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 12);
  return `Pulso_IG_${digest}`;
}

function instagramRemoteVideoPath(videoPath, contentSha256 = null, storageRoot = '/sdcard') {
  const name = path.basename(videoPath).replace(/[^A-Za-z0-9_.-]/g, '_');
  if (!/\.mp4$/i.test(name)) throw new Error('Instagram exige MP4');
  const root = String(storageRoot || '/sdcard').replace(/\/+$/, '');
  if (root !== '/sdcard' && !/^\/storage\/[A-F0-9-]{1,64}$/i.test(root)) {
    throw new Error('Instagram exige um volume Android seguro para o staging');
  }
  return `${root}/Movies/${instagramAlbumName(videoPath, contentSha256)}/${name}`;
}

async function mountedExternalStorage(control) {
  try {
    const output = String(await control.shell(['sm', 'list-volumes', 'public'], { timeout: 10000 }));
    const uuid = output.match(/^\s*public:\S+\s+mounted\s+([A-F0-9-]{1,64})\s*$/im)?.[1];
    if (!uuid || /^(?:null|none)$/i.test(uuid)) return null;
    const root = `/storage/${uuid}`;
    const disk = String(await control.shell(['df', '-Pk', root], { timeout: 10000 })).trim();
    const availableKilobytes = Number(disk.split(/\r?\n/).filter(Boolean).at(-1)?.trim().split(/\s+/)?.[3]);
    if (!Number.isSafeInteger(availableKilobytes) || availableKilobytes < 0) return null;
    return { root, availableBytes: availableKilobytes * 1024 };
  } catch (_error) {
    return null;
  }
}

function instagramCaptionForInput(caption) {
  const normalized = String(caption || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    // Android `input text` accepts a conservative ASCII subset. Keep the
    // meaning of common editorial punctuation instead of rejecting otherwise
    // valid captions before the native publisher can submit them.
    .replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'")
    .replace(/[–—−]/g, '-').replace(/…/g, '...')
    .replace(/[➔→➜➡]/g, '->').replace(/•/g, '-')
    .replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > 2200 || !/^[\x20-\x7e]+$/.test(normalized)) {
    throw new Error('Instagram: legenda vazia, longa ou com caracteres não suportados pelo teclado Android');
  }
  return normalized;
}

function encodeInstagramTextInput(value) {
  const shellSpecial = new Set(['\\', '#', '&', ';', '|', '<', '>', '$', '(', ')', '{', '}', '[', ']', '!', '?', "'", '"', '*']);
  return [...String(value || '')].map(character => shellSpecial.has(character) ? `\\${character}` : character).join('').replace(/ /g, '%s');
}

function instagramTextInputArgument(value) {
  return encodeInstagramTextInput(instagramCaptionForInput(value));
}

function instagramTextInputChunks(value, chunkSize = 40) {
  const normalized = instagramCaptionForInput(value);
  const maximum = Math.max(8, Math.floor(Number(chunkSize) || 40));
  const characters = [...normalized];
  const chunks = [];
  for (let index = 0; index < characters.length; index += maximum) {
    chunks.push(encodeInstagramTextInput(characters.slice(index, index + maximum).join('')));
  }
  return chunks;
}

async function typeInstagramCaption(control, caption, { wait = sleep, chunkSize = 40, interChunkDelayMs = 150 } = {}) {
  const chunks = instagramTextInputChunks(caption, chunkSize);
  for (let index = 0; index < chunks.length; index += 1) {
    await control.shell(['input', 'text', chunks[index]], { timeout: 15000 });
    if (index + 1 < chunks.length) await wait(interChunkDelayMs);
  }
}

async function typeAndVerifyInstagramCaption(control, caption, { initialNodes, wait = sleep } = {}) {
  const expected = instagramCaptionForInput(caption);
  let nodes = Array.isArray(initialNodes) ? initialNodes : await control.dumpUi();
  const attempts = [
    { chunkSize: 40, interChunkDelayMs: 150 },
    { chunkSize: 24, interChunkDelayMs: 400 }
  ];
  for (let attempt = 0; attempt < attempts.length; attempt += 1) {
    const field = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.caption, clickable: true })[0];
    if (!field || !Number.isFinite(field.x) || !Number.isFinite(field.y)) {
      throw new Error('Instagram: campo de legenda indisponível para validar a digitação');
    }
    await control.tap(field.x, field.y);
    await control.shell(['input', 'keycombination', '113', '29'], { timeout: 10000 });
    await typeInstagramCaption(control, expected, { ...attempts[attempt], wait });
    nodes = await control.dumpUi();
    const observed = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.caption })[0]?.text || '';
    if (normalizeInstagramCaption(observed) === expected) return nodes;
  }
  throw new Error('Instagram: legenda digitada diverge do texto preparado após duas tentativas');
}

function findInstagramSingleVideo(nodes) {
  const items = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.mediaThumbnail });
  if (items.length !== 1) throw new Error(`Instagram: álbum precisa conter exatamente um vídeo (encontrei ${items.length})`);
  const item = items[0];
  if (!/\bvideo thumbnail\b/i.test(item.description || '') || /\bselected\b/i.test(item.description || '')) {
    throw new Error('Instagram: item isolado não está inequivocamente disponível para seleção');
  }
  return item;
}

function findInstagramAlbumCard(nodes, albumName) {
  const candidates = (Array.isArray(nodes) ? nodes : []).filter(node => node.visible !== false
    && (String(node.description || '').trim() === albumName || String(node.text || '').trim() === albumName)
    && Number(node.width) >= 160 && Number(node.height) >= 160);
  if (candidates.length !== 1) return null;
  return candidates[0];
}

async function findInstagramAlbumByScrolling(control, albumName, { wait = sleep, maxSwipes = 60 } = {}) {
  let nodes = await control.dumpUi();
  let card = findInstagramAlbumCard(nodes, albumName);
  if (card) return card;
  const expandedOpen = nodes.some(node => node.resourceId === `${INSTAGRAM_PACKAGE}:id/title_text_view`
    && /^(albums|álbuns)$/i.test(valueText(node)));
  if (!expandedOpen) {
    const seeAll = nodes.filter(node => node.visible !== false && node.clickable
      && /^(see all|ver tudo)$/i.test(valueText(node)));
    if (seeAll.length !== 1) throw new Error(`Instagram: álbum isolado ${albumName} não encontrado`);
    await control.tap(seeAll[0].x, seeAll[0].y);
    await wait(1000);
  }
  // Instagram can reopen its expanded grid at a previous scroll position.
  // Search in both directions; old staging albums can exceed twelve pages.
  for (const [startY, endY] of [['1100', '480'], ['480', '1100']]) {
    let previousPage = '';
    let unchanged = 0;
    for (let attempt = 0; attempt <= maxSwipes; attempt++) {
      nodes = await control.dumpUi();
      // The previous sheet may remain underneath the expanded grid.
      const expanded = nodes.filter(node => Number(node.width) >= 280);
      card = findInstagramAlbumCard(expanded, albumName);
      if (card) return card;
      const page = expanded.filter(node => node.visible !== false && Number(node.height) >= 160)
        .map(node => `${node.description || node.text || ''}:${node.y}`).sort().join('|');
      unchanged = page && page === previousPage ? unchanged + 1 : 0;
      previousPage = page;
      if (unchanged >= 2) break;
      if (attempt < maxSwipes) {
        await control.shell(['input', 'swipe', '360', startY, '360', endY, '350']);
        await wait(700);
      }
    }
  }
  throw new Error(`Instagram: álbum isolado ${albumName} não encontrado após rolagem`);
}

function instagramIsMediaPicker(nodes) {
  const reelDestination = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.reelDestination }).length === 1;
  const legacyPicker = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.folderButton }).length === 1;
  const reelPicker = findInstagramNodes(nodes, {
    id: `${INSTAGRAM_PACKAGE}:id/gallery_title_text`, text: /^new reel$/i
  }).length === 1 && findInstagramNodes(nodes, { id: INSTAGRAM_IDS.mediaThumbnail }).length > 0;
  return reelDestination && (legacyPicker || reelPicker);
}

function instagramCanResumeMediaPicker(nodes, { packageName, accountHandle, sessionVerified } = {}) {
  return packageName === INSTAGRAM_PACKAGE
    && Boolean(String(accountHandle || '').trim())
    && sessionVerified === true
    && instagramIsMediaPicker(nodes);
}

// Instagram may return to its empty Reel camera after a failed pre-submit
// attempt. Its gallery shortcut currently has no accessibility label; use it
// only when the observed camera controls identify one unambiguous shortcut.
function findInstagramReelCameraGallery(nodes) {
  const reel = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.reelDestination, clickable: true });
  const discard = findInstagramNodes(nodes, { description: /^discard$/i, clickable: true });
  if (reel.length !== 1 || !reel[0].selected || discard.length !== 1
    || instagramIsCaptionScreen(nodes) || instagramIsMediaPicker(nodes) || instagramIsDraftDialog(nodes)) return null;
  const candidates = (Array.isArray(nodes) ? nodes : []).filter(n => n.visible !== false && n.clickable
    && !n.resourceId && !n.text && !n.description && Number.isInteger(n.x) && Number.isInteger(n.y)
    && n.x < reel[0].x - 200 && Math.abs(n.y - reel[0].y) < 20
    && n.width >= 64 && n.width <= 120 && n.height >= 64 && n.height <= 120);
  return candidates.length === 1 ? candidates[0] : null;
}

function findInstagramAlbumTrigger(nodes, albumName) {
  const legacy = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.folderButton, clickable: true });
  if (legacy.length === 1) return legacy[0];
  const albumTriggerPattern = /^Pulso_IG_[a-f0-9]{12}$/i;
  const currentAlbum = (Array.isArray(nodes) ? nodes : []).filter(node => node.visible !== false
    && (String(node.text || '').trim() === albumName || String(node.description || '').trim() === albumName
      || albumTriggerPattern.test(String(node.text || '').trim())
      || albumTriggerPattern.test(String(node.description || '').trim()))
    && Number(node.width) >= 120 && Number(node.height) >= 30);
  if (currentAlbum.length === 1) return currentAlbum[0];
  const recentLabel = findInstagramNodes(nodes, { text: /^recents$/i });
  if (recentLabel.length !== 1) return null;
  const dropdown = (Array.isArray(nodes) ? nodes : []).filter(node => node.visible !== false && node.clickable
    && Number(node.width) >= 120 && Number(node.height) >= 30
    && Math.abs(Number(node.x) - Number(recentLabel[0].x)) <= 20
    && Math.abs(Number(node.y) - Number(recentLabel[0].y)) <= 20);
  return dropdown.length === 1 ? dropdown[0] : null;
}

function findInstagramCaptionEditorDone(nodes) {
  const done = findInstagramNodes(nodes, {
    id: `${INSTAGRAM_PACKAGE}:id/action_bar_button_text`, text: /^ok$/i, clickable: true
  });
  return done.length === 1 ? done[0] : null;
}

function instagramCaptionMatchesResume(currentCaption, expectedCaption) {
  const current = normalizeInstagramCaption(currentCaption);
  const expected = normalizeInstagramCaption(expectedCaption);
  return Boolean(expected && current.startsWith(expected));
}

function instagramCaptionLooksLikeResume(currentCaption, expectedCaption) {
  const current = normalizeInstagramCaption(currentCaption);
  const expected = normalizeInstagramCaption(expectedCaption);
  return Boolean(expected && (current.startsWith(expected) || (current.length >= 100 && expected.startsWith(current))));
}

function normalizeInstagramCaption(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function findInstagramProfileReelTiles(nodes, accountHandle) {
  const handle = String(accountHandle || '').replace(/^@/, '').toLowerCase();
  if (!handle) return [];
  const prefix = new RegExp(`^Reel by ${escapeRegExp(handle)}\\.`, 'i');
  return (Array.isArray(nodes) ? nodes : []).filter(node => node.visible !== false && node.clickable
    && node.resourceId === `${INSTAGRAM_PACKAGE}:id/preview_clip_thumbnail`
    && prefix.test(String(node.description || '').trim()))
    .sort((left, right) => Number(left.top) - Number(right.top) || Number(left.left) - Number(right.left));
}

function instagramIsReelSortMenu(nodes) {
  const labels = (Array.isArray(nodes) ? nodes : []).filter(node => node.visible !== false)
    .map(node => String(node.text || node.description || '').trim().toLowerCase());
  return labels.includes('latest') && labels.includes('most viewed');
}

function instagramIsOwnReelDetail(nodes, accountHandle) {
  const handle = String(accountHandle || '').replace(/^@/, '').toLowerCase();
  if (!handle) return false;
  const username = findInstagramNodes(nodes, {
    id: `${INSTAGRAM_PACKAGE}:id/clips_author_username`, text: new RegExp(`^${escapeRegExp(handle)}$`, 'i')
  });
  const media = findInstagramNodes(nodes, {
    id: `${INSTAGRAM_PACKAGE}:id/clips_media_component`, description: new RegExp(`^Reel by ${escapeRegExp(handle)}\\.`, 'i')
  });
  return username.length === 1 && media.length === 1
    && (Array.isArray(nodes) ? nodes : []).some(node => String(node.text || '').trim() === 'Insights'
      || (node.resourceId === `${INSTAGRAM_PACKAGE}:id/clips_viewer_action_bar_title`
        && /^(your reels|seus reels)$/i.test(String(node.text || '').trim())));
}

function instagramIsOwnReelCaptionSheet(nodes, accountHandle) {
  const handle = String(accountHandle || '').replace(/^@/, '').toLowerCase();
  if (!handle || !Array.isArray(nodes)) return false;
  const media = findInstagramNodes(nodes, {
    id: `${INSTAGRAM_PACKAGE}:id/clips_media_component`, description: new RegExp(`^Reel by ${escapeRegExp(handle)}\\.`, 'i')
  });
  const comments = findInstagramNodes(nodes, { id: `${INSTAGRAM_PACKAGE}:id/layout_comment_thread_edittext_multiline` });
  return media.length === 1 && comments.length === 1
    && /^(add a comment|adicione um comentário|adicionar comentário)[….]*$/i.test(String(comments[0].text || '').trim())
    && nodes.some(node => node.resourceId === `${INSTAGRAM_PACKAGE}:id/clips_viewer_action_bar_title`
      && /^(your reels|seus reels)$/i.test(String(node.text || '').trim()));
}

// A previous read-only verification can leave the own-Reel viewer open. Only
// navigate back from positively identified states, never from an unknown draft
// or a comment with text. No share or create action is performed here.
async function recoverInstagramOwnReelView(control, initialNodes, accountHandle, { wait = sleep } = {}) {
  let nodes = initialNodes;
  const commentFields = findInstagramNodes(nodes, { id: `${INSTAGRAM_PACKAGE}:id/layout_comment_thread_edittext_multiline` });
  if (commentFields.length && !instagramIsOwnReelCaptionSheet(nodes, accountHandle)) return nodes;
  if (instagramIsOwnReelCaptionSheet(nodes, accountHandle)) {
    await control.press('BACK');
    nodes = await waitInstagramUi(control, current => instagramIsOwnReelDetail(current, accountHandle),
      'Reel próprio após fechar legenda', { timeoutMs: 30000, wait });
  }
  if (instagramIsOwnReelDetail(nodes, accountHandle)) {
    await control.press('BACK');
    nodes = await waitInstagramUi(control, current => findInstagramNodes(current, { id: INSTAGRAM_IDS.feedTab, clickable: true }).length === 1,
      'perfil após fechar Reel próprio', { timeoutMs: 30000, wait });
  }
  return nodes;
}

function instagramOwnReelCaption(nodes, accountHandle) {
  const handle = String(accountHandle || '').replace(/^@/, '').toLowerCase();
  const prefix = new RegExp(`^${escapeRegExp(handle)} said\\s+`, 'i');
  const candidates = (Array.isArray(nodes) ? nodes : []).filter(node => node.visible !== false
    && prefix.test(String(node.description || node.text || '').trim()));
  if (candidates.length !== 1) return '';
  return String(candidates[0].description || candidates[0].text || '').trim().replace(prefix, '');
}

function instagramOwnReelCaptionMatches(nodes, accountHandle, expectedCaption) {
  const actual = normalizeInstagramCaption(instagramOwnReelCaption(nodes, accountHandle));
  return Boolean(actual && actual === normalizeInstagramCaption(expectedCaption));
}

function instagramOwnReelCaptionPreviewMatches(nodes, expectedCaption) {
  const prefix = normalizeInstagramCaption(expectedCaption).slice(0, 32);
  if (prefix.length < 16) return false;
  const candidates = (Array.isArray(nodes) ? nodes : []).filter(node => {
    if (node.visible === false || !node.clickable) return false;
    const caption = normalizeInstagramCaption(node.description || node.text)
      .replace(/^[\w.]+ said\s+/i, '');
    return caption.startsWith(prefix);
  });
  return candidates.length === 1;
}

function instagramShareTransitionObserved(nodes) {
  const visible = (Array.isArray(nodes) ? nodes : []).filter(node => node.visible !== false);
  const shared = visible.some(node => /your reel has been shared|seu reel foi compartilhado|reel shared/i.test(valueText(node)));
  const composerGone = findInstagramNodes(visible, { id: INSTAGRAM_IDS.caption }).length === 0;
  const profileTab = findInstagramNodes(visible, { id: INSTAGRAM_IDS.profileTab, clickable: true }).length === 1;
  return shared || (composerGone && profileTab);
}

function instagramIsReelEditor(nodes) {
  return findInstagramNodes(nodes, { id: INSTAGRAM_IDS.reelNext, clickable: true }).length === 1
    && (Array.isArray(nodes) ? nodes : []).some(node => node.resourceId === `${INSTAGRAM_PACKAGE}:id/camera_video_preview_surface_view`);
}

function instagramIsCaptionScreen(nodes) {
  return findInstagramNodes(nodes, { id: INSTAGRAM_IDS.caption, clickable: true }).length === 1
    && findInstagramNodes(nodes, { id: INSTAGRAM_IDS.nextOrShare, clickable: true }).length === 1;
}

async function finishInstagramCaptionEditor(control, initialNodes, { wait = sleep } = {}) {
  let nodes = initialNodes;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const done = findInstagramCaptionEditorDone(nodes);
    if (attempt > 0 && !done && instagramIsCaptionScreen(nodes)) return nodes;
    if (done) await control.tap(done.x, done.y);
    else if (attempt === 0) await control.press('BACK');
    await wait(800);
    nodes = await control.dumpUi();
  }
  if (!findInstagramCaptionEditorDone(nodes) && instagramIsCaptionScreen(nodes)) return nodes;
  throw new Error('Instagram: editor de legenda não fechou; compartilhamento não iniciado');
}

function instagramIsDraftDialog(nodes) {
  const visible = Array.isArray(nodes) ? nodes.filter(node => node.visible !== false) : [];
  return visible.some(node => /keep editing your draft\?/i.test(valueText(node)))
    && visible.some(node => /this draft will be saved/i.test(valueText(node)));
}

function instagramIsPreviewTutorial(nodes) {
  return (Array.isArray(nodes) ? nodes : []).some(node => node.visible !== false
    && /swipe up or down to adjust preview size/i.test(valueText(node)));
}

async function dismissInstagramPreviewTutorial(control, nodes) {
  if (!instagramIsPreviewTutorial(nodes)) return nodes;
  const gotIt = findInstagramNodes(nodes, { text: /^got it$/i });
  const button = findInstagramNodes(nodes, { id: 'igds_media_button', clickable: true });
  if (gotIt.length !== 1 || button.length !== 1) throw new Error('Instagram: aviso de prévia sem controle Got it único');
  await control.tap(button[0].x, button[0].y);
  return waitInstagramUi(control, current => !instagramIsPreviewTutorial(current), 'aviso de prévia fechado');
}

async function waitForInstagramMediaPicker(control, { wait = sleep, timeoutMs = 45000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let nodes = [];
  while (Date.now() <= deadline) {
    nodes = await control.dumpUi({ timeout: Math.max(1, Math.min(10000, deadline - Date.now())) });
    if (instagramIsMediaPicker(nodes)) return nodes;
    if (instagramIsPreviewTutorial(nodes)) {
      await dismissInstagramPreviewTutorial(control, nodes);
      continue;
    }
    if (instagramCapturePermissionPrompt(nodes)) {
      const allow = nodes.filter(node => node.visible !== false && node.clickable
        && /^(while using the app|allow only while using the app|durante o uso do app|permitir durante o uso do app)$/i.test(valueText(node)));
      if (allow.length !== 1) throw new Error('Instagram: permissão de câmera/áudio sem opção de uso durante o app');
      await control.tap(allow[0].x, allow[0].y);
      continue;
    }
    if (Date.now() >= deadline) break;
    await wait(Math.min(500, deadline - Date.now()));
  }
  throw new Error('Instagram: seletor de mídia não retornou após iniciar Reel');
}

async function startInstagramNewVideoFromDraft(control, nodes, options = {}) {
  if (!instagramIsDraftDialog(nodes)) return nodes;
  const startNew = findInstagramNodes(nodes, { text: /^start new video$/i, clickable: true });
  if (startNew.length !== 1) throw new Error('Instagram: botão Start new video do rascunho não é único');
  await control.tap(startNew[0].x, startNew[0].y);
  return waitForInstagramMediaPicker(control, options);
}

function instagramCapturePermissionPrompt(nodes) {
  return (Array.isArray(nodes) ? nodes : []).some(node =>
    /allow instagram to take pictures and record video|allow instagram to record audio/i.test(valueText(node)));
}

function instagramPermissionDenyButtons(nodes) {
  return (Array.isArray(nodes) ? nodes : []).filter(node => node.clickable
    && /^(don't allow|do not allow|não permitir)$/i.test(valueText(node)));
}

function instagramIsRecentProfilePost(nodes, accountHandle) {
  const handle = String(accountHandle || '').replace(/^@/, '').toLowerCase();
  const header = (Array.isArray(nodes) ? nodes : []).find(node => node.resourceId === `${INSTAGRAM_PACKAGE}:id/row_feed_profile_header`);
  const description = String(header?.description || '').toLowerCase();
  return Boolean(handle && description.includes(handle)
    && /(posted|publicou).*(now|seconds?|minutes?|agora|segundos?|minutos?)/i.test(description));
}

function instagramSubmitButton(nodes) {
  const labels = /^(share|compartilhar)$/i;
  const ids = [INSTAGRAM_IDS.audioReuseShare, INSTAGRAM_IDS.nextOrShare,
    `${INSTAGRAM_PACKAGE}:id/clips_share_button`, `${INSTAGRAM_PACKAGE}:id/reel_share_button`];
  const candidates = (Array.isArray(nodes) ? nodes : []).filter(node => node.visible !== false
    && node.clickable && ids.includes(node.resourceId)
    && labels.test(`${node.text || ''} ${node.description || ''}`.trim()));
  return candidates.length === 1 ? candidates[0] : null;
}

async function waitInstagramUi(control, predicate, label, { timeoutMs = 25000, pollMs = 800, wait = sleep } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastNodes = [];
  while (Date.now() <= deadline) {
    lastNodes = await control.dumpUi({ timeout: Math.max(1, Math.min(10000, deadline - Date.now())) });
    if (predicate(lastNodes)) return lastNodes;
    if (Date.now() >= deadline) break;
    await wait(Math.min(pollMs, deadline - Date.now()));
  }
  throw new Error(`Instagram: tela esperada não apareceu (${label})`);
}

// A newly submitted Reel may take time to appear ahead of older posts. Keep
// checking the profile without ever submitting again; only the full caption
// on the authenticated account is sufficient to confirm this artifact.
async function waitForInstagramCaptionedReel(control, initialNodes, accountHandle, caption, {
  wait = sleep, attempts = 8, retryDelayMs = 20000, timeoutMs = 60000
} = {}) {
  let nodes = initialNodes;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const reel = findInstagramProfileReelTiles(nodes, accountHandle)[0];
    if (!reel) throw new Error('Instagram: grade do perfil não contém Reel identificável');
    await control.tap(reel.x, reel.y);
    nodes = await waitInstagramUi(control, current => instagramIsOwnReelDetail(current, accountHandle),
      'detalhe do Reel no perfil próprio', { timeoutMs, wait });
    if (!instagramOwnReelCaptionMatches(nodes, accountHandle, caption)) {
      const prefix = normalizeInstagramCaption(caption).slice(0, 32);
      const candidates = nodes.filter(node => node.visible !== false && node.clickable
        && (new RegExp(`^${escapeRegExp(String(accountHandle).replace(/^@/, ''))} said\\s+`, 'i')
          .test(String(node.description || node.text || '').trim())
          || (instagramOwnReelCaptionPreviewMatches(nodes, caption)
            && normalizeInstagramCaption(node.description || node.text).startsWith(prefix))));
      // Expand only a preview that actually matches this caption. Opening an
      // older Reel is not evidence that the current upload succeeded.
      if (candidates.length === 1 && instagramOwnReelCaptionPreviewMatches(nodes, caption)) {
        await control.tap(candidates[0].x, candidates[0].y);
        nodes = await waitInstagramUi(control, current => instagramOwnReelCaptionMatches(current, accountHandle, caption),
          'legenda completa do Reel público', { timeoutMs: Math.min(15000, timeoutMs), wait });
      }
    }
    if (instagramOwnReelCaptionMatches(nodes, accountHandle, caption)) return nodes;
    if (attempt + 1 >= attempts) break;
    await control.press('BACK');
    await wait(retryDelayMs);
    nodes = await waitInstagramUi(control, current => findInstagramProfileReelTiles(current, accountHandle).length > 0,
      'grade Reels atualizada do perfil', { timeoutMs, wait });
  }
  throw new Error('Instagram: Reel com a legenda esperada ainda não apareceu no perfil');
}

async function clickUnique(control, nodes, predicate, label) {
  const candidates = (Array.isArray(nodes) ? nodes : []).filter(predicate);
  if (candidates.length !== 1) throw new Error(`Instagram: controle ${label} não é único (${candidates.length})`);
  const node = candidates[0];
  if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) throw new Error(`Instagram: coordenadas inválidas para ${label}`);
  await control.tap(node.x, node.y);
  return node;
}

async function stageInstagramVideo(control, videoPath, { wait = sleep } = {}) {
  const source = path.resolve(videoPath);
  const sourceStat = fs.statSync(source);
  if (!sourceStat.isFile() || sourceStat.size <= 0) throw new Error('Instagram exige arquivo local não vazio');
  const localHash = await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(source);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
  const external = await mountedExternalStorage(control);
  const externalRequiredBytes = sourceStat.size + INSTAGRAM_EXTERNAL_STAGING_HEADROOM_BYTES;
  const usingExternal = Boolean(external && external.availableBytes >= externalRequiredBytes);
  const remote = instagramRemoteVideoPath(source, localHash, usingExternal ? external.root : '/sdcard');
  const albumPath = remote.slice(0, remote.lastIndexOf('/'));
  const internalRequiredBytes = sourceStat.size + INSTAGRAM_STAGING_HEADROOM_BYTES;
  await require('./social-readiness').recoverAndroidInternalStorage(control,
    usingExternal ? 64 * 1024 * 1024 : internalRequiredBytes);
  const disk = String(await control.shell(['df', '-Pk', '/data'])).trim().split(/\r?\n/).filter(Boolean).at(-1)?.trim().split(/\s+/) || [];
  const freeKilobytes = Number(disk[3]);
  if (!Number.isSafeInteger(freeKilobytes) || freeKilobytes < 0) {
    throw Object.assign(new Error('Instagram: não foi possível verificar o espaço livre no AVD'), { code: 'ANDROID_STORAGE_UNKNOWN' });
  }
  const internalFree = freeKilobytes * 1024;
  if (usingExternal && internalFree < 64 * 1024 * 1024) {
    throw Object.assign(new Error('Instagram: armazenamento interno insuficiente para processar o Reel'), {
      code: 'ANDROID_STORAGE_INSUFFICIENT'
    });
  }
  let availableBytes = usingExternal ? external.availableBytes : null;
  let location = usingExternal ? `no volume externo ${external.root}` : 'no AVD';
  if (!usingExternal) {
    availableBytes = internalFree;
    location = 'no AVD';
  }
  const requiredBytes = usingExternal ? externalRequiredBytes : internalRequiredBytes;
  if (availableBytes < requiredBytes) {
    const availableMiB = Math.floor(availableBytes / (1024 * 1024));
    const requiredMiB = Math.ceil(requiredBytes / (1024 * 1024));
    throw Object.assign(new Error(`Instagram: armazenamento insuficiente ${location} (${availableMiB} MiB livres; ${requiredMiB} MiB necessários)`), {
      code: 'ANDROID_STORAGE_INSUFFICIENT'
    });
  }
  const encoded = await control.shell(['toybox', 'sha256sum', remote], { allowFailure: true });
  if (String(encoded).trim()) {
    const stagedHash = String(encoded).trim().split(/\s+/)[0];
    if (stagedHash !== localHash) {
      throw Object.assign(new Error('Instagram: o arquivo versionado já existente no álbum isolado não corresponde ao hash esperado'), {
        code: 'ANDROID_STAGING_HASH_MISMATCH'
      });
    }
  } else {
    await control.shell(['mkdir', '-p', albumPath]);
    const temporaryRemote = `${remote}.partial`;
    await control.shell(['rm', '-f', temporaryRemote]);
    control.run(['push', source, temporaryRemote], { timeout: 300000 });
    const temporaryHash = String(await control.shell(['toybox', 'sha256sum', temporaryRemote], { allowFailure: true }))
      .trim().split(/\s+/)[0];
    if (temporaryHash !== localHash) {
      await control.shell(['rm', '-f', temporaryRemote]);
      throw Object.assign(new Error('Instagram: cópia temporária no AVD não passou na validação SHA-256'), {
        code: 'ANDROID_STAGING_HASH_MISMATCH'
      });
    }
    await control.shell(['mv', '-f', temporaryRemote, remote]);
  }
  await control.shell(['am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${remote}`], { timeout: 120000 });
  await wait(1000);
  return { albumName: path.posix.basename(albumPath), remote };
}

async function publishInstagramReel({ control, videoPath, caption = '', accountHandle = '@pulso_ai_news', wait = sleep,
  timeoutMs = 8 * 60 * 1000, screenshotDir = path.join(__dirname, '..', 'logs', 'snaps'), resumeCurrentDraft = false,
  startFromCurrentMediaPicker = false } = {}) {
  let submitStarted = false;
  const capture = async name => {
    if (typeof control.screenshot !== 'function') return null;
    const dir = path.resolve(screenshotDir);
    fs.mkdirSync(dir, { recursive: true });
    const digest = crypto.createHash('sha256').update(path.resolve(videoPath)).digest('hex').slice(0, 10);
    const target = path.join(dir, `instagram_${digest}_${name}.png`);
    fs.writeFileSync(target, control.screenshot());
    return path.relative(path.join(__dirname, '..'), target);
  };
  try {
    const source = path.resolve(String(videoPath || ''));
    if (!videoPath || !fs.statSync(source).isFile() || !/\.mp4$/i.test(source)) throw new Error('arquivo MP4 Instagram não encontrado');
    if (!control || typeof control.dumpUi !== 'function' || typeof control.tap !== 'function' || typeof control.shell !== 'function') {
      throw new TypeError('controle Android Instagram inválido');
    }
    const media = await stageInstagramVideo(control, source, { wait });
    const typedCaption = instagramCaptionForInput(caption);
    let nodes = await control.dumpUi();
    if (!resumeCurrentDraft && !startFromCurrentMediaPicker) {
      nodes = await recoverInstagramOwnReelView(control, nodes, accountHandle, { wait });
    }
    const cameraGallery = !resumeCurrentDraft && !startFromCurrentMediaPicker
      ? findInstagramReelCameraGallery(nodes) : null;
    if (cameraGallery) {
      await control.tap(cameraGallery.x, cameraGallery.y);
      nodes = await waitForInstagramMediaPicker(control, { wait });
      startFromCurrentMediaPicker = true;
    }
    const initialCaptionField = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.caption })[0];
    const captionEditorAlreadyOpen = Boolean(findInstagramCaptionEditorDone(nodes) && initialCaptionField);
    const captionUi = instagramIsCaptionScreen(nodes) || captionEditorAlreadyOpen;
    const resumeCaption = captionUi && instagramCaptionLooksLikeResume(initialCaptionField?.text, typedCaption);
    if (resumeCurrentDraft && !resumeCaption) {
      throw new Error('Instagram: rascunho atual não corresponde à legenda esperada; não o alterei');
    }

    let firstEditorScreenshot = null;
    if (startFromCurrentMediaPicker) {
      if (!instagramIsMediaPicker(nodes)) throw new Error('Instagram: retomada solicitada fora do seletor de mídia');
    } else if (!resumeCaption) {
      const feedTab = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.feedTab, clickable: true })[0];
      if (feedTab) {
        await control.tap(feedTab.x, feedTab.y);
        nodes = await waitInstagramUi(control, current => findInstagramNodes(current, { id: INSTAGRAM_IDS.createButton, clickable: true }).length === 1,
          'feed autenticado');
      }
      await clickUnique(control, nodes, node => node.resourceId === INSTAGRAM_IDS.createButton && node.clickable, 'criar Reel');
      nodes = await waitInstagramUi(control, current => instagramIsMediaPicker(current)
        || instagramIsDraftDialog(current) || instagramIsPreviewTutorial(current)
        || instagramCapturePermissionPrompt(current), 'seletor de mídias ou rascunho existente');
      if (instagramIsPreviewTutorial(nodes)) nodes = await dismissInstagramPreviewTutorial(control, nodes);
      nodes = await startInstagramNewVideoFromDraft(control, nodes, { wait });
      if (!instagramIsMediaPicker(nodes)) nodes = await waitForInstagramMediaPicker(control, { wait });
    }

    if (!resumeCaption) {
      const reelTab = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.reelDestination, clickable: true })[0];
      if (!reelTab?.selected) await control.tap(reelTab.x, reelTab.y);
      nodes = await waitInstagramUi(control, current => instagramIsMediaPicker(current)
        || instagramIsDraftDialog(current) || instagramIsPreviewTutorial(current)
        || instagramCapturePermissionPrompt(current), 'destino Reel');
      if (instagramIsPreviewTutorial(nodes)) nodes = await dismissInstagramPreviewTutorial(control, nodes);
      nodes = await startInstagramNewVideoFromDraft(control, nodes, { wait });

      if (!instagramIsMediaPicker(nodes)) {
        nodes = await waitForInstagramMediaPicker(control, { wait });
      }

      const albumSheetOpen = nodes.some(node => node.resourceId === `${INSTAGRAM_PACKAGE}:id/title_text_view`
        && /^(select album|albums|selecionar álbum|álbuns)$/i.test(valueText(node)));
      if (!albumSheetOpen) {
        const folderButton = findInstagramAlbumTrigger(nodes, media.albumName);
        if (!folderButton) throw new Error('Instagram: botão de álbuns não encontrado');
        await control.tap(folderButton.x, folderButton.y);
        nodes = await waitInstagramUi(control, current => findInstagramNodes(current, { id: INSTAGRAM_IDS.menuItem }).length > 0,
          'menu de origem da galeria');
        const allAlbums = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.menuItem, description: 'All albums', clickable: true });
        if (allAlbums.length !== 1) throw new Error('Instagram: opção All albums não identificada; envio interrompido');
        await control.tap(allAlbums[0].x, allAlbums[0].y);
        await wait(1000);
      }
      const albumCard = await findInstagramAlbumByScrolling(control, media.albumName, { wait });
      await control.tap(albumCard.x, albumCard.y);
      nodes = await waitInstagramUi(control, current => (Array.isArray(current) ? current : []).some(node =>
        node.visible !== false && (String(node.text || '').trim() === media.albumName
          || String(node.description || '').trim() === media.albumName)), 'álbum isolado selecionado');
      const item = findInstagramSingleVideo(nodes);
      await control.tap(item.x, item.y);
      nodes = await waitInstagramUi(control, instagramIsReelEditor, 'prévia do Reel selecionado');
      firstEditorScreenshot = await capture('selected');
      const editorNext = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.reelNext, clickable: true })[0];
      if (!editorNext || !/^next$/i.test(valueText(editorNext))) throw new Error('Instagram: botão Next da prévia não identificado');
      await control.tap(editorNext.x, editorNext.y);
      nodes = await waitInstagramUi(control, current => instagramIsCaptionScreen(current)
        || current.some(node => /new ways to reuse/i.test(valueText(node))), 'tela de legenda');
    }

    const reuseNotice = nodes.find(node => /new ways to reuse/i.test(valueText(node)));
    if (reuseNotice) {
      const ok = nodes.filter(node => node.clickable && /^ok$/i.test(valueText(node)));
      if (ok.length !== 1) throw new Error('Instagram: aviso inicial de Reels sem botão OK único');
      await control.tap(ok[0].x, ok[0].y);
      nodes = await waitInstagramUi(control, instagramIsCaptionScreen, 'legenda após aviso inicial');
    }

    const captionField = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.caption, clickable: true })[0];
    if (!captionField) throw new Error('Instagram: campo de legenda não encontrado');
    const captionEditorNodes = await typeAndVerifyInstagramCaption(control, typedCaption, { initialNodes: nodes, wait });
    nodes = await finishInstagramCaptionEditor(control, captionEditorNodes, { wait });
    const observedCaption = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.caption })[0]?.text || '';
    if (observedCaption.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim() !== typedCaption) {
      throw new Error('Instagram: legenda digitada diverge do texto preparado');
    }
    let submit = instagramSubmitButton(nodes);
    if (!submit) {
      const captionNext = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.nextOrShare, clickable: true })[0];
      if (!captionNext || !/^next$/i.test(valueText(captionNext))) throw new Error('Instagram: botão Next/Share da legenda não identificado');
      await control.tap(captionNext.x, captionNext.y);
      nodes = await waitInstagramUi(control, current => Boolean(instagramSubmitButton(current))
        || current.some(node => /clips_original_audio_nux_sheet_content/.test(node.resourceId || '')),
      'confirmação final de compartilhamento', { timeoutMs: 30000, wait });
      submit = instagramSubmitButton(nodes);
      if (!submit && nodes.some(node => /clips_original_audio_nux_sheet_content/.test(node.resourceId || ''))) {
        submit = instagramSubmitButton(nodes);
      }
    }
    if (!submit) throw new Error('Instagram: botão final Compartilhar não identificado; envio não submetido');
    const preSubmitScreenshot = await capture('ready-to-share');
    submitStarted = true;
    await control.tap(submit.x, submit.y);
    const finalScreenshot = await capture('submitted');
    nodes = await waitInstagramUi(control, instagramShareTransitionObserved,
    'retorno do envio', { timeoutMs: Math.min(120000, timeoutMs), wait });
    let profileTab = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.profileTab, clickable: true })[0];
    if (!profileTab) {
      nodes = await waitInstagramUi(control, current => instagramShareTransitionObserved(current)
        && findInstagramNodes(current, { id: INSTAGRAM_IDS.profileTab, clickable: true }).length === 1,
      'aba de perfil após confirmação', { timeoutMs: 30000, wait });
      profileTab = findInstagramNodes(nodes, { id: INSTAGRAM_IDS.profileTab, clickable: true })[0];
    }
    if (!profileTab) throw new Error('Instagram: envio acionado; tela de perfil não disponível para verificação');
    await control.tap(profileTab.x, profileTab.y);
    nodes = await waitInstagramUi(control, current => current.some(node => node.resourceId === `${INSTAGRAM_PACKAGE}:id/action_bar_title`
      && String(node.text || '').trim().toLowerCase() === String(accountHandle).replace(/^@/, '').toLowerCase())
      && current.some(node => /edit profile|editar perfil/i.test(valueText(node))),
    'perfil autenticado após o envio', { timeoutMs: Math.min(60000, timeoutMs), wait });
    let reelsTab = null;
    for (let scroll = 0; scroll < 5; scroll += 1) {
      reelsTab = findInstagramNodes(nodes, { id: `${INSTAGRAM_PACKAGE}:id/profile_tab_icon_view`, description: /^reels$/i, clickable: true })[0] || null;
      if (reelsTab) break;
      await control.shell(['input', 'swipe', '360', '1060', '360', '420', '350']);
      await wait(600);
      nodes = await control.dumpUi();
    }
    if (!reelsTab) throw new Error('Instagram: aba Reels do perfil próprio não apareceu');
    const alreadyOnReelsTab = reelsTab.selected === true
      || findInstagramProfileReelTiles(nodes, accountHandle).length > 0;
    if (!alreadyOnReelsTab) await control.tap(reelsTab.x, reelsTab.y);
    nodes = await waitInstagramUi(control, current => findInstagramProfileReelTiles(current, accountHandle).length > 0
      || instagramIsReelSortMenu(current), 'grade Reels do perfil', { timeoutMs: Math.min(60000, timeoutMs), wait });
    if (instagramIsReelSortMenu(nodes)) {
      await control.press('BACK');
      nodes = await waitInstagramUi(control, current => findInstagramProfileReelTiles(current, accountHandle).length > 0,
        'grade Reels sem menu de ordenação', { timeoutMs: Math.min(30000, timeoutMs), wait });
    }
    nodes = await waitForInstagramCaptionedReel(control, nodes, accountHandle, typedCaption,
      { timeoutMs: Math.min(60000, timeoutMs), wait });
    const verificationScreenshot = await capture('profile');
    return createPublicationResult({
      platform: 'instagram', videoPath: source, status: 'confirmed', account: accountHandle,
      evidence: { kind: 'public_profile_post', observed: `Reel mais recente do perfil ${accountHandle} foi aberto e a legenda pública completa corresponde ao texto enviado`, screenshotPath: verificationScreenshot || finalScreenshot || preSubmitScreenshot || firstEditorScreenshot }
    });
  } catch (error) {
    const observed = String(error?.message || error).replace(/[\r\n\t]+/g, ' ').slice(0, 180);
    const failureScreenshot = await capture(submitStarted ? 'unknown' : 'failed').catch(() => null);
    const storageBlocked = !submitStarted && error?.code === 'ANDROID_STORAGE_INSUFFICIENT';
    return createPublicationResult({
      platform: 'instagram', videoPath: path.resolve(String(videoPath || '')),
      status: submitStarted ? 'unknown' : 'failed',
      failureCode: submitStarted ? 'attempt_outcome_unknown'
        : storageBlocked ? 'android_storage_insufficient' : 'pre_submit_ui_error',
      evidence: { kind: submitStarted ? 'attempt_outcome_unknown' : 'confirmed_no_send',
        observed: submitStarted ? `Compartilhamento acionado; confirmação não observada: ${observed}`
          : `Fluxo interrompido antes do toque final em Compartilhar: ${observed}`,
        screenshotPath: failureScreenshot || undefined }
    });
  }
}

module.exports = {
  INSTAGRAM_IDS,
  INSTAGRAM_PACKAGE,
  findInstagramAlbumCard,
  findInstagramAlbumByScrolling,
  findInstagramAlbumTrigger,
  findInstagramCaptionEditorDone,
  instagramCaptionMatchesResume,
  instagramCaptionLooksLikeResume,
  findInstagramNodes,
  findInstagramSingleVideo,
  findInstagramProfileReelTiles,
  instagramIsOwnReelDetail,
  instagramIsOwnReelCaptionSheet,
  recoverInstagramOwnReelView,
  instagramIsReelSortMenu,
  instagramOwnReelCaption,
  instagramOwnReelCaptionMatches,
  instagramOwnReelCaptionPreviewMatches,
  instagramShareTransitionObserved,
  instagramAlbumName,
  INSTAGRAM_STAGING_HEADROOM_BYTES,
  instagramCapturePermissionPrompt,
  instagramCaptionForInput,
  instagramIsCaptionScreen,
  instagramIsDraftDialog,
  instagramIsPreviewTutorial,
  instagramIsMediaPicker,
  instagramCanResumeMediaPicker,
  findInstagramReelCameraGallery,
  instagramIsReelEditor,
  instagramIsRecentProfilePost,
  instagramPermissionDenyButtons,
  instagramRemoteVideoPath,
  instagramSubmitButton,
  dismissInstagramPreviewTutorial,
  startInstagramNewVideoFromDraft,
  waitForInstagramMediaPicker,
  waitForInstagramCaptionedReel,
  instagramTextInputArgument,
  instagramTextInputChunks,
  typeInstagramCaption,
  typeAndVerifyInstagramCaption,
  finishInstagramCaptionEditor,
  publishInstagramReel,
  stageInstagramVideo,
  waitInstagramUi
};
