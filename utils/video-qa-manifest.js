'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { probeVideoHealth } = require('./ffmpeg');
const { countHookWords } = require('./hook-structure');
const { summarizeNarrationTimings, narrationProviderContinuity } = require('./narration-timing');
const { isPublicationEligible } = require('./publication-status');
const { hashSourceContext } = require('./source-evidence');

const NANO_BANANA_PRO_MODEL_ID = 'gemini-3-pro-image';

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', chunk => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function sha256StableRegularFile(filePath) {
  const before = await fsp.lstat(filePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('artifact is not a regular file');
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath, {
    flags: fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  });
  await new Promise((resolve, reject) => {
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  const after = await fsp.lstat(filePath, { bigint: true });
  if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
    || before.size !== after.size || before.mtimeNs !== after.mtimeNs) {
    throw new Error('artifact changed while its hash was being checked');
  }
  return { sha256: hash.digest('hex'), sizeBytes: Number(after.size) };
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function normalizeArtifactPath(root, filePath) {
  const absolutePath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
  if (!isWithin(path.join(root, 'data', 'videos'), absolutePath)) {
    throw new Error('artefato de QA fora do diretório gerenciado de vídeos');
  }
  return absolutePath;
}

function buildEditorialMetadata({
  themeId,
  topic,
  targetWords,
  formatId,
  formatVersion,
  scriptRevision,
  seed,
  hook,
  hookStructureId,
  experimentId,
  visualMode
} = {}) {
  const supportedVisualModes = new Set([
    'ai-generated-scenes',
    'mixed-generated-scenes',
    'graphics-and-source-prints',
    'narrative-episode-v1',
    'narrative-episode-v2',
    'approved-reference-v2'
  ]);
  return {
    themeId: String(themeId || ''),
    topic: String(topic || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    targetWords: Number.isSafeInteger(targetWords) && targetWords > 0 ? targetWords : null,
    formatId: String(formatId || 'unknown'),
    formatVersion: Number.isInteger(formatVersion) ? formatVersion : null,
    scriptRevision: String(scriptRevision || ''),
    seed: Number.isSafeInteger(seed) ? seed : null,
    hook: String(hook || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    hookStructureId: /^[a-z][a-z-]{0,47}$/.test(String(hookStructureId || '')) ? hookStructureId : null,
    hookWordCount: countHookWords(hook),
    experimentId: /^[A-Za-z0-9_-]{8,80}$/.test(String(experimentId || '')) ? experimentId : null,
    visualMode: supportedVisualModes.has(String(visualMode || '')) ? visualMode : 'unknown'
  };
}

function normalizeScenePlanEvidence(scenePlan) {
  if (scenePlan == null) return null;
  if (!scenePlan || scenePlan.schemaVersion !== 1
    || !/^[a-f0-9]{64}$/.test(String(scenePlan.sha256 || ''))
    || !Array.isArray(scenePlan.sceneIds) || scenePlan.sceneIds.length < 1 || scenePlan.sceneIds.length > 1000) {
    throw new TypeError('scene plan evidence is invalid');
  }
  const sceneIds = scenePlan.sceneIds.map(id => String(id));
  if (sceneIds.some(id => !/^[A-Za-z0-9_-]{1,96}$/.test(id)) || new Set(sceneIds).size !== sceneIds.length) {
    throw new TypeError('scene plan evidence has invalid or duplicate IDs');
  }
  const baseSha256 = scenePlan.baseSha256 || scenePlan.sha256;
  if (!/^[a-f0-9]{64}$/.test(String(baseSha256 || ''))) throw new TypeError('scene plan base hash is invalid');
  let rebuild = null;
  if (scenePlan.rebuild != null) {
    const candidate = scenePlan.rebuild;
    if (!/^[a-f0-9]{64}$/.test(String(candidate.sourceQaManifestSha256 || ''))
      || !/^[a-f0-9]{64}$/.test(String(candidate.critiqueManifestSha256 || ''))
      || !/^[a-f0-9]{64}$/.test(String(candidate.correctionSetSha256 || ''))
      || !/^[a-f0-9]{64}$/.test(String(candidate.sourceScenePlanSha256 || ''))
      || candidate.sourceScenePlanSha256 !== baseSha256
      || !Array.isArray(candidate.sceneIds) || !Number.isInteger(candidate.correctionsApplied)
      || candidate.correctionsApplied < 1 || candidate.correctionsApplied > 50) {
      throw new TypeError('scene plan rebuild provenance is invalid');
    }
    const rebuiltIds = [...new Set(candidate.sceneIds.map(String))];
    if (!rebuiltIds.length || rebuiltIds.some(id => !sceneIds.includes(id))) {
      throw new TypeError('scene plan rebuild contains unknown scene IDs');
    }
    rebuild = {
      sourceQaManifestSha256: candidate.sourceQaManifestSha256,
      critiqueManifestSha256: candidate.critiqueManifestSha256,
      correctionSetSha256: candidate.correctionSetSha256,
      sourceScenePlanSha256: candidate.sourceScenePlanSha256,
      sceneIds: rebuiltIds,
      correctionsApplied: candidate.correctionsApplied
    };
  }
  let visualRhythm = null;
  if (scenePlan.visualRhythm != null) {
    const rhythm = scenePlan.visualRhythm;
    if (rhythm.schemaVersion !== 1 || rhythm.rule !== 'long-cue-shot-variation-v1'
      || rhythm.status !== 'passed' || rhythm.planSha256 !== scenePlan.sha256) {
      throw new TypeError('scene plan visual rhythm evidence is invalid');
    }
    visualRhythm = { schemaVersion: 1, rule: rhythm.rule, status: rhythm.status, planSha256: rhythm.planSha256 };
  }
  return { schemaVersion: 1, sha256: scenePlan.sha256, baseSha256, sceneIds,
    ...(visualRhythm ? { visualRhythm } : {}), ...(rebuild ? { rebuild } : {}) };
}

function normalizeSceneReferences(sceneReferences) {
  if (sceneReferences == null) return null;
  if (!sceneReferences || typeof sceneReferences !== 'object' || Array.isArray(sceneReferences)
    || !Array.isArray(sceneReferences.newsItems) || sceneReferences.newsItems.length > 20
    || !Array.isArray(sceneReferences.prints) || sceneReferences.prints.length > 21) {
    throw new TypeError('scene reference replay data is invalid');
  }
  const text = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const newsItems = sceneReferences.newsItems.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('scene news item is invalid');
    return {
      title: text(item.title, 400),
      source: text(item.source, 160),
      time: text(item.time, 120),
      referenceLabel: text(item.referenceLabel, 160)
    };
  });
  let dataBytes = 0;
  const prints = sceneReferences.prints.map(item => {
    if (item == null) return null;
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.src !== 'string'
      || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(item.src)
      || item.src.length > 4_000_000) {
      throw new TypeError('scene print replay data is invalid');
    }
    dataBytes += Buffer.byteLength(item.src, 'utf8');
    return {
      src: item.src,
      source: text(item.source, 160),
      time: text(item.time, 120),
      title: text(item.title, 400),
      readingWords: Number.isSafeInteger(item.readingWords) && item.readingWords >= 0 ? item.readingWords : 0
    };
  });
  if (dataBytes > 24_000_000) throw new RangeError('scene print replay data exceeds 24 MB');
  return { schemaVersion: 1, newsItems, prints };
}

async function inspectNarrationAudio({ root, filePath, inputSha256 } = {}) {
  const projectRoot = path.resolve(root || path.join(__dirname, '..'));
  const absolutePath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(projectRoot, filePath || '');
  if (!isWithin(path.join(projectRoot, 'data', 'videos'), absolutePath)
    || !/^[a-f0-9]{64}$/.test(String(inputSha256 || ''))) {
    throw new Error('narration replay asset path or input hash is invalid');
  }
  const [lstat, realPath] = await Promise.all([fsp.lstat(absolutePath), fsp.realpath(absolutePath)]);
  if (!lstat.isFile() || lstat.isSymbolicLink() || !isWithin(path.join(projectRoot, 'data', 'videos'), realPath)) {
    throw new Error('narration replay asset is not a managed regular file');
  }
  const proof = await sha256StableRegularFile(absolutePath);
  if (proof.sizeBytes < 1000) throw new Error('narration replay asset is not a complete audio file');
  return {
    path: path.relative(projectRoot, realPath).split(path.sep).join('/'),
    sha256: proof.sha256,
    sizeBytes: proof.sizeBytes,
    inputSha256
  };
}

async function inspectScriptCache({ root, scriptCache } = {}) {
  if (!scriptCache || typeof scriptCache !== 'object' || Array.isArray(scriptCache)) return null;
  const projectRoot = path.resolve(root || path.join(__dirname, '..'));
  const scriptEntry = scriptCache.script || { path: scriptCache.path, sha256: scriptCache.sha256 };
  const metadataEntry = scriptCache.metadata || {
    path: scriptCache.metadataPath, sha256: scriptCache.metadataSha256
  };
  const read = async (filePath, expectedHash) => {
    const absolutePath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(projectRoot, filePath || '');
    const managed = path.join(projectRoot, 'data', 'scripts');
    if (!isWithin(managed, absolutePath) || (expectedHash != null && !/^[a-f0-9]{64}$/.test(String(expectedHash)))) {
      throw new Error('script replay asset path or hash is invalid');
    }
    const [lstat, realPath] = await Promise.all([fsp.lstat(absolutePath), fsp.realpath(absolutePath)]);
    if (!lstat.isFile() || lstat.isSymbolicLink() || !isWithin(managed, realPath)) {
      throw new Error('script replay asset is not a managed regular file');
    }
    const proof = await sha256StableRegularFile(absolutePath);
    if (expectedHash != null && proof.sha256 !== expectedHash) throw new Error('script replay asset hash changed');
    return { path: path.relative(projectRoot, realPath).split(path.sep).join('/'), sha256: proof.sha256 };
  };
  const [script, metadata] = await Promise.all([
    read(scriptEntry.path, scriptEntry.sha256),
    read(metadataEntry.path, metadataEntry.sha256)
  ]);
  return { script, metadata };
}

async function inspectSceneImageAssets({ root, assets } = {}) {
  if (assets == null) return null;
  if (!Array.isArray(assets) || assets.length > 120) throw new TypeError('scene image replay data is invalid');
  const projectRoot = path.resolve(root || path.join(__dirname, '..'));
  const managed = path.join(projectRoot, 'data', 'images');
  const seen = new Set();
  const result = [];
  for (const asset of assets) {
    const groupIndex = Number(asset?.groupIndex);
    const variant = String(asset?.variant || '');
    const absolutePath = path.isAbsolute(asset?.path) ? path.resolve(asset.path) : path.resolve(projectRoot, asset?.path || '');
    const key = `${groupIndex}:${variant}`;
    if (!Number.isInteger(groupIndex) || groupIndex < 0 || groupIndex > 20 || !/^[a-f]$/.test(variant)
      || seen.has(key) || !isWithin(managed, absolutePath)) throw new TypeError('scene image replay asset is invalid');
    seen.add(key);
    const [lstat, realPath] = await Promise.all([fsp.lstat(absolutePath), fsp.realpath(absolutePath)]);
    if (!lstat.isFile() || lstat.isSymbolicLink() || !isWithin(managed, realPath)) {
      throw new Error('scene image replay asset is not a managed regular file');
    }
    const proof = await sha256StableRegularFile(absolutePath);
    if (proof.sha256 !== asset.sha256) throw new Error('scene image replay asset hash changed');
    if (asset.beatSha256 != null && !/^[a-f0-9]{64}$/.test(String(asset.beatSha256))) throw new TypeError('scene image beat hash is invalid');
    result.push({ groupIndex, variant, path: path.relative(projectRoot, realPath).split(path.sep).join('/'), sha256: proof.sha256,
      ...(asset.beatSha256 ? { beatSha256: asset.beatSha256 } : {}) });
  }
  return result;
}

function normalizeReplaySourceContext(value, expectedHash) {
  if (typeof value !== 'string' || value.length > 16000) throw new TypeError('source replay context is invalid');
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (hashSourceContext(normalized) !== expectedHash) throw new Error('source replay context hash does not match source review');
  return normalized;
}

async function inspectArtifact({ root, filePath, role, platforms = [] }) {
  const absolutePath = normalizeArtifactPath(root, filePath);
  const realPath = await fsp.realpath(absolutePath);
  if (!isWithin(path.join(root, 'data', 'videos'), realPath)) {
    throw new Error('artefato de QA resolve para fora do diretório gerenciado');
  }
  const stat = await fsp.stat(realPath);
  if (!stat.isFile()) throw new Error('artefato de QA não é arquivo regular');
  const technical = await probeVideoHealth(realPath);
  return {
    role,
    path: path.relative(root, realPath),
    sha256: await sha256File(realPath),
    sizeBytes: stat.size,
    durationSeconds: technical.duration,
    technical: {
      status: technical.ok ? 'passed' : 'failed',
      checks: {
        readableDuration: Number.isFinite(technical.duration),
        durationInRange: Number.isFinite(technical.duration) && technical.duration >= 15 && technical.duration <= 1800,
        audioTrack: !technical.issues.some(issue => issue.includes('nenhuma trilha de áudio')),
        minimumFileSize: stat.size >= 50 * 1024
      },
      issues: technical.issues
    },
    ...(platforms.length ? { platforms: [...new Set(platforms.map(value => String(value).toLowerCase()))] } : {})
  };
}

async function inspectThumbnailArtifact({ root, filePath, variant = 'landscape' }) {
  const absolutePath = normalizeArtifactPath(root, filePath);
  const realPath = await fsp.realpath(absolutePath);
  if (!isWithin(path.join(root, 'data', 'videos'), realPath)) {
    throw new Error('thumbnail resolves outside managed media');
  }
  const stat = await fsp.stat(realPath);
  if (!stat.isFile()) throw new Error('thumbnail is not a regular file');
  const metadata = await sharp(realPath).metadata();
  const expected = variant === 'portrait' ? { width: 1080, height: 1920 } : { width: 1280, height: 720 };
  if (metadata.format !== 'png' || metadata.width !== expected.width || metadata.height !== expected.height) {
    throw new Error(`thumbnail must be a ${expected.width}x${expected.height} PNG`);
  }
  return {
    path: path.relative(root, realPath),
    sha256: await sha256File(realPath),
    sizeBytes: stat.size,
    format: metadata.format,
    width: metadata.width,
    height: metadata.height
  };
}

async function inspectThumbnailArtProvenance({ root, value }) {
  if (!value || value.modelId !== NANO_BANANA_PRO_MODEL_ID || value.modelName !== 'Nano Banana Pro'
    || !value.landscape || !value.portrait) throw new TypeError('Nano Banana Pro cover provenance is incomplete');
  const inspectVariant = async (candidate, aspectRatio) => {
    if (!candidate || candidate.aspectRatio !== aspectRatio
      || !/^[a-f0-9]{64}$/i.test(String(candidate.promptSha256 || ''))
      || !/^[a-f0-9]{64}$/i.test(String(candidate.imageSha256 || ''))
      || typeof candidate.imagePath !== 'string' || !['gemini-web', 'gemini-android'].includes(candidate.provider)
      || candidate.modelVerification !== 'requested-not-verified') {
      throw new TypeError('Nano Banana Pro cover variant metadata is invalid');
    }
    const imagePath = path.resolve(root, candidate.imagePath);
    if (!isWithin(path.join(root, 'data', 'images'), imagePath)) throw new Error('cover art path is outside managed images');
    const realPath = await fsp.realpath(imagePath);
    const lstat = await fsp.lstat(imagePath);
    if (!lstat.isFile() || lstat.isSymbolicLink()
      || !isWithin(path.join(root, 'data', 'images'), realPath)) throw new Error('cover art is not a managed regular file');
    const proof = await sha256StableRegularFile(imagePath);
    if (proof.sha256 !== candidate.imageSha256) throw new Error('cover art source hash changed');
    const metadata = await sharp(realPath).metadata();
    const expectedRatio = aspectRatio === '9:16' ? 9 / 16 : 16 / 9;
    if (!metadata.width || !metadata.height
      || Math.abs((metadata.width / metadata.height) - expectedRatio) / expectedRatio > 0.04
      || metadata.width !== candidate.width || metadata.height !== candidate.height) {
      throw new Error('cover art source aspect ratio or dimensions changed');
    }
    return {
      provider: candidate.provider,
      modelVerification: candidate.modelVerification,
      selectedMode: String(candidate.selectedMode).slice(0, 200),
      aspectRatio,
      imagePath: path.relative(root, realPath),
      imageSha256: proof.sha256,
      promptSha256: candidate.promptSha256,
      width: metadata.width,
      height: metadata.height
    };
  };

  return {
    modelId: NANO_BANANA_PRO_MODEL_ID,
    modelName: 'Nano Banana Pro',
    landscape: await inspectVariant(value.landscape, '16:9'),
    portrait: await inspectVariant(value.portrait, '9:16')
  };
}

async function writeVideoQaManifest({
  root,
  videoPath,
  relatedMasters = [],
  clips = [],
  videoId,
  jobId,
  themeId,
  topic,
  targetWords,
  formatId,
  formatVersion,
  scriptRevision,
  seed,
  hook,
  hookStructureId,
  narrationTimings,
  thumbnailPath,
  portraitThumbnailPath,
  thumbnailSource = null,
  thumbnailArtProvenance = null,
  sourceEvidence,
  sourceName = '',
  sourceTimeLabel = '',
  narrationAudio = null,
  sourceContext = null,
  scriptCache = null,
  sceneImageAssets = null,
  sceneReferences = null,
  publicationReview,
  renderer = null,
  experimentId = null,
  visualMode = null,
  scenePlan = null
} = {}) {
  const projectRoot = path.resolve(root || path.join(__dirname, '..'));
  if (!/^vid_[a-f0-9]{24}$/.test(String(videoId || ''))) throw new TypeError('videoId inválido para manifesto QA');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(String(jobId || ''))) throw new TypeError('jobId inválido para manifesto QA');
  const assets = [await inspectArtifact({ root: projectRoot, filePath: videoPath, role: 'master' })];
  for (const master of relatedMasters) {
    if (!master || typeof master.path !== 'string') continue;
    assets.push(await inspectArtifact({
      root: projectRoot,
      filePath: master.path,
      role: String(master.role || 'related_master').slice(0, 40)
    }));
  }
  for (const clip of clips) {
    if (!clip || typeof clip.path !== 'string') continue;
    assets.push(await inspectArtifact({
      root: projectRoot,
      filePath: clip.path,
      role: 'social_part',
      platforms: Array.isArray(clip.platforms) ? clip.platforms : []
    }));
  }
  const thumbnail = typeof thumbnailPath === 'string' && thumbnailPath
    ? await inspectThumbnailArtifact({ root: projectRoot, filePath: thumbnailPath })
    : null;
  const portraitThumbnail = typeof portraitThumbnailPath === 'string' && portraitThumbnailPath
    ? await inspectThumbnailArtifact({ root: projectRoot, filePath: portraitThumbnailPath, variant: 'portrait' })
    : null;
  const thumbnailArt = thumbnailArtProvenance
    ? await inspectThumbnailArtProvenance({ root: projectRoot, value: thumbnailArtProvenance })
    : null;
  if (thumbnailArt && (!thumbnail || !portraitThumbnail)) {
    throw new Error('Nano Banana Pro source art requires both rendered cover formats');
  }
  if (thumbnailSource) {
    if (!/^https:\/\//.test(String(thumbnailSource.articleUrl || ''))
      || !/^https:\/\//.test(String(thumbnailSource.imageUrl || ''))
      || !/^[a-f0-9]{64}$/.test(String(thumbnailSource.imageSha256 || ''))
      || typeof thumbnailSource.imagePath !== 'string') throw new TypeError('origem da imagem da capa inválida');
    const sourcePath = path.resolve(projectRoot, thumbnailSource.imagePath);
    if (!isWithin(path.join(projectRoot, 'data', 'images'), sourcePath)
      || !isWithin(path.join(projectRoot, 'data', 'images'), await fsp.realpath(sourcePath))
      || (await sha256StableRegularFile(sourcePath)).sha256 !== thumbnailSource.imageSha256) {
      throw new Error('imagem de origem da capa ausente ou alterada');
    }
  }
  const replayAudio = narrationAudio ? await inspectNarrationAudio({
    root: projectRoot, filePath: narrationAudio.path, inputSha256: narrationAudio.inputSha256
  }) : null;
  const replayScriptCache = scriptCache ? await inspectScriptCache({ root: projectRoot, scriptCache }) : null;
  const replaySceneImages = await inspectSceneImageAssets({ root: projectRoot, assets: sceneImageAssets });
  const replayReferences = normalizeSceneReferences(sceneReferences);
  const replaySourceContext = sourceContext == null ? null
    : normalizeReplaySourceContext(sourceContext, sourceEvidence?.contextHash);
  const narrationTiming = summarizeNarrationTimings(narrationTimings);
  const narrationContinuityPassed = !Array.isArray(narrationTimings)
    || narrationTiming.voiceContinuity.status === 'consistent';
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    videoId,
    jobId,
    ...(typeof renderer === 'string' && renderer.trim() ? { renderer: renderer.trim().slice(0, 160) } : {}),
    editorial: buildEditorialMetadata({
      themeId, topic, targetWords, formatId, formatVersion, scriptRevision, seed, hook, hookStructureId, experimentId, visualMode
    }),
    ...(scenePlan ? { scenePlan: normalizeScenePlanEvidence(scenePlan) } : {}),
    ...(replayAudio ? { narrationAudio: replayAudio } : {}),
    ...(replayScriptCache ? { scriptCache: replayScriptCache } : {}),
    ...(replaySceneImages ? { sceneImageAssets: replaySceneImages } : {}),
    ...(replayReferences ? { sceneReferences: replayReferences } : {}),
    narrationTiming,
    sourceReview: {
      sourceHash: /^[a-f0-9]{64}$/i.test(String(sourceEvidence?.contextHash || '')) ? sourceEvidence.contextHash : null,
      ...(replaySourceContext !== null ? { sourceContext: replaySourceContext } : {}),
      sourceTitle: String(sourceEvidence?.sourceTitle || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      sourceUrl: /^https?:\/\//i.test(String(sourceEvidence?.sourceUrl || '')) ? String(sourceEvidence.sourceUrl).trim().slice(0, 2048) : null,
      sourceName: String(sourceName || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      sourceTimeLabel: String(sourceTimeLabel || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      factualReviewStatus: String(publicationReview?.status || 'unavailable'),
      reviewer: String(publicationReview?.reviewer || '').slice(0, 120)
    },
    visualReview: {
      status: 'pending',
      note: 'O manifesto vincula master, cortes e capas horizontal/vertical por hash; não declara aprovação estética humana.'
    },
    technicalStatus: assets.every(asset => asset.technical.status === 'passed') && narrationContinuityPassed
      ? 'passed' : 'failed',
    assets,
    thumbnail,
    ...(thumbnailArt ? { thumbnailArt } : {}),
    ...(thumbnailSource ? { thumbnailSource } : {}),
    ...(portraitThumbnail ? {
      portraitThumbnail,
      coverVariants: { schemaVersion: 1, requiredFormats: [...(thumbnail ? ['16:9'] : []), '9:16'] }
    } : {})
  };
  const directory = path.join(projectRoot, 'data', 'reports', 'qa');
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const manifestPath = path.join(directory, `${videoId}.json`);
  const temporaryPath = `${manifestPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await fsp.rename(temporaryPath, manifestPath);
  } catch (error) {
    await fsp.unlink(temporaryPath).catch(() => {});
    throw error;
  }
  return {
    manifest,
    manifestPath: path.relative(projectRoot, manifestPath),
    manifestSha256: await sha256File(manifestPath)
  };
}

async function verifyVideoQaManifest({
  root,
  manifestPath,
  manifestSha256,
  expectedPaths = [],
  allowMissingManifestAssets = false,
  allowAdditionalManifestAssets = false,
  allowMissingThumbnail = false
} = {}) {
  const projectRoot = path.resolve(root || path.join(__dirname, '..'));
  const resolvedManifestPath = path.isAbsolute(manifestPath)
    ? path.resolve(manifestPath)
    : path.resolve(projectRoot, manifestPath || '');
  if (!isWithin(path.join(projectRoot, 'data', 'reports', 'qa'), resolvedManifestPath)) {
    return { status: 'invalid_manifest_path', reason: 'manifest_path_outside_qa_directory' };
  }
  let manifest;
  let manifestBytes;
  try {
    const realManifestPath = await fsp.realpath(resolvedManifestPath);
    if (!isWithin(path.join(projectRoot, 'data', 'reports', 'qa'), realManifestPath)) {
      return { status: 'invalid_manifest_path', reason: 'manifest_resolves_outside_qa_directory' };
    }
    manifestBytes = await fsp.readFile(resolvedManifestPath);
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  }
  catch (error) {
    return { status: error.code === 'ENOENT' ? 'missing' : 'invalid', reason: error.code || 'invalid_json' };
  }
  if (manifestSha256 && crypto.createHash('sha256').update(manifestBytes).digest('hex') !== manifestSha256) {
    return { status: 'mismatch', reason: 'manifest_hash_changed' };
  }
  let verifiedThumbnailArt = null;
  if (manifest.thumbnailArt != null) {
    try {
      verifiedThumbnailArt = await inspectThumbnailArtProvenance({ root: projectRoot, value: manifest.thumbnailArt });
      if (!manifest.thumbnail || !manifest.portraitThumbnail) {
        return { status: 'invalid', reason: 'nano_banana_pro_cover_pair_missing' };
      }
    } catch {
      return { status: 'invalid', reason: 'nano_banana_pro_cover_provenance_invalid' };
    }
  }
  if (manifest.narrationTiming && Number(manifest.narrationTiming.groupCount) > 0) {
    const continuity = narrationProviderContinuity(manifest.narrationTiming);
    if (continuity.status !== 'consistent') {
      return {
        status: 'invalid',
        reason: continuity.status === 'mixed' ? 'narration_provider_mix' : 'narration_provider_unverified'
      };
    }
  }
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets) || manifest.technicalStatus !== 'passed') {
    return { status: 'invalid', reason: 'manifest_contract_or_technical_status_invalid' };
  }
  let scenePlanEvidence = null;
  try {
    scenePlanEvidence = normalizeScenePlanEvidence(manifest.scenePlan);
  } catch {
    return { status: 'invalid', reason: 'scene_plan_invalid' };
  }
  const expected = expectedPaths.map(filePath => path.resolve(projectRoot, filePath));
  const expectedSet = new Set(expected);
  const recorded = manifest.assets.map(asset => path.resolve(projectRoot, asset.path));
  if (expected.length && (expected.some(filePath => !recorded.includes(filePath))
    || (!allowMissingManifestAssets && !allowAdditionalManifestAssets && expected.length !== recorded.length))) {
    return { status: 'mismatch', reason: 'asset_set_changed' };
  }
  const prunedAssetPaths = new Set();
  if (allowMissingManifestAssets && expected.length) {
    for (const recordedPath of recorded) {
      if (expectedSet.has(recordedPath)) continue;
      try {
        await fsp.lstat(recordedPath);
        return { status: 'mismatch', reason: 'asset_set_changed' };
      } catch (error) {
        if (error.code !== 'ENOENT') return { status: 'mismatch', reason: 'asset_unreadable' };
        prunedAssetPaths.add(recordedPath);
      }
    }
  }
  const assetsToVerify = allowMissingManifestAssets && expected.length
    ? manifest.assets.filter(asset => expectedSet.has(path.resolve(projectRoot, asset.path)))
    : manifest.assets;
  for (const asset of assetsToVerify) {
    const mediaRoot = path.join(projectRoot, 'data', 'videos');
    const assetPath = path.resolve(projectRoot, asset.path);
    if (!isWithin(mediaRoot, assetPath)) {
      return { status: 'invalid', reason: 'asset_path_outside_managed_media' };
    }
    let currentHash;
    try {
      const realAssetPath = await fsp.realpath(assetPath);
      if (!isWithin(mediaRoot, realAssetPath) || !(await fsp.lstat(assetPath)).isFile()) {
        return { status: 'invalid', reason: 'asset_resolves_outside_managed_media' };
      }
      currentHash = await sha256File(realAssetPath);
    }
    catch (error) { return { status: 'mismatch', reason: error.code === 'ENOENT' ? 'asset_missing' : 'asset_unreadable' }; }
    if (currentHash !== asset.sha256) return { status: 'mismatch', reason: 'asset_hash_changed' };
  }
  let verifiedThumbnail = null;
  if (manifest.thumbnail != null) {
    const thumbnail = manifest.thumbnail;
    if (!thumbnail || typeof thumbnail.path !== 'string' || !/^[a-f0-9]{64}$/i.test(String(thumbnail.sha256 || ''))) {
      return { status: 'invalid', reason: 'thumbnail_contract_invalid' };
    }
    let thumbnailPath;
    try {
      thumbnailPath = normalizeArtifactPath(projectRoot, thumbnail.path);
      const realThumbnailPath = await fsp.realpath(thumbnailPath);
      if (!isWithin(path.join(projectRoot, 'data', 'videos'), realThumbnailPath)
        || !(await fsp.lstat(thumbnailPath)).isFile()) {
        return { status: 'invalid', reason: 'thumbnail_resolves_outside_managed_media' };
      }
      const stat = await fsp.stat(realThumbnailPath);
      if (stat.size !== thumbnail.sizeBytes) return { status: 'mismatch', reason: 'thumbnail_size_changed' };
      const metadata = await sharp(realThumbnailPath).metadata();
      if (metadata.format !== 'png' || metadata.width !== 1280 || metadata.height !== 720
        || thumbnail.format !== metadata.format || thumbnail.width !== metadata.width || thumbnail.height !== metadata.height) {
        return { status: 'mismatch', reason: 'thumbnail_contract_changed' };
      }
      const currentHash = await sha256File(realThumbnailPath);
      if (currentHash !== thumbnail.sha256) return { status: 'mismatch', reason: 'thumbnail_hash_changed' };
      verifiedThumbnail = {
        path: realThumbnailPath,
        sha256: currentHash,
        sizeBytes: stat.size,
        format: metadata.format,
        width: metadata.width,
        height: metadata.height
      };
    } catch (error) {
      if (error.code === 'ENOENT' && allowMissingThumbnail) {
        verifiedThumbnail = null;
      } else {
        return { status: error.code === 'ENOENT' ? 'mismatch' : 'invalid', reason: error.code === 'ENOENT' ? 'thumbnail_missing' : 'thumbnail_unreadable' };
      }
    }
  }
  let verifiedPortraitThumbnail = null;
  if (manifest.portraitThumbnail != null) {
    const thumbnail = manifest.portraitThumbnail;
    if (!thumbnail || typeof thumbnail.path !== 'string' || !/^[a-f0-9]{64}$/i.test(String(thumbnail.sha256 || ''))) {
      return { status: 'invalid', reason: 'portrait_thumbnail_contract_invalid' };
    }
    let thumbnailPath;
    try {
      thumbnailPath = normalizeArtifactPath(projectRoot, thumbnail.path);
      const realThumbnailPath = await fsp.realpath(thumbnailPath);
      if (!isWithin(path.join(projectRoot, 'data', 'videos'), realThumbnailPath)
        || !(await fsp.lstat(thumbnailPath)).isFile()) {
        return { status: 'invalid', reason: 'portrait_thumbnail_resolves_outside_managed_media' };
      }
      const stat = await fsp.stat(realThumbnailPath);
      if (stat.size !== thumbnail.sizeBytes) return { status: 'mismatch', reason: 'portrait_thumbnail_size_changed' };
      const metadata = await sharp(realThumbnailPath).metadata();
      if (metadata.format !== 'png' || metadata.width !== 1080 || metadata.height !== 1920
        || thumbnail.format !== metadata.format || thumbnail.width !== metadata.width || thumbnail.height !== metadata.height) {
        return { status: 'mismatch', reason: 'portrait_thumbnail_contract_changed' };
      }
      const currentHash = await sha256File(realThumbnailPath);
      if (currentHash !== thumbnail.sha256) return { status: 'mismatch', reason: 'portrait_thumbnail_hash_changed' };
      verifiedPortraitThumbnail = {
        path: realThumbnailPath,
        sha256: currentHash,
        sizeBytes: stat.size,
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        variant: 'portrait'
      };
    } catch (error) {
      if (error.code === 'ENOENT' && allowMissingThumbnail) {
        verifiedPortraitThumbnail = null;
      } else {
        return { status: error.code === 'ENOENT' ? 'mismatch' : 'invalid', reason: error.code === 'ENOENT' ? 'portrait_thumbnail_missing' : 'portrait_thumbnail_unreadable' };
      }
    }
  }
  const requiredCoverFormats = Array.isArray(manifest.coverVariants?.requiredFormats)
    ? manifest.coverVariants.requiredFormats : [];
  if (manifest.coverVariants != null) {
    const expectedCoverFormats = [
      ...(manifest.thumbnail != null ? ['16:9'] : []),
      ...(manifest.portraitThumbnail != null ? ['9:16'] : [])
    ];
    const declared = [...requiredCoverFormats].sort();
    if (manifest.coverVariants.schemaVersion !== 1 || !Array.isArray(manifest.coverVariants.requiredFormats)
      || declared.some((format, index) => !['16:9', '9:16'].includes(format)
        || (index > 0 && format === declared[index - 1]))
      || declared.join(',') !== [...expectedCoverFormats].sort().join(',')) {
      return { status: 'invalid', reason: 'cover_variants_contract_invalid' };
    }
  }
  if (requiredCoverFormats.includes('16:9') && !manifest.thumbnail) {
    return { status: 'invalid', reason: 'required_landscape_thumbnail_missing' };
  }
  if (requiredCoverFormats.includes('9:16') && !manifest.portraitThumbnail) {
    return { status: 'invalid', reason: 'required_portrait_thumbnail_missing' };
  }
  const explicitVisualScope = Array.isArray(manifest.visualReview?.approvedAssets);
  const visualReviewAssets = explicitVisualScope ? [] : null;
  let visualReviewScopeInvalid = false;
  if (explicitVisualScope) {
    for (const reviewed of manifest.visualReview.approvedAssets) {
      if (!reviewed || typeof reviewed.path !== 'string' || !/^[a-f0-9]{64}$/i.test(String(reviewed.sha256 || ''))) {
        visualReviewScopeInvalid = true;
        continue;
      }
      const reviewedPath = path.resolve(projectRoot, reviewed.path);
      const asset = assetsToVerify.find(item => path.resolve(projectRoot, item.path) === reviewedPath);
      const isThumbnail = verifiedThumbnail && verifiedThumbnail.path === reviewedPath;
      const isPortraitThumbnail = verifiedPortraitThumbnail && verifiedPortraitThumbnail.path === reviewedPath;
      if (prunedAssetPaths.has(reviewedPath)
        || (allowMissingThumbnail && !verifiedThumbnail && manifest.thumbnail
          && path.resolve(projectRoot, manifest.thumbnail.path) === reviewedPath)
        || (allowMissingThumbnail && !verifiedPortraitThumbnail && manifest.portraitThumbnail
          && path.resolve(projectRoot, manifest.portraitThumbnail.path) === reviewedPath)) continue;
      const reviewedSha256 = asset?.sha256 || (isThumbnail ? verifiedThumbnail.sha256 : null)
        || (isPortraitThumbnail ? verifiedPortraitThumbnail.sha256 : null);
      if (!reviewedSha256 || reviewedSha256 !== reviewed.sha256) {
        visualReviewScopeInvalid = true;
        continue;
      }
      visualReviewAssets.push({ path: reviewedPath, sha256: reviewedSha256 });
    }
  }
  const masterAsset = manifest.assets.find(asset => asset.role === 'master');
  return {
    status: 'verified',
    visualReview: manifest.visualReview?.status || 'unrecorded',
    visualReviewAssets,
    visualReviewScopeInvalid,
    videoId: manifest.videoId,
    masterPath: masterAsset ? path.resolve(projectRoot, masterAsset.path) : null,
    thumbnail: verifiedThumbnail,
    portraitThumbnail: verifiedPortraitThumbnail,
    thumbnailArt: verifiedThumbnailArt,
    coverVariants: { requiredFormats: requiredCoverFormats },
    formatId: manifest.editorial?.formatId || 'unknown',
    scriptRevision: manifest.editorial?.scriptRevision || null,
    renderer: manifest.renderer || null,
    factualReviewStatus: manifest.sourceReview?.factualReviewStatus || 'unavailable',
    reviewer: manifest.sourceReview?.reviewer || null,
    sourceHash: manifest.sourceReview?.sourceHash || null,
    visualMode: manifest.editorial?.visualMode || 'unknown',
    scenePlan: scenePlanEvidence,
    assets: manifest.assets.length,
    assetProofs: manifest.assets.map(asset => ({
      role: asset.role || null,
      path: path.resolve(projectRoot, asset.path),
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes
    }))
  };
}

async function verifyPublicationAssetBinding({ root, entry, artifactPath, expectedSha256 } = {}) {
  const projectRoot = path.resolve(root || path.join(__dirname, '..'));
  const resolvedArtifactPath = path.resolve(projectRoot, artifactPath || '');
  const qaRoot = path.join(projectRoot, 'data', 'reports', 'qa');
  if (!/^[a-f0-9]{64}$/i.test(String(expectedSha256 || ''))
    || !isWithin(path.join(projectRoot, 'data', 'videos'), resolvedArtifactPath)) {
    return { status: 'invalid', reason: 'artifact_hash_or_path_invalid' };
  }
  if (!isPublicationEligible(entry)) return { status: 'ineligible', reason: 'publication_eligibility_not_current' };
  if (typeof entry.qaManifestPath !== 'string' || !entry.qaManifestPath.trim()
    || !/^[a-f0-9]{64}$/i.test(String(entry.qaManifestSha256 || ''))) {
    return { status: 'missing', reason: 'hash_bound_manifest_reference_missing' };
  }

  const manifestPath = path.isAbsolute(entry.qaManifestPath)
    ? path.resolve(entry.qaManifestPath)
    : path.resolve(projectRoot, entry.qaManifestPath);
  if (!isWithin(qaRoot, manifestPath)) return { status: 'invalid', reason: 'manifest_path_outside_qa_directory' };
  let bytes;
  let manifest;
  try {
    const realManifestPath = await fsp.realpath(manifestPath);
    if (!isWithin(qaRoot, realManifestPath)) return { status: 'invalid', reason: 'manifest_resolves_outside_qa_directory' };
    bytes = await fsp.readFile(realManifestPath);
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'missing' : 'invalid', reason: error.code || 'invalid_manifest' };
  }
  const manifestSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (manifestSha256 !== entry.qaManifestSha256) return { status: 'mismatch', reason: 'manifest_hash_changed' };
  if (manifest.schemaVersion !== 1 || manifest.technicalStatus !== 'passed'
    || manifest.sourceReview?.factualReviewStatus !== 'approved'
    || manifest.sourceReview?.sourceHash !== entry.sourceEvidence?.contextHash
    || manifest.visualReview?.status !== 'approved'
    || !Array.isArray(manifest.visualReview?.approvedAssets)) {
    return { status: 'unapproved', reason: 'manifest_review_or_technical_gate_incomplete' };
  }

  const asset = manifest.assets?.find(candidate => path.resolve(projectRoot, candidate.path) === resolvedArtifactPath);
  if (!asset) return { status: 'mismatch', reason: 'asset_missing_from_manifest' };
  if (asset.sha256 !== expectedSha256) return { status: 'mismatch', reason: 'asset_hash_changed' };
  const visualApproval = manifest.visualReview.approvedAssets.some(candidate => candidate
    && path.resolve(projectRoot, candidate.path) === resolvedArtifactPath
    && candidate.sha256 === expectedSha256);
  if (!visualApproval) return { status: 'unapproved', reason: 'visual_asset_not_approved' };
  return {
    status: 'verified',
    manifestSha256,
    artifactSha256: asset.sha256,
    role: asset.role || null
  };
}

async function verifyArtifactOwnersForPublication({ root, entries = [], artifactPath, expectedSha256 } = {}) {
  const projectRoot = path.resolve(root || path.join(__dirname, '..'));
  const target = path.isAbsolute(artifactPath || '')
    ? path.resolve(artifactPath) : path.resolve(projectRoot, artifactPath || '');
  const samePath = candidate => typeof candidate === 'string'
    && (path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(projectRoot, candidate)) === target;
  const owners = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (samePath(entry.videoPath) || (Array.isArray(entry.clips) && entry.clips.some(clip =>
      samePath(typeof clip === 'string' ? clip : clip?.path)))) owners.push(entry);
  }
  if (!owners.length) return { status: 'missing', reason: 'artifact_has_no_ledger_owner', owners: 0 };
  for (const entry of owners) {
    const binding = await verifyPublicationAssetBinding({
      root: projectRoot,
      entry,
      artifactPath: target,
      expectedSha256
    });
    if (binding.status !== 'verified') {
      return { ...binding, owners: owners.length, jobId: entry.jobId || null };
    }
  }
  return { status: 'verified', owners: owners.length, artifactSha256: expectedSha256 };
}

module.exports = {
  buildEditorialMetadata,
  normalizeSceneReferences,
  inspectNarrationAudio,
  inspectScriptCache,
  inspectSceneImageAssets,
  normalizeReplaySourceContext,
  normalizeScenePlanEvidence,
  inspectThumbnailArtifact,
  sha256File,
  sha256StableRegularFile,
  verifyPublicationAssetBinding,
  verifyArtifactOwnersForPublication,
  writeVideoQaManifest,
  verifyVideoQaManifest
};
