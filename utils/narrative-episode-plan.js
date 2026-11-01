'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { extractSpeechEnvelope } = require('./speech-envelope');
const { normalizeIllustrations } = require('./narrative-illustration-plan');
const { cueHasLongBeatVariation, cueRequiresPairedVisual, validateCueVisualGrounding } = require('./narrative-visual-semantics');
const { narrativeBeatSha256 } = require('./scene-image-prompt');
const { narrativeBeatRelation } = require('./narrative-beat-relation');
const { resolveHumanActor } = require('./narrative-human-actors');

const SCHEMA_VERSION = 'pulso.narrative-episode/v2';
const ACTION_KINDS = new Set(['travel', 'reveal-part', 'transform', 'rearrange', 'compare']);
const CAMERA_KINDS = new Set(['wide', 'detail', 'follow', 'result']);
const OBJECT_KINDS = new Set([
  'device', 'document', 'person', 'map', 'chart', 'product', 'token', 'vehicle',
  'building', 'nature', 'cell', 'network', 'step', 'number'
]);
const ROOT = path.resolve(__dirname, '..');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function cleanText(value, limit = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function planInputProjection(plan) {
  return {
    schemaVersion: plan.schemaVersion, jobId: plan.jobId, themeId: plan.themeId,
    scriptSha256: plan.scriptSha256, narrationSha256: plan.narrationSha256,
    source: plan.source, fps: plan.fps, durationMs: plan.durationMs,
    seed: plan.seed, speechEnvelopeSha256: plan.speechEnvelopeSha256,
    chapters: plan.chapters, sentences: plan.sentences, claims: plan.claims, assets: plan.assets
  };
}

function narrativePlanInputSha256(plan) {
  return sha256(Buffer.from(stableJson(planInputProjection(plan))));
}

function narrationGroups(script) {
  const sections = script?.mainContent?.sections || script?.sections || [];
  return [
    { id: 'hook', kind: 'hook', title: cleanText(script?.title || 'Abertura'), text: cleanText(script?.hook?.text || script?.hook, Infinity) },
    ...sections.map((section, index) => ({
      id: `section-${index + 1}`, kind: 'section', title: cleanText(section?.title || `Parte ${index + 1}`),
      text: cleanText(section?.content, Infinity)
    })),
    { id: 'conclusion', kind: 'conclusion', title: 'Conclusão',
      text: cleanText(script?.conclusion?.finalThought || script?.conclusion, Infinity) }
  ].filter(group => group.text);
}

function toFrame(ms, fps, mode = 'start') {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.max(0, mode === 'end' ? Math.ceil(value * fps / 1000) : Math.floor(value * fps / 1000));
}

function buildTimedNarration(script, timings, fps, durationMs) {
  const groups = narrationGroups(script);
  if (!Array.isArray(timings) || timings.length !== groups.length) {
    throw new Error(`timings TTS divergentes: esperado ${groups.length}, recebido ${timings?.length || 0}`);
  }
  const sentences = [];
  const chapters = [];
  groups.forEach((group, groupIndex) => {
    const timing = timings[groupIndex];
    const offsetMs = Number(timing?.audioOffsetMs);
    const groupDurationMs = Number(timing?.durationMs);
    const timedText = (timing?.sentences || []).map(sentence => cleanText(sentence?.text, Infinity)).filter(Boolean).join(' ');
    if (timedText.replace(/\s+/g, ' ').trim() !== group.text.replace(/\s+/g, ' ').trim()) {
      throw new Error(`frases temporizadas não correspondem ao roteiro em ${group.id}`);
    }
    if (!Number.isFinite(offsetMs) || offsetMs < 0 || !Number.isFinite(groupDurationMs) || groupDurationMs <= 0) {
      throw new Error(`timing TTS inválido no grupo ${group.id}`);
    }
    const startFrame = toFrame(offsetMs, fps);
    const endFrame = toFrame(Math.min(durationMs, offsetMs + groupDurationMs), fps, 'end');
    const sentenceRefs = [];
    for (const [sentenceIndex, item] of (timing.sentences || []).entries()) {
      const startMs = offsetMs + Number(item.startMs);
      const rawEndMs = offsetMs + Number(item.endMs);
      const endMs = Math.min(durationMs, rawEndMs);
      const sentenceStartFrame = toFrame(startMs, fps);
      const sentenceEndFrame = toFrame(endMs, fps, 'end');
      const expectedText = cleanText(item.text, Infinity);
      if (!expectedText || sentenceStartFrame === null || sentenceEndFrame === null
        || sentenceEndFrame <= sentenceStartFrame || rawEndMs > durationMs + 80) {
        throw new Error(`frase/tempo TTS inválido em ${group.id}, frase ${sentenceIndex + 1}`);
      }
      const id = `${group.id}-sentence-${sentenceIndex + 1}`;
      const words = Array.isArray(item.words) ? item.words.map(String) : expectedText.split(/\s+/).filter(Boolean);
      const wordStarts = Array.isArray(item.wordTimes) && item.wordTimes.length === words.length ? item.wordTimes : null;
      const wordEnds = Array.isArray(item.wordEndTimes) && item.wordEndTimes.length === words.length ? item.wordEndTimes : null;
      const wordTimings = wordStarts && wordEnds ? words.map((text, wordIndex) => {
        const wordStartFrame = toFrame(startMs + Number(wordStarts[wordIndex]), fps);
        const wordEndFrame = toFrame(startMs + Number(wordEnds[wordIndex]), fps, 'end');
        if (wordStartFrame === null || wordEndFrame === null || wordEndFrame <= wordStartFrame) {
          throw new Error(`limite de palavra TTS inválido em ${group.id}, frase ${sentenceIndex + 1}`);
        }
        return { text, startFrame: wordStartFrame, endFrame: wordEndFrame };
      }) : [];
      const sentence = {
        id, groupId: group.id, groupIndex, sentenceIndex, text: expectedText,
        startFrame: sentenceStartFrame, endFrame: sentenceEndFrame,
        wordTimings
      };
      sentences.push(sentence);
      sentenceRefs.push(id);
    }
    if (!sentenceRefs.length) throw new Error(`grupo sem frases temporizadas: ${group.id}`);
    chapters.push({
      id: group.id, kind: group.kind, title: group.title,
      startFrame, durationInFrames: Math.max(1, endFrame - startFrame), sentenceIds: sentenceRefs
    });
  });

  sentences.sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  for (let index = 1; index < sentences.length; index += 1) {
    if (sentences[index].startFrame < sentences[index - 1].startFrame) {
      throw new Error('frases TTS fora de ordem temporal');
    }
  }
  return { chapters, sentences };
}

async function buildAssetManifest(sceneImageAssets = [], { root = ROOT } = {}) {
  const assets = [];
  for (const [index, asset] of (Array.isArray(sceneImageAssets) ? sceneImageAssets : []).entries()) {
    const originalPath = String(asset?.path || '').replace(/\\/g, '/');
    if (!originalPath) {
      throw new Error(`asset de cena fora do diretório gerenciado: ${index}`);
    }
    const absolutePath = path.isAbsolute(originalPath) ? path.resolve(originalPath) : path.resolve(root, originalPath);
    const relative = path.relative(path.resolve(root), absolutePath);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`asset de cena escapou do projeto: ${originalPath}`);
    }
    const managedPath = relative.split(path.sep).join('/');
    const bytes = await fs.readFile(absolutePath);
    const actualHash = sha256(bytes);
    if (!/^[a-f0-9]{64}$/i.test(String(asset.sha256 || '')) || actualHash !== asset.sha256) {
      throw new Error(`hash do asset de cena não confere: ${managedPath}`);
    }
    const groupIndex = Number(asset.groupIndex);
    if (!Number.isSafeInteger(groupIndex) || groupIndex < 0) throw new Error(`groupIndex inválido em ${managedPath}`);
    if (asset.beatSha256 != null && !/^[a-f0-9]{64}$/.test(String(asset.beatSha256))) throw new Error(`hash da frase inválido em ${managedPath}`);
    assets.push({
      id: `scene-image-${groupIndex}-${String(asset.variant || index + 1).replace(/[^a-zA-Z0-9_-]/g, '-')}`,
      groupIndex, variant: String(asset.variant || 'default'), managedPath,
      sha256: actualHash, kind: 'illustration', illustrative: true,
      ...(asset.beatSha256 ? { beatSha256: asset.beatSha256 } : {})
    });
  }
  return assets;
}

// Only an unambiguous prompt-to-sentence match may put an image on screen.
// Legacy assets and duplicate matching sentences stay unbound.
function bindNarrativeBeatAssets(assets, sentences) {
  return assets.map(asset => {
    if (!asset.beatSha256) return asset;
    const matches = sentences.filter(sentence => sentence.groupIndex === asset.groupIndex
      && narrativeBeatSha256(sentence.text) === asset.beatSha256);
    return matches.length === 1 ? { ...asset, sentenceId: matches[0].id } : asset;
  });
}

async function createNarrativeEpisodePlan({
  jobId, script, themeId, fps = 24, durationMs, timings, audioPath, sourceEvidence,
  publicationReview, sceneImageAssets = [], root = ROOT
} = {}) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(String(jobId || ''))) throw new TypeError('jobId inválido para plano narrativo');
  if (!script || typeof script !== 'object') throw new TypeError('roteiro aprovado ausente');
  if (!/^[a-z0-9_-]{2,40}$/i.test(String(themeId || ''))) throw new TypeError('themeId inválido');
  if (!Number.isFinite(fps) || fps < 12 || fps > 60) throw new RangeError('fps fora do intervalo permitido');
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new RangeError('duração real de narração inválida');
  if (!audioPath) throw new TypeError('arquivo de narração obrigatório');
  const audioBytes = await fs.readFile(audioPath);
  const groups = narrationGroups(script);
  if (!groups.length) throw new Error('roteiro aprovado não contém narração');
  const timeline = buildTimedNarration(script, timings, fps, durationMs);
  const assets = bindNarrativeBeatAssets(await buildAssetManifest(sceneImageAssets, { root }), timeline.sentences);
  const source = {
    eligible: sourceEvidence?.eligible === true,
    sourceTitle: cleanText(sourceEvidence?.sourceTitle, 300),
    sourceUrl: cleanText(sourceEvidence?.sourceUrl, 1000),
    contextHash: String(sourceEvidence?.contextHash || ''),
    contextChars: Number(sourceEvidence?.contextChars) || 0,
    reviewStatus: String(publicationReview?.status || 'unavailable'),
    reviewSourceHash: String(publicationReview?.sourceHash || '')
  };
  if (source.eligible && (!/^[a-f0-9]{64}$/i.test(source.contextHash)
    || source.reviewStatus !== 'approved' || source.reviewSourceHash !== source.contextHash)) {
    throw new Error('evidência/fact-check não vinculados ao contexto do plano narrativo');
  }
  const scriptSha256 = sha256(Buffer.from(stableJson(script)));
  const narrationSha256 = sha256(audioBytes);
  const speechEnvelope = await extractSpeechEnvelope(audioPath);
  const speechEnvelopeSha256 = sha256(Buffer.from(stableJson(speechEnvelope)));
  const totalFrames = Math.max(1, Math.ceil(durationMs * fps / 1000));
  const claims = timeline.sentences.map(sentence => ({
    id: `claim-${sentence.id}`, sentenceId: sentence.id, text: sentence.text,
    sourceContextHash: source.contextHash, sourceUrl: source.sourceUrl,
    reviewStatus: source.reviewStatus
  }));
  const plan = {
    schemaVersion: SCHEMA_VERSION, jobId: String(jobId), themeId: String(themeId),
    title: cleanText(script.title || script.hook, 300), fps, durationMs: Math.round(durationMs),
    durationInFrames: totalFrames, seed: Number.isSafeInteger(script.seed) && script.seed >= 0 ? script.seed : 0,
    scriptSha256, narrationSha256, speechEnvelope, speechEnvelopeSha256, source,
    chapters: timeline.chapters, sentences: timeline.sentences, claims, assets,
    palette: script.visualPalettes || null, scenes: []
  };
  plan.inputSha256 = narrativePlanInputSha256(plan);
  return plan;
}

function validateNarrativeEpisodePlan(plan, { root = ROOT, verifyAssets = false } = {}) {
  const errors = [];
  if (plan?.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(String(plan?.jobId || ''))) errors.push('jobId');
  if (!/^[a-z0-9_-]{2,40}$/i.test(String(plan?.themeId || ''))) errors.push('themeId');
  if (!Number.isFinite(plan?.fps) || plan.fps < 12 || plan.fps > 60) errors.push('fps');
  if (!Number.isFinite(plan?.durationMs) || plan.durationMs <= 0) errors.push('durationMs');
  if (!Number.isSafeInteger(plan?.durationInFrames) || plan.durationInFrames < 1) errors.push('durationInFrames');
  for (const key of ['scriptSha256', 'narrationSha256', 'inputSha256']) {
    if (!/^[a-f0-9]{64}$/i.test(String(plan?.[key] || ''))) errors.push(key);
  }
  if (!plan?.speechEnvelope || !Number.isFinite(plan.speechEnvelope.stepMs) || plan.speechEnvelope.stepMs <= 0
    || !Array.isArray(plan.speechEnvelope.levels) || !plan.speechEnvelope.levels.length
    || !/^[a-f0-9]{64}$/i.test(String(plan.speechEnvelopeSha256 || ''))
    || plan.speechEnvelope.levels.some(level => !Number.isFinite(level) || level < 0 || level > 1)
    || sha256(Buffer.from(stableJson(plan.speechEnvelope))) !== plan.speechEnvelopeSha256) {
    errors.push('speechEnvelope');
  }
  if (Number.isFinite(plan?.durationMs) && Number.isFinite(plan?.speechEnvelope?.stepMs)
    && Array.isArray(plan?.speechEnvelope?.levels)) {
    const expectedLevels = Math.ceil(plan.durationMs / plan.speechEnvelope.stepMs);
    if (Math.abs(plan.speechEnvelope.levels.length - expectedLevels) > 2) errors.push('speechEnvelope:duration');
  }
  if (!Array.isArray(plan?.chapters) || !plan.chapters.length) errors.push('chapters');
  if (!Array.isArray(plan?.sentences) || !plan.sentences.length) errors.push('sentences');
  if (!Array.isArray(plan?.claims) || plan.claims.length !== (plan?.sentences || []).length) errors.push('claims');
  if (!Array.isArray(plan?.scenes) || !plan.scenes.length) errors.push('scenes');
  const chapterIds = new Set((plan?.chapters || []).map(chapter => chapter.id));
  const sentenceIds = new Set((plan?.sentences || []).map(sentence => sentence.id));
  const claimIds = new Set((plan?.claims || []).map(claim => claim.id));
  const assetIds = new Set((plan?.assets || []).map(asset => asset.id));
  if (chapterIds.size !== (plan?.chapters || []).length) errors.push('chapters:duplicate_id');
  if (sentenceIds.size !== (plan?.sentences || []).length) errors.push('sentences:duplicate_id');
  if (claimIds.size !== (plan?.claims || []).length) errors.push('claims:duplicate_id');
  if (assetIds.size !== (plan?.assets || []).length) errors.push('assets:duplicate_id');
  const assignedSentences = new Map();
  const sceneIds = new Set();
  const sentenceById = new Map((plan?.sentences || []).map(sentence => [sentence.id, sentence]));
  const chapterSentenceCounts = new Map();
  for (const chapter of plan?.chapters || []) {
    if (!Array.isArray(chapter.sentenceIds) || !chapter.sentenceIds.length
      || !Number.isSafeInteger(chapter.startFrame) || !Number.isSafeInteger(chapter.durationInFrames)
      || chapter.startFrame < 0 || chapter.durationInFrames < 1
      || chapter.startFrame + chapter.durationInFrames > plan.durationInFrames + 1) {
      errors.push(`chapter:${chapter?.id || 'unknown'}:timing`);
    }
    for (const sentenceId of chapter.sentenceIds || []) {
      const sentence = sentenceById.get(sentenceId);
      if (!sentence || sentence.groupId !== chapter.id) errors.push(`chapter:${chapter.id}:sentence:${sentenceId}`);
      chapterSentenceCounts.set(sentenceId, (chapterSentenceCounts.get(sentenceId) || 0) + 1);
    }
  }
  for (const sentence of plan?.sentences || []) {
    if (!sentenceIds.has(sentence.id) || !chapterIds.has(sentence.groupId)
      || !Number.isSafeInteger(sentence.startFrame) || !Number.isSafeInteger(sentence.endFrame)
      || sentence.startFrame < 0 || sentence.endFrame <= sentence.startFrame
      || sentence.endFrame > plan.durationInFrames + 1) errors.push(`sentence:${sentence?.id || 'unknown'}`);
    if (chapterSentenceCounts.get(sentence.id) !== 1) errors.push(`sentence:${sentence.id}:chapter_coverage`);
    if (Array.isArray(sentence.wordTimings) && sentence.wordTimings.length) {
      let previousEnd = sentence.startFrame;
      for (const word of sentence.wordTimings) {
        if (!cleanText(word?.text, 80) || !Number.isSafeInteger(word.startFrame) || !Number.isSafeInteger(word.endFrame)
          || word.startFrame < sentence.startFrame || word.endFrame <= word.startFrame
          // Start is floored and end is ceiled to preserve the measured
          // speech interval. Adjacent non-overlapping words can therefore
          // share exactly one frame after quantization at 24 fps.
          || word.endFrame > sentence.endFrame || word.startFrame < previousEnd - 1) {
          errors.push(`sentence:${sentence.id}:word_timing`);
          break;
        }
        previousEnd = word.endFrame;
      }
    }
  }
  for (const asset of plan?.assets || []) {
    const managedPath = String(asset?.managedPath || '').replace(/\\/g, '/');
    if (!asset?.id || !managedPath || !Number.isSafeInteger(asset.groupIndex) || asset.groupIndex < 0
      || path.isAbsolute(managedPath) || managedPath.split('/').includes('..')
      || !/^[a-f0-9]{64}$/i.test(String(asset.sha256 || '')) || asset.illustrative !== true) {
      errors.push(`asset:${asset?.id || 'unknown'}`);
    }
    if (asset?.beatSha256 != null && !/^[a-f0-9]{64}$/.test(String(asset.beatSha256))) errors.push(`asset:${asset.id}:beat_hash`);
    if (asset?.sentenceId) {
      const sentence = (plan?.sentences || []).find(item => item.id === asset.sentenceId);
      const matches = (plan?.sentences || []).filter(item => item.groupIndex === asset.groupIndex
        && narrativeBeatSha256(item.text) === asset.beatSha256);
      if (!sentence || sentence.groupIndex !== asset.groupIndex || matches.length !== 1 || matches[0].id !== asset.sentenceId) {
        errors.push(`asset:${asset.id}:sentence`);
      }
    }
    if (verifyAssets && managedPath) {
      const absolutePath = path.resolve(root, managedPath);
      if (!absolutePath.startsWith(`${path.resolve(root)}${path.sep}`)) errors.push(`asset-path:${asset.id}`);
    }
  }
  for (const scene of plan?.scenes || []) {
    try {
      const drawings = normalizeIllustrations(scene?.illustrations, (scene?.sentenceIds || []).map(id => sentenceById.get(id)).filter(Boolean), plan.fps);
      for (const actorNode of drawings.flatMap(drawing => drawing.nodes).filter(node => node.actorId)) {
        const actor = resolveHumanActor(actorNode.actorId);
        if (!actor || actor.sha256 !== actorNode.actorSha256) errors.push(`scene:${scene?.id || 'unknown'}:actor:${actorNode.actorId}:hash`);
      }
    } catch { errors.push(`scene:${scene?.id || 'unknown'}:illustrations`); }
    if (!scene?.id || sceneIds.has(scene.id)) errors.push(`scene:${scene?.id || 'unknown'}:duplicate_id`);
    else sceneIds.add(scene.id);
    const chapter = (plan?.chapters || []).find(item => item.id === scene.chapterId);
    if (!chapterIds.has(scene.chapterId) || !Array.isArray(scene.sentenceIds) || !scene.sentenceIds.length
      || scene.sentenceIds.some(id => !sentenceIds.has(id))
      || !Number.isSafeInteger(scene.startFrame) || !Number.isSafeInteger(scene.durationInFrames)
      || scene.durationInFrames < 1 || scene.startFrame + scene.durationInFrames > plan.durationInFrames + 1
      || scene.startFrame !== chapter?.startFrame || scene.durationInFrames !== chapter?.durationInFrames
      || scene.sentenceIds.length !== chapter?.sentenceIds?.length
      || scene.sentenceIds.some((id, index) => id !== chapter?.sentenceIds?.[index])) {
      errors.push(`scene:${scene?.id || 'unknown'}:timing`);
    }
    const maxObjects = Math.min(32, Math.max(4, (scene.sentenceIds || []).length * 4));
    if (!Array.isArray(scene.objects) || scene.objects.length < 2 || scene.objects.length > maxObjects) {
      errors.push(`scene:${scene?.id || 'unknown'}:objects`);
    }
    if (!Array.isArray(scene.claimRefs) || scene.claimRefs.length !== (scene.sentenceIds || []).length
      || scene.claimRefs.some(id => !claimIds.has(id))) errors.push(`scene:${scene.id}:claims`);
    const objects = new Set((scene.objects || []).map(object => object.id));
    for (const object of scene.objects || []) {
      if (!OBJECT_KINDS.has(object.kind) || !cleanText(object.label, 80) || String(object.label || '').trim().length > 24
        || !['literal', 'illustrative', 'generic'].includes(object.labelType)
        || object.illustrative !== (object.labelType === 'illustrative')) {
        errors.push(`scene:${scene.id}:object:${object.id}`);
      }
    }
    const maxActions = Math.min(64, Math.max(12, (scene.sentenceIds || []).length * 8));
    if (!Array.isArray(scene.actions) || scene.actions.length < 2 || scene.actions.length > maxActions) {
      errors.push(`scene:${scene.id}:actions`);
    }
    for (const action of scene.actions || []) {
      const cue = sentenceById.get(action.cueSentenceId);
      if (!ACTION_KINDS.has(action.kind) || !objects.has(action.targetObjectId)
        || !scene.sentenceIds.includes(action.cueSentenceId)
        || !Number.isSafeInteger(action.startFrame) || !Number.isSafeInteger(action.endFrame)
        || action.startFrame < scene.startFrame || action.endFrame <= action.startFrame
        || action.endFrame > scene.startFrame + scene.durationInFrames
        || !cue || action.startFrame < cue.startFrame || action.endFrame > cue.endFrame
        || !action.trajectories?.landscape || !action.trajectories?.portrait) {
        errors.push(`scene:${scene.id}:action:${action?.kind || 'unknown'}`);
        continue;
      }
      for (const [aspect, bounds] of Object.entries({
        landscape: { minX: 0.12, maxX: 0.56, minY: 0.16, maxY: 0.58 },
        portrait: { minX: 0.16, maxX: 0.84, minY: 0.12, maxY: 0.36 }
      })) {
        for (const point of [action.trajectories[aspect].from, action.trajectories[aspect].to]) {
          if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.scale)
            || point.x < bounds.minX || point.x > bounds.maxX || point.y < bounds.minY || point.y > bounds.maxY
            || point.scale < 0.5 || point.scale > 1.6) {
            errors.push(`scene:${scene.id}:action:${action.kind}:trajectory:${aspect}`);
          }
        }
      }
    }
    for (const camera of scene.cameraShots || []) {
      const cue = sentenceById.get(camera.cueSentenceId);
      if (!CAMERA_KINDS.has(camera.kind) || !objects.has(camera.focusObjectId)
        || !scene.sentenceIds.includes(camera.cueSentenceId)
        || !Number.isSafeInteger(camera.startFrame) || !cue
        || camera.startFrame < cue.startFrame || camera.startFrame >= cue.endFrame) errors.push(`scene:${scene.id}:camera`);
    }
    const maxCameras = Math.min(64, Math.max(8, (scene.sentenceIds || []).length * 2));
    if (!Array.isArray(scene.cameraShots) || scene.cameraShots.length < 2 || scene.cameraShots.length > maxCameras) {
      errors.push(`scene:${scene.id}:camera_count`);
    }
    const gestureKinds = new Set(['hook', 'explain', 'point', 'compare', 'emphasize', 'conclusion']);
    if (!['left', 'right'].includes(scene.presenter?.side) || !['full', 'medium', 'close'].includes(scene.presenter?.framing)
      || !Array.isArray(scene.presenter?.gestureCues) || !scene.presenter.gestureCues.length
      || scene.presenter.gestureCues.some(cue => !sentenceIds.has(cue.cueSentenceId) || !gestureKinds.has(cue.gesture))) {
      errors.push(`scene:${scene.id}:presenter`);
    }
    const rhythm = [];
    for (const sentenceId of (scene.sentenceIds || [])) {
      assignedSentences.set(sentenceId, (assignedSentences.get(sentenceId) || 0) + 1);
      if (!(scene.actions || []).some(action => action.cueSentenceId === sentenceId)
        && !(scene.cameraShots || []).some(camera => camera.cueSentenceId === sentenceId)) {
        errors.push(`scene:${scene.id}:unanimated-sentence:${sentenceId}`);
      }
      const focused = new Set([...(scene.actions || []).filter(action => action.cueSentenceId === sentenceId).map(action => action.targetObjectId),
        ...(scene.cameraShots || []).filter(camera => camera.cueSentenceId === sentenceId).map(camera => camera.focusObjectId)]);
      const cue = sentenceById.get(sentenceId);
      const flow = narrativeBeatRelation({ sentence: cue?.text, objects: scene.objects });
      if (focused.size > 4 && !(focused.size <= 8 && flow?.kind === 'flow')) errors.push(`scene:${scene.id}:too-many-focused-objects:${sentenceId}`);
      if (cue) {
        const globalIndex = plan.sentences.findIndex(sentence => sentence.id === sentenceId);
        const previousCue = globalIndex > 0 ? plan.sentences[globalIndex - 1] : null;
        const grounding = validateCueVisualGrounding({ scene, cue, previousCue });
        if (!grounding.grounded) errors.push(`scene:${scene.id}:ungrounded-visual:${sentenceId}`);
        if (!grounding.paired) errors.push(`scene:${scene.id}:transformation-needs-two-objects:${sentenceId}`);
        if (!grounding.routes) errors.push(`scene:${scene.id}:routes-need-map-or-network:${sentenceId}`);
        if (!cueHasLongBeatVariation({ cue, scene, fps: plan.fps })) errors.push(`scene:${scene.id}:long-cue-needs-shot-change:${sentenceId}`);
        rhythm.push(grounding.signature);
      }
    }
    if (rhythm.length >= 4 && new Set(rhythm).size < 2) errors.push(`scene:${scene.id}:unchanging-visuals`);
    for (const layoutName of ['landscape', 'portrait']) {
      const layout = scene.layouts?.[layoutName];
      if (!layout || !layout.objects || [...objects].some(id => {
        const position = layout.objects[id];
        const bounds = layoutName === 'landscape'
          ? { minX: 0.12, maxX: 0.56, minY: 0.16, maxY: 0.58 }
          : { minX: 0.16, maxX: 0.84, minY: 0.12, maxY: 0.36 };
        return !position || !Number.isFinite(position.x) || !Number.isFinite(position.y)
          || !Number.isFinite(position.scale) || position.x < bounds.minX || position.x > bounds.maxX
          || position.y < bounds.minY || position.y > bounds.maxY || position.scale < 0.5 || position.scale > 1.6;
      })) errors.push(`scene:${scene.id}:layout:${layoutName}`);
    }
    if (scene.assetId && !assetIds.has(scene.assetId)) errors.push(`scene:${scene.id}:asset`);
  }
  for (const sentenceId of sentenceIds) {
    if (assignedSentences.get(sentenceId) !== 1) errors.push(`sentence:${sentenceId}:scene_coverage`);
  }
  for (const claim of plan?.claims || []) {
    if (!sentenceIds.has(claim.sentenceId) || claim.id !== `claim-${claim.sentenceId}`
      || claim.sourceContextHash !== plan.source?.contextHash) errors.push(`claim:${claim?.id || 'unknown'}`);
  }
  if (plan?.source?.eligible === true && (!/^[a-f0-9]{64}$/i.test(String(plan.source.contextHash || ''))
    || plan.source.reviewStatus !== 'approved' || plan.source.reviewSourceHash !== plan.source.contextHash)) {
    errors.push('source_review_binding');
  }
  if (/^[a-f0-9]{64}$/i.test(String(plan?.inputSha256 || ''))
    && plan.inputSha256 !== narrativePlanInputSha256(plan)) errors.push('inputSha256:mismatch');
  return { valid: errors.length === 0, errors };
}

async function verifyNarrativeEpisodeAssets(plan, { root = ROOT } = {}) {
  const failures = [];
  for (const asset of plan?.assets || []) {
    const absolutePath = path.resolve(root, asset.managedPath);
    const relative = path.relative(path.resolve(root), absolutePath);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      failures.push({ id: asset.id, reason: 'outside_project' });
      continue;
    }
    try {
      const actual = sha256(await fs.readFile(absolutePath));
      if (actual !== asset.sha256) failures.push({ id: asset.id, reason: 'sha256_mismatch' });
    } catch (error) {
      failures.push({ id: asset.id, reason: error.code === 'ENOENT' ? 'missing' : 'unreadable' });
    }
  }
  if (failures.length) throw Object.assign(new Error('assets do plano narrativo ausentes ou alterados'), {
    code: 'NARRATIVE_ASSET_INTEGRITY_FAILED', failures
  });
  return true;
}

module.exports = {
  ACTION_KINDS, CAMERA_KINDS, OBJECT_KINDS, ROOT, SCHEMA_VERSION,
  bindNarrativeBeatAssets, buildAssetManifest, buildTimedNarration, createNarrativeEpisodePlan, cueRequiresPairedVisual,
  narrationGroups, narrativePlanInputSha256, planInputProjection, sha256, stableJson,
  validateCueVisualGrounding, validateNarrativeEpisodePlan, verifyNarrativeEpisodeAssets
};
