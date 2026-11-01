'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { updateTopicLedger } = require('./topic-ledger');
const {
  verifyVideoQaManifest, normalizeSceneReferences, inspectNarrationAudio,
  inspectScriptCache, inspectSceneImageAssets, normalizeReplaySourceContext
} = require('./video-qa-manifest');
const { normalizeSceneCorrection } = require('./scene-visual-critique');
const { resolveEditorialFormat } = require('./editorial-formats');

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function writeAtomic(filePath, bytes, mode = 0o600) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, bytes, { flag: 'wx', mode });
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function normalizeVisualCritique(critique, scenePlan) {
  if (!critique || critique.schemaVersion !== 1 || !Array.isArray(critique.findings)
    || critique.findings.length < 1 || critique.findings.length > 50) {
    throw new TypeError('visual critique must contain 1–50 findings in schemaVersion 1');
  }
  if (!scenePlan || scenePlan.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(String(scenePlan.sha256 || ''))
    || !Array.isArray(scenePlan.sceneIds)) {
    throw new Error('QA manifest has no hash-bound scene plan for critique');
  }
  const knownSceneIds = new Set(scenePlan.sceneIds);
  const findings = critique.findings.map((finding, index) => {
    const sceneId = String(finding?.sceneId || '').trim();
    const category = String(finding?.category || '').trim();
    const severity = String(finding?.severity || '').trim();
    const issue = String(finding?.issue || '').replace(/\s+/g, ' ').trim();
    const recommendedFix = String(finding?.recommendedFix || '').replace(/\s+/g, ' ').trim();
    if (!knownSceneIds.has(sceneId)) throw new Error(`visual critique finding ${index + 1} references unknown scene: ${sceneId}`);
    if (!['composition', 'typography', 'contrast', 'motion', 'depth', 'integration', 'clarity', 'other'].includes(category)) {
      throw new TypeError(`visual critique finding ${index + 1} has invalid category`);
    }
    if (!['low', 'medium', 'high'].includes(severity)) throw new TypeError(`visual critique finding ${index + 1} has invalid severity`);
    if (!issue || issue.length > 500 || !recommendedFix || recommendedFix.length > 500) {
      throw new TypeError(`visual critique finding ${index + 1} requires an issue and a concrete recommendedFix`);
    }
    const correction = normalizeSceneCorrection(finding?.correction);
    return { sceneId, category, severity, issue, recommendedFix, correction };
  });
  return { schemaVersion: 1, findings };
}

function normalizeVisualRebuildEditorial(editorial, sourceReview = {}) {
  const targetWords = Number.isSafeInteger(editorial?.targetWords) ? editorial.targetWords : null;
  const formatVersion = Number.isInteger(editorial?.formatVersion) && editorial.formatVersion > 0
    ? editorial.formatVersion : 1;
  const seed = Number.isSafeInteger(editorial?.seed) && editorial.seed >= 0 ? editorial.seed : null;
  const result = {
    themeId: String(editorial?.themeId || '').trim(),
    topic: String(editorial?.topic || sourceReview.sourceTitle || '').replace(/\s+/g, ' ').trim(),
    targetWords,
    formatId: editorial?.formatId && editorial.formatId !== 'unknown' ? String(editorial.formatId) : null,
    formatVersion,
    scriptRevision: String(editorial?.scriptRevision || ''),
    seed,
    hook: String(editorial?.hook || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    visualMode: String(editorial?.visualMode || 'unknown')
  };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(result.themeId)
    || result.topic.length > 300
    || (targetWords !== null && (targetWords < 1 || targetWords > 10000))
    || !Number.isInteger(result.formatVersion) || result.formatVersion < 1
    || !result.scriptRevision || result.scriptRevision.length > 120
    || !['ai-generated-scenes', 'mixed-generated-scenes', 'graphics-and-source-prints', 'narrative-episode-v1', 'narrative-episode-v2'].includes(result.visualMode)) {
    throw new Error('source QA manifest lacks complete, reproducible editorial metadata');
  }
  if (result.formatId !== null) resolveEditorialFormat({ formatId: result.formatId });
  return result;
}

function resolveVisualRebuildEditorial(sourceEditorial, requested = {}) {
  const editorial = normalizeVisualRebuildEditorial(sourceEditorial, requested.sourceReview);
  const checks = [
    ['themeId', requested.themeId],
    ['topic', requested.topic],
    ['targetWords', requested.targetWords],
    ['formatId', requested.formatId],
    ['seed', requested.seed]
  ];
  for (const [key, value] of checks) {
    if (value === undefined || value === null || value === '') continue;
    const comparable = ['targetWords', 'seed'].includes(key) ? Number(value) : String(value);
    if (editorial[key] !== null && comparable !== editorial[key]) {
      throw new Error(`visual rebuild ${key} conflicts with the source QA manifest`);
    }
    if (editorial[key] === null) editorial[key] = comparable;
  }
  if (!editorial.topic || !Number.isSafeInteger(editorial.targetWords)
    || editorial.targetWords < 1 || editorial.targetWords > 10000) {
    throw new Error('visual rebuild requires the original --topic and --words values');
  }
  if (!Number.isSafeInteger(editorial.seed) || editorial.seed < 0 || !editorial.formatId) {
    throw new Error('visual rebuild requires the original --seed and --format values');
  }
  resolveEditorialFormat({ formatId: editorial.formatId });
  return editorial;
}

async function loadVisualRebuildCritique({
  root = path.join(__dirname, '..'),
  manifestPath,
  expectedManifestSha256
} = {}) {
  const projectRoot = path.resolve(root);
  if (typeof manifestPath !== 'string' || !manifestPath.trim()
    || !/^[a-f0-9]{64}$/.test(String(expectedManifestSha256 || ''))) {
    throw new TypeError('visual rebuild requires a QA manifest path and expected SHA-256');
  }
  const resolvedManifestPath = path.isAbsolute(manifestPath)
    ? path.resolve(manifestPath) : path.resolve(projectRoot, manifestPath);
  const qaDirectory = path.join(projectRoot, 'data', 'reports', 'qa');
  if (!isWithin(qaDirectory, resolvedManifestPath)) throw new Error('critique manifest must be inside data/reports/qa');
  const bytes = await fsp.readFile(resolvedManifestPath);
  const manifestSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (manifestSha256 !== expectedManifestSha256) throw new Error('visual critique manifest hash changed');
  const verified = await verifyVideoQaManifest({
    root: projectRoot,
    manifestPath: resolvedManifestPath,
    manifestSha256
  });
  if (verified.status !== 'verified') throw new Error(`visual critique QA manifest is invalid: ${verified.reason}`);
  if (typeof verified.masterPath !== 'string' || !verified.masterPath) {
    throw new Error('visual critique source QA manifest has no verified master path');
  }
  const manifest = JSON.parse(bytes.toString('utf8'));
  const sourceEditorial = normalizeVisualRebuildEditorial(manifest.editorial, manifest.sourceReview);
  if (!manifest.narrationAudio?.path || !manifest.narrationAudio?.sha256) {
    throw new Error('source QA manifest lacks hash-bound narration required for visual rebuild');
  }
  const narrationAudio = await inspectNarrationAudio({
    root: projectRoot,
    filePath: manifest.narrationAudio.path,
    inputSha256: manifest.narrationAudio.inputSha256
  });
  if (narrationAudio.sha256 !== manifest.narrationAudio.sha256
    || narrationAudio.sizeBytes !== manifest.narrationAudio.sizeBytes) {
    throw new Error('source QA narration asset hash or size changed');
  }
  const sourceContext = normalizeReplaySourceContext(manifest.sourceReview?.sourceContext, manifest.sourceReview?.sourceHash);
  if (!/^[a-f0-9]{64}$/.test(String(manifest.scriptCache?.script?.sha256 || ''))
    || !/^[a-f0-9]{64}$/.test(String(manifest.scriptCache?.metadata?.sha256 || ''))) {
    throw new Error('source QA manifest lacks hash-bound script cache required for visual rebuild');
  }
  const scriptCache = await inspectScriptCache({ root: projectRoot, scriptCache: manifest.scriptCache });
  if (!scriptCache) throw new Error('source QA manifest lacks hash-bound script cache required for visual rebuild');
  const sceneImageAssets = await inspectSceneImageAssets({ root: projectRoot, assets: manifest.sceneImageAssets });
  if (!sceneImageAssets) throw new Error('source QA manifest lacks hash-bound scene images required for visual rebuild');
  const sceneReferences = normalizeSceneReferences(manifest.sceneReferences);
  if (!sceneReferences) throw new Error('source QA manifest lacks replayable scene references');
  const stored = manifest.visualReview?.critique;
  if (manifest.visualReview?.status !== 'rejected' || manifest.visualReview?.rebuildRequired !== true || !stored) {
    throw new Error('QA manifest does not contain a rejected, rebuildable visual critique');
  }
  if (!/^[a-f0-9]{64}$/.test(String(stored.sourceQaManifestSha256 || ''))
    || !/^[a-f0-9]{64}$/.test(String(stored.sourceScenePlanSha256 || ''))
    || stored.sourceScenePlanSha256 !== manifest.scenePlan?.sha256
    || stored.sourceScenePlanSha256 !== verified.scenePlan?.sha256) {
    throw new Error('visual critique source hashes do not match its QA scene plan');
  }
  const normalized = normalizeVisualCritique(stored, manifest.scenePlan);
  const targets = [...new Set(normalized.findings.map(finding => finding.sceneId))].sort();
  const declared = [...new Set((stored.sceneIds || []).map(String))].sort();
  if (!targets.length || JSON.stringify(targets) !== JSON.stringify(declared)) {
    throw new Error('visual critique scene IDs do not match its findings');
  }
  return {
    schemaVersion: normalized.schemaVersion,
    sourceMasterPath: verified.masterPath,
    sourceQaManifestSha256: stored.sourceQaManifestSha256,
    critiqueManifestSha256: manifestSha256,
    sourceScenePlanSha256: stored.sourceScenePlanSha256,
    sourceEditorial,
    sourceContext,
    narrationAudio: { ...narrationAudio, path: path.resolve(projectRoot, narrationAudio.path) },
    scriptCache: {
      scriptPath: path.resolve(projectRoot, scriptCache.script.path),
      metadataPath: path.resolve(projectRoot, scriptCache.metadata.path),
      scriptSha256: scriptCache.script.sha256,
      metadataSha256: scriptCache.metadata.sha256
    },
    sceneImageAssets: sceneImageAssets.map(asset => ({ ...asset, path: path.resolve(projectRoot, asset.path) })),
    sceneReferences,
    sourceReview: {
      sourceHash: manifest.sourceReview?.sourceHash || null,
      sourceTitle: String(manifest.sourceReview?.sourceTitle || sourceEditorial.topic),
      sourceUrl: typeof manifest.sourceReview?.sourceUrl === 'string' ? manifest.sourceReview.sourceUrl : null,
      sourceName: String(manifest.sourceReview?.sourceName || ''),
      sourceTimeLabel: String(manifest.sourceReview?.sourceTimeLabel || ''),
      factualReviewStatus: String(manifest.sourceReview?.factualReviewStatus || 'unavailable'),
      reviewer: String(manifest.sourceReview?.reviewer || '')
    },
    sceneIds: declared,
    findings: normalized.findings
  };
}

async function recordVideoVisualReview({
  root = path.join(__dirname, '..'),
  manifestPath,
  ledgerPath = path.join(root, process.env.STATE_DIR || 'data/state', 'topics.json'),
  reviewer,
  status = 'approved',
  approvedPaths = [],
  note = '',
  method = 'manual',
  authorization = null,
  expectedManifestSha256 = null,
  validateEntry = null,
  critique = null
} = {}) {
  const projectRoot = path.resolve(root);
  if (!['approved', 'rejected'].includes(status)) throw new TypeError('review status must be approved or rejected');
  if (!['manual', 'owner-delegated-automatic'].includes(method)) throw new TypeError('invalid review method');
  if (method === 'owner-delegated-automatic' && !/^[a-f0-9]{64}$/.test(authorization?.policySha256 || '')) {
    throw new TypeError('automatic review requires an authorization policy hash');
  }
  const reviewerName = String(reviewer || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!reviewerName) throw new TypeError('reviewer is required');
  if (typeof manifestPath !== 'string' || !manifestPath.trim()) throw new TypeError('manifestPath is required');
  if (!Array.isArray(approvedPaths) || (status === 'approved' && approvedPaths.length === 0)) {
    throw new TypeError('an approved review must list at least one reviewed asset');
  }
  if (status === 'rejected' && approvedPaths.length > 0) {
    throw new TypeError('a rejected review cannot approve assets');
  }
  if (critique !== null && (status !== 'rejected' || !/^[a-f0-9]{64}$/.test(String(expectedManifestSha256 || '')))) {
    throw new TypeError('a visual critique requires rejected status and the expected source manifest SHA-256');
  }

  const resolvedManifestPath = path.isAbsolute(manifestPath)
    ? path.resolve(manifestPath)
    : path.resolve(projectRoot, manifestPath || '');
  const resolvedLedgerPath = path.isAbsolute(ledgerPath)
    ? path.resolve(ledgerPath)
    : path.resolve(projectRoot, ledgerPath);
  const qaDirectory = path.join(projectRoot, 'data', 'reports', 'qa');
  if (!isWithin(qaDirectory, resolvedManifestPath)) throw new Error('manifest must be inside data/reports/qa');

  const originalBytes = await fsp.readFile(resolvedManifestPath);
  const originalHash = crypto.createHash('sha256').update(originalBytes).digest('hex');
  if (expectedManifestSha256 && originalHash !== expectedManifestSha256) throw new Error('manifest changed before review');
  const verified = await verifyVideoQaManifest({
    root: projectRoot,
    manifestPath: resolvedManifestPath,
    manifestSha256: originalHash
  });
  if (verified.status !== 'verified') throw new Error(`QA manifest is not valid: ${verified.reason}`);
  const manifest = JSON.parse(originalBytes.toString('utf8'));
  const normalizedCritique = critique === null ? null : normalizeVisualCritique(critique, manifest.scenePlan);
  const assets = new Map(manifest.assets.map(asset => [
    path.resolve(projectRoot, asset.path), asset.sha256
  ]));
  if (verified.thumbnail) assets.set(path.resolve(verified.thumbnail.path), verified.thumbnail.sha256);
  if (verified.portraitThumbnail) assets.set(path.resolve(verified.portraitThumbnail.path), verified.portraitThumbnail.sha256);

  const approvedAssets = [];
  for (const value of approvedPaths) {
    const assetPath = path.isAbsolute(value) ? path.resolve(value) : path.resolve(projectRoot, value);
    const sha256 = assets.get(assetPath);
    if (!sha256) throw new Error(`reviewed path is not a hash-bound asset in this manifest: ${value}`);
    if (approvedAssets.some(asset => asset.path === assetPath)) throw new Error(`duplicate reviewed path: ${value}`);
    approvedAssets.push({ path: path.relative(projectRoot, assetPath), sha256 });
  }
  const masterAsset = manifest.assets.find(asset => asset.role === 'master');
  const masterPath = masterAsset ? path.resolve(projectRoot, masterAsset.path) : null;
  if (status === 'approved' && masterPath && approvedAssets.some(asset => path.resolve(projectRoot, asset.path) === masterPath)) {
    if (!verified.thumbnail || !approvedAssets.some(asset => path.resolve(projectRoot, asset.path) === verified.thumbnail.path
      && asset.sha256 === verified.thumbnail.sha256)) {
      throw new Error('approving a master also requires reviewing its hash-bound thumbnail');
    }
    if (verified.coverVariants?.requiredFormats?.includes('9:16')
      && (!verified.portraitThumbnail || !approvedAssets.some(asset => path.resolve(projectRoot, asset.path) === verified.portraitThumbnail.path
        && asset.sha256 === verified.portraitThumbnail.sha256))) {
      throw new Error('approving this master also requires reviewing its hash-bound portrait thumbnail');
    }
  }

  const reviewerNote = String(note || (normalizedCritique
    ? `${normalizedCritique.findings.length} cena(s) marcadas para reconstrução visual.` : ''))
    .replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (status === 'rejected' && !reviewerNote) throw new TypeError('a rejected review must include a note');
  const reviewedAt = new Date().toISOString();
  manifest.visualReview = {
    ...manifest.visualReview,
    status,
    method,
    authorization: method === 'owner-delegated-automatic' ? authorization : null,
    reviewer: reviewerName,
    reviewedAt,
    ...(reviewerNote ? { note: reviewerNote } : {}),
    approvedAssets,
    ...(normalizedCritique ? {
      rebuildRequired: true,
      critique: {
        schemaVersion: normalizedCritique.schemaVersion,
        sourceQaManifestSha256: originalHash,
        sourceScenePlanSha256: manifest.scenePlan.sha256,
        sceneIds: [...new Set(normalizedCritique.findings.map(finding => finding.sceneId))],
        findings: normalizedCritique.findings
      }
    } : {})
  };
  const nextBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const nextHash = crypto.createHash('sha256').update(nextBytes).digest('hex');
  const stat = await fsp.stat(resolvedManifestPath);
  await writeAtomic(resolvedManifestPath, nextBytes, stat.mode & 0o777);

  try {
    await updateTopicLedger(resolvedLedgerPath, ledger => {
      const matching = ledger.entries.filter(entry => {
        const entryManifestPath = typeof entry.qaManifestPath === 'string'
          ? (path.isAbsolute(entry.qaManifestPath)
            ? path.resolve(entry.qaManifestPath)
            : path.resolve(projectRoot, entry.qaManifestPath))
          : null;
        return entry.videoId === manifest.videoId || entryManifestPath === resolvedManifestPath;
      });
      if (matching.length !== 1) {
        throw new Error(`expected one matching topic-ledger entry; found ${matching.length}`);
      }
      if (expectedManifestSha256 && matching[0].qaManifestSha256 !== expectedManifestSha256) {
        throw new Error('ledger manifest hash changed before review');
      }
      if (validateEntry && !validateEntry(matching[0])) throw new Error('publication eligibility changed before review');
      matching[0].qaManifestPath = path.relative(projectRoot, resolvedManifestPath);
      matching[0].qaManifestSha256 = nextHash;
      return ledger;
    });
  } catch (error) {
    await writeAtomic(resolvedManifestPath, originalBytes, stat.mode & 0o777).catch(rollbackError => {
      error.message += `; manifest rollback also failed: ${rollbackError.message}`;
    });
    throw error;
  }

  return {
    videoId: manifest.videoId,
    visualMode: manifest.editorial?.visualMode || 'unknown',
    status,
    reviewer: reviewerName,
    reviewedAt,
    approvedAssets,
    rebuildRequired: Boolean(normalizedCritique),
    ...(normalizedCritique ? { findings: normalizedCritique.findings } : {}),
    manifestPath: path.relative(projectRoot, resolvedManifestPath),
    manifestSha256: nextHash,
    ledgerPath: path.relative(projectRoot, resolvedLedgerPath)
  };
}

module.exports = { recordVideoVisualReview, loadVisualRebuildCritique, normalizeVisualCritique,
  normalizeVisualRebuildEditorial, resolveVisualRebuildEditorial };
