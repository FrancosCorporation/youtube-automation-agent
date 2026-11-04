'use strict';

const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { sha256StableRegularFile } = require('./video-qa-manifest');
const { buildPortraitPartRender } = require('./portrait-part-ranges');

async function renderPortraitPartCheckpoint({ sourcePath, sourceSha256, outputPath, ranges,
  run, durationReader }) {
  const recipe = buildPortraitPartRender({ portraitVideoPath: sourcePath, outputPath, ranges });
  const identity = crypto.createHash('sha256').update(JSON.stringify({ version: 1,
    sourceSha256, args: recipe.args.slice(0, -1) })).digest('hex');
  const manifestPath = `${outputPath}.checkpoint.json`;
  let saved;
  try { saved = JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  if (saved?.identity === identity) {
    const actual = await sha256StableRegularFile(outputPath).catch(() => null);
    const duration = actual ? await durationReader(outputPath).catch(() => null) : null;
    if (actual?.sha256 === saved.sha256 && actual.sizeBytes === saved.sizeBytes
      && Number.isFinite(duration) && Math.abs(duration - recipe.durationMs / 1000) <= 0.45) return duration;
  }
  const token = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const temporary = `${outputPath}.${token}.tmp.mp4`;
  const temporaryManifest = `${manifestPath}.${token}.tmp`;
  try {
    await run([...recipe.args.slice(0, -1), temporary]);
    const duration = await durationReader(temporary);
    const proof = await sha256StableRegularFile(temporary);
    if (!proof?.sizeBytes || !Number.isFinite(duration) || Math.abs(duration - recipe.durationMs / 1000) > 0.45) {
      throw Object.assign(new Error('corte vertical incompleto'), { code: 'GENERATION_SOCIAL_PARTS_PENDING' });
    }
    await fs.writeFile(temporaryManifest, JSON.stringify({ identity, sha256: proof.sha256, sizeBytes: proof.sizeBytes }), { flag: 'wx', mode: 0o600 });
    // Preserve unmatched outputs; never silently overwrite a previous artifact.
    for (const file of [outputPath, manifestPath]) {
      await fs.rename(file, `${file}.superseded-${token}`).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    await fs.rename(temporary, outputPath);
    await fs.rename(temporaryManifest, manifestPath);
    return duration;
  } finally {
    await fs.unlink(temporary).catch(() => {});
    await fs.unlink(temporaryManifest).catch(() => {});
  }
}

module.exports = { renderPortraitPartCheckpoint };
