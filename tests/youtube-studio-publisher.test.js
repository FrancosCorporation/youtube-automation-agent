'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  advanceToVisibility,
  assertStudioChannel,
  connectStudioBrowser,
  studioProcessingNotice, waitForStudioPublishedRow,
  confirmedUploadText,
  makeYoutubeUrl,
  publicationProof,
  studioChannelId,
  studioQuotaRejection,
  studioExplicitUploadLimit,
  studioPreSubmitErrorCode,
  selectStudioAndroidDocument,
  uploadWithStudio,
  youtubeVideoId
} = require('../utils/youtube-studio-publisher');

const CHANNEL_ID = 'UCT_Scob-q-jUJgfDUaMvejA';

test('Studio URL is bound to the configured channel before upload', () => {
  assert.equal(studioChannelId(`https://studio.youtube.com/channel/${CHANNEL_ID}/videos/upload`), CHANNEL_ID);
  assert.equal(assertStudioChannel(`https://studio.youtube.com/channel/${CHANNEL_ID}/videos/upload`, CHANNEL_ID), CHANNEL_ID);
  assert.throws(() => assertStudioChannel('https://studio.youtube.com/channel/UC0000000000000000000000/videos/upload', CHANNEL_ID), {
    code: 'YOUTUBE_STUDIO_CHANNEL_MISMATCH'
  });
  assert.throws(() => assertStudioChannel('https://youtube.com/channel/UCT_Scob-q-jUJgfDUaMvejA', CHANNEL_ID), {
    code: 'YOUTUBE_STUDIO_CHANNEL_MISMATCH'
  });
});

test('Studio reconnects by starting headless Android Chrome only when local CDP is unavailable', async () => {
  const calls = [];
  const browser = {};
  let connections = 0;
  const connect = async () => { calls.push('connect'); if (++connections === 1) throw new Error('closed'); return browser; };
  const result = await connectStudioBrowser({ cdpUrl: 'http://127.0.0.1:9223', device: 'emulator-5560',
    connect, runAdb: (device, args) => calls.push([device, ...args]), wait: async () => calls.push('wait') });
  assert.equal(result, browser);
  const foreground = ['emulator-5560', 'shell', 'am', 'start', '-a', 'android.intent.action.MAIN',
    '-c', 'android.intent.category.LAUNCHER', '-p', 'com.android.chrome'];
  assert.deepEqual(calls, [['emulator-5560', 'forward', '--list'],
    ['emulator-5560', 'forward', '--no-rebind', 'tcp:9223', 'localabstract:chrome_devtools_remote'],
    foreground, 'wait', 'connect', foreground, 'wait', 'connect']);
  let started = false;
  await assert.rejects(connectStudioBrowser({ cdpUrl: 'https://remote.example', device: 'emulator-5560',
    connect: async () => { throw new Error('closed'); }, runAdb: () => { started = true; } }), /closed/);
  assert.equal(started, false);
});

test('Studio tenta uma terceira reconexão local quando o Chrome demora a expor o CDP', async () => {
  const calls = [];
  let connections = 0;
  const result = await connectStudioBrowser({
    cdpUrl: 'http://127.0.0.1:9223', device: 'emulator-5560',
    connect: async () => {
      connections += 1;
      if (connections < 3) throw new Error('Chrome ainda iniciando');
      return { connected: true };
    },
    runAdb: (_device, args) => calls.push(args), wait: async delay => calls.push(['wait', delay])
  });
  assert.deepEqual(result, { connected: true });
  assert.equal(connections, 3);
  assert.deepEqual(calls.filter(call => Array.isArray(call) && call[0] === 'wait'), [
    ['wait', 2000], ['wait', 3500], ['wait', 5000]
  ]);
});

test('Studio ativa a rede do Chrome Android mesmo se o CDP já estiver disponível', async () => {
  const calls = [];
  await connectStudioBrowser({ cdpUrl: 'http://127.0.0.1:9223', device: 'emulator-5560',
    runAdb: (_device, args) => calls.push(args), wait: async () => {}, connect: async () => { calls.push('connected'); return {}; } });
  assert.equal(calls[2][4], 'android.intent.action.MAIN');
  assert.equal(calls[3], 'connected');
});

test('YouTube links parse stable video IDs and reject malformed IDs', () => {
  assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=AbCdEfGh123&feature=share'), 'AbCdEfGh123');
  assert.equal(youtubeVideoId('https://youtu.be/AbCdEfGh123'), 'AbCdEfGh123');
  assert.equal(youtubeVideoId('https://www.youtube.com/shorts/AbCdEfGh123'), 'AbCdEfGh123');
  assert.equal(makeYoutubeUrl('AbCdEfGh123'), 'https://youtu.be/AbCdEfGh123');
  assert.throws(() => makeYoutubeUrl('bad'), /videoId inválido/);
});

test('Studio completion and channel upload-limit messages are distinguished', () => {
  assert.equal(confirmedUploadText('Vídeo publicado. Copiar link'), true);
  assert.equal(confirmedUploadText('Aguarde enquanto o vídeo é enviado'), false);
  assert.equal(confirmedUploadText('Link do vídeo https://youtu.be/AbCdEfGh123 Salvo como privado'), false);
  assert.equal(confirmedUploadText('Video link Copy link Upload processing'), false);
  assert.equal(confirmedUploadText('Seu vídeo foi publicado'), true);
  assert.equal(studioQuotaRejection('You have reached your daily upload limit'), true);
  assert.equal(studioQuotaRejection('Upload processing'), false);
  assert.equal(studioExplicitUploadLimit('O limite diário de envios foi alcançado'), true);
  assert.equal(studioExplicitUploadLimit('You have reached your daily upload limit'), true);
  assert.equal(studioExplicitUploadLimit('Conheça os limites diários de envios'), false);
  assert.equal(studioProcessingNotice('Processando vídeo. A versão de definição padrão precisa terminar o processamento.'), true);
  assert.equal(confirmedUploadText('Processando vídeo. A versão de definição padrão precisa terminar o processamento.'), false);
});

test('Studio notices an explicit channel limit before trying the Next button', async () => {
  let clicks = 0;
  const page = { locator: selector => selector === 'ytcp-uploads-dialog'
    ? { innerText: async () => 'O limite diário de envios foi alcançado' }
    : selector.includes('[name="PUBLIC"]') ? { isVisible: async () => false }
      : { count: async () => { clicks++; return 0; } }, waitForTimeout: async () => {} };
  await assert.rejects(advanceToVisibility(page), { code: 'YOUTUBE_STUDIO_UPLOAD_LIMIT' });
  assert.equal(clicks, 0);
});

test('SD processing is reconciled from the exact channel row without another upload', async () => {
  const id = 'AbCdEfGh123', channelId = 'UCdMVsUBp7pYYB3Af0G4JKIQ';
  const snapshots = [[['OtherVid123', 'Público\nPublicado']], [[id, 'Público\nProcessando']], [[id, 'Público\nPublicado']]];
  const listings = []; let closed = 0, clock = 0;
  const prepare = async (_browser, options) => {
    listings.push(options.listing);
    const rows = snapshots.shift().map(([videoId, innerText]) => ({ innerText,
      querySelectorAll: () => [{ getAttribute: () => `/video/${videoId}/edit` }] }));
    return { channelId, page: { close: async () => { closed++; },
      locator: () => ({ evaluateAll: async (callback, videoId) => callback(rows, videoId) }) } };
  };
  const proof = await waitForStudioPublishedRow({}, { videoId: id, expectedChannelId: channelId,
    platform: 'shorts', prepare, now: () => clock, wait: async ms => { clock += ms; },
    capture: async () => 'proof.png', timeoutMs: 60000 });
  assert.equal(proof.videoId, id);
  assert.deepEqual(listings, ['short', 'short', 'short']);
  assert.equal(closed, 3);
});

test('a draft/private row or a different account never becomes a publication confirmation', async () => {
  for (const wrongChannel of [false, true]) {
    let clock = 0;
    const proof = await waitForStudioPublishedRow({}, { videoId: 'AbCdEfGh123', expectedChannelId: 'expected',
      timeoutMs: 1000, now: () => clock, wait: async ms => { clock += ms; },
      prepare: async () => ({ channelId: wrongChannel ? 'other' : 'expected', page: {
        close: async () => {}, locator: () => ({ evaluateAll: async () => ['Público\nRascunho\nPublicado'] })
      } }), capture: async () => { throw Error('must not capture'); } });
    assert.equal(proof, null);
  }
});

test('Studio stops on visibility with either two or three Next steps, including Shorts', async () => {
  for (const required of [0, 2, 3]) {
    let clicks = 0;
    const control = { isVisible: async () => true, isDisabled: async () => false,
      evaluate: async callback => callback({ click: () => { clicks++; } }) };
    const page = {
      locator: selector => selector.includes('[name="PUBLIC"]')
        ? { isVisible: async () => clicks >= required }
        : { count: async () => 1, nth: () => control },
      waitForTimeout: async () => {}
    };
    await advanceToVisibility(page);
    assert.equal(clicks, required);
  }
});

test('falha transitória de DNS antes do upload recebe código com retry', () => {
  assert.equal(studioPreSubmitErrorCode(new Error('page.goto: net::ERR_NAME_NOT_RESOLVED')),
    'YOUTUBE_STUDIO_SESSION_UNAVAILABLE');
  assert.equal(studioPreSubmitErrorCode(new Error('erro desconhecido')), 'youtube_studio_pre_submit_failed');
});

test('publication proof is hash bound and records the configured visibility', () => {
  const proof = publicationProof({
    videoPath: '/data/master.mp4',
    videoId: 'AbCdEfGh123',
    title: 'Episódio de teste',
    expectedSha256: 'a'.repeat(64),
    channelId: CHANNEL_ID,
    privacyStatus: 'public',
    screenshotPath: '/data/reports/studio.png'
  });
  assert.equal(proof.status, 'confirmed');
  assert.equal(proof.platform, 'youtube');
  assert.equal(proof.url, 'https://youtu.be/AbCdEfGh123');
  assert.equal(proof.artifact.sha256, 'a'.repeat(64));
  assert.match(proof.evidence.observed, /visibilidade public/);
  assert.equal(proof.evidence.screenshotPath, '/data/reports/studio.png');

  const shortProof = publicationProof({
    platform: 'shorts', videoPath: '/data/short.mp4', videoId: 'AbCdEfGh123', title: 'Short',
    expectedSha256: 'b'.repeat(64), channelId: CHANNEL_ID, privacyStatus: 'public'
  });
  assert.equal(shortProof.platform, 'shorts');
});

test('invalid QA hash returns confirmed no-send before starting Android or Studio', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-studio-no-send-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const videoPath = path.join(root, 'episode.mp4');
  await fs.writeFile(videoPath, Buffer.from('fixture mp4 bytes'));
  let deviceStarts = 0;
  const result = await uploadWithStudio({
    platform: 'shorts', videoPath, title: 'Short', expectedSha256: 'f'.repeat(64),
    ensureDevice: async () => { deviceStarts++; },
    connect: async () => { throw new Error('Studio must not open on bad hash'); },
    withLock: async callback => callback()
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.platform, 'shorts');
  assert.equal(result.failureCode, 'youtube_studio_media_hash_mismatch');
  assert.equal(result.evidence.kind, 'confirmed_no_send');
  assert.equal(deviceStarts, 0);
});

test('Studio stages the approved video in the configured Android media directory', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-studio-stage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const videoPath = path.join(root, 'episode.mp4');
  const bytes = Buffer.from('fixture mp4 bytes');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(videoPath, bytes);
  const calls = [];
  const result = await uploadWithStudio({ videoPath, title: 'Teste', expectedSha256: hash,
    cdpUrl: 'https://remote.example', ensureDevice: async () => {}, withLock: async callback => callback(),
    connect: async () => { throw new Error('session unavailable'); },
    runAdb: (_device, args) => { calls.push(args); return args.includes('sha256sum') ? `${hash} file`
      : args.includes('df') ? 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/fuse 9999999 10 9999989 1% /data' : ''; }
  });
  assert.equal(result.evidence.kind, 'confirmed_no_send');
  assert.ok(calls.some(args => args[0] === 'shell' && args[1] === 'mkdir'
    && args.at(-1) === '/sdcard/Movies/PulsoStudio'));
  assert.ok(calls.some(args => args[0] === 'push' && args.at(-1).startsWith('/sdcard/Movies/PulsoStudio/')));
  assert.ok(calls.some(args => args.includes('android.intent.action.MEDIA_SCANNER_SCAN_FILE')));
});

test('Studio Android picker selects only the exact staged filename and checkpoints before tapping', async () => {
  const events = [];
  const page = { locator: selector => ({ first: () => ({
    waitFor: async () => events.push(['input', selector]), evaluate: async () => events.push('open')
  }) }) };
  const control = { getResumedActivity: async () => 'com.google.android.documentsui/.files.FilesActivity',
    dumpUi: async () => [
      { resourceId: 'android:id/title', text: 'other.mp4', x: 20, y: 30 },
      { resourceId: 'android:id/title', text: 'approved.mp4', x: 120, y: 130 }
    ], tap: async (x, y) => events.push(['tap', x, y]) };
  await selectStudioAndroidDocument({ page, control, filename: 'approved.mp4', kind: 'video',
    onSelecting: () => events.push('checkpoint'), wait: async () => {} });
  assert.deepEqual(events.slice(-2), ['checkpoint', ['tap', 120, 130]]);
  control.dumpUi = async () => [{ resourceId: 'android:id/title', text: 'approved.mp4', x: 1, y: 2 },
    { resourceId: 'android:id/title', text: 'approved.mp4', x: 3, y: 4 }];
  await assert.rejects(selectStudioAndroidDocument({ page, control, filename: 'approved.mp4', kind: 'video',
    onSelecting: () => { throw new Error('must not select'); }, wait: async () => {} }), /não é único/);
});

test('a corrupted Android thumbnail blocks the upload before opening Studio', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-studio-cover-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const videoPath = path.join(root, 'episode.mp4'), thumbnailPath = path.join(root, 'cover.png');
  const video = Buffer.from('fixture video');
  await fs.writeFile(videoPath, video); await fs.writeFile(thumbnailPath, 'fixture cover');
  const videoHash = crypto.createHash('sha256').update(video).digest('hex');
  let opened = false;
  const result = await uploadWithStudio({ videoPath, thumbnailPath, title: 'Teste', expectedSha256: videoHash,
    cdpUrl: 'https://remote.example', ensureDevice: async () => {}, withLock: async callback => callback(),
    connect: async () => { opened = true; throw new Error('must not open'); },
    runAdb: (_device, args) => args.includes('df') ? 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/fuse 9999999 10 9999989 1% /data'
      : args.includes('sha256sum') ? `${args.at(-1).endsWith('-cover.png') ? '0'.repeat(64) : videoHash} file` : '' });
  assert.equal(result.failureCode, 'youtube_studio_thumbnail_staging_hash_mismatch');
  assert.equal(result.evidence.kind, 'confirmed_no_send');
  assert.equal(opened, false);
});

test('Studio opens the document browser from the photo picker before choosing the exact cover', async () => {
  const taps = []; let step = 0; let selected = false;
  const control = {
    getResumedActivity: async () => step < 2
      ? 'com.google.android.providers.media.module/com.android.providers.media.photopicker.PhotoPickerGetContentActivity'
      : 'com.google.android.documentsui/.files.FilesActivity',
    dumpUi: async () => step === 0 ? [{ description: 'More options', clickable: true, x: 1, y: 2 }]
      : step === 1 ? [{ text: 'Browse…', x: 3, y: 4 }]
        : [{ resourceId: 'android:id/title', text: 'approved.png', x: 5, y: 6 }],
    tap: async (x, y) => { taps.push([x, y]); step++; }
  };
  const page = { locator: () => ({ first: () => ({ waitFor: async () => {}, evaluate: async () => {} }) }) };
  await selectStudioAndroidDocument({ page, control, filename: 'approved.png', kind: 'image',
    onSelecting: () => { selected = true; }, wait: async () => {} });
  assert.deepEqual(taps, [[1, 2], [3, 4], [5, 6]]);
  assert.equal(selected, true);
});

test('Studio submits the document search before selecting the requested filename', async () => {
  const calls = []; let searched = false;
  const control = {
    getResumedActivity: async () => 'com.google.android.documentsui/.picker.PickActivity',
    dumpUi: async () => searched ? [{ resourceId: 'android:id/title', text: 'cover.png', x: 9, y: 8 }]
      : [{ description: 'Search', clickable: true, x: 1, y: 2 }],
    tap: async (...args) => calls.push(['tap', ...args]),
    shell: async args => calls.push(args),
    press: async key => { calls.push(['press', key]); searched = true; }
  };
  const page = { locator: () => ({ first: () => ({ waitFor: async () => {}, evaluate: async () => {} }) }) };
  await selectStudioAndroidDocument({ page, control, filename: 'cover.png', kind: 'image', wait: async () => {} });
  assert.deepEqual(calls, [['tap', 1, 2], ['input', 'text', 'cover.png'], ['press', 'ENTER'], ['tap', 9, 8]]);
});

test('Studio fecha o menu overflow do DocumentsUI antes de reler os arquivos', async () => {
  const calls = [];
  let menuOpen = true;
  const control = {
    getResumedActivity: async () => 'com.google.android.documentsui/.picker.PickActivity',
    dumpUi: async () => menuOpen
      ? [{ text: 'Sort by...', visible: true }, { text: 'Select all', visible: true }, { text: 'Show hidden files', visible: true }]
      : [{ resourceId: 'android:id/title', text: 'approved.mp4', x: 9, y: 8 }],
    press: async key => { calls.push(['press', key]); menuOpen = false; },
    tap: async (...args) => calls.push(['tap', ...args])
  };
  const page = { locator: () => ({ first: () => ({ waitFor: async () => {}, evaluate: async () => {} }) }) };
  await selectStudioAndroidDocument({ page, control, filename: 'approved.mp4', kind: 'video', wait: async () => {} });
  assert.deepEqual(calls, [['press', 'BACK'], ['tap', 9, 8]]);
});

test('Studio fecha aviso de TikTok sem resposta que encobre o seletor e seleciona o arquivo exato', async () => {
  const calls = []; let dialog = true;
  const control = {
    getResumedActivity: async () => 'com.google.android.documentsui/.picker.PickActivity',
    dumpUi: async () => dialog ? [
      { resourceId: 'android:id/alertTitle', text: "TikTok isn't responding" },
      { resourceId: 'android:id/aerr_close', clickable: true, x: 20, y: 30 }
    ] : [{ resourceId: 'android:id/title', text: 'approved.mp4', x: 9, y: 8 }],
    tap: async (x, y) => { calls.push([x, y]); if (x === 20) dialog = false; }
  };
  const page = { locator: () => ({ first: () => ({ waitFor: async () => {}, evaluate: async () => {} }) }) };
  await selectStudioAndroidDocument({ page, control, filename: 'approved.mp4', kind: 'video', wait: async () => {} });
  assert.deepEqual(calls, [[20, 30], [9, 8]]);
});

test('document search grid matches the full filename and ignores preview controls', async () => {
  const taps = [];
  const control = {
    getResumedActivity: async () => 'com.google.android.documentsui/.picker.PickActivity',
    dumpUi: async () => [
      { description: 'cover.png, 13.81 kB, 7:34 PM', resourceId: '', width: 197, height: 197, x: 146, y: 783 },
      { description: 'Preview the file cover.png', resourceId: 'com.google.android.documentsui:id/preview_icon', width: 96, height: 96, x: 197, y: 733 }
    ], tap: async (...args) => taps.push(args)
  };
  const page = { locator: () => ({ first: () => ({ waitFor: async () => {}, evaluate: async () => {} }) }) };
  await selectStudioAndroidDocument({ page, control, filename: 'cover.png', kind: 'image', wait: async () => {} });
  assert.deepEqual(taps, [[146, 783]]);
});

test('Studio não prepara nem envia arquivo quando o armazenamento interno está cheio', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-studio-low-space-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const videoPath = path.join(root, 'episode.mp4');
  await fs.writeFile(videoPath, Buffer.from('fixture mp4 bytes'));
  const calls = [];
  const result = await uploadWithStudio({ videoPath, title: 'Teste', ensureDevice: async () => {},
    withLock: async callback => callback(), runAdb: (_device, args) => {
      calls.push(args);
      return 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/fuse 9999999 9999998 1 100% /data';
    } });
  assert.equal(result.failureCode, 'YOUTUBE_STUDIO_STORAGE_INSUFFICIENT');
  assert.equal(result.evidence.kind, 'confirmed_no_send');
  assert.ok(result.nextAttemptAt);
  assert.equal(calls.some(args => args[0] === 'push'), false);
});

test('Android Studio promotion is accepted and failed preparation closes only its new page', async () => {
  const { prepareStudioPage } = require('../utils/youtube-studio-publisher');
  const events = [];
  let rejectWait = false;
  const page = {
    goto: async () => events.push('navigate'),
    waitForFunction: async () => { if (rejectWait) throw new Error('session unavailable'); events.push('wait'); },
    getByText: () => ({ first: () => ({ isVisible: async () => true, click: async () => events.push('continue') }) }),
    url: () => `https://studio.youtube.com/channel/${CHANNEL_ID}/videos/upload`,
    locator: () => ({ innerText: async () => 'Pulso IA Conteúdo do canal' }),
    close: async () => events.push('close')
  };
  const browser = { contexts: () => [{ newPage: async () => page }] };
  const result = await prepareStudioPage(browser, { expectedChannelId: CHANNEL_ID, timeoutMs: 1000 });
  assert.equal(result.page, page);
  assert.deepEqual(events, ['navigate', 'wait', 'continue', 'wait']);
  rejectWait = true;
  await assert.rejects(prepareStudioPage(browser, { expectedChannelId: CHANNEL_ID, timeoutMs: 1000 }), /session unavailable/);
  assert.equal(events.at(-1), 'close');
});
