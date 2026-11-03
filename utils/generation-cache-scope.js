'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');

async function prepareGenerationCacheScope({ root, outputDir, slug, jobId, revision, topic, formatId, targetWords, contextHash, allowLegacy = false }) {
  if (!/^[a-z0-9_]{1,100}$/i.test(slug) || !/^[a-f0-9-]{36}$/i.test(jobId) || !/^[a-z0-9-]{1,100}$/i.test(revision)) {
    throw new Error('identidade de cache de geração inválida');
  }
  const scopedSlug = `${slug}-${jobId}`;
  const oldScript = path.join(root, 'data/scripts', `${slug}-${revision}.json`);
  const newScript = path.join(root, 'data/scripts', `${scopedSlug}-${revision}.json`);
  if (!allowLegacy || await fs.stat(newScript).then(() => true).catch(() => false)) return scopedSlug;
  let metadata;
  try { metadata = JSON.parse(await fs.readFile(`${oldScript}.meta.json`, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return scopedSlug; throw error; }
  // Only adopt a legacy snapshot from the exact resumed editorial request.
  // A different job may already have replaced this historically shared path.
  if (metadata.revision !== revision || metadata.topic !== topic || metadata.formatId !== formatId
    || metadata.targetWords !== targetWords || metadata.contextHash !== contextHash) return scopedSlug;
  const oldTts = path.join(outputDir, `${slug}-${revision}_tts`);
  const newTts = path.join(outputDir, `${scopedSlug}-${revision}_tts`);
  await fs.mkdir(newTts, { recursive: true });
  const copy = async (source, destination, optional = false) => {
    try { await fs.copyFile(source, destination, constants.COPYFILE_EXCL); }
    catch (error) { if (error.code === 'EEXIST' || optional && error.code === 'ENOENT') return; throw error; }
  };
  for (const name of ['narration.mp3', 'narration.mp3.meta.json', 'narration.srt', 'narration.word-timings.json']) {
    await copy(path.join(oldTts, name), path.join(newTts, name), true);
  }
  // Script is the completion marker; incomplete migration can be retried.
  await copy(`${oldScript}.meta.json`, `${newScript}.meta.json`);
  await copy(oldScript, newScript);
  return scopedSlug;
}

module.exports = { prepareGenerationCacheScope };
