'use strict';

const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isKwaiFeedScreen, isKwaiProfile, isKwaiPostComposer, isKwaiVideoEditor, isKwaiEditorActivity } = require('./kwai-upload-flow');

const ROOT = path.join(__dirname, '..');
const RESUME_FILENAME = 'kwai-upload-resume.json';
const STAGES = Object.freeze(['selected', 'transcoding', 'composer']);

function getStateDir(stateDir = process.env.STATE_DIR || path.join(ROOT, 'data/state')) {
  return path.resolve(ROOT, stateDir);
}

function getResumePath(stateDir) {
  return path.join(getStateDir(stateDir), RESUME_FILENAME);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fsSync.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

function validateMarker(marker) {
  return Boolean(marker && marker.schemaVersion === 1
    && typeof marker.videoPath === 'string' && path.isAbsolute(marker.videoPath)
    && /^[a-f0-9]{64}$/.test(marker.videoSha256 || '')
    && /^[a-f0-9]{64}$/.test(marker.captionSha256 || '')
    && /^Pulso_[a-f0-9]{12}$/.test(marker.albumName || '')
    && Number.isFinite(marker.durationSeconds) && marker.durationSeconds > 0
    && STAGES.includes(marker.stage)
    && Number.isFinite(Date.parse(marker.createdAt))
    && Number.isFinite(Date.parse(marker.updatedAt)));
}

function resolveKwaiUploadResume(marker, matches) {
  if (marker && !matches) {
    throw new Error('Kwai: marcador persistido não corresponde ao arquivo, legenda, duração ou álbum deste envio');
  }
  return marker || null;
}

async function createKwaiUploadResume({ videoPath, caption, albumName, durationSeconds, stage = 'selected', now = new Date() }) {
  const resolvedVideoPath = path.resolve(videoPath);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Kwai: duração inválida para marcador de retomada');
  if (!/^Pulso_[a-f0-9]{12}$/.test(String(albumName || ''))) throw new Error('Kwai: álbum inválido para marcador de retomada');
  if (!STAGES.includes(stage)) throw new Error('Kwai: etapa inválida para marcador de retomada');
  const timestamp = new Date(now).toISOString();
  const marker = {
    schemaVersion: 1,
    videoPath: resolvedVideoPath,
    videoSha256: await hashFile(resolvedVideoPath),
    captionSha256: sha256(String(caption).slice(0, 2000)),
    albumName,
    durationSeconds,
    stage,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  if (!validateMarker(marker)) throw new Error('Kwai: marcador de retomada inválido');
  return marker;
}

async function saveKwaiUploadResume(marker, { stateDir } = {}) {
  if (!validateMarker(marker)) throw new Error('Kwai: recusado marcador de retomada inválido');
  const directory = getStateDir(stateDir);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const target = getResumePath(directory);
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(marker, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, target);
    await fs.chmod(target, 0o600);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return marker;
}

async function readKwaiUploadResume({ stateDir } = {}) {
  try {
    const marker = JSON.parse(await fs.readFile(getResumePath(stateDir), 'utf8'));
    if (!validateMarker(marker)) throw new Error('Kwai: marcador de retomada persistido inválido; envio interrompido');
    return marker;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function advanceKwaiUploadResume(marker, stage, { stateDir, now = new Date() } = {}) {
  if (!validateMarker(marker) || !STAGES.includes(stage)) throw new Error('Kwai: marcador ou etapa inválida para avanço');
  const transitions = { selected: ['transcoding', 'composer'], transcoding: ['composer'], composer: [] };
  if (stage !== marker.stage && !transitions[marker.stage].includes(stage)) {
    throw new Error(`Kwai: transição de retomada inválida (${marker.stage} -> ${stage})`);
  }
  const updated = { ...marker, stage, updatedAt: new Date(now).toISOString() };
  await saveKwaiUploadResume(updated, { stateDir });
  return updated;
}

async function matchesKwaiUploadResume(marker, { videoPath, caption, albumName, durationSeconds } = {}) {
  if (!validateMarker(marker)) return false;
  const resolvedVideoPath = path.resolve(videoPath || '');
  if (marker.videoPath !== resolvedVideoPath
    || marker.albumName !== albumName
    || marker.captionSha256 !== sha256(String(caption).slice(0, 2000))
    || !Number.isFinite(durationSeconds)
    || Math.abs(marker.durationSeconds - durationSeconds) > 1) return false;
  try {
    return marker.videoSha256 === await hashFile(resolvedVideoPath);
  } catch (_error) {
    return false;
  }
}

async function clearKwaiUploadResume({ stateDir } = {}) {
  try {
    await fs.unlink(getResumePath(stateDir));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

// A marker for an uncertain old upload must stay available for reconciliation,
// but must not hold every distinct future video when the app is safely at home.
async function archiveUnrelatedKwaiResume(marker, { videoPath, activity, nodes, stateDir, packageName = 'kwai.lite.video' } = {}) {
  if (!validateMarker(marker) || path.resolve(videoPath || '') === marker.videoPath
    || !String(activity || '').startsWith(`${packageName}/`)
    || isKwaiEditorActivity(activity, packageName) || isKwaiPostComposer(nodes || [])
    || isKwaiVideoEditor(nodes || []) || !(isKwaiFeedScreen(nodes || []) || isKwaiProfile(nodes || []))) {
    throw new Error('Kwai: outro rascunho não pode ser arquivado fora do feed/perfil confirmado');
  }
  if (await hashFile(path.resolve(videoPath)) === marker.videoSha256) {
    throw new Error('Kwai: conteúdo idêntico ao envio incerto anterior; reconciliação obrigatória');
  }
  const activePath = getResumePath(stateDir);
  const original = await fs.readFile(activePath);
  if (JSON.stringify(JSON.parse(original)) !== JSON.stringify(marker)) throw new Error('Kwai: marcador mudou antes do arquivamento');
  const directory = path.join(getStateDir(stateDir), 'kwai-upload-resume-archive');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const archivedPath = path.join(directory, `${marker.videoSha256}-${sha256(original).slice(0, 16)}.json`);
  try { await fs.writeFile(archivedPath, original, { mode: 0o600, flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST' || !(await fs.readFile(archivedPath)).equals(original)) throw error;
  }
  if (!(await fs.readFile(activePath)).equals(original)) throw new Error('Kwai: marcador mudou; cópia preservada e ponteiro ativo mantido');
  await fs.unlink(activePath);
  return archivedPath;
}

module.exports = {
  RESUME_FILENAME,
  STAGES,
  advanceKwaiUploadResume,
  archiveUnrelatedKwaiResume,
  clearKwaiUploadResume,
  createKwaiUploadResume,
  matchesKwaiUploadResume,
  readKwaiUploadResume,
  resolveKwaiUploadResume,
  saveKwaiUploadResume
};
