'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FORMATS } = require('./editorial-formats');

function validateGenerationArticle(article) {
  let url;
  try { url = new URL(article?.url); } catch { throw new Error('fonte de retomada inválida'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || typeof article?.title !== 'string' || article.title.trim().length < 12 || article.title.length > 500
    || typeof article?.source !== 'string' || !article.source.trim() || article.source.length > 120
    || !Number.isFinite(article.ageHoursAtCapture) || article.ageHoursAtCapture < 0
    || typeof article.capturedAt !== 'string' || !Number.isFinite(Date.parse(article.capturedAt))
    || !/^[a-f0-9]{64}$/.test(article.contextHash || '')) throw new Error('fonte de retomada inválida');
  return { url: article.url, title: article.title, source: article.source,
    ageHoursAtCapture: article.ageHoursAtCapture, capturedAt: article.capturedAt, contextHash: article.contextHash };
}

function generationArticleAgeHours(article, now = Date.now()) {
  const valid = validateGenerationArticle(article);
  const elapsed = (Number(now) - Date.parse(valid.capturedAt)) / 3600000;
  if (!Number.isFinite(elapsed) || elapsed < -1 / 60) throw new Error('data de captura da fonte inválida');
  return valid.ageHoursAtCapture + Math.max(0, elapsed);
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function validateAttempt(value, root) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) {
    throw new Error('registro de geração interrompida tem formato ou versão inválida');
  }
  if (typeof value.outPath !== 'string' || path.isAbsolute(value.outPath)) {
    throw new Error('registro de geração interrompida não contém caminho relativo válido');
  }
  const resolvedOutput = path.resolve(root, value.outPath);
  if (!isWithin(path.join(root, 'data', 'videos'), resolvedOutput) || path.extname(resolvedOutput).toLowerCase() !== '.mp4') {
    throw new Error('registro de geração interrompida aponta para fora de data/videos');
  }
  if (typeof value.theme !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value.theme)) {
    throw new Error('registro de geração interrompida não contém tema válido');
  }
  if (typeof value.jobId !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.jobId)) {
    throw new Error('registro de geração interrompida não contém jobId válido');
  }
  if (typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt))) {
    throw new Error('registro de geração interrompida não contém horário válido');
  }
  if (value.slotAt != null && (typeof value.slotAt !== 'string' || !Number.isFinite(Date.parse(value.slotAt)))) {
    throw new Error('registro de geração interrompida contém slot inválido');
  }
  if (value.sourceVisualsOnly != null && typeof value.sourceVisualsOnly !== 'boolean') {
    throw new Error('modo visual de retomada inválido');
  }
  if (value.seed != null && (!Number.isSafeInteger(value.seed) || value.seed < 0 || value.seed >= 1e9)) {
    throw new Error('seed de geração interrompida inválida');
  }
  if (value.attemptCount != null && (!Number.isSafeInteger(value.attemptCount) || value.attemptCount < 1 || value.attemptCount > 1000)) {
    throw new Error('contador da tentativa de geração inválido');
  }
  if (value.formatId != null && !FORMATS.some(format => format.id === value.formatId)) {
    throw new Error('formato editorial de retomada inválido');
  }
  const article = value.article == null ? null : validateGenerationArticle(value.article);
  if (value.recap != null && value.recap !== true) {
    throw new Error('registro de geração interrompida contém marcador de recap inválido');
  }
  if (value.recap === true) {
    const window = value.recapWindow;
    if (!window || window.themeId !== value.theme || !Number.isSafeInteger(window.windowIndex) || window.windowIndex < 0
      || window.key !== `${window.themeId}:${window.windowIndex}`
      || typeof window.startAt !== 'string' || !Number.isFinite(Date.parse(window.startAt))
      || typeof window.endAt !== 'string' || !Number.isFinite(Date.parse(window.endAt))
      || window.dueAt !== window.endAt || Date.parse(window.startAt) >= Date.parse(window.endAt)) {
      throw new Error('registro de geração interrompida contém janela de recap inválida');
    }
  } else if (value.recapWindow != null) {
    throw new Error('registro de geração interrompida contém janela sem marcador de recap');
  }

  return {
    version: 1,
    outPath: value.outPath,
    theme: value.theme,
    jobId: value.jobId,
    startedAt: value.startedAt,
    ...(value.slotAt ? { slotAt: value.slotAt } : {}),
    ...(value.sourceVisualsOnly === true ? { sourceVisualsOnly: true } : {}),
    ...(value.seed != null ? { seed: value.seed } : {}),
    ...(value.attemptCount != null ? { attemptCount: value.attemptCount } : {}),
    ...(value.formatId ? { formatId: value.formatId } : {}),
    ...(article ? { article } : {}),
    ...(value.recap === true ? { recap: true, recapWindow: { ...value.recapWindow } } : {})
  };
}

async function isCompletedGenerationAttempt({ attempt, ledgerPath, root, isManagedVideo, probeVideoHealth }) {
  if (typeof ledgerPath !== 'string' || !ledgerPath || typeof root !== 'string' || !root
    || typeof isManagedVideo !== 'function' || typeof probeVideoHealth !== 'function') {
    throw new TypeError('ledger, raiz, validador de mídia e QA são obrigatórios para reconciliar geração');
  }
  let validated;
  try { validated = validateAttempt(attempt, root); }
  catch (_error) { return false; }
  const outputPath = path.resolve(root, validated.outPath);
  if (!await isManagedVideo(outputPath)) return false;

  let ledger;
  try { ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8')); }
  catch (_error) { return false; }
  if (!ledger || !Array.isArray(ledger.entries)) return false;
  const entry = [...ledger.entries].reverse().find(candidate => candidate?.jobId === validated.jobId
    && typeof candidate.videoPath === 'string'
    && path.resolve(root, candidate.videoPath) === outputPath
    && typeof candidate.generatedAt === 'string'
    && Number.isFinite(Date.parse(candidate.generatedAt)));
  if (!entry) return false;

  try {
    return (await probeVideoHealth(outputPath))?.ok === true;
  } catch (_error) {
    return false;
  }
}

async function isCompletedResumeOutput({ attempt, jobId, outPath, ledgerPath, root, isManagedVideo, probeVideoHealth }) {
  if (!attempt || attempt.jobId !== jobId || typeof attempt.outPath !== 'string' || typeof outPath !== 'string'
    || path.resolve(root, attempt.outPath) !== path.resolve(root, outPath)) return false;
  return isCompletedGenerationAttempt({ attempt, ledgerPath, root, isManagedVideo, probeVideoHealth });
}

function createGenerationAttemptStore({ filePath, root }) {
  if (typeof filePath !== 'string' || !filePath || typeof root !== 'string' || !root) {
    throw new TypeError('caminho do registro e raiz do projeto são obrigatórios');
  }

  return {
    async read() {
      let contents;
      try {
        contents = await fs.readFile(filePath, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
      let value;
      try {
        value = JSON.parse(contents);
      } catch (error) {
        const invalid = new Error(`registro de geração interrompida ilegível: ${error.message}`);
        invalid.code = 'GENERATION_ATTEMPT_INVALID';
        throw invalid;
      }
      try {
        return validateAttempt(value, root);
      } catch (error) {
        const invalid = new Error(error.message);
        invalid.code = 'GENERATION_ATTEMPT_INVALID';
        throw invalid;
      }
    },

    async write(value) {
      const validated = validateAttempt(value, root);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      try {
        await fs.writeFile(tempPath, JSON.stringify(validated, null, 2), { flag: 'wx', mode: 0o600 });
        await fs.rename(tempPath, filePath);
      } catch (error) {
        await fs.unlink(tempPath).catch(() => {});
        throw error;
      }
      return validated;
    },

    async clear() {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    },

    async quarantineInvalid() {
      const quarantinePath = `${filePath}.invalid.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
      try {
        await fs.rename(filePath, quarantinePath);
        return quarantinePath;
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    }
  };
}

async function refreshGenerationAttempt({ attemptStore, expected, root }) {
  const current = await attemptStore.read();
  if (!current || !expected || current.jobId !== expected.jobId
    || path.resolve(root, current.outPath) !== path.resolve(root, expected.outPath)) {
    throw Object.assign(new Error('checkpoint de geração mudou durante a tentativa; preservado para reconciliação'), {
      code: 'GENERATION_ATTEMPT_IDENTITY_MISMATCH'
    });
  }
  return current;
}

module.exports = { createGenerationAttemptStore, isCompletedGenerationAttempt, isCompletedResumeOutput, validateAttempt,
  validateGenerationArticle, generationArticleAgeHours, refreshGenerationAttempt };
