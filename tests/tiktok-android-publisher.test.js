'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { durationLabelSeconds, publishTikTok, stageTikTokVideo } = require('../utils/tiktok-android-publisher');

const id = suffix => `com.zhiliaoapp.musically:id/${suffix}`;
const node = (resourceId, text, x, extra = {}) => ({ resourceId: id(resourceId), text, x, y: 1, clickable: true, visible: true, ...extra });
function simulatedControl({ alteredCaption = false, hashtagSuggestions = false } = {}) {
  let state = 'feed';
  let caption = '';
  const taps = [];
  const states = {
    feed: () => [node('ond', '', 1)],
    camera: () => [node('upload_hot_area', '', 2)],
    picker: () => [node('dw6', '', 3)],
    albums: () => [node('l29', 'Pulso_TT_aaaaaaaaaaaa', 4, { clickable: false })],
    album: () => [node('tv_title', 'Pulso_TT_aaaaaaaaaaaa', 5, { clickable: false }), node('gre', '01:00', 6, { clickable: false }), node('l37', '', 7)],
    selected: () => [node('y1v', 'Next (1)', 8)],
    editor: () => [node('q0y', 'Next', 9, { clickable: false }), node('q0w', '', 10)],
    final: () => [node('h9x', alteredCaption ? 'wrong' : caption || 'Add description...', 11), node('dud', '', 12, { description: 'Everyone can view this post' }),
      ...(!hashtagSuggestions || /\s$/.test(caption) ? [node('tjf', 'Post', 13)] : [])]
  };
  const next = { 1: 'camera', 2: 'picker', 3: 'albums', 4: 'album', 7: 'selected', 8: 'editor', 10: 'final' };
  return {
    taps,
    async dumpUi() { return states[state](); },
    async tap(x) { taps.push(x); if (next[x]) state = next[x]; },
    async shell(args) { if (args[0] === 'input' && args[1] === 'text') caption += args[2].replace(/%s/g, ' ').replace(/\\#/g, '#'); },
    async press() {}
  };
}

const stage = async () => ({ albumName: 'Pulso_TT_aaaaaaaaaaaa', hash: 'a'.repeat(64) });
const options = { videoPath: '/tmp/fixture.mp4', caption: 'Video de teste', accountHandle: '@example',
  stage, duration: async () => 60, wait: async () => {}, timeoutMs: 50 };

test('TikTok seleciona mídia isolada, confere legenda e registra envio como incerto', async () => {
  const control = simulatedControl();
  const result = await publishTikTok({ ...options, control });
  assert.equal(result.status, 'unknown');
  assert.equal(result.evidence.kind, 'attempt_outcome_unknown');
  assert.equal(result.artifact.sha256, 'a'.repeat(64));
  assert.equal(control.taps.filter(x => x === 13).length, 1);
});

test('TikTok não toca Post se a legenda observada divergir', async () => {
  const control = simulatedControl({ alteredCaption: true });
  const result = await publishTikTok({ ...options, control });
  assert.equal(result.status, 'failed');
  assert.equal(result.evidence.kind, 'confirmed_no_send');
  assert.equal(control.taps.includes(13), false);
});

test('TikTok termina hashtag para liberar o compositor e conserva a legenda verificada', async () => {
  const control = simulatedControl({ hashtagSuggestions: true });
  const result = await publishTikTok({ ...options, caption: 'Video de teste #saude', control });
  assert.equal(result.status, 'unknown', JSON.stringify(result.evidence));
  assert.equal(control.taps.filter(x => x === 13).length, 1);
});

test('TikTok aguarda a navegação reaparecer depois da indexação de mídia', async () => {
  const control = simulatedControl();
  const originalDump = control.dumpUi.bind(control);
  let calls = 0;
  control.dumpUi = async () => ++calls === 1 ? [] : originalDump();
  const result = await publishTikTok({ ...options, control });
  assert.equal(result.status, 'unknown');
  assert.equal(control.taps.filter(x => x === 13).length, 1);
});

test('TikTok procura o álbum isolado abaixo das mídias antigas sem selecionar outra pasta', async () => {
  const control = simulatedControl();
  const originalDump = control.dumpUi.bind(control);
  const originalShell = control.shell.bind(control);
  let scrolled = false;
  control.dumpUi = async () => {
    const nodes = await originalDump();
    return !scrolled && nodes.some(item => item.resourceId === id('l29'))
      ? [node('l29', 'Older album', 99, { clickable: false })] : nodes;
  };
  control.shell = async args => {
    if (args[1] === 'swipe') scrolled = true;
    return originalShell(args);
  };
  const result = await publishTikTok({ ...options, control });
  assert.equal(scrolled, true);
  assert.equal(control.taps.includes(99), false);
  assert.equal(result.status, 'unknown');
});

test('TikTok fecha sugestões da legenda antes de procurar Post e reconfere o texto', async () => {
  const control = simulatedControl();
  const originalDump = control.dumpUi.bind(control);
  const originalTap = control.tap.bind(control);
  let settled = false;
  control.dumpUi = async () => {
    const nodes = await originalDump();
    return settled ? nodes : nodes.filter(item => item.resourceId !== id('tjf'));
  };
  control.tap = async (x, y) => {
    if (x === 360 && y === 172) settled = true;
    return originalTap(x, y);
  };
  const result = await publishTikTok({ ...options, control });
  assert.equal(settled, true);
  assert.equal(result.status, 'unknown');
  assert.equal(control.taps.filter(x => x === 13).length, 1);
});

test('TikTok não abre o editor quando o armazenamento é insuficiente', async () => {
  let touched = false;
  const result = await publishTikTok({ ...options, control: { dumpUi: async () => { touched = true; return []; } },
    stage: async () => { throw Object.assign(new Error('sem espaço'), { code: 'ANDROID_STORAGE_INSUFFICIENT' }); } });
  assert.equal(result.failureCode, 'android_storage_insufficient');
  assert.equal(result.evidence.kind, 'confirmed_no_send');
  assert.equal(touched, false);
  assert.equal(durationLabelSeconds('01:03'), 63);
});

test('staging TikTok confere hash e reutiliza apenas a cópia idêntica', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pulso-tiktok-staging-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const video = path.join(root, 'video.mp4');
  await fsp.writeFile(video, 'fixture de vídeo');
  const remoteFiles = new Map();
  let pushes = 0;
  const control = {
    async shell(args) {
      if (args[0] === 'df') return 'Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/test 1000000 1 999999 1% /data';
      if (args[0] === 'toybox' && args[1] === 'sha256sum') {
        const bytes = remoteFiles.get(args[2]);
        return bytes ? `${crypto.createHash('sha256').update(bytes).digest('hex')}  ${args[2]}` : '';
      }
      if (args[0] === 'mv') { remoteFiles.set(args[2], remoteFiles.get(args[1])); remoteFiles.delete(args[1]); }
      if (args[0] === 'rm') remoteFiles.delete(args.at(-1));
      return '';
    },
    run(args) { pushes++; remoteFiles.set(args[2], fs.readFileSync(args[1])); }
  };
  const expected = crypto.createHash('sha256').update(await fsp.readFile(video)).digest('hex');
  const first = await stageTikTokVideo(control, video, { wait: async () => {} });
  assert.equal(first.hash, expected);
  assert.equal(first.albumName, `Pulso_TT_${expected.slice(0, 12)}`);
  await stageTikTokVideo(control, video, { wait: async () => {} });
  assert.equal(pushes, 1);
  remoteFiles.set(first.remote, Buffer.from('conteúdo divergente'));
  await assert.rejects(stageTikTokVideo(control, video, { wait: async () => {} }), /hash do arquivo existente não corresponde/);
  assert.equal(pushes, 1);
});
