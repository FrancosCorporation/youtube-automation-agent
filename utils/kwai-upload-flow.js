'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const GALLERY_LIST_ID = 'kwai.lite.video.basis:id/album_view_list';
const MEDIA_DURATION_ID = 'kwai.lite.video.basis:id/media_duration';
const PREVIEW_CONTAINER_ID = 'kwai.lite.video.basis:id/preview_container';
const ALBUM_LIST_ITEM_ID = 'kwai.lite.video.basis:id/kwai_album_list_item_label';
const ALBUM_LIST_CONTAINER_ID = 'kwai.lite.video:id/recycler_view';
const NEXT_STEP_ID = 'kwai.lite.video.product:id/btn_next_step';

function kwaiStagingAlbumName(videoPath) {
  const digest = crypto.createHash('sha256').update(path.resolve(videoPath)).digest('hex').slice(0, 12);
  return `Pulso_${digest}`;
}

function parseDurationLabel(value) {
  const match = String(value || '').trim().match(/^(\d{1,3}):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function nodeText(node) {
  return `${node?.text || ''} ${node?.desc || ''}`.trim();
}

function nodeCenterIsInside(node, container) {
  const left = container.x - container.w / 2;
  const right = container.x + container.w / 2;
  const top = container.y - container.h / 2;
  const bottom = container.y + container.h / 2;
  return node.x >= left && node.x <= right && node.y >= top && node.y <= bottom;
}

function getKwaiGalleryItems(nodes = []) {
  const containers = nodes.filter(node => node.rid === PREVIEW_CONTAINER_ID && node.clickable);
  return nodes.filter(node => node.rid === MEDIA_DURATION_ID)
    .map(durationNode => {
      const container = containers.find(candidate => nodeCenterIsInside(durationNode, candidate));
      return {
        durationNode,
        durationSeconds: parseDurationLabel(durationNode.text),
        container
      };
    })
    .filter(item => item.container && item.durationSeconds !== null)
    .sort((left, right) => left.container.y - right.container.y || left.container.x - right.container.x);
}

function findUniqueKwaiGalleryItem(nodes, targetDurationSeconds, { isolatedAlbum = false } = {}) {
  const galleryVisible = nodes.some(node => node.rid === GALLERY_LIST_ID);
  if (!galleryVisible) throw new Error('Kwai: hierarquia atual não confirma a grade da galeria');
  const duration = Number(targetDurationSeconds);
  if (!Number.isFinite(duration) || duration < 0) {
    throw new TypeError('Kwai: duração do arquivo inválida para selecionar na galeria');
  }
  // A grade do Kwai Lite exibe mm:ss truncados (ex.: 293,933 s aparece como
  // 4:53). Compare o mesmo segundo inteiro que o app mostra; arredondar ou
  // usar uma tolerância ampla poderia selecionar um vídeo diferente.
  const displayedDurationSeconds = Math.floor(duration);
  const items = getKwaiGalleryItems(nodes);
  // Some Android MediaStore versions round milliseconds before Kwai formats
  // the label. Accept the adjacent rounded second only inside the album bound
  // to the staged, hash-verified file; ambiguous matches still fail closed.
  const acceptedSeconds = new Set([displayedDurationSeconds]);
  if (isolatedAlbum) acceptedSeconds.add(Math.round(duration));
  const matches = items.filter(item => acceptedSeconds.has(item.durationSeconds));
  if (matches.length !== 1) {
    throw new Error(`Kwai: não identifiquei correspondência única de ${displayedDurationSeconds}s na galeria`);
  }
  return matches[0];
}

function findKwaiUploadAlbumOption(nodes, albumName) {
  const options = nodes.filter(node => node.rid === ALBUM_LIST_ITEM_ID && String(node.text || '').trim());
  const isolatedAlbum = options.find(node => String(node.text).trim() === String(albumName || '').trim());
  if (isolatedAlbum) return { node: isolatedAlbum, mode: 'isolated_album' };
  const gallery = options.find(node => /^gallery$/i.test(String(node.text).trim()));
  return gallery ? { node: gallery, mode: 'gallery_fallback' } : null;
}

function kwaiAlbumListSwipe(container) {
  if (!container || ![container.x, container.y, container.w, container.h].every(Number.isFinite)
    || container.w < 100 || container.h < 200) return null;
  const left = container.x - container.w / 2;
  const right = container.x + container.w / 2;
  const top = container.y - container.h / 2;
  const bottom = container.y + container.h / 2;
  const x = Math.round((left + right) / 2);
  const y1 = Math.round(Math.min(bottom - 40, container.y + container.h * 0.32));
  const y2 = Math.round(Math.max(top + 40, container.y - container.h * 0.2));
  if (x < left || x > right || y1 <= y2 || y1 >= bottom || y2 <= top) return null;
  return { x1: x, y1, x2: x, y2, durationMs: 450 };
}

async function findKwaiUploadAlbumOptionAcrossPages({ initialNodes = [], albumName, advance, maxPages = 24 } = {}) {
  if (typeof advance !== 'function') throw new TypeError('Kwai: função de rolagem da lista de álbuns obrigatória');
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 40) {
    throw new RangeError('Kwai: limite de páginas de álbuns inválido');
  }
  const target = String(albumName || '').trim();
  if (!target) throw new TypeError('Kwai: nome do álbum isolado obrigatório');

  let nodes = initialNodes;
  let galleryFallback = null;
  let previousSignature = null;
  for (let page = 0; page < maxPages; page++) {
    const visible = findKwaiUploadAlbumOption(nodes, target);
    if (visible?.mode === 'isolated_album') {
      return { nodes, option: visible, pagesVisited: page + 1, reachedEnd: false };
    }
    if (visible?.mode === 'gallery_fallback') galleryFallback = visible;

    const labels = nodes.filter(node => node.rid === ALBUM_LIST_ITEM_ID && String(node.text || '').trim());
    const signature = labels.map(node => String(node.text).trim()).join('\u0000');
    if (!labels.length || (previousSignature !== null && signature === previousSignature)) {
      return { nodes, option: galleryFallback, pagesVisited: page + 1, reachedEnd: true };
    }
    previousSignature = signature;
    if (page + 1 >= maxPages) break;
    const container = nodes.find(node => node.rid === ALBUM_LIST_CONTAINER_ID && node.h >= 200);
    if (!container) return { nodes, option: galleryFallback, pagesVisited: page + 1, reachedEnd: true };
    nodes = await advance(nodes, container);
    if (!Array.isArray(nodes)) throw new TypeError('Kwai: rolagem não retornou a hierarquia atualizada');
  }
  const visible = findKwaiUploadAlbumOption(nodes, target);
  if (visible?.mode === 'isolated_album') {
    return { nodes, option: visible, pagesVisited: maxPages, reachedEnd: false };
  }
  return { nodes, option: galleryFallback, pagesVisited: maxPages, reachedEnd: false };
}

function findKwaiNode(nodes, { id = '', text = null, desc = null, clickable = false } = {}) {
  return nodes.find(node => {
    if (id && node.rid !== id) return false;
    if (text && !text.test(String(node.text || ''))) return false;
    if (desc && !desc.test(String(node.desc || ''))) return false;
    if (clickable && !node.clickable) return false;
    return true;
  }) || null;
}

function findKwaiSelectedDuration(nodes) {
  if (!nodes.some(node => node.rid === NEXT_STEP_ID && /^OK\s*\(1\)$/i.test(node.text || ''))) return null;
  const legacy = nodes.find(node => node.rid === 'kwai.lite.video.basis:id/selected_des');
  const tray = nodes.find(node => node.rid === 'kwai.lite.video.basis:id/picked_recycler_view' && node.w > 0 && node.h > 0);
  if (!tray) return legacy && parseDurationLabel(legacy.text) !== null ? legacy : null;
  // Unlike the source grid, this explicit tray contains selected media only.
  // Some accessibility backends omit selected_des because its bounds are
  // inverted. Require exactly one selected preview and its own duration.
  const previews = nodes.filter(node => node.rid === 'kwai.lite.video.basis:id/media_preview' && nodeCenterIsInside(node, tray));
  const durations = nodes.filter(node => node.rid === MEDIA_DURATION_ID && nodeCenterIsInside(node, tray));
  if (previews.length !== 1 || durations.length !== 1 || parseDurationLabel(durations[0].text) === null) return null;
  if (legacy && parseDurationLabel(legacy.text) !== parseDurationLabel(durations[0].text)) return null;
  return durations[0];
}

function isKwaiSelectionConfirmed(nodes) {
  return Boolean(findKwaiSelectedDuration(nodes));
}

function isKwaiVideoEditor(nodes) {
  const hasNextStep = nodes.some(node => node.rid === 'kwai.lite.video.product:id/edit_post_next_step_button'
    && /^Next$/i.test(node.text || '') && node.clickable !== false);
  const hasEditorSurface = nodes.some(node => [
    'kwai.lite.video.product:id/caption_editor_container',
    'kwai.lite.video.basis:id/preview',
    'kwai.lite.video.product:id/edit_post_button',
    'kwai.lite.video.product:id/sticker_layout_for_edit'
  ].includes(node.rid));
  return hasNextStep && hasEditorSurface;
}

function isKwaiSourceGallery(nodes) {
  return nodes.some(node => node.rid === GALLERY_LIST_ID)
    && nodes.some(node => node.rid === MEDIA_DURATION_ID)
    && !nodes.some(node => /ProgressBar$/i.test(node.cls || '') || /progress|loading|transcod/i.test(node.rid || ''))
    && !isKwaiVideoEditor(nodes) && !isKwaiPostComposer(nodes);
}

function isKwaiEditorActivity(activityName, packageName = 'kwai.lite.video') {
  return activityName === `${packageName}/com.yxcorp.gifshow.v3.EditorActivity`;
}

function isKwaiVideoDetailActivity(activityName, packageName = 'kwai.lite.video') {
  return activityName === `${packageName}/com.yxcorp.gifshow.detail.PhotoDetailNewActivity`;
}

async function readKwaiResumedActivity(kwai) {
  if (typeof kwai?.getResumedActivity !== 'function') return null;
  try {
    return await kwai.getResumedActivity();
  } catch (_error) {
    return null;
  }
}

function shouldOpenKwaiAppForResume({ resumeMarker, resumedActivity, packageName = 'kwai.lite.video' } = {}) {
  if (!resumeMarker) return true;
  return !String(resumedActivity || '').startsWith(`${packageName}/`);
}

function findKwaiCaptionField(nodes) {
  return nodes.find(node => /EditText/i.test(node.cls || '') && node.clickable)
    || nodes.find(node => /caption|description|legenda|descri/i.test(`${node.rid || ''} ${node.desc || ''}`) && node.clickable)
    || null;
}

function isEmptyKwaiCaptionField(node) {
  if (!node) return false;
  const text = String(node.text || '').trim();
  if (!text) return true;
  const hint = String(node.hint || '').trim();
  return node.rid === 'kwai.lite.video.basis:id/editor' && /EditText/i.test(node.cls || '')
    && Boolean(hint) && text === hint;
}

function isKwaiPostComposer(nodes) {
  return Boolean(findKwaiCaptionField(nodes)
    && findKwaiNode(nodes, { id: 'kwai.lite.video.basis:id/post', clickable: true }));
}

function isKwaiUnsubmittedPostComposer(nodes, expectedCaption) {
  if (!isKwaiPostComposer(nodes)) return false;
  const captionField = findKwaiCaptionField(nodes);
  const postButton = findKwaiNode(nodes, { id: 'kwai.lite.video.basis:id/post', clickable: true });
  return Boolean(postButton && matchesKwaiCaption(captionField, expectedCaption));
}

function findKwaiComposerExitCancel(nodes) {
  const recognizedPrompt = nodes.some(node => node.rid === 'kwai.lite.video:id/title'
      && /^go back to edit the video\?$/i.test(node.text || ''))
    && nodes.some(node => node.rid === 'kwai.lite.video.basis:id/positive' && /^edit video$/i.test(node.text || ''))
    && nodes.some(node => node.rid === 'kwai.lite.video.basis:id/negative' && /^save as drafts$/i.test(node.text || ''));
  if (!recognizedPrompt) return null;
  return findKwaiNode(nodes, { id: 'kwai.lite.video.basis:id/extra', text: /^cancel$/i, clickable: true });
}

function hasKwaiPublishConfirmation(nodes) {
  return nodes.some(node => /published successfully|video published|post shared|publicado com sucesso|vídeo publicado|publicação concluída/i.test(nodeText(node)));
}

function hasKwaiHashtagSuggestions(nodes) {
  return nodes.some(node => /\b(?:people have used|people used|pessoas usaram|pessoas utilizaram)\b/i.test(nodeText(node)));
}

function isKwaiNotificationPrompt(nodes) {
  return nodes.some(node => node.rid === 'kwai.lite.video.basis:id/tv_guide_title' && /notification/i.test(node.text || ''))
    && nodes.some(node => node.rid === 'kwai.lite.video.basis:id/tv_click_cancel' && /^Maybe Later$/i.test(node.text || ''));
}

function normalizeKwaiPrivacy(value = 'public') {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'public' || normalized === 'private') return normalized;
  throw new Error('Kwai: privacidade deve ser public ou private');
}

function findKwaiPrivacyOption(nodes, privacy) {
  const id = privacy === 'private'
    ? 'kwai.lite.video.product:id/rl_private'
    : 'kwai.lite.video.product:id/rl_public';
  return nodes.find(node => node.rid === id && node.clickable) || null;
}

function isKwaiPrivacyApplied(nodes, privacy) {
  const expected = privacy === 'private' ? /^private$/i : /^public$/i;
  return nodes.some(node => node.rid === 'kwai.lite.video.product:id/tv_select_permission' && expected.test(node.text || ''));
}

function isKwaiPrivacySettingsScreen(nodes) {
  return nodes.some(node => node.rid === 'kwai.lite.video.basis:id/title_tv' && /^privacy setting$/i.test(node.text || ''))
    && nodes.some(node => node.rid === 'kwai.lite.video.product:id/rl_public')
    && nodes.some(node => node.rid === 'kwai.lite.video.product:id/rl_private');
}

function hasKwaiPublicPromotionDialog(nodes) {
  return nodes.some(node => node.rid === 'kwai.lite.video.basis:id/dialog_content')
    && nodes.some(node => node.rid === 'kwai.lite.video:id/title' && /making post public/i.test(node.text || ''))
    && nodes.some(node => node.rid === 'kwai.lite.video.basis:id/negative' && /^not now$/i.test(node.text || ''));
}

function isKwaiProfile(nodes) {
  const hasProfileIdentity = nodes.some(node => node.rid === 'kwai.lite.video.basis:id/tv_user_id')
    || nodes.some(node => node.rid === 'kwai.lite.video.basis:id/title_tv' && Boolean(node.text?.trim()));
  const hasProfileTabs = nodes.some(node => node.rid === 'kwai.lite.video.basis:id/pager_tab_container'
    || node.rid === 'kwai.lite.video.basis:id/tabs');
  const hasProfileControls = nodes.some(node => node.rid === 'kwai.lite.video.basis:id/profile_settings_button')
    || nodes.some(node => node.rid === 'kwai.lite.video.basis:id/profile_empty_container');
  return hasProfileIdentity && hasProfileTabs && hasProfileControls;
}

function isKwaiFeedScreen(nodes) {
  const tabs = nodes.filter(node => node.rid === 'kwai.lite.video.basis:id/consume_tab_text');
  return nodes.some(node => node.rid === 'kwai.lite.video.basis:id/irb_radioButton' && /^for you$/i.test(node.text || ''))
    && tabs.some(node => /^(home|início|inicio)$/i.test(node.text || ''))
    && tabs.some(node => /^(profile|perfil)$/i.test(node.text || ''));
}

function findKwaiProfileTabs(nodes) {
  const tabs = nodes.find(node => node.rid === 'kwai.lite.video.basis:id/pager_tab_container')
    || nodes.find(node => node.rid === 'kwai.lite.video.basis:id/tabs');
  if (!tabs) return [];
  return nodes.filter(node => node.cls === 'android.widget.ImageView' && node.clickable
      && Math.abs(node.y - tabs.y) <= Math.max(2, tabs.h / 2)
      && node.x >= tabs.x - tabs.w / 2 && node.x <= tabs.x + tabs.w / 2)
    .sort((left, right) => left.x - right.x);
}

function getKwaiProfilePosts(nodes) {
  return nodes.filter(node => node.rid === 'kwai.lite.video.basis:id/thumb' && node.clickable)
    .sort((left, right) => left.y - right.y || left.x - right.x);
}

function matchesKwaiCaption(node, expectedCaption) {
  const normalize = value => String(value || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
  const expected = normalize(expectedCaption);
  const observed = normalize(node?.text);
  if (!expected || !observed) return false;
  return observed.includes(expected.slice(0, Math.min(32, expected.length)));
}

module.exports = {
  isEmptyKwaiCaptionField,
  findKwaiSelectedDuration,
  isKwaiSourceGallery,
  kwaiStagingAlbumName,
  GALLERY_LIST_ID,
  MEDIA_DURATION_ID,
  NEXT_STEP_ID,
  findKwaiCaptionField,
  isKwaiPostComposer,
  isKwaiUnsubmittedPostComposer,
  findKwaiComposerExitCancel,
  findKwaiNode,
  findKwaiUploadAlbumOption,
  kwaiAlbumListSwipe,
  findKwaiUploadAlbumOptionAcrossPages,
  findKwaiProfileTabs,
  getKwaiProfilePosts,
  findUniqueKwaiGalleryItem,
  findKwaiPrivacyOption,
  getKwaiGalleryItems,
  hasKwaiPublicPromotionDialog,
  hasKwaiPublishConfirmation,
  hasKwaiHashtagSuggestions,
  isKwaiNotificationPrompt,
  isKwaiPrivacyApplied,
  isKwaiPrivacySettingsScreen,
  isKwaiFeedScreen,
  isKwaiProfile,
  isKwaiSelectionConfirmed,
  isKwaiVideoEditor,
  isKwaiEditorActivity,
  isKwaiVideoDetailActivity,
  readKwaiResumedActivity,
  shouldOpenKwaiAppForResume,
  normalizeKwaiPrivacy,
  matchesKwaiCaption,
  parseDurationLabel
};
