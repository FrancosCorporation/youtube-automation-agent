'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const {
  INSTAGRAM_DISCOVERY_MAX_SECONDS,
  INSTAGRAM_MIN_NARRATIVE_SECONDS,
  INSTAGRAM_APP_MAX_SECONDS,
  INSTAGRAM_GRAPH_API_MAX_SECONDS,
  configuredInstagramPartDurationLimitSeconds,
  configuredNarrativePartDurationLimitSeconds,
  createNarrativePartScript,
  instagramPartDurationLimitSeconds,
  isPlatformTargeted,
  isShortsTargeted,
  narrativeBlocksFromScript,
  narrativePartDurationRejection,
  socialClipCaption,
  splitNarrativeBlocks,
  TIKTOK_CREATOR_REWARDS_MIN_SECONDS
} = require('../utils/platform-video-policy');
const {
  TELEGRAM_ANDROID_PREMIUM_MAX_BYTES,
  TELEGRAM_ANDROID_STANDARD_MAX_BYTES,
  YOUTUBE_SHORTS_MAX_SECONDS,
  YOUTUBE_UNVERIFIED_MAX_SECONDS,
  YOUTUBE_VERIFIED_MAX_SECONDS,
  X_ANDROID_PREMIUM_MAX_SECONDS,
  X_ANDROID_STANDARD_MAX_SECONDS,
  isWithinFileSizeLimit,
  platformVideoLimitSeconds,
  telegramFileLimitBytes
} = require('../utils/platform-upload-limits');

test('only the exact approved complete reference is eligible as a short video', () => {
  const clip = {
    path: path.join(__dirname, '..', 'data', 'videos', 'clips', 'pulso-internet-reference-20261029', 'internet-parte1.mp4'),
    kind: 'owner-approved-reference-v2', referenceJobId: 'pulso-internet-reference-20261029',
    partIndex: 1, partCount: 1, platforms: ['kwai', 'instagram', 'shorts']
  };
  for (const platform of clip.platforms) assert.equal(isPlatformTargeted(clip, platform), true);
  assert.equal(isPlatformTargeted(clip, 'tiktok'), false);
  assert.equal(isShortsTargeted(clip), true);
  assert.equal(narrativePartDurationRejection('kwai', clip, 31.019, 179), null);
  assert.ok(narrativePartDurationRejection('kwai', clip, 180, 179));
  assert.ok(narrativePartDurationRejection('tiktok', clip, 31, 179));
  assert.equal(isPlatformTargeted({ ...clip, path: '/tmp/other.mp4' }, 'kwai'), false);
  assert.equal(isPlatformTargeted({ ...clip, referenceJobId: 'other' }, 'kwai'), false);
});

test('later narrative parts repeat a short real opening and reserve its audio inside the duration cap', () => {
  const blocks = [4, 60, 60, 60, 60, 10].map((durationSeconds, originalIndex) => ({
    kind: originalIndex === 0 ? 'hook' : 'section', originalIndex, durationSeconds,
    text: `Bloco ${originalIndex}`
  }));
  const parts = splitNarrativeBlocks(blocks, 130, 60, { contextBlock: blocks[0] });
  assert.equal(parts.length, 3);
  assert(parts.every(part => part.blocks[0].originalIndex === 0));
  assert(parts.every(part => part.durationSeconds <= 130 && part.durationSeconds >= 60));
  assert(parts.every(part => part.durationSeconds === part.blocks.reduce((sum, block) => sum + block.durationSeconds, 0)));
  assert.deepEqual(parts.flatMap(part => part.blocks.filter(block => !block.contextIntro)).map(block => block.originalIndex), [0, 1, 2, 3, 4, 5]);
  assert.equal(parts[1].blocks[0].contextIntro, true);
});

test('a six-minute narrative is split into three contextual parts below the discovery ceiling', () => {
  const blocks = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, durationSeconds: 60 }));
  const parts = splitNarrativeBlocks(blocks);
  assert.equal(INSTAGRAM_DISCOVERY_MAX_SECONDS, 179);
  assert.deepEqual(parts.map(part => part.durationSeconds), [120, 120, 120]);
  assert.deepEqual(parts.map(part => part.blocks.map(block => block.id)), [[1, 2], [3, 4], [5, 6]]);
  assert(parts.every(part => part.durationSeconds <= INSTAGRAM_DISCOVERY_MAX_SECONDS));
});

test('a five-minute-forty-second explanation fits two parts at the 2m59s ceiling', () => {
  const blocks = [10, 80, 80, 80, 80, 10].map((durationSeconds, index) => ({ id: index, durationSeconds }));
  const parts = splitNarrativeBlocks(blocks);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map(part => part.durationSeconds), [170, 170]);
  assert(parts.every(part => part.durationSeconds <= 179));
  assert.deepEqual(parts.flatMap(part => part.blocks.map(block => block.id)), [0, 1, 2, 3, 4, 5]);
});

test('longer source videos create only as many parts as the 2m59s target requires', () => {
  const blocks = [80, 75, 72, 80, 75].map((durationSeconds, index) => ({ id: index, durationSeconds }));
  const parts = splitNarrativeBlocks(blocks);
  assert.equal(parts.length, 3);
  assert(parts.every(part => part.durationSeconds <= 179));
  assert.deepEqual(parts.flatMap(part => part.blocks.map(block => block.id)), [0, 1, 2, 3, 4]);
});

test('section boundaries can increase the part count when the minimum count has no valid partition', () => {
  const durations = [3.192, 43.464, 64.992, 73.992, 45.264, 70.344, 73.032, 71.616, 30.744];
  const blocks = durations.map((durationSeconds, id) => ({ id, durationSeconds }));
  const parts = splitNarrativeBlocks(blocks);

  assert.equal(parts.length, 4, 'the three-part lower bound cannot preserve these section boundaries');
  assert.deepEqual(parts.map(part => Number(part.durationSeconds.toFixed(3))), [111.648, 119.256, 143.376, 102.36]);
  assert(parts.every(part => part.durationSeconds <= INSTAGRAM_DISCOVERY_MAX_SECONDS));
  assert(parts.every(part => part.durationSeconds > INSTAGRAM_MIN_NARRATIVE_SECONDS));
  assert.deepEqual(parts.flatMap(part => part.blocks.map(block => block.id)), blocks.map(block => block.id));
});

test('part scripts preserve narrative order and rebase real audio timing to the new part', () => {
  const script = {
    title: 'Relatório de teste',
    hook: 'Uma abertura curta.',
    mainContent: { sections: [
      { title: 'Primeira seção', content: 'O primeiro bloco.', emotion: 'curiosity' },
      { title: 'Segunda seção', content: 'O segundo bloco.', emotion: 'confidence' }
    ] },
    conclusion: { finalThought: 'Fechamento.' },
    timings: [
      { durationMs: 10_000, sentences: [{ text: 'Uma abertura curta.', startMs: 0, durationMs: 10_000 }] },
      { durationMs: 60_000, sentences: [{ text: 'O primeiro bloco.', startMs: 0, durationMs: 60_000 }] },
      { durationMs: 70_000, sentences: [{ text: 'O segundo bloco.', startMs: 0, durationMs: 70_000 }] },
      { durationMs: 5_000, sentences: [{ text: 'Fechamento.', startMs: 0, durationMs: 5_000 }] }
    ]
  };
  const blocks = narrativeBlocksFromScript(script);
  const partScript = createNarrativePartScript(script, blocks.slice(1, 3), 2, 2);
  assert.deepEqual(partScript.mainContent.sections.map(section => section.title), ['Primeira seção', 'Segunda seção']);
  assert.deepEqual(partScript.timings.map(timing => timing.audioOffsetMs), [0, 60_000]);
  assert.deepEqual(partScript.partIndicator, { index: 2, count: 2 });
  assert.equal(partScript.minimal, true);
  assert.equal(partScript.maxCaptionWords, 12);
});

test('partitioning rejects invalid blocks and adds parts when intact sections need more room', () => {
  assert.throws(() => splitNarrativeBlocks([{ durationSeconds: 181 }]), /excede o limite/);
  const intactSections = splitNarrativeBlocks([
    { durationSeconds: 100 }, { durationSeconds: 100 }, { durationSeconds: 100 }
  ]);
  assert.deepEqual(intactSections.map(part => part.durationSeconds), [100, 100, 100]);
  assert.throws(() => splitNarrativeBlocks([{ durationSeconds: Number.NaN }]), /duração positiva/);
});

test('legacy Instagram/TikTok narrative parts stay restricted to their explicitly selected destinations', () => {
  const part = { platforms: ['instagram', 'tiktok'], partIndex: 1, partCount: 2, title: 'IA em duas partes' };
  part.kind = 'instagram-narrative-part';
  assert.equal(isPlatformTargeted(part, 'instagram'), true);
  assert.equal(isPlatformTargeted(part, 'tiktok'), true);
  assert.equal(isShortsTargeted(part), false);
  assert.equal(isShortsTargeted({ path: '/tmp/short.mp4' }), false, 'unclassified legacy cuts are not retried automatically');
  assert.equal(INSTAGRAM_APP_MAX_SECONDS, 1200);
  assert.equal(INSTAGRAM_GRAPH_API_MAX_SECONDS, 900);
  assert.equal(INSTAGRAM_MIN_NARRATIVE_SECONDS, 60);
  assert.equal(TIKTOK_CREATOR_REWARDS_MIN_SECONDS, 60);
});

test('narrative duration guard blocks micro-clips and keeps Creator Rewards videos over one minute', () => {
  const clip = { kind: 'instagram-narrative-part' };
  assert.match(narrativePartDurationRejection('instagram', clip, 9), /abaixo de 60s/);
  assert.equal(narrativePartDurationRejection('instagram', clip, 60), null);
  assert.match(narrativePartDurationRejection('tiktok', clip, 60), /não ultrapassa 60s/);
  assert.equal(narrativePartDurationRejection('tiktok', clip, 60.1), null);
  assert.equal(narrativePartDurationRejection('tiktok', clip, 179), null);
  assert.match(narrativePartDurationRejection('tiktok', clip, 179.1), /acima do alvo de 179s/);
  assert.match(narrativePartDurationRejection('facebook', clip, 120), /destino não permitido/);
});

test('generic and legacy social cuts cannot route automatically without narrative metadata', () => {
  const generatedShort = { kind: 'social-short-clip', platforms: ['shorts', 'kwai', 'x'] };
  const legacyShort = { path: '/tmp/old-short.mp4' };
  assert.equal(isPlatformTargeted(generatedShort, 'instagram'), false);
  assert.equal(isPlatformTargeted(legacyShort, 'instagram'), false);
  assert.equal(isPlatformTargeted(generatedShort, 'tiktok'), false);
  assert.equal(isPlatformTargeted(legacyShort, 'tiktok'), false);
  assert.equal(isPlatformTargeted(generatedShort, 'kwai'), false);
  assert.equal(isPlatformTargeted(generatedShort, 'x'), false);
  assert.equal(isPlatformTargeted(legacyShort, 'kwai'), false, 'legacy cuts stay out of automatic retries');
  assert.equal(isShortsTargeted(generatedShort), false);
});

test('narrative vertical parts use a conservative duration ceiling for each destination', () => {
  assert.equal(configuredNarrativePartDurationLimitSeconds('instagram', {}), 179);
  assert.equal(configuredNarrativePartDurationLimitSeconds('tiktok', {}), 179);
  assert.equal(configuredNarrativePartDurationLimitSeconds('shorts', {}), 179);
  assert.equal(configuredNarrativePartDurationLimitSeconds('kwai', {}), 299);
  assert.equal(configuredNarrativePartDurationLimitSeconds('x', {}), 139);
  assert.equal(configuredNarrativePartDurationLimitSeconds('x', { X_MAX_VIDEO_SECONDS: '600' }), 599);

  const clip = { kind: 'social-narrative-part', platforms: ['instagram', 'tiktok', 'shorts', 'kwai', 'x'] };
  assert.equal(narrativePartDurationRejection('instagram', clip, 179), null);
  assert.match(narrativePartDurationRejection('instagram', clip, 180), /acima do alvo de 179s/);
  assert.equal(narrativePartDurationRejection('shorts', clip, 179), null);
  assert.match(narrativePartDurationRejection('shorts', clip, 9), /abaixo de 60s/);
  assert.equal(narrativePartDurationRejection('kwai', clip, 299), null);
  assert.match(narrativePartDurationRejection('kwai', clip, 300), /acima do alvo de 299s/);
  assert.equal(narrativePartDurationRejection('x', clip, 139), null);
  assert.match(narrativePartDurationRejection('x', clip, 140), /acima do alvo de 139s/);
  assert.match(narrativePartDurationRejection('facebook', clip, 120), /destino não permitido/);
});

test('Instagram narrative renders cannot leak to another destination through conflicting metadata', () => {
  const invalid = { kind: 'instagram-narrative-part', platforms: ['instagram', 'facebook'] };
  assert.equal(isPlatformTargeted(invalid, 'instagram'), false);
  assert.equal(isPlatformTargeted(invalid, 'tiktok'), false);
});

test('upload limits follow the selected Android surface rather than web or API limits', () => {
  assert.equal(X_ANDROID_STANDARD_MAX_SECONDS, 140);
  assert.equal(X_ANDROID_PREMIUM_MAX_SECONDS, 600);
  assert.equal(platformVideoLimitSeconds('x', { X_MAX_VIDEO_SECONDS: '14400' }), 600,
    'web Premium limit must be capped to the Android Premium limit');
  assert.equal(platformVideoLimitSeconds('x', { X_MAX_VIDEO_SECONDS: '480' }), 480);
  assert.equal(platformVideoLimitSeconds('x', { X_MAX_VIDEO_SECONDS: '-1' }), 140);
  assert.equal(platformVideoLimitSeconds('instagram', {}), INSTAGRAM_APP_MAX_SECONDS);
  assert.equal(platformVideoLimitSeconds('instagram', { SOCIAL_INSTAGRAM_APP_MAX_SECONDS: '3600' }), INSTAGRAM_APP_MAX_SECONDS,
    'Instagram app configuration cannot exceed the researched twenty-minute ceiling');
  assert.equal(platformVideoLimitSeconds('instagram', { SOCIAL_INSTAGRAM_APP_MAX_SECONDS: '300' }), 300,
    'operators can keep a lower verified or editorial limit');
  assert.equal(platformVideoLimitSeconds('tiktok', {}), 180,
    'unverified Android acceptance keeps the conservative operator cap');
});

test('YouTube duration limits default to 15 minutes and require an explicit verified-account override', () => {
  assert.equal(YOUTUBE_UNVERIFIED_MAX_SECONDS, 900);
  assert.equal(YOUTUBE_VERIFIED_MAX_SECONDS, 43_200);
  assert.equal(YOUTUBE_SHORTS_MAX_SECONDS, 180);
  assert.equal(platformVideoLimitSeconds('youtube', {}), 900);
  assert.equal(platformVideoLimitSeconds('youtube', { YT_MAX_VIDEO_SECONDS: '43200' }), 43_200);
  assert.equal(platformVideoLimitSeconds('youtube', { YT_MAX_VIDEO_SECONDS: '50000' }), 43_200,
    'configuration cannot exceed the documented 12-hour ceiling');
  assert.equal(platformVideoLimitSeconds('youtube', { YT_MAX_VIDEO_SECONDS: 'invalid' }), 900);
  assert.equal(platformVideoLimitSeconds('shorts', { YT_MAX_VIDEO_SECONDS: '43200' }), 180,
    'the Shorts ceiling is independent from the long-form account limit');
  assert.equal(platformVideoLimitSeconds('facebook', {}), null,
    'unknown/unimplemented publishing routes must not inherit an unrelated fallback cap');
});

test('Instagram and TikTok narrative parts default to 2m59s and stay below three minutes', () => {
  assert.equal(configuredInstagramPartDurationLimitSeconds({}), 179);
  assert.equal(configuredInstagramPartDurationLimitSeconds({ SOCIAL_INSTAGRAM_PART_SECONDS: '180' }), 179);
  assert.equal(configuredInstagramPartDurationLimitSeconds({ SOCIAL_INSTAGRAM_MAX_SECONDS: '180' }), 179,
    'the legacy variable remains supported but cannot exceed the discovery target');
  assert.equal(instagramPartDurationLimitSeconds(1800), 179,
    'the upload app limit is separate from the shorter editorial part target');
  assert.throws(() => instagramPartDurationLimitSeconds(0), /duração máxima inválida/);
});

test('Telegram app limits are file-size based and distinguish standard from Premium accounts', () => {
  assert.equal(TELEGRAM_ANDROID_STANDARD_MAX_BYTES, 2 * 1024 ** 3);
  assert.equal(TELEGRAM_ANDROID_PREMIUM_MAX_BYTES, 4 * 1024 ** 3);
  assert.equal(telegramFileLimitBytes({}), TELEGRAM_ANDROID_STANDARD_MAX_BYTES);
  assert.equal(telegramFileLimitBytes({ SOCIAL_TELEGRAM_MAX_BYTES: String(5 * 1024 ** 3) }), TELEGRAM_ANDROID_PREMIUM_MAX_BYTES);
  assert.equal(isWithinFileSizeLimit(16, 16), true);
  assert.equal(isWithinFileSizeLimit(17, 16), false);
  assert.equal(isWithinFileSizeLimit(Number.NaN, 16), false);
});

test('Instagram captions identify each part and point to its continuation', () => {
  const caption = socialClipCaption({
    clip: { kind: 'instagram-narrative-part', platforms: ['instagram'], partIndex: 1, partCount: 2, title: 'IA em duas partes' },
    title: 'IA em duas partes', hashtags: '#IA #Tecnologia', sourceUrl: 'https://example.test/video', platform: 'instagram'
  });
  assert.match(caption, /^Parte 1\/2/);
  assert.match(caption, /continuação está na Parte 2/);
  assert.match(caption, /Fonte: https:\/\/example\.test\/video/);
  assert.doesNotMatch(caption, /#shorts/);
});
