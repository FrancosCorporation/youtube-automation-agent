'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  completeKwaiDraftFromEditor,
  waitForKwaiPostInProfile,
  resumeKwaiComposerIfMatching,
  PLATFORM_BUDGET_MS,
  DEFAULT_KWAI_UPLOAD_TIMEOUT_MS
} = require('../scripts/upload-to-socials');
const {
  findKwaiCaptionField,
  isEmptyKwaiCaptionField,
  isKwaiPostComposer,
  isKwaiUnsubmittedPostComposer,
  findKwaiComposerExitCancel,
  findKwaiUploadAlbumOption,
  findKwaiUploadAlbumOptionAcrossPages,
  kwaiAlbumListSwipe,
  findUniqueKwaiGalleryItem,
  getKwaiGalleryItems,
  hasKwaiPublishConfirmation,
  hasKwaiHashtagSuggestions,
  isKwaiNotificationPrompt,
  isKwaiFeedScreen,
  findKwaiPrivacyOption,
  findKwaiProfileTabs,
  getKwaiProfilePosts,
  hasKwaiPublicPromotionDialog,
  isKwaiPrivacyApplied,
  isKwaiPrivacySettingsScreen,
  isKwaiProfile,
  isKwaiSelectionConfirmed,
  findKwaiSelectedDuration,
  isKwaiSourceGallery,
  isKwaiVideoEditor,
  isKwaiEditorActivity,
  isKwaiVideoDetailActivity,
  readKwaiResumedActivity,
  shouldOpenKwaiAppForResume,
  normalizeKwaiPrivacy,
  parseDurationLabel,
  matchesKwaiCaption,
  kwaiStagingAlbumName
} = require('../utils/kwai-upload-flow');
const {
  advanceKwaiUploadResume,
  createKwaiUploadResume,
  readKwaiUploadResume,
  saveKwaiUploadResume
} = require('../utils/kwai-upload-resume');

test('Kwai upload budget covers on-device transcoding and publish confirmation', () => {
  assert.equal(DEFAULT_KWAI_UPLOAD_TIMEOUT_MS, 23 * 60 * 1000);
  if (!process.env.KWAI_UPLOAD_TIMEOUT_MS) {
    assert.equal(PLATFORM_BUDGET_MS.kwai, DEFAULT_KWAI_UPLOAD_TIMEOUT_MS);
  } else {
    assert.ok(PLATFORM_BUDGET_MS.kwai > 0);
  }
});

const galleryItem = (x, y, duration, suffix = '') => [
  { rid: 'kwai.lite.video.basis:id/preview_container', x, y, w: 240, h: 241, clickable: true },
  { rid: `kwai.lite.video.basis:id/media_preview${suffix}`, x, y, w: 240, h: 241, clickable: true },
  { rid: 'kwai.lite.video.basis:id/media_duration', x: x + 89, y: y + 96, w: 42, h: 49, text: duration, clickable: false }
];

test('Kwai duration labels parse conservatively', () => {
  assert.equal(parseDurationLabel('0:05'), 5);
  assert.equal(parseDurationLabel('12:34'), 754);
  assert.equal(parseDurationLabel('5 sec'), null);
  assert.equal(parseDurationLabel('1:99'), null);
});

test('Kwai distinguishes a native caption hint from actual draft text', () => {
  const hint = 'Describe your post, add hashtags or @friends';
  const field = { rid: 'kwai.lite.video.basis:id/editor', cls: 'android.widget.EditText', text: hint, hint };
  assert.equal(isEmptyKwaiCaptionField(field), true);
  assert.equal(isEmptyKwaiCaptionField({ ...field, text: 'Unrelated actual draft' }), false);
  assert.equal(isEmptyKwaiCaptionField({ ...field, hint: '' }), false);
  assert.equal(isEmptyKwaiCaptionField({ ...field, rid: 'other:id/editor' }), false);
});

test('Kwai identifies a still-active Post button only when the target caption remains in the composer', () => {
  const caption = 'Sine-JP oferece mais de 200 vagas #carreira';
  const composer = [
    { rid: 'kwai.lite.video.basis:id/editor', cls: 'android.widget.EditText', text: caption, clickable: true },
    { rid: 'kwai.lite.video.basis:id/post', clickable: true }
  ];
  assert.equal(isKwaiUnsubmittedPostComposer(composer, caption), true);
  assert.equal(isKwaiUnsubmittedPostComposer(composer, 'Outra legenda'), false);
  assert.equal(isKwaiUnsubmittedPostComposer(composer.map(node => ({ ...node, clickable: false })), caption), false);
  assert.equal(isKwaiUnsubmittedPostComposer([{ text: 'published successfully' }], caption), false);
});

test('Kwai recognizes only the explicit cancel action in its composer-exit prompt', () => {
  const prompt = [
    { rid: 'kwai.lite.video:id/title', text: 'Go back to edit the video?' },
    { rid: 'kwai.lite.video.basis:id/positive', text: 'Edit video', clickable: true },
    { rid: 'kwai.lite.video.basis:id/negative', text: 'Save as drafts', clickable: true },
    { rid: 'kwai.lite.video.basis:id/extra', text: 'Cancel', clickable: true }
  ];
  assert.equal(findKwaiComposerExitCancel(prompt), prompt[3]);
  assert.equal(findKwaiComposerExitCancel([{ text: 'Cancel', clickable: true }]), null);
  assert.equal(findKwaiComposerExitCancel(prompt.slice(0, 3)), null);
});

test('Kwai detects a returned source gallery without mistaking loading or the editor for it', () => {
  const gallery = [{ rid: 'kwai.lite.video.basis:id/album_view_list' }, ...galleryItem(100, 300, '4:53')];
  assert.equal(isKwaiSourceGallery(gallery), true);
  assert.equal(isKwaiSourceGallery([...gallery, { cls: 'android.widget.ProgressBar' }]), false);
  assert.equal(isKwaiSourceGallery([...gallery,
    { rid: 'kwai.lite.video.product:id/edit_post_next_step_button', text: 'Next', clickable: true },
    { rid: 'kwai.lite.video.product:id/caption_editor_container' }
  ]), false);
});

test('Kwai stops before publication when transcoding returns to the gallery repeatedly', async () => {
  let taps = 0;
  let reads = 0;
  const snapshots = [];
  const result = await completeKwaiDraftFromEditor({
    async tap() { taps++; },
    async dumpUI() {
      reads++;
      return [{ rid: 'kwai.lite.video.basis:id/album_view_list' }, ...galleryItem(100, 300, '4:53')];
    },
    async screencap(label) { snapshots.push(label); }
  }, {
    videoPath: '/tmp/approved-gallery-return.mp4', caption: 'Approved caption',
    initialNodes: [
      { rid: 'kwai.lite.video.product:id/edit_post_next_step_button', text: 'Next', clickable: true, x: 600, y: 1100 },
      { rid: 'kwai.lite.video.product:id/caption_editor_container' }
    ]
  });
  assert.equal(reads, 3);
  assert.equal(taps, 1, 'only Next; never Post');
  assert.equal(result.status, 'failed');
  assert.equal(result.evidence.kind, 'confirmed_no_send');
  assert.match(result.evidence.observed, /retorno à galeria/);
  assert.ok(snapshots.includes('ui_unexpected_state'));
});

test('Kwai gallery selection accepts one unique duration match and rejects ambiguity', () => {
  const albumNodes = [
    { rid: 'kwai.lite.video.basis:id/album_view_list' },
    ...galleryItem(120, 350, '0:05')
  ];
  const crowdedGallery = [
    { rid: 'kwai.lite.video.basis:id/album_view_list' },
    ...galleryItem(120, 350, '0:05'),
    ...galleryItem(361, 350, '0:11'),
    ...galleryItem(120, 593, '0:12')
  ];
  assert.equal(getKwaiGalleryItems(crowdedGallery).length, 3);
  assert.equal(findUniqueKwaiGalleryItem(albumNodes, 5).container.x, 120);
  assert.equal(findUniqueKwaiGalleryItem(crowdedGallery, 11).container.x, 361);
  assert.equal(findUniqueKwaiGalleryItem(crowdedGallery, 5).container.x, 120);
  const ambiguousGallery = [...crowdedGallery, ...galleryItem(361, 593, '0:05')];
  assert.throws(() => findUniqueKwaiGalleryItem(ambiguousGallery, 5), /correspondência única/);
  assert.throws(() => findUniqueKwaiGalleryItem(albumNodes.filter(node => node.rid !== 'kwai.lite.video.basis:id/album_view_list'), 5), /grade da galeria/);
});

test('Kwai gallery duration matching follows the app’s truncated mm:ss label', () => {
  const gallery = [
    { rid: 'kwai.lite.video.basis:id/album_view_list' },
    ...galleryItem(120, 350, '4:53')
  ];
  assert.equal(findUniqueKwaiGalleryItem(gallery, 293.933).container.x, 120);
  assert.throws(() => findUniqueKwaiGalleryItem([
    ...gallery,
    ...galleryItem(361, 350, '4:53')
  ], 293.933), /correspondência única de 293s/);
  assert.throws(() => findUniqueKwaiGalleryItem(gallery, Number.NaN), /duração do arquivo inválida/);
});

test('Kwai accepts rounded duration only in the unique isolated staging album', () => {
  const gallery = [{ rid: 'kwai.lite.video.basis:id/album_view_list' }, ...galleryItem(120, 350, '1:11')];
  assert.throws(() => findUniqueKwaiGalleryItem(gallery, 70.958), /correspondência única/);
  assert.equal(findUniqueKwaiGalleryItem(gallery, 70.958, { isolatedAlbum: true }).container.x, 120);
  assert.throws(() => findUniqueKwaiGalleryItem([...gallery, ...galleryItem(361, 350, '1:10')], 70.958,
    { isolatedAlbum: true }), /correspondência única/);
});

test('Kwai prefers the isolated album and falls back only to the explicit Gallery option', () => {
  const options = [
    { rid: 'kwai.lite.video.basis:id/kwai_album_list_item_label', text: 'Gallery', x: 210, y: 200 },
    { rid: 'kwai.lite.video.basis:id/kwai_album_list_item_label', text: 'Pulso_123', x: 210, y: 500 }
  ];
  assert.equal(findKwaiUploadAlbumOption(options, 'Pulso_123').mode, 'isolated_album');
  assert.equal(findKwaiUploadAlbumOption(options, 'Pulso_missing').mode, 'gallery_fallback');
  assert.equal(findKwaiUploadAlbumOption(options.filter(node => node.text !== 'Gallery'), 'Pulso_missing'), null);
});

test('Kwai searches later album pages before considering the duplicate-prone Gallery fallback', async () => {
  const labels = values => [
    { rid: 'kwai.lite.video:id/recycler_view', x: 360, y: 669, w: 720, h: 1030 },
    ...values.map((text, index) => ({
      rid: 'kwai.lite.video.basis:id/kwai_album_list_item_label', text, x: 250, y: 220 + index * 150
    }))
  ];
  const pages = [labels(['Gallery', 'Movies', 'Pulso_old']), labels(['Pulso_other', 'Pulso_target'])];
  let advances = 0;
  const result = await findKwaiUploadAlbumOptionAcrossPages({
    initialNodes: pages[0], albumName: 'Pulso_target',
    advance: async () => pages[++advances], maxPages: 4
  });
  assert.equal(result.option.mode, 'isolated_album');
  assert.equal(result.option.node.text, 'Pulso_target');
  assert.equal(result.pagesVisited, 2);
  assert.equal(advances, 1);
});

test('Kwai computes album swipes from center-based Android bounds and stays inside the list', () => {
  assert.deepEqual(kwaiAlbumListSwipe({ x: 360, y: 669, w: 720, h: 1030 }), {
    x1: 360, y1: 999, x2: 360, y2: 463, durationMs: 450
  });
  assert.equal(kwaiAlbumListSwipe({ x: 360, y: 669, w: 720, h: 100 }), null);
});

test('Kwai uses Gallery fallback only after the album list stops advancing', async () => {
  const page = [
    { rid: 'kwai.lite.video:id/recycler_view', x: 360, y: 669, w: 720, h: 1030 },
    { rid: 'kwai.lite.video.basis:id/kwai_album_list_item_label', text: 'Gallery', x: 210, y: 200 }
  ];
  const result = await findKwaiUploadAlbumOptionAcrossPages({
    initialNodes: page, albumName: 'Pulso_missing', advance: async () => page
  });
  assert.equal(result.option.mode, 'gallery_fallback');
  assert.equal(result.reachedEnd, true);
});

test('Kwai staging album is stable per generated artifact and distinct per path', () => {
  assert.equal(kwaiStagingAlbumName('/tmp/pulso/video-a.mp4'), kwaiStagingAlbumName('/tmp/pulso/video-a.mp4'));
  assert.notEqual(kwaiStagingAlbumName('/tmp/pulso/video-a.mp4'), kwaiStagingAlbumName('/tmp/pulso/video-b.mp4'));
});

test('Kwai flow recognizes selection and editor only from their explicit app controls', () => {
  assert.equal(isKwaiSelectionConfirmed([
    { rid: 'kwai.lite.video.product:id/btn_next_step', text: 'OK (1)' },
    { rid: 'kwai.lite.video.basis:id/selected_des', text: '0:05' }
  ]), true);
  assert.equal(isKwaiSelectionConfirmed([{ text: 'Select' }]), false);
  assert.equal(isKwaiVideoEditor([
    { rid: 'kwai.lite.video.product:id/caption_editor_container' },
    { rid: 'kwai.lite.video.product:id/edit_post_next_step_button', text: 'Next' }
  ]), true);
  assert.equal(isKwaiVideoEditor([
    { rid: 'kwai.lite.video.basis:id/preview' },
    { rid: 'kwai.lite.video.product:id/edit_post_button' },
    { rid: 'kwai.lite.video.product:id/edit_post_next_step_button', text: 'Next', clickable: true }
  ]), true, 'recognizes the current Kwai EditorActivity layout');
  assert.equal(isKwaiVideoEditor([
    { rid: 'kwai.lite.video.basis:id/preview' },
    { rid: 'kwai.lite.video.product:id/edit_post_next_step_button', text: 'Next', clickable: true }
  ]), true, 'the current editor may expose its preview surface without the legacy caption container');
  assert.equal(isKwaiVideoEditor([
    { rid: 'kwai.lite.video.product:id/edit_post_next_step_button', text: 'Next', clickable: true }
  ]), false, 'a generic Next control without an editor surface is not sufficient');
  assert.equal(isKwaiEditorActivity('kwai.lite.video/com.yxcorp.gifshow.v3.EditorActivity'), true);
  assert.equal(isKwaiEditorActivity('com.android.launcher3/.Launcher'), false);
  assert.equal(isKwaiEditorActivity('other.package/com.yxcorp.gifshow.v3.EditorActivity'), false);
});

test('Kwai verifies the selected tray when the legacy duration label is absent', () => {
  const tray = { rid: 'kwai.lite.video.basis:id/picked_recycler_view', x: 360, y: 982, w: 720, h: 153 };
  const preview = { rid: 'kwai.lite.video.basis:id/media_preview', x: 81, y: 982 };
  const duration = { rid: 'kwai.lite.video.basis:id/media_duration', text: '4:53', x: 104, y: 1012 };
  const next = { rid: 'kwai.lite.video.product:id/btn_next_step', text: 'OK (1)' };
  const nodes = [tray, preview, duration, next, ...galleryItem(120, 350, '4:53')];
  assert.equal(findKwaiSelectedDuration(nodes), duration);
  assert.equal(isKwaiSelectionConfirmed(nodes), true);
  assert.equal(findKwaiSelectedDuration(nodes.filter(node => node !== duration)), null, 'grid duration is not selection proof');
  assert.equal(findKwaiSelectedDuration([...nodes, { ...preview, x: 220 }]), null, 'two selected previews are ambiguous');
  assert.equal(findKwaiSelectedDuration([...nodes, { ...duration, x: 220 }]), null, 'two duration labels are ambiguous');
  assert.equal(findKwaiSelectedDuration([...nodes, { rid: 'kwai.lite.video.basis:id/selected_des', text: '1:31' }]), null);
  assert.equal(findKwaiSelectedDuration(nodes.map(node => node === next ? { ...next, text: 'OK (2)' } : node)), null);
});

test('Kwai recognizes the public video detail activity used during interrupted retry recovery', () => {
  assert.equal(isKwaiVideoDetailActivity('kwai.lite.video/com.yxcorp.gifshow.detail.PhotoDetailNewActivity'), true);
  assert.equal(isKwaiVideoDetailActivity('kwai.lite.video/com.yxcorp.gifshow.v3.EditorActivity'), false);
  assert.equal(isKwaiVideoDetailActivity('other.app/com.yxcorp.gifshow.detail.PhotoDetailNewActivity'), false);
});

test('Kwai resumed activity reader supports synchronous ADB text and async adapters', async () => {
  const activity = 'kwai.lite.video/com.yxcorp.gifshow.v3.EditorActivity';
  assert.equal(await readKwaiResumedActivity({ getResumedActivity: () => activity }), activity);
  assert.equal(await readKwaiResumedActivity({ getResumedActivity: async () => activity }), activity);
  assert.equal(await readKwaiResumedActivity({ getResumedActivity: () => Promise.reject(new Error('ADB unavailable')) }), null);
  assert.equal(await readKwaiResumedActivity({}), null);
});

test('Kwai preserves an active app activity while resuming a verified draft', () => {
  const marker = { stage: 'transcoding' };
  assert.equal(shouldOpenKwaiAppForResume({ resumeMarker: null, resumedActivity: null }), true);
  assert.equal(shouldOpenKwaiAppForResume({
    resumeMarker: marker,
    resumedActivity: 'kwai.lite.video/com.yxcorp.gifshow.v3.EditorActivity'
  }), false);
  assert.equal(shouldOpenKwaiAppForResume({
    resumeMarker: marker,
    resumedActivity: 'kwai.lite.video/com.yxcorp.gifshow.camera2.CameraHomeActivity'
  }), false);
  assert.equal(shouldOpenKwaiAppForResume({
    resumeMarker: marker,
    resumedActivity: 'com.android.launcher3/.Launcher'
  }), true);
});

test('Kwai UI recognizers handle expected control and caption variants', () => {
  assert.equal(findKwaiCaptionField([{ rid: 'caption', cls: 'android.widget.EditText', clickable: true }]).rid, 'caption');
  assert.equal(findKwaiCaptionField([{ rid: 'caption', cls: 'android.widget.EditText', clickable: false }]), null);
  assert.equal(hasKwaiPublishConfirmation([{ text: 'Vídeo publicado com sucesso' }]), true);
  assert.equal(hasKwaiPublishConfirmation([{ text: 'Cancel' }]), false);
  assert.equal(hasKwaiHashtagSuggestions([
    { rid: 'kwai.lite.video.product:id/tv_tag', text: 'emagrecimento' },
    { text: '898226 people have used' }
  ]), true);
  assert.equal(hasKwaiHashtagSuggestions([
    { rid: 'kwai.lite.video.basis:id/editor', text: '#fitness #treino #emagrecimento' }
  ]), false, 'selected hashtags alone do not indicate an open suggestion tray');
  assert.equal(normalizeKwaiPrivacy('Private'), 'private');
  assert.equal(normalizeKwaiPrivacy(), 'public');
  assert.throws(() => normalizeKwaiPrivacy('friends'), /public ou private/);
  assert.equal(findKwaiPrivacyOption([{ rid: 'kwai.lite.video.product:id/rl_private', clickable: true }], 'private').rid,
    'kwai.lite.video.product:id/rl_private');
  assert.equal(isKwaiPrivacyApplied([{ rid: 'kwai.lite.video.product:id/tv_select_permission', text: 'Private' }], 'private'), true);
  assert.equal(isKwaiPostComposer([
    { rid: 'kwai.lite.video.basis:id/editor', cls: 'android.widget.EditText', clickable: true },
    { rid: 'kwai.lite.video.basis:id/post', clickable: true }
  ]), true);
  assert.equal(isKwaiPostComposer([{ rid: 'kwai.lite.video.basis:id/editor', clickable: true }]), false);
  const privacyScreen = [
    { rid: 'kwai.lite.video.basis:id/title_tv', text: 'Privacy Setting' },
    { rid: 'kwai.lite.video.product:id/rl_public' },
    { rid: 'kwai.lite.video.product:id/rl_private' }
  ];
  assert.equal(isKwaiPrivacySettingsScreen(privacyScreen), true);
  assert.equal(hasKwaiPublicPromotionDialog([
    { rid: 'kwai.lite.video.basis:id/dialog_content' },
    { rid: 'kwai.lite.video:id/title', text: 'Making post public helps you get followers. Wanna give it a try?' },
    { rid: 'kwai.lite.video.basis:id/negative', text: 'Not now', clickable: true }
  ]), true);
});

test('Kwai profile verification identifies ordered privacy tabs and caption evidence', () => {
  const profileNodes = [
    { rid: 'kwai.lite.video.basis:id/tv_user_id', text: 'account-id' },
    { rid: 'kwai.lite.video.basis:id/pager_tab_container', x: 360, y: 703, w: 720, h: 83 },
    { rid: 'kwai.lite.video.basis:id/profile_settings_button', text: 'Edit Profile' },
    ...[90, 270, 450, 630].map(x => ({ cls: 'android.widget.ImageView', clickable: true, x, y: 703, w: 180, h: 83 })),
    { rid: 'kwai.lite.video.basis:id/thumb', clickable: true, x: 119, y: 904, w: 239, h: 318 },
    { rid: 'kwai.lite.video.basis:id/count_tv', text: '1' }
  ];
  assert.equal(isKwaiProfile(profileNodes), true);
  assert.equal(isKwaiProfile([
    { rid: 'kwai.lite.video.basis:id/title_tv', text: 'Conta autenticada' },
    { rid: 'kwai.lite.video.basis:id/pager_tab_container', x: 360, y: 173, w: 720, h: 83 },
    { rid: 'kwai.lite.video.basis:id/profile_settings_button', text: 'Edit Profile' },
    { rid: 'kwai.lite.video.basis:id/profile_empty_container' }
  ]), true, 'new Kwai profile layout may expose title_tv instead of tv_user_id');
  assert.equal(isKwaiProfile([
    { rid: 'kwai.lite.video.basis:id/title_tv', text: 'For You' },
    { rid: 'kwai.lite.video.basis:id/pager_tab_container' }
  ]), false, 'an arbitrary app title and tab container do not prove the account profile');
  assert.deepEqual(findKwaiProfileTabs(profileNodes).map(node => node.x), [90, 270, 450, 630]);
  const currentProfileNodes = [
    { rid: 'kwai.lite.video.basis:id/title_tv', text: 'rodolfo franco550' },
    { rid: 'kwai.lite.video.basis:id/tabs', cls: 'android.widget.HorizontalScrollView', x: 360, y: 703, w: 720, h: 83 },
    { rid: 'kwai.lite.video.basis:id/profile_settings_button', text: 'Edit Profile' },
    ...[90, 270, 450, 630].map(x => ({ cls: 'android.widget.ImageView', clickable: true, x, y: 703, w: 180, h: 83 }))
  ];
  assert.equal(isKwaiProfile(currentProfileNodes), true, 'recognizes the current Kwai profile layout');
  assert.deepEqual(findKwaiProfileTabs(currentProfileNodes).map(node => node.x), [90, 270, 450, 630]);
  assert.equal(getKwaiProfilePosts(profileNodes).length, 1);
  assert.equal(matchesKwaiCaption({ text: 'Teste técnico privado Pulso IA — publicação de validação' },
    'Teste técnico privado Pulso IA — publicação de validação no emulador Android.'), true);
  assert.equal(matchesKwaiCaption({ text: 'Outro vídeo da conta' }, 'Teste técnico privado Pulso IA'), false);
  assert.equal(matchesKwaiCaption({ text: 'Parte 1/2 Como a China está transformando o turismo em uma máquina de consumo' },
    'Parte 1/2\n\nComo a China está transformando o turismo em uma máquina de consumo'), true);
  assert.equal(isKwaiProfile([{ rid: 'kwai.lite.video.basis:id/thumb' }]), false);
  assert.equal(isKwaiFeedScreen([
    { rid: 'kwai.lite.video.basis:id/irb_radioButton', text: 'For you' },
    { rid: 'kwai.lite.video.basis:id/consume_tab_text', text: 'Início' },
    { rid: 'kwai.lite.video.basis:id/consume_tab_text', text: 'Perfil' }
  ]), true);
});

test('Kwai profile verification retries a stale latest post without another submit', async () => {
  const caption = 'Harvard revela cinco exercícios para coração, força e equilíbrio';
  const state = { screen: 'feed', postVisits: 0, submitTaps: 0 };
  const feedNodes = [
    { rid: 'kwai.lite.video.basis:id/irb_radioButton', text: 'For you' },
    { rid: 'kwai.lite.video.basis:id/consume_tab_text', text: 'Home', clickable: true, x: 90, y: 1200 },
    { rid: 'kwai.lite.video.basis:id/consume_tab_text', text: 'Profile', clickable: true, x: 630, y: 1200 }
  ];
  const profileNodes = [
    { rid: 'kwai.lite.video.basis:id/tv_user_id', text: 'pulso-test' },
    { rid: 'kwai.lite.video.basis:id/pager_tab_container', x: 360, y: 703, w: 720, h: 83 },
    { rid: 'kwai.lite.video.basis:id/profile_settings_button', text: 'Edit Profile' },
    ...[90, 270, 450, 630].map(x => ({ cls: 'android.widget.ImageView', clickable: true, x, y: 703, w: 180, h: 83 })),
    { rid: 'kwai.lite.video.basis:id/thumb', clickable: true, x: 119, y: 904, w: 239, h: 318 }
  ];
  const kwai = {
    KEY: { BACK: 4 },
    async dumpUI() {
      if (state.screen === 'feed') return feedNodes;
      if (state.screen === 'profile') return profileNodes;
      if (state.screen === 'post') return [
        { rid: 'kwai.lite.video.basis:id/slide_play_tv_user_info_desc',
          text: state.postVisits === 1 ? 'Publicação anterior da conta' : caption },
        { rid: 'kwai.lite.video.basis:id/tv_slide_play_post_time', text: '06:59 PM' }
      ];
      return [];
    },
    async tap(x, y) {
      if (state.screen === 'feed' && x === 630) state.screen = 'profile';
      else if (state.screen === 'profile' && y === 904) {
        state.postVisits += 1;
        state.screen = 'post';
      } else if (y === 1120) state.submitTaps += 1;
    },
    async key(code) {
      assert.equal(code, 4);
      if (state.screen === 'post') state.screen = 'profile';
      else if (state.screen === 'profile') state.screen = 'feed';
    },
    async screencap(name) { return name === 'profile_confirmed' ? '/tmp/kwai-profile-proof.png' : null; }
  };

  const evidence = await waitForKwaiPostInProfile(kwai, {
    privacy: 'public', caption, timeoutMs: 500, attemptTimeoutMs: 20, retryDelayMs: 1
  });

  assert.equal(evidence.kind, 'public_profile_post');
  assert.equal(evidence.observed, caption);
  assert.equal(evidence.screenshotPath, '/tmp/kwai-profile-proof.png');
  assert.equal(state.postVisits, 2, 'rechecks the profile after initially seeing the prior post');
  assert.equal(state.submitTaps, 0, 'verification never taps Post again');
});

test('Kwai verification can return from the post detail to the public profile without submitting again', async () => {
  const caption = 'Parte 2/6 O texto vira tokens';
  const state = { screen: 'detail', taps: [] };
  const profile = [
    { rid: 'kwai.lite.video.basis:id/tv_user_id', text: 'Pulse_New_Ai' },
    { rid: 'kwai.lite.video.basis:id/pager_tab_container', x: 360, y: 703, w: 720, h: 83 },
    { rid: 'kwai.lite.video.basis:id/profile_settings_button', text: 'Edit Profile' },
    ...[90, 270, 450, 630].map(x => ({ cls: 'android.widget.ImageView', clickable: true, x, y: 703, w: 180, h: 83 })),
    { rid: 'kwai.lite.video.basis:id/thumb', clickable: true, x: 119, y: 904, w: 239, h: 318 }
  ];
  const kwai = {
    KEY: { BACK: 4 },
    async getResumedActivity() { return 'kwai.lite.video/com.yxcorp.gifshow.detail.PhotoDetailNewActivity'; },
    async dumpUI() {
      if (state.screen === 'detail') return [{ rid: 'kwai.lite.video.basis:id/inside_stream_back_btn', clickable: true, x: 50, y: 50 }];
      if (state.screen === 'profile') return profile;
      if (state.screen === 'post') return [
        { rid: 'kwai.lite.video.basis:id/slide_play_tv_user_info_desc', text: caption },
        { rid: 'kwai.lite.video.basis:id/tv_slide_play_post_time', text: '05:09 PM' }
      ];
      if (state.screen === 'feed') return [
        { rid: 'kwai.lite.video.basis:id/irb_radioButton', text: 'For you' },
        { rid: 'kwai.lite.video.basis:id/consume_tab_text', text: 'Home' },
        { rid: 'kwai.lite.video.basis:id/consume_tab_text', text: 'Profile' }
      ];
      return [];
    },
    async tap(x, y) {
      state.taps.push([x, y]);
      if (state.screen === 'detail' && x === 50) state.screen = 'profile';
      else if (state.screen === 'profile' && y === 904) state.screen = 'post';
    },
    async key() { if (state.screen === 'post') state.screen = 'profile'; else if (state.screen === 'profile') state.screen = 'feed'; },
    async screencap() { return '/tmp/kwai-detail-proof.png'; }
  };
  const result = await waitForKwaiPostInProfile(kwai, { privacy: 'public', caption, timeoutMs: 500, attemptTimeoutMs: 30, retryDelayMs: 1 });
  assert.equal(result.kind, 'public_profile_post');
  assert.equal(result.account, 'Pulse_New_Ai');
  assert.ok(state.taps.some(([x]) => x === 50));
  assert.ok(!state.taps.some(([, y]) => y === 1120), 'verification never submits a post');
});

test('Kwai expands a truncated caption and confirms the full author text without commenting', async () => {
  const caption = 'Parte 2/6\n\nO texto vira tokens\n\nFonte: https://example.org';
  const state = { screen: 'feed', submitted: 0, keyboardBacks: 0 };
  const kwai = {
    KEY: { BACK: 4 },
    async dumpUI() {
      if (state.screen === 'feed') return [
        { rid: 'kwai.lite.video.basis:id/irb_radioButton', text: 'For you' },
        { rid: 'kwai.lite.video.basis:id/consume_tab_text', text: 'Home', x: 90, y: 1200 },
        { rid: 'kwai.lite.video.basis:id/consume_tab_text', text: 'Profile', x: 630, y: 1200 }
      ];
      if (state.screen === 'profile') return [
        { rid: 'kwai.lite.video.basis:id/tv_user_id', text: 'Pulse_New_Ai' },
        { rid: 'kwai.lite.video.basis:id/pager_tab_container', x: 360, y: 703, w: 720, h: 83 },
        { rid: 'kwai.lite.video.basis:id/profile_settings_button', text: 'Edit Profile' },
        ...[90, 270, 450, 630].map(x => ({ cls: 'android.widget.ImageView', clickable: true, x, y: 703, w: 180, h: 83 })),
        { rid: 'kwai.lite.video.basis:id/thumb', clickable: true, x: 119, y: 904, w: 239, h: 318 }
      ];
      if (state.screen === 'post') return [
        { rid: 'kwai.lite.video.basis:id/slide_play_tv_user_info_desc', text: 'Pa... More', clickable: true, x: 200, y: 943 },
        { rid: 'kwai.lite.video.basis:id/tv_slide_play_post_time', text: '05:09 PM' }
      ];
      if (state.screen === 'keyboard') return [{ rid: 'kwai.lite.video.basis:id/editor', text: 'Say something nice...' }];
      if (state.screen === 'caption') return [
        { rid: 'kwai.lite.video.basis:id/tv_tag_author', text: 'Author' },
        { rid: 'kwai.lite.video.basis:id/comment', text: caption },
        { rid: 'kwai.lite.video.basis:id/comment_tab_close_dialog', clickable: true, x: 665, y: 364 }
      ];
      return [];
    },
    async tap(x, y) {
      if (state.screen === 'feed' && x === 630) state.screen = 'profile';
      else if (state.screen === 'profile' && y === 904) state.screen = 'post';
      else if (state.screen === 'post' && y === 943) state.screen = 'keyboard';
      else if (state.screen === 'caption' && x === 665) state.screen = 'post';
      else if (y === 1120) state.submitted++;
    },
    async key() {
      if (state.screen === 'keyboard' && ++state.keyboardBacks >= 2) state.screen = 'caption';
      else if (state.screen === 'post') state.screen = 'profile';
      else if (state.screen === 'profile') state.screen = 'feed';
    },
    async screencap() { return '/tmp/kwai-expanded-proof.png'; }
  };
  const evidence = await waitForKwaiPostInProfile(kwai, { privacy: 'public', caption, timeoutMs: 500, attemptTimeoutMs: 30, retryDelayMs: 1 });
  assert.equal(evidence.kind, 'public_profile_post');
  assert.equal(evidence.observed, caption);
  assert.equal(state.keyboardBacks, 2);
  assert.equal(state.submitted, 0);
});

test('Kwai post-return notification prompt is recognized only with its safe dismissal action', () => {
  assert.equal(isKwaiNotificationPrompt([
    { rid: 'kwai.lite.video.basis:id/tv_guide_title', text: 'Enable Notifications' },
    { rid: 'kwai.lite.video.basis:id/tv_click_cancel', text: 'Maybe Later' }
  ]), true);
  assert.equal(isKwaiNotificationPrompt([
    { rid: 'kwai.lite.video.basis:id/tv_guide_title', text: 'Enable Notifications' }
  ]), false);
});

test('Kwai closes hashtag suggestions before tapping Post and verifies the public profile', async () => {
  const caption = 'Treino e resistência à insulina #fitness';
  const state = { screen: 'composer', caption: 'caption auto-filled', keyboardVisible: false, suggestionVisible: false, taps: [] };
  const composerNodes = () => [
    { rid: 'kwai.lite.video.basis:id/editor', cls: 'android.widget.EditText', clickable: true, text: state.caption, x: 300, y: 200 },
    { rid: 'kwai.lite.video.product:id/rl_set_permission', clickable: true, x: 360, y: 600 },
    { rid: 'kwai.lite.video.product:id/tv_select_permission', text: 'Public' },
    { rid: 'kwai.lite.video.basis:id/post', clickable: true, x: 360, y: 1120 },
    ...(state.suggestionVisible ? [{ text: '898226 people have used' }] : [])
  ];
  const feedNodes = () => [
    { rid: 'kwai.lite.video.basis:id/irb_radioButton', text: 'For you' },
    { rid: 'kwai.lite.video.basis:id/consume_tab_text', text: 'Home', clickable: true, x: 90, y: 1200 },
    { rid: 'kwai.lite.video.basis:id/consume_tab_text', text: 'Profile', clickable: true, x: 630, y: 1200 }
  ];
  const profileNodes = () => [
    { rid: 'kwai.lite.video.basis:id/tv_user_id', text: 'pulso-test' },
    { rid: 'kwai.lite.video.basis:id/pager_tab_container', x: 360, y: 703, w: 720, h: 83 },
    { rid: 'kwai.lite.video.basis:id/profile_settings_button', text: 'Edit Profile' },
    ...[90, 270, 450, 630].map(x => ({ cls: 'android.widget.ImageView', clickable: true, x, y: 703, w: 180, h: 83 })),
    { rid: 'kwai.lite.video.basis:id/thumb', clickable: true, x: 119, y: 904, w: 239, h: 318 }
  ];
  const kwai = {
    KEY: { BACK: 4 },
    async dumpUI() {
      if (state.screen === 'composer') return composerNodes();
      if (state.screen === 'feed') return feedNodes();
      if (state.screen === 'profile') return profileNodes();
      if (state.screen === 'post') return [
        { rid: 'kwai.lite.video.basis:id/slide_play_tv_user_info_desc', text: caption },
        { rid: 'kwai.lite.video.basis:id/tv_slide_play_post_time', text: '12:41 PM' }
      ];
      return [];
    },
    async tap(x, y) {
      if (state.screen === 'composer' && y === 1120) {
        state.taps.push('post');
        state.keyboardAtPost = state.keyboardVisible;
        state.suggestionsAtPost = state.suggestionVisible;
        assert.equal(state.keyboardVisible, false, 'Post must not be tapped through the hashtag suggestion tray');
        assert.equal(state.suggestionVisible, false, 'Post must not be tapped while the separate hashtag tray is visible');
        state.screen = 'feed';
      } else if (state.screen === 'feed' && x === 630) {
        state.taps.push('profile');
        state.screen = 'profile';
      } else if (state.screen === 'profile' && y === 703 && x === 90) {
        state.taps.push('public_tab');
      } else if (state.screen === 'profile' && y === 904) {
        state.taps.push('latest_post');
        state.screen = 'post';
      }
    },
    async replaceText(value) {
      state.caption = value;
      state.keyboardVisible = true;
      state.suggestionVisible = true;
      state.taps.push('caption');
    },
    async key(code) {
      assert.equal(code, 4);
      if (state.screen === 'composer' && state.keyboardVisible) {
        state.keyboardVisible = false;
        state.taps.push('dismiss_ime');
      } else if (state.screen === 'composer' && state.suggestionVisible) {
        state.suggestionVisible = false;
        state.taps.push('dismiss_suggestions');
      } else if (state.screen === 'post') state.screen = 'profile';
      else if (state.screen === 'profile') state.screen = 'feed';
    },
    async screencap() {}
  };

  const result = await completeKwaiDraftFromEditor(kwai, {
    videoPath: '/tmp/pulso-kwai-clean-submit.mp4',
    caption,
    initialNodes: composerNodes()
  });

  assert.equal(result.status, 'confirmed');
  assert.equal(result.evidence.kind, 'public_profile_post');
  assert.equal(state.keyboardAtPost, false);
  assert.equal(state.suggestionsAtPost, false);
  assert.deepEqual(state.taps, ['caption', 'dismiss_ime', 'dismiss_suggestions', 'post', 'profile', 'public_tab', 'latest_post']);
});

test('Kwai retry dismisses an existing hashtag tray even when the caption already matches', async () => {
  const caption = 'Treino e resistência à insulina #fitness';
  let suggestionsVisible = true;
  let exitPromptVisible = false;
  let backCount = 0;
  let cancelCount = 0;
  let reachedPostControl = false;
  const composerNodes = () => [
    { rid: 'kwai.lite.video.basis:id/editor', cls: 'android.widget.EditText', clickable: true, text: caption, x: 300, y: 200 },
    { rid: 'kwai.lite.video.product:id/rl_set_permission', clickable: true, x: 360, y: 600 },
    { rid: 'kwai.lite.video.product:id/tv_select_permission', text: 'Public' },
    { rid: 'kwai.lite.video.basis:id/post', clickable: true, x: 360, y: 1120 },
    ...(suggestionsVisible ? [{ text: '898232 people have used' }] : []),
    ...(exitPromptVisible ? [
      { rid: 'kwai.lite.video:id/title', text: 'Go back to edit the video?' },
      { rid: 'kwai.lite.video.basis:id/positive', text: 'Edit video', clickable: true },
      { rid: 'kwai.lite.video.basis:id/negative', text: 'Save as drafts', clickable: true },
      { rid: 'kwai.lite.video.basis:id/extra', text: 'Cancel', clickable: true, x: 360, y: 900 }
    ] : [])
  ];
  const kwai = {
    KEY: { BACK: 4 },
    async dumpUI() { return composerNodes(); },
    async key(code) {
      assert.equal(code, 4);
      backCount += 1;
      exitPromptVisible = true;
    },
    async tap(x, y) {
      if (exitPromptVisible && y === 900) {
        cancelCount += 1;
        exitPromptVisible = false;
        suggestionsVisible = false;
        return;
      }
      assert.equal(suggestionsVisible, false);
      reachedPostControl = true;
      throw new Error('stop the fixture before a submit action');
    },
    async screencap() {}
  };

  const result = await completeKwaiDraftFromEditor(kwai, {
    videoPath: '/tmp/pulso-kwai-existing-composer.mp4',
    caption,
    initialNodes: composerNodes()
  });

  assert.equal(backCount, 1);
  assert.equal(cancelCount, 1);
  assert.equal(reachedPostControl, true);
  assert.equal(result.status, 'failed');
  assert.equal(result.evidence.kind, 'confirmed_no_send');
});

test('Kwai resumes an existing composer only when its caption matches this job', async () => {
  const caption = 'Treino e resistência à insulina #fitness';
  let suggestionsVisible = true;
  let backCount = 0;
  let postControlReached = false;
  const composerNodes = text => [
    { rid: 'kwai.lite.video.basis:id/editor', cls: 'android.widget.EditText', clickable: true, text, x: 300, y: 200 },
    { rid: 'kwai.lite.video.product:id/rl_set_permission', clickable: true, x: 360, y: 600 },
    { rid: 'kwai.lite.video.product:id/tv_select_permission', text: 'Public' },
    { rid: 'kwai.lite.video.basis:id/post', clickable: true, x: 360, y: 1120 },
    ...(suggestionsVisible ? [{ text: '898232 people have used' }] : [])
  ];
  const kwai = {
    KEY: { BACK: 4 },
    async dumpUI() { return composerNodes(caption); },
    async key(code) { assert.equal(code, 4); backCount += 1; suggestionsVisible = false; },
    async tap() {
      assert.equal(suggestionsVisible, false);
      postControlReached = true;
      throw new Error('fixture stopped before a submit action');
    },
    async screencap() {}
  };
  const nodes = composerNodes(caption);

  const resumed = await resumeKwaiComposerIfMatching(kwai, nodes, {
    videoPath: '/tmp/pulso-kwai-resume.mp4', caption
  });
  assert.equal(backCount, 1);
  assert.equal(postControlReached, true);
  assert.equal(resumed.status, 'failed');
  assert.equal(resumed.evidence.kind, 'confirmed_no_send');

  await assert.rejects(resumeKwaiComposerIfMatching(kwai, composerNodes('Unrelated draft caption'), {
    videoPath: '/tmp/pulso-kwai-resume.mp4', caption
  }), /não corresponde à legenda deste job/);
});

test('Kwai transcode recovery skips Next and fills a blank caption only for the bound artifact', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kwai-transcode-resume-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateDir = path.join(root, 'state');
  const videoPath = path.join(root, 'approved.mp4');
  const caption = 'Treino e resistência à insulina #fitness';
  await fs.writeFile(videoPath, 'approved artifact');
  const albumName = kwaiStagingAlbumName(videoPath);
  let resumeMarker = await createKwaiUploadResume({ videoPath, caption, albumName, durationSeconds: 293.9 });
  resumeMarker = await advanceKwaiUploadResume(resumeMarker, 'transcoding', { stateDir });
  await saveKwaiUploadResume(resumeMarker, { stateDir });

  const taps = [];
  const hint = 'Describe your post, add hashtags or @friends';
  const state = { caption: hint, keyboard: false };
  const composerNodes = () => [
    { rid: 'kwai.lite.video.basis:id/editor', cls: 'android.widget.EditText', clickable: true, text: state.caption, hint, x: 300, y: 200 },
    { rid: 'kwai.lite.video.product:id/rl_set_permission', clickable: true, x: 360, y: 600 },
    { rid: 'kwai.lite.video.product:id/tv_select_permission', text: 'Public' },
    { rid: 'kwai.lite.video.basis:id/post', clickable: true, x: 360, y: 1120 }
  ];
  const editorNodes = [
    { rid: 'kwai.lite.video.basis:id/preview' },
    { rid: 'kwai.lite.video.product:id/edit_post_next_step_button', text: 'Next', clickable: true, x: 540, y: 1120 }
  ];
  const kwai = {
    KEY: { BACK: 4 },
    async dumpUI() { return composerNodes(); },
    async tap(x, y) {
      if (y === 1120) {
        taps.push('post');
        throw new Error('fixture stops before submit');
      }
      taps.push('caption');
      assert.equal(x, 300);
    },
    async replaceText(value) { state.caption = value; state.keyboard = true; },
    async key(code) { assert.equal(code, 4); state.keyboard = false; },
    async screencap() {}
  };

  const result = await completeKwaiDraftFromEditor(kwai, {
    videoPath, caption, initialNodes: editorNodes, resumeMarker, resumeStateDir: stateDir
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.evidence.kind, 'confirmed_no_send');
  assert.deepEqual(taps, ['caption', 'post']);
  assert.equal(state.caption, caption);
  assert.equal((await readKwaiUploadResume({ stateDir })).stage, 'composer');

  state.caption = 'another job caption';
  const divergentNodes = composerNodes();
  await assert.rejects(resumeKwaiComposerIfMatching(kwai, divergentNodes, {
    videoPath, caption, resumeMarker: await readKwaiUploadResume({ stateDir }), resumeStateDir: stateDir
  }), /não corresponde à legenda deste job/);
});
