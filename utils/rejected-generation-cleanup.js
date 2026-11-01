'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { sha256File } = require('./video-qa-manifest');
const { videoIdForPath } = require('./observability-ids');

function inside(base, candidate) {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function safeMediaPath(root, candidate) {
  const projectRoot = path.resolve(root);
  const videoRoot = path.join(projectRoot, 'data', 'videos');
  const target = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(projectRoot, candidate);
  if (!inside(videoRoot, target) || !['.mp4', '.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(target).toLowerCase())) return null;
  try {
    const realProjectRoot = await fs.realpath(projectRoot);
    const realVideoRoot = await fs.realpath(videoRoot);
    if (realVideoRoot !== path.resolve(realProjectRoot, path.relative(projectRoot, videoRoot))) return null;
    const expectedTarget = path.resolve(realVideoRoot, path.relative(videoRoot, target));
    if (await fs.realpath(target) !== expectedTarget || !(await fs.lstat(target)).isFile()) return null;
    return target;
  } catch (_error) {
    return null;
  }
}

/**
 * Remove only artifacts from this generation when its own QA manifest proves
 * that technical QA rejected the exact job and each file still matches hash.
 */
async function discardTechnicallyRejectedGeneration({ root, outPath, jobId, failureCode } = {}) {
  if (failureCode !== 'video_technical_qa_failed') return { discarded: false, reason: 'not_technical_qa_rejection', removed: [] };
  if (typeof root !== 'string' || !root || typeof outPath !== 'string' || !outPath
    || typeof jobId !== 'string' || !jobId) throw new TypeError('root, outPath e jobId são obrigatórios');

  const projectRoot = path.resolve(root);
  const masterPath = await safeMediaPath(projectRoot, outPath);
  if (!masterPath || path.extname(masterPath).toLowerCase() !== '.mp4') {
    return { discarded: false, reason: 'master_not_safe_managed_media', removed: [] };
  }
  const videoId = videoIdForPath(masterPath);
  const manifestPath = path.join(projectRoot, 'data', 'reports', 'qa', `${videoId}.json`);
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
  catch (_error) { return { discarded: false, reason: 'matching_qa_manifest_missing_or_invalid', removed: [] }; }
  if (manifest.videoId !== videoId || manifest.jobId !== jobId || manifest.technicalStatus !== 'failed') {
    return { discarded: false, reason: 'qa_manifest_does_not_prove_this_rejection', removed: [] };
  }
  const masterAsset = (Array.isArray(manifest.assets) ? manifest.assets : [])
    .find(asset => asset?.role === 'master' && path.resolve(projectRoot, asset.path || '') === masterPath);
  if (!masterAsset || !/^[a-f0-9]{64}$/i.test(String(masterAsset.sha256 || ''))) {
    return { discarded: false, reason: 'rejected_master_not_bound_by_manifest', removed: [] };
  }

  const assets = [...manifest.assets, ...(manifest.thumbnail ? [{ ...manifest.thumbnail, role: 'thumbnail' }] : [])];
  const removed = [];
  const retained = [];
  for (const asset of assets) {
    if (!asset || typeof asset.path !== 'string' || !/^[a-f0-9]{64}$/i.test(String(asset.sha256 || ''))) continue;
    const target = await safeMediaPath(projectRoot, asset.path);
    if (!target) { retained.push({ path: asset.path, reason: 'asset_not_safe_managed_media' }); continue; }
    let currentHash;
    try { currentHash = await sha256File(target); }
    catch (_error) { continue; }
    if (currentHash !== asset.sha256) { retained.push({ path: asset.path, reason: 'asset_hash_changed' }); continue; }
    try {
      await fs.unlink(target);
      removed.push(path.relative(projectRoot, target));
    } catch (_error) {
      retained.push({ path: asset.path, reason: 'asset_removal_failed' });
    }
  }

  return { discarded: removed.includes(path.relative(projectRoot, masterPath)), reason: 'technical_qa_rejected', removed, retained };
}

module.exports = { discardTechnicallyRejectedGeneration };
