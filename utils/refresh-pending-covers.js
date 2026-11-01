'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { withProcessFileLock } = require('./process-file-lock');
const { inspectThumbnailArtifact, verifyVideoQaManifest, sha256StableRegularFile } = require('./video-qa-manifest');

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function atomicWrite(target, bytes) {
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, target); }
  finally { await fs.unlink(temporary).catch(() => {}); }
}

// Replace covers only for an episode with no destination attempt. A crash
// between the two atomic writes fails closed on the ledger's manifest hash;
// the old manifest is preserved for recovery.
async function refreshPendingCovers({ root, ledgerPath, videoId, expectedManifestSha256,
  landscapePath, portraitPath, thumbnailSource }) {
  const projectRoot = path.resolve(root);
  const ledgerFile = path.resolve(ledgerPath);
  return withProcessFileLock(async () => {
    const ledger = JSON.parse(await fs.readFile(ledgerFile, 'utf8'));
    const matches = ledger.entries.filter(entry => entry.videoId === videoId);
    if (matches.length !== 1) throw new Error('episódio não identificado de forma única');
    const entry = matches[0];
    if (entry.qaManifestSha256 !== expectedManifestSha256 || entry.ytUrl || entry.results) {
      throw new Error('capa não pode ser alterada após tentativa ou mudança de manifesto');
    }
    const manifestPath = path.resolve(projectRoot, entry.qaManifestPath || '');
    const qaRoot = path.join(projectRoot, 'data/reports/qa');
    if (!manifestPath.startsWith(`${qaRoot}${path.sep}`)) throw new Error('manifesto fora do diretório QA');
    const oldBytes = await fs.readFile(manifestPath);
    if (digest(oldBytes) !== expectedManifestSha256) throw new Error('hash do manifesto mudou');
    const expectedPaths = [entry.videoPath, entry.portraitVideoPath, ...(entry.clips || []).map(clip => clip.path)]
      .filter(value => typeof value === 'string' && value);
    const verified = await verifyVideoQaManifest({ root: projectRoot, manifestPath,
      manifestSha256: expectedManifestSha256, expectedPaths });
    if (verified.status !== 'verified') throw new Error(`manifesto anterior inválido: ${verified.reason}`);
    const [thumbnail, portraitThumbnail] = await Promise.all([
      inspectThumbnailArtifact({ root: projectRoot, filePath: landscapePath }),
      inspectThumbnailArtifact({ root: projectRoot, filePath: portraitPath, variant: 'portrait' })
    ]);
    if (thumbnailSource && (!/^https:\/\//.test(String(thumbnailSource.articleUrl || ''))
      || !/^https:\/\//.test(String(thumbnailSource.imageUrl || ''))
      || !/^[a-f0-9]{64}$/.test(String(thumbnailSource.imageSha256 || '')))) throw new Error('origem da capa inválida');
    if (thumbnailSource) {
      const sourcePath = path.resolve(projectRoot, thumbnailSource.imagePath || '');
      const sourceRoot = path.join(projectRoot, 'data/images');
      if (!sourcePath.startsWith(`${sourceRoot}${path.sep}`)
        || !(await fs.realpath(sourcePath)).startsWith(`${sourceRoot}${path.sep}`)
        || (await sha256StableRegularFile(sourcePath)).sha256 !== thumbnailSource.imageSha256) {
        throw new Error('imagem de origem ausente ou alterada');
      }
    }
    const manifest = JSON.parse(oldBytes);
    manifest.thumbnail = thumbnail;
    manifest.portraitThumbnail = portraitThumbnail;
    if (thumbnailSource) manifest.thumbnailSource = thumbnailSource;
    else delete manifest.thumbnailSource;
    manifest.visualReview = { status: 'pending', note: 'Capas substituídas; revisão visual vinculada aos novos hashes é necessária.' };
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    const newSha256 = digest(bytes);
    const backup = path.join(qaRoot, `${videoId}.before-cover-${expectedManifestSha256}.json`);
    try { await fs.writeFile(backup, oldBytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST' || digest(await fs.readFile(backup)) !== expectedManifestSha256) throw error; }
    entry.thumbnailPath = thumbnail.path;
    entry.portraitThumbnailPath = portraitThumbnail.path;
    if (thumbnailSource) entry.thumbnailSource = thumbnailSource;
    else delete entry.thumbnailSource;
    entry.qaManifestSha256 = newSha256;
    await atomicWrite(manifestPath, bytes);
    try { await atomicWrite(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`); }
    catch (error) { await atomicWrite(manifestPath, oldBytes); throw error; }
    return { videoId, manifestSha256: newSha256, thumbnail, portraitThumbnail, backup };
  }, { lockPath: `${ledgerFile}.lock`, owner: 'pending-cover-repair', timeoutMs: 120000 });
}

module.exports = { refreshPendingCovers };
