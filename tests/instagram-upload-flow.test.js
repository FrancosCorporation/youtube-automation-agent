'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  INSTAGRAM_IDS,
  INSTAGRAM_PACKAGE,
  findInstagramAlbumCard,
  findInstagramReelCameraGallery,
  findInstagramAlbumByScrolling,
  findInstagramAlbumTrigger,
  findInstagramCaptionEditorDone,
  findInstagramProfileReelTiles,
  findInstagramSingleVideo,
  instagramIsDraftDialog,
  instagramIsPreviewTutorial,
  instagramAlbumName,
  INSTAGRAM_STAGING_HEADROOM_BYTES,
  instagramCapturePermissionPrompt,
  instagramCaptionForInput,
  instagramCaptionLooksLikeResume,
  instagramCaptionMatchesResume,
  instagramIsCaptionScreen,
  instagramIsOwnReelDetail,
  instagramIsOwnReelCaptionSheet,
  recoverInstagramOwnReelView,
  waitForInstagramCaptionedReel,
  instagramIsReelSortMenu,
  instagramIsMediaPicker,
  instagramCanResumeMediaPicker,
  instagramIsRecentProfilePost,
  instagramIsReelEditor,
  instagramOwnReelCaptionMatches,
  instagramOwnReelCaptionPreviewMatches,
  instagramPermissionDenyButtons,
  instagramRemoteVideoPath,
  publishInstagramReel,
  stageInstagramVideo,
  instagramSubmitButton,
  instagramShareTransitionObserved,
  instagramTextInputArgument,
  instagramTextInputChunks,
  dismissInstagramPreviewTutorial,
  startInstagramNewVideoFromDraft,
  typeInstagramCaption,
  typeAndVerifyInstagramCaption,
  finishInstagramCaptionEditor
} = require('../utils/instagram-upload-flow');

test('Instagram fecha o editor de legenda antes de considerar o Share acessível', async () => {
  const field = { resourceId: INSTAGRAM_IDS.caption, clickable: true, text: 'legenda', visible: true };
  const share = { resourceId: INSTAGRAM_IDS.nextOrShare, clickable: true, description: 'Share', visible: true };
  const done = { resourceId: `${INSTAGRAM_PACKAGE}:id/action_bar_button_text`, clickable: true, text: 'OK', x: 650, y: 190, visible: true };
  const editor = [field, share, done];
  const finalScreen = [field, share];
  let taps = 0;
  const control = { async tap() { taps += 1; }, async press() { throw new Error('BACK não esperado'); },
    async dumpUi() { return taps < 2 ? editor : finalScreen; } };
  assert.deepEqual(await finishInstagramCaptionEditor(control, editor, { wait: async () => {} }), finalScreen);
  assert.equal(taps, 2);
  const stuck = { async tap() {}, async press() {}, async dumpUi() { return editor; } };
  await assert.rejects(finishInstagramCaptionEditor(stuck, editor, { wait: async () => {} }), /compartilhamento não iniciado/);
});

test('Instagram recovers only the unique gallery shortcut on the observed Reel camera', () => {
  const gallery = { text: '', description: '', resourceId: '', clickable: true, x: 60, y: 1172, width: 96, height: 96 };
  const reel = { resourceId: INSTAGRAM_IDS.reelDestination, clickable: true, selected: true, x: 360, y: 1172 };
  const discard = { description: 'Discard', clickable: true, x: 56, y: 188 };
  assert.equal(findInstagramReelCameraGallery([gallery, reel, discard]), gallery);
  assert.equal(findInstagramReelCameraGallery([gallery, { ...gallery, x: 90 }, reel, discard]), null);
  assert.equal(findInstagramReelCameraGallery([gallery, { ...reel, selected: false }, discard]), null);
  assert.equal(findInstagramReelCameraGallery([gallery, reel]), null);
});

test('Instagram searches the expanded album list without selecting another album', async () => {
  const album = { description: 'Pulso_IG_684a57082018', width: 312, height: 312, x: 180, y: 500 };
  let reads = 0;
  const actions = [];
  const control = {
    async dumpUi() {
      reads++;
      if (reads === 1) return [{ text: 'See all', clickable: true, x: 630, y: 530 }];
      return reads >= 4 ? [album] : [];
    },
    async tap(...args) { actions.push(['tap', ...args]); },
    async shell(args) { actions.push(args); }
  };
  assert.equal(await findInstagramAlbumByScrolling(control, album.description, { wait: async () => {} }), album);
  assert.equal(actions.filter(a => a[1] === 'swipe').length, 2);
  assert.deepEqual(actions[0], ['tap', 630, 530]);
});

test('Instagram searches back toward earlier albums when the grid reopens mid-list', async () => {
  const album = { description: 'Pulso_IG_target', width: 312, height: 312, x: 180, y: 500 };
  const middle = { description: 'Pulso_IG_middle', width: 312, height: 312, x: 180, y: 500 };
  let direction = '';
  const actions = [];
  const control = {
    async dumpUi() {
      return [{ resourceId: 'com.instagram.android:id/title_text_view', text: 'Albums' },
        direction === 'up' ? album : middle];
    },
    async shell(args) { actions.push(args); direction = args[3] === '480' ? 'up' : 'down'; }
  };
  assert.equal(await findInstagramAlbumByScrolling(control, album.description, { wait: async () => {}, maxSwipes: 4 }), album);
  assert.deepEqual(actions.map(args => args[3]), ['1100', '1100', '480']);
});

test('Instagram staging album is stable per absolute artifact and keeps MP4 name safe', () => {
  const file = path.resolve('data/videos/a video.mp4');
  assert.equal(instagramAlbumName(file), instagramAlbumName(path.relative(process.cwd(), file)));
  assert.match(instagramAlbumName(file), /^Pulso_IG_[a-f0-9]{12}$/);
  assert.equal(instagramRemoteVideoPath(file), `/sdcard/Movies/${instagramAlbumName(file)}/a_video.mp4`);
});

test('Instagram versions staging albums by asset hash and verifies an atomic temporary copy', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'instagram-staging-'));
  const file = path.join(directory, 'part 1.mp4');
  const bytes = Buffer.from('approved-video-bytes');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(file, bytes);
  const staged = new Map();
  const calls = [];
  const control = {
    async shell(args) {
      calls.push(['shell', ...args]);
      if (args[0] === 'df') return 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/block 1000000 500000 500000 50% /data/user/0';
      if (args[0] === 'toybox' && args[1] === 'sha256sum') {
        const content = staged.get(args[2]);
        return content ? `${crypto.createHash('sha256').update(content).digest('hex')}  ${args[2]}` : '';
      }
      if (args[0] === 'rm') { staged.delete(args.at(-1)); return ''; }
      if (args[0] === 'mv') {
        staged.set(args[3], staged.get(args[2]));
        staged.delete(args[2]);
        return '';
      }
      return '';
    },
    run(args) {
      calls.push(['run', ...args]);
      staged.set(args[2], require('node:fs').readFileSync(args[1]));
    }
  };
  try {
    const album = instagramAlbumName(file, hash);
    assert.notEqual(album, instagramAlbumName(file), 'content changes get a separate isolated album');
    assert.equal(instagramAlbumName(file, hash), album, 'the same artifact bytes reuse the same album');
    const media = await stageInstagramVideo(control, file, { wait: async () => {} });
    assert.equal(media.remote, instagramRemoteVideoPath(file, hash));
    assert.deepEqual(staged.get(media.remote), bytes);
    assert.ok(calls.some(call => call[0] === 'run' && call[3].endsWith('.mp4.partial')));
    assert.ok(calls.some(call => call[0] === 'shell' && call[1] === 'mv'));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Instagram stages on a mounted public SD volume even when internal data is below 48 MiB', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'instagram-sd-staging-'));
  const file = path.join(directory, 'part.mp4');
  const bytes = Buffer.from('approved-video-bytes');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(file, bytes);
  const staged = new Map();
  const calls = [];
  const control = {
    async shell(args) {
      calls.push(['shell', ...args]);
      if (args[0] === 'sm') return 'public:253,80 mounted 0000-0000\n';
      if (args[0] === 'df' && args.at(-1) === '/data') {
        return 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/block 1000000 900000 100000 90% /data/user/0';
      }
      if (args[0] === 'df') {
        return 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/fuse 4000000 10 3999990 1% /storage/0000-0000';
      }
      if (args[0] === 'toybox' && args[1] === 'sha256sum') {
        const content = staged.get(args[2]);
        return content ? `${crypto.createHash('sha256').update(content).digest('hex')}  ${args[2]}` : '';
      }
      if (args[0] === 'rm') { staged.delete(args.at(-1)); return ''; }
      if (args[0] === 'mv') {
        staged.set(args[3], staged.get(args[2]));
        staged.delete(args[2]);
        return '';
      }
      return '';
    },
    run(args) {
      calls.push(['run', ...args]);
      staged.set(args[2], fsSync.readFileSync(args[1]));
    }
  };
  const fsSync = require('node:fs');
  try {
    const media = await stageInstagramVideo(control, file, { wait: async () => {} });
    assert.equal(media.remote, instagramRemoteVideoPath(file, hash, '/storage/0000-0000'));
    assert.deepEqual(staged.get(media.remote), bytes);
    assert.ok(calls.some(call => call[0] === 'run' && call[3].endsWith('.mp4.partial')));
    assert.equal(calls.some(call => call[0] === 'shell' && call[1] === 'df' && call.at(-1) === '/data'), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Instagram rejects staging before pushing when the AVD lacks video space and headroom', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'instagram-low-space-'));
  const file = path.join(directory, 'part.mp4');
  await fs.writeFile(file, Buffer.from('video'));
  let pushes = 0;
  const control = {
    async shell(args) {
      if (args[0] === 'df') return 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/block 1000000 999990 10 100% /data/user/0';
      return '';
    },
    run() { pushes++; }
  };
  try {
    await assert.rejects(stageInstagramVideo(control, file, { wait: async () => {} }), error => {
      assert.equal(error.code, 'ANDROID_STORAGE_INSUFFICIENT');
      assert.match(error.message, /armazenamento insuficiente/);
      return true;
    });
    assert.equal(pushes, 0);
    assert.ok(INSTAGRAM_STAGING_HEADROOM_BYTES >= 64 * 1024 * 1024);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Instagram não envia ao volume externo se o armazenamento interno está cheio', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'instagram-external-low-internal-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'part.mp4');
  await fs.writeFile(file, Buffer.from('video'));
  let pushes = 0;
  const control = {
    async shell(args) {
      if (args[0] === 'sm') return 'public:253,80 mounted 0000-0000\n';
      if (args.at(-1) === '/data') return 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/block 1000000 999990 10 100% /data';
      return 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/fuse 4000000 10 3999990 1% /storage/0000-0000';
    },
    run() { pushes++; }
  };
  await assert.rejects(stageInstagramVideo(control, file, { wait: async () => {} }), { code: 'ANDROID_STORAGE_INSUFFICIENT' });
  assert.equal(pushes, 0);
});

test('Instagram records internal storage shortages as a retryable confirmed no-send blocker', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'instagram-storage-blocked-publish-'));
  const file = path.join(directory, 'part.mp4');
  await fs.writeFile(file, Buffer.from('video'));
  const control = {
    async shell(args) {
      if (args[0] === 'df') return 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/block 1000000 999990 10 100% /data/user/0';
      return '';
    },
    async dumpUi() { return []; },
    async tap() {}
  };
  try {
    const result = await publishInstagramReel({ control, videoPath: file, caption: 'Teste', wait: async () => {} });
    assert.equal(result.status, 'failed');
    assert.equal(result.failureCode, 'android_storage_insufficient');
    assert.equal(result.evidence.kind, 'confirmed_no_send');
    assert.match(result.evidence.observed, /armazenamento insuficiente/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Instagram closes the dedicated caption editor only through its exact OK control', () => {
  const done = { resourceId: 'com.instagram.android:id/action_bar_button_text', text: 'OK', clickable: true, visible: true, x: 658, y: 190 };
  assert.equal(findInstagramCaptionEditorDone([done]), done);
  assert.equal(findInstagramCaptionEditorDone([{ ...done, text: 'Share' }]), null);
  assert.equal(findInstagramCaptionEditorDone([done, { ...done }]), null);
});

test('Instagram saves an unrelated draft before starting a new Reel and dismisses its exact preview tutorial', async () => {
  const draft = [
    { text: 'Keep editing your draft?', visible: true },
    { text: 'If you start a new video, this draft will be saved.', visible: true },
    { text: 'Keep editing', clickable: true, visible: true, x: 360, y: 1036 },
    { text: 'Start new video', clickable: true, visible: true, x: 360, y: 1133 }
  ];
  assert.equal(instagramIsDraftDialog(draft), true);
  const picker = [
    { resourceId: INSTAGRAM_IDS.reelDestination, visible: true },
    { resourceId: INSTAGRAM_IDS.folderButton, visible: true },
    { resourceId: INSTAGRAM_IDS.mediaThumbnail, description: 'Unselected Video thumbnail', visible: true }
  ];
  const taps = [];
  const control = { async dumpUi() { return picker; }, async tap(x, y) { taps.push([x, y]); } };
  assert.deepEqual(await startInstagramNewVideoFromDraft(control, draft, { wait: async () => {} }), picker);
  assert.deepEqual(taps, [[360, 1133]], 'existing Reel is saved, not discarded or resumed as another artifact');

  const tutorial = [
    { text: 'Swipe up or down to adjust preview size.', visible: true },
    { text: 'Got it', visible: true },
    { resourceId: 'igds_media_button', clickable: true, visible: true, x: 360, y: 846 }
  ];
  assert.equal(instagramIsPreviewTutorial(tutorial), true);
  let reads = 0;
  const tutorialControl = {
    async tap(x, y) { taps.push([x, y]); },
    async dumpUi() { reads++; return reads === 1 ? [] : picker; }
  };
  assert.deepEqual(await dismissInstagramPreviewTutorial(tutorialControl, tutorial), []);
  assert.deepEqual(taps.at(-1), [360, 846]);
});

test('Instagram resumes only a draft whose normalized caption begins with the exact expected text', () => {
  assert.equal(instagramCaptionMatchesResume('Parte 1/2 sem documentacao #ia duplicado', 'Parte 1/2 sem documentação #ia'), true);
  assert.equal(instagramCaptionMatchesResume('Outro vídeo #ia', 'Parte 1/2 sem documentação #ia'), false);
  assert.equal(instagramCaptionMatchesResume('', 'Parte 1/2'), false);
  assert.equal(instagramCaptionLooksLikeResume('Parte 2/2 Como a IA ajudou a destravar drivers sem documentacao Fonte: https://blogs.gnome.org/uraeus/2026/10/15/aiandreverseengineerhard',
    'Parte 2/2 Como a IA ajudou a destravar drivers sem documentacao Fonte: https://blogs.gnome.org/uraeus/2026/10/15/aiandreverseengineerhardware/ #ia'), true);
  assert.equal(instagramCaptionLooksLikeResume('Outro vídeo com uma legenda longa que em nada corresponde à pauta e que foi preparado por alguém de outra conta', 'Parte 2/2 Como a IA ajudou a destravar drivers sem documentacao'), false);
});

test('Instagram profile verification skips the Drafts tile and checks the newest public Reel caption', () => {
  const current = { resourceId: 'com.instagram.android:id/preview_clip_thumbnail', description: 'Reel by pulso_ai_news. View Count 0. Double tap to play or pause.', clickable: true, visible: true, x: 360, y: 819, left: 241, top: 608 };
  const older = { ...current, description: 'Reel by pulso_ai_news. View Count 4. Double tap to play or pause.', x: 601, left: 482 };
  const draft = { resourceId: 'com.instagram.android:id/drafts_thumbnail', description: '', clickable: true, visible: true, x: 119, y: 819, left: 0, top: 608 };
  assert.deepEqual(findInstagramProfileReelTiles([older, draft, current], '@pulso_ai_news'), [current, older]);
  const collapsed = [
    { resourceId: 'com.instagram.android:id/clips_author_username', text: 'pulso_ai_news', visible: true },
    { resourceId: 'com.instagram.android:id/clips_media_component', description: 'Reel by pulso_ai_news. Double tap to play or pause.', visible: true },
    { resourceId: 'com.instagram.android:id/navbar_button_text', text: 'Insights', visible: true },
    { text: '', description: 'pulso_ai_news said Parte 1/2 Como a IA ajudou a destravar …', clickable: true, visible: true }
  ];
  const caption = 'Parte 1/2 Como a IA ajudou a destravar drivers sem documentacao A continuacao esta na Parte 2. Fonte: https://blogs.gnome.org/uraeus/2026/10/15/aiandreverseengineerhardware/ #ia';
  assert.equal(instagramIsOwnReelDetail(collapsed, '@pulso_ai_news'), true);
  const ownReels = [...collapsed.slice(0, 2), { resourceId: 'com.instagram.android:id/clips_viewer_action_bar_title', text: 'Your reels', visible: true }];
  assert.equal(instagramIsOwnReelDetail(ownReels, '@pulso_ai_news'), true);
  assert.equal(instagramIsOwnReelDetail(ownReels, '@outra_conta'), false);
  assert.equal(instagramOwnReelCaptionMatches(collapsed, '@pulso_ai_news', caption), false);
  const expanded = [...collapsed.slice(0, 3), { ...collapsed[3], description: `pulso_ai_news said ${caption}` }];
  assert.equal(instagramOwnReelCaptionMatches(expanded, '@pulso_ai_news', caption), true);
  assert.equal(instagramOwnReelCaptionPreviewMatches(collapsed, caption), true);
  assert.equal(instagramOwnReelCaptionPreviewMatches(collapsed, 'Parte 2/2 Como a IA ajudou a destravar'), false,
    'a newest public preview for Part 1 cannot confirm Part 2');
});

test('Instagram retorna da legenda e do Reel próprios sem abandonar comentário ou outra conta', async () => {
  const id = 'com.instagram.android:id/';
  const sheet = [
    { resourceId: `${id}clips_media_component`, description: 'Reel by pulso_ai_news. Double tap to play or pause.' },
    { resourceId: `${id}clips_viewer_action_bar_title`, text: 'Your reels' },
    { resourceId: `${id}layout_comment_thread_edittext_multiline`, text: 'Add a comment…' }
  ];
  const detail = [sheet[0], sheet[1], { resourceId: `${id}clips_author_username`, text: 'pulso_ai_news' }];
  const profile = [{ resourceId: `${id}feed_tab`, clickable: true }];
  let current = sheet;
  const actions = [];
  const control = {
    async press(key) { actions.push(key); current = actions.length === 1 ? detail : profile; },
    async dumpUi() { return current; }
  };
  assert.equal(instagramIsOwnReelCaptionSheet(sheet, '@pulso_ai_news'), true);
  assert.equal(await recoverInstagramOwnReelView(control, sheet, '@pulso_ai_news', { wait: async () => {} }), profile);
  assert.deepEqual(actions, ['BACK', 'BACK']);
  const unsentComment = sheet.map(node => node.resourceId.endsWith('multiline') ? { ...node, text: 'Ainda estou escrevendo' } : node);
  actions.length = 0;
  assert.equal(await recoverInstagramOwnReelView(control, unsentComment, '@pulso_ai_news', { wait: async () => {} }), unsentComment);
  assert.equal(await recoverInstagramOwnReelView(control, sheet, '@outra_conta', { wait: async () => {} }), sheet);
  assert.deepEqual(actions, []);
});

test('Instagram revisita o perfil até o Reel com legenda exata aparecer, sem publicar outra vez', async () => {
  const tile = { resourceId: 'com.instagram.android:id/preview_clip_thumbnail', description: 'Reel by pulso_ai_news. View Count 0.', clickable: true, visible: true, x: 360, y: 819, left: 240, top: 608 };
  const grid = [tile];
  const detail = caption => [
    { resourceId: 'com.instagram.android:id/clips_author_username', text: 'pulso_ai_news', visible: true },
    { resourceId: 'com.instagram.android:id/clips_media_component', description: 'Reel by pulso_ai_news. Double tap to play or pause.', visible: true },
    { resourceId: 'com.instagram.android:id/clips_viewer_action_bar_title', text: 'Your reels', visible: true },
    { description: `pulso_ai_news said ${caption}`, visible: true, clickable: true, x: 70, y: 900 }
  ];
  const caption = 'Creatine HMB em formato stick para saude muscular';
  let visits = 0;
  let current = grid;
  const actions = [];
  const control = {
    async tap(x, y) { actions.push(['tap', x, y]); visits++; current = detail(visits === 1 ? 'Video anterior sobre outro assunto' : caption); },
    async press(key) { actions.push(['press', key]); current = grid; },
    async dumpUi() { return current; }
  };
  const nodes = await waitForInstagramCaptionedReel(control, grid, '@pulso_ai_news', caption,
    { wait: async () => {}, attempts: 2, timeoutMs: 100 });
  assert.equal(instagramOwnReelCaptionMatches(nodes, '@pulso_ai_news', caption), true);
  assert.deepEqual(actions, [['tap', 360, 819], ['press', 'BACK'], ['tap', 360, 819]]);
  const oldOnly = { ...control, async tap(x, y) { actions.push(['tap', x, y]); current = detail('Video anterior'); } };
  await assert.rejects(waitForInstagramCaptionedReel(oldOnly, grid, '@pulso_ai_news', caption,
    { wait: async () => {}, attempts: 2, timeoutMs: 100 }), /legenda esperada/);
});

test('Instagram caption input preserves meaning while normalizing Android keyboard text', () => {
  const caption = 'Parte 1/2\nComo a IA ajudou na documentação. #inteligência artificial';
  assert.equal(instagramCaptionForInput(caption), 'Parte 1/2 Como a IA ajudou na documentacao. #inteligencia artificial');
  assert.equal(instagramTextInputArgument(caption), 'Parte%s1/2%sComo%sa%sIA%sajudou%sna%sdocumentacao.%s\\#inteligencia%sartificial');
  const chunks = instagramTextInputChunks(caption, 12);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every(chunk => chunk.length <= 37));
  assert.equal(chunks.join('').replace(/\\(.)/g, '$1').replace(/%s/g, ' '), instagramCaptionForInput(caption));
  assert.throws(() => instagramCaptionForInput(''), /legenda vazia/);
  assert.throws(() => instagramCaptionForInput('🙂'), /caracteres não suportados/);
});

test('Instagram/TikTok caption input maps editorial Unicode punctuation to Android-safe ASCII', () => {
  assert.equal(instagramCaptionForInput('Alerta… ➔ “não ignore” — veja • agora'),
    'Alerta... -> "nao ignore" - veja - agora');
});

test('Instagram types long captions sequentially in bounded Android input chunks', async () => {
  const calls = [];
  let pauses = 0;
  await typeInstagramCaption({ shell: async args => calls.push(args.at(-1)) }, 'Parte 2/2 #ia https://example.test/a/long/source', {
    chunkSize: 12, interChunkDelayMs: 1, wait: async () => { pauses += 1; }
  });
  assert.ok(calls.length > 3);
  assert.equal(pauses, calls.length - 1);
  assert.equal(calls.join('').replace(/\\(.)/g, '$1').replace(/%s/g, ' '), 'Parte 2/2 #ia https://example.test/a/long/source');
});

test('Instagram retries caption entry more slowly and still requires an exact UI match', async () => {
  const expected = 'Título preparado https://example.test/a #carreira #emprego';
  const textInput = { resourceId: INSTAGRAM_IDS.caption, text: '', clickable: true, visible: true, x: 200, y: 300 };
  let attempt = 0;
  let typed = '';
  const control = {
    async tap() {},
    async shell(args) {
      if (args[0] === 'input' && args[1] === 'keycombination') {
        attempt += 1;
        typed = '';
      } else if (args[0] === 'input' && args[1] === 'text') {
        typed += args[2].replace(/\\(.)/g, '$1').replace(/%s/g, ' ');
      }
    },
    async dumpUi() {
      const observed = attempt === 1 ? typed.replace('#carreira', '#car') : typed;
      return [{ ...textInput, text: observed }];
    }
  };
  const nodes = await typeAndVerifyInstagramCaption(control, expected, { initialNodes: [textInput], wait: async () => {} });
  assert.equal(attempt, 2);
  assert.equal(nodes[0].text, instagramCaptionForInput(expected));

  const alwaysWrong = { ...control, async dumpUi() { return [{ ...textInput, text: 'different caption' }]; } };
  await assert.rejects(typeAndVerifyInstagramCaption(alwaysWrong, expected, { initialNodes: [textInput], wait: async () => {} }),
    /diverge do texto preparado após duas tentativas/);
});

test('Instagram album selection requires one unique visible album card', () => {
  const album = { text: '', description: 'Pulso_IG_0123456789ab', visible: true, x: 400, y: 800, width: 240, height: 240 };
  assert.equal(findInstagramAlbumCard([album], album.description), album);
  assert.equal(findInstagramAlbumCard([album, { ...album }], album.description), null);
  assert.equal(findInstagramAlbumCard([{ ...album, width: 80 }], album.description), null);
});

test('Instagram 451 Reel gallery recognizes the staged album picker and its native trigger', () => {
  const albumName = 'Pulso_IG_0123456789ab';
  const albumTrigger = { text: albumName, visible: true, clickable: false, x: 162, y: 400, width: 260, height: 43 };
  const nodes = [
    { resourceId: 'com.instagram.android:id/gallery_title_text', text: 'New reel', visible: true },
    { resourceId: INSTAGRAM_IDS.reelDestination, text: 'REEL', selected: true, visible: true },
    { resourceId: INSTAGRAM_IDS.mediaThumbnail, description: 'Unselected Video thumbnail created now', visible: true },
    albumTrigger
  ];
  assert.equal(instagramIsMediaPicker(nodes), true);
  assert.equal(findInstagramAlbumTrigger(nodes, albumName), albumTrigger);
  assert.equal(findInstagramAlbumTrigger(nodes, 'Pulso_IG_fedcba987654'), albumTrigger,
    'modern gallery must open its current album dropdown before choosing the exact isolated album');
  const recentsParent = { resourceId: '', clickable: true, visible: true, x: 106, y: 400, width: 213, height: 95 };
  const recentsLabel = { resourceId: '', text: 'Recents', clickable: false, visible: true, x: 102, y: 400, width: 141, height: 43 };
  assert.equal(findInstagramAlbumTrigger([
    ...nodes.filter(node => node !== albumTrigger), recentsParent, recentsLabel
  ], albumName), recentsParent, 'Instagram 451 dropdown is the clickable parent of the Recents label');
});

test('Instagram resumes an existing New reel picker only for the verified Instagram session', () => {
  const picker = [
    { resourceId: `${INSTAGRAM_PACKAGE}:id/gallery_title_text`, text: 'New reel', visible: true },
    { resourceId: INSTAGRAM_IDS.reelDestination, text: 'REEL', selected: true, visible: true },
    { resourceId: INSTAGRAM_IDS.mediaThumbnail, description: 'Unselected Video thumbnail', visible: true }
  ];
  assert.equal(instagramIsMediaPicker(picker), true);
  assert.equal(instagramCanResumeMediaPicker(picker, {
    packageName: INSTAGRAM_PACKAGE, accountHandle: '@pulso_ai_news', sessionVerified: true
  }), true);
  assert.equal(instagramCanResumeMediaPicker(picker, {
    packageName: 'com.instagram.android', accountHandle: '', sessionVerified: true
  }), false);
  assert.equal(instagramCanResumeMediaPicker(picker, {
    packageName: INSTAGRAM_PACKAGE, accountHandle: '@pulso_ai_news', sessionVerified: false
  }), false);
  assert.equal(instagramCanResumeMediaPicker([{ text: 'Feed' }], {
    packageName: INSTAGRAM_PACKAGE, accountHandle: '@pulso_ai_news', sessionVerified: true
  }), false);
});

test('Instagram resumes the observed New reel picker instead of looking for the feed create control', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'instagram-resume-picker-'));
  const file = path.join(directory, 'part.mp4');
  await fs.writeFile(file, Buffer.from('approved-video-bytes'));
  const staged = new Map();
  const taps = [];
  const picker = [
    { resourceId: `${INSTAGRAM_PACKAGE}:id/gallery_title_text`, text: 'New reel', visible: true },
    { resourceId: INSTAGRAM_IDS.reelDestination, text: 'REEL', selected: true, clickable: true, visible: true },
    { resourceId: INSTAGRAM_IDS.mediaThumbnail, description: 'Unselected Video thumbnail', visible: true }
  ];
  const control = {
    async shell(args) {
      if (args[0] === 'df') return 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/block 1000000 500000 500000 50% /data/user/0';
      if (args[0] === 'toybox' && args[1] === 'sha256sum') {
        const bytes = staged.get(args[2]);
        return bytes ? `${crypto.createHash('sha256').update(bytes).digest('hex')}  ${args[2]}` : '';
      }
      if (args[0] === 'rm') staged.delete(args.at(-1));
      if (args[0] === 'mv') { staged.set(args[3], staged.get(args[2])); staged.delete(args[2]); }
      return '';
    },
    run(args) { staged.set(args[2], require('node:fs').readFileSync(args[1])); },
    async dumpUi() { return picker; },
    async tap(x, y) { taps.push([x, y]); }
  };
  try {
    const result = await publishInstagramReel({ control, videoPath: file, caption: 'Teste', startFromCurrentMediaPicker: true, wait: async () => {} });
    assert.equal(result.status, 'failed');
    assert.equal(result.failureCode, 'pre_submit_ui_error');
    assert.match(result.evidence.observed, /botão de álbuns não encontrado/);
    assert.deepEqual(taps, [], 'resume must not search for or tap the feed create button');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Instagram media selection fails closed unless the isolated album has one unselected video', () => {
  const item = { resourceId: INSTAGRAM_IDS.mediaThumbnail, description: 'Unselected Video thumbnail created now', visible: true, x: 360, y: 700 };
  assert.equal(findInstagramSingleVideo([item]), item);
  assert.throws(() => findInstagramSingleVideo([]), /exatamente um vídeo/);
  assert.throws(() => findInstagramSingleVideo([item, { ...item }]), /exatamente um vídeo/);
  assert.throws(() => findInstagramSingleVideo([{ ...item, description: 'Selected Video thumbnail created now' }]), /inequivocamente/);
  assert.throws(() => findInstagramSingleVideo([{ ...item, description: 'Unselected Image thumbnail created now' }]), /inequivocamente/);
});

test('Instagram UI gates distinguish picker, Reel editor, caption, and final Share from Next', () => {
  const picker = [
    { resourceId: INSTAGRAM_IDS.folderButton, visible: true },
    { resourceId: INSTAGRAM_IDS.reelDestination, visible: true }
  ];
  const editor = [
    { resourceId: 'com.instagram.android:id/camera_video_preview_surface_view', visible: true },
    { resourceId: INSTAGRAM_IDS.reelNext, clickable: true, visible: true }
  ];
  const caption = [
    { resourceId: INSTAGRAM_IDS.caption, clickable: true, visible: true },
    { resourceId: INSTAGRAM_IDS.nextOrShare, clickable: true, text: 'Next', visible: true }
  ];
  assert.equal(instagramIsMediaPicker(picker), true);
  assert.equal(instagramIsReelEditor(editor), true);
  assert.equal(instagramIsCaptionScreen(caption), true);
  assert.equal(instagramIsReelSortMenu([{ text: 'Latest' }, { text: 'Most viewed' }]), true);
  assert.equal(instagramIsReelSortMenu([{ text: 'Latest' }]), false);
  assert.equal(instagramSubmitButton(caption), null);
  assert.equal(instagramSubmitButton([{ resourceId: INSTAGRAM_IDS.nextOrShare, clickable: true, text: 'Share', visible: true }]).text, 'Share');
  assert.equal(instagramSubmitButton([{ resourceId: INSTAGRAM_IDS.audioReuseShare, clickable: true, description: 'Share', visible: true }]).resourceId, INSTAGRAM_IDS.audioReuseShare);
  const profileTab = { resourceId: 'com.instagram.android:id/profile_tab', clickable: true, visible: true };
  assert.equal(instagramShareTransitionObserved([...caption, profileTab]), false,
    'navigation controls on the caption page do not prove upload completion');
  assert.equal(instagramShareTransitionObserved([profileTab]), true,
    'leaving the caption composer and returning to the profile is a real transition');
  assert.equal(instagramShareTransitionObserved([{ text: 'Your reel has been shared', visible: true }]), true);
});

test('Instagram denies unnecessary camera and microphone prompts instead of granting capture access', () => {
  const prompt = [{ text: 'Allow Instagram to record audio?', visible: true }];
  const deny = { text: "Don't allow", clickable: true, visible: true, x: 300, y: 900 };
  assert.equal(instagramCapturePermissionPrompt(prompt), true);
  assert.deepEqual(instagramPermissionDenyButtons([...prompt, deny]), [deny]);
  assert.equal(instagramCapturePermissionPrompt([{ text: 'Allow Instagram to access videos', visible: true }]), false);
  assert.deepEqual(instagramPermissionDenyButtons([{ text: 'Allow while using the app', clickable: true, visible: true }]), []);
});

test('Instagram confirms only a fresh post from the exact authenticated profile', () => {
  const header = { resourceId: 'com.instagram.android:id/row_feed_profile_header', description: 'pulso_ai_news posted a video 1 minute ago' };
  assert.equal(instagramIsRecentProfilePost([header], '@pulso_ai_news'), true);
  assert.equal(instagramIsRecentProfilePost([{ ...header, description: 'pulso_ai_news posted a video 5 days ago' }], '@pulso_ai_news'), false);
  assert.equal(instagramIsRecentProfilePost([header], '@another_account'), false);
});
