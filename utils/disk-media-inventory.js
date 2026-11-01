'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { publicationSucceeded, isLegacyYouTubeUploadLimit } = require('./publication-status');
const { isPlatformTargeted, isShortsTargeted } = require('./platform-video-policy');

const MEDIA_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi']);
const DEFAULT_SCAN_ROOTS = ['.', '../remotion-pilot/out'];
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', '.venv', 'venv']);

function resolveProjectPath(root, candidate) {
  return path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
}

function normalizedHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch (_error) { return null; }
}

function isImageAssetUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return /(?:^|\.)googleusercontent\.com$/i.test(parsed.hostname)
      || /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(parsed.pathname);
  } catch (_error) { return false; }
}

function isAggregatorUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.hostname.toLowerCase() === 'news.google.com'
      || parsed.hostname.toLowerCase().endsWith('.news.google.com');
  } catch (_error) { return false; }
}

function sourceUrlFromEntry(entry) {
  const explicit = [
    entry?.sourceEvidence?.sourceUrl,
    entry?.sourceUrl,
    typeof entry?.source === 'object' ? entry.source.url : null,
    entry?.articleUrl
  ].map(normalizedHttpUrl).find(url => url && !isAggregatorUrl(url));
  if (explicit) return explicit;

  const recordUrl = normalizedHttpUrl(entry?.url);
  if (recordUrl && !isImageAssetUrl(recordUrl) && !isAggregatorUrl(recordUrl)) return recordUrl;
  return null;
}

function sourceNameFromEntry(entry) {
  const source = entry?.source;
  if (typeof source === 'string' && source.trim()) return source.trim();
  if (source && typeof source.name === 'string' && source.name.trim()) return source.name.trim();
  return null;
}

function rawDestinationResults(entry, artifact, root) {
  let results = {};
  if (artifact.role === 'master') {
    results = { ...(entry.results?.long || {}) };
    if (entry.ytUrl && !results.youtube) results.youtube = entry.ytUrl;
  } else {
    const match = Object.entries(entry.results?.clips || {})
      .find(([candidate]) => resolveProjectPath(root, candidate) === resolveProjectPath(root, artifact.path));
    if (match) results = match[1] || {};
  }
  return results;
}

function destinationStatuses(entry, artifact, root) {
  const results = rawDestinationResults(entry, artifact, root);
  return Object.fromEntries(Object.entries(results).map(([platform, value]) => [platform,
    publicationSucceeded(value) ? 'confirmed'
      : typeof value === 'string' && /^(?:ok|success|successful|publicado|postado)$/i.test(value.trim()) ? 'unknown'
      : value && typeof value === 'object' && typeof value.status === 'string' ? value.status
        : value == null || value === '' ? 'not_attempted'
          : isLegacyYouTubeUploadLimit(value, platform) ? 'quota_skipped_legacy'
          : typeof value === 'string' && value.trim().toLocaleLowerCase('pt-BR') === 'não logado' ? 'not_logged_legacy'
          : /pulado.*cota|quota/i.test(String(value)) ? 'quota_skipped_legacy'
            : /desativad|não alvo/i.test(String(value)) ? 'disabled_or_not_targeted_legacy'
              : /ignorado/i.test(String(value)) ? 'rejected_legacy'
                : 'legacy_or_unstructured'
  ]));
}

function destinationEvidence(entry, artifact, root) {
  const results = rawDestinationResults(entry, artifact, root);
  const statuses = destinationStatuses(entry, artifact, root);
  return Object.fromEntries(Object.entries(results).map(([platform, value]) => [platform, {
    status: statuses[platform] || 'not_attempted',
    account: typeof value?.account === 'string' ? value.account : null,
    artifactSha256: typeof value?.artifact?.sha256 === 'string' ? value.artifact.sha256 : null,
    legacyProof: typeof value === 'string' && /^https?:\/\//i.test(value.trim()),
    ...(typeof value === 'string' && /^https?:\/\//i.test(value.trim()) ? { url: value.trim() } : {}),
    ...(typeof value?.url === 'string' ? { url: value.url } : {}),
    ...(typeof value?.externalId === 'string' ? { externalId: value.externalId } : {}),
    ...(typeof value?.failureCode === 'string' ? { failureCode: value.failureCode } : {}),
    ...(typeof value?.confirmedAt === 'string' ? { confirmedAt: value.confirmedAt } : {}),
    ...(typeof value?.evidence?.kind === 'string' ? { evidenceKind: value.evidence.kind } : {})
  }]));
}

function requiredDestinations(entry, artifact, root) {
  if (artifact.role === 'master') {
    const targets = ['youtube'];
    if (/^(1|true|yes)$/i.test(String(process.env.X_POST_FULL_VIDEO || ''))) targets.push('x');
    return targets;
  }
  const clip = (Array.isArray(entry.clips) ? entry.clips : [])
    .map(item => typeof item === 'string' ? { path: item } : item)
    .find(item => item && typeof item.path === 'string'
      && resolveProjectPath(root, item.path) === resolveProjectPath(root, artifact.path));
  if (!clip) return [];
  const targets = ['instagram', 'tiktok', 'kwai', 'x'].filter(platform => isPlatformTargeted(clip, platform));
  const clips = (Array.isArray(entry.clips) ? entry.clips : [])
    .map(item => typeof item === 'string' ? { path: item } : item)
    .filter(item => item && typeof item.path === 'string' && isShortsTargeted(item));
  const rawMaximum = Number(process.env.MAX_SHORTS || Number.MAX_SAFE_INTEGER);
  const count = Math.max(0, Math.floor(Number.isFinite(rawMaximum) ? rawMaximum : 1));
  const selectedIndex = clips.findIndex(item =>
    resolveProjectPath(root, item.path) === resolveProjectPath(root, artifact.path));
  if (selectedIndex >= 0 && selectedIndex < count) targets.push('shorts');
  return targets;
}

function artifactMetadata(entry, artifact, root) {
  if (artifact.role === 'master') return { requiredDestinations: requiredDestinations(entry, artifact, root) };
  const clip = (Array.isArray(entry.clips) ? entry.clips : [])
    .map(item => typeof item === 'string' ? { path: item } : item)
    .find(item => item && typeof item.path === 'string'
      && resolveProjectPath(root, item.path) === resolveProjectPath(root, artifact.path));
  return {
    kind: clip?.kind || null,
    platforms: Array.isArray(clip?.platforms) ? clip.platforms : [],
    partIndex: Number.isInteger(clip?.partIndex) ? clip.partIndex : null,
    partCount: Number.isInteger(clip?.partCount) ? clip.partCount : null,
    requiredDestinations: requiredDestinations(entry, artifact, root)
  };
}

function isBrowserExtensionResource(filePath, projectRoot) {
  const relative = path.relative(projectRoot, filePath).split(path.sep);
  const browserProfiles = relative.findIndex((part, index) => part === 'data' && relative[index + 1] === 'browser-profiles');
  return browserProfiles >= 0 && relative.slice(browserProfiles + 2).includes('Extensions');
}

async function listVideos(scanRoots, projectRoot) {
  const videos = new Map();
  const pending = scanRoots.map(candidate => resolveProjectPath(projectRoot, candidate));
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name) && !isBrowserExtensionResource(path.join(fullPath, 'placeholder'), projectRoot)) {
          pending.push(fullPath);
        }
      } else if (entry.isFile() && MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const stat = await fs.stat(fullPath);
        videos.set(path.resolve(fullPath), {
          path: path.resolve(fullPath), sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString()
        });
      }
    }
  }
  return [...videos.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function readLedgersAndQueues(root, configuredStateDir) {
  const dataRoot = path.join(root, 'data');
  const stateDirs = new Set([path.resolve(root, configuredStateDir || 'data/state')]);
  try {
    for (const item of await fs.readdir(dataRoot, { withFileTypes: true })) {
      if (item.isDirectory() && /^state(?:-|$)/i.test(item.name)) stateDirs.add(path.join(dataRoot, item.name));
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const records = new Map();
  const queuedPaths = new Set();
  for (const stateDir of stateDirs) {
    try {
      const ledger = JSON.parse(await fs.readFile(path.join(stateDir, 'topics.json'), 'utf8'));
      for (const entry of Array.isArray(ledger.entries) ? ledger.entries : []) {
        if (!entry || typeof entry !== 'object') continue;
        const artifacts = [
          ...(typeof entry.videoPath === 'string' ? [{ path: entry.videoPath, role: 'master' }] : []),
          ...(Array.isArray(entry.clips) ? entry.clips.map(clip => ({
            path: typeof clip === 'string' ? clip : clip?.path,
            role: 'clip'
          })) : [])
        ];
        for (const artifact of artifacts) {
          if (typeof artifact.path !== 'string' || !artifact.path) continue;
          const key = resolveProjectPath(root, artifact.path);
          const list = records.get(key) || [];
          list.push({
            role: artifact.role,
            ...artifactMetadata(entry, artifact, root),
            title: typeof entry.title === 'string' ? entry.title : null,
            themeId: typeof entry.themeId === 'string' ? entry.themeId : null,
            sourceName: sourceNameFromEntry(entry),
            originTitle: typeof entry.originTitle === 'string' ? entry.originTitle : null,
            sourceUrl: sourceUrlFromEntry(entry),
            originUrl: normalizedHttpUrl(entry.originUrl),
            sourceEvidence: entry.sourceEvidence && typeof entry.sourceEvidence === 'object' ? {
              eligible: entry.sourceEvidence.eligible === true,
              ...(typeof entry.sourceEvidence.reason === 'string' ? { reason: entry.sourceEvidence.reason } : {}),
              ...(typeof entry.sourceEvidence.mode === 'string' ? { mode: entry.sourceEvidence.mode } : {}),
              ...(typeof entry.sourceEvidence.contextHash === 'string' ? { contextHash: entry.sourceEvidence.contextHash } : {}),
              ...(Number.isSafeInteger(entry.sourceEvidence.contextChars) ? { contextChars: entry.sourceEvidence.contextChars } : {}),
              ...(Number.isSafeInteger(entry.sourceEvidence.contextWords) ? { contextWords: entry.sourceEvidence.contextWords } : {}),
              ...(typeof entry.sourceEvidence.checkedAt === 'string' ? { checkedAt: entry.sourceEvidence.checkedAt } : {})
            } : null,
            jobId: typeof entry.jobId === 'string' ? entry.jobId : null,
            publicationEligible: typeof entry.publicationEligible === 'boolean' ? entry.publicationEligible : null,
            publicationReviewStatus: typeof entry.publicationReview?.status === 'string' ? entry.publicationReview.status : null,
            qaManifestPath: typeof entry.qaManifestPath === 'string' ? entry.qaManifestPath : null,
            qaManifestSha256: typeof entry.qaManifestSha256 === 'string' ? entry.qaManifestSha256 : null,
            destinations: destinationStatuses(entry, artifact, root),
            destinationEvidence: destinationEvidence(entry, artifact, root)
          });
          records.set(key, list);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error instanceof SyntaxError) {
        throw new Error(`ledger inválido em ${path.join(stateDir, 'topics.json')}: ${error.message}`);
      }
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      const queue = JSON.parse(await fs.readFile(path.join(stateDir, 'publish-queue.json'), 'utf8'));
      for (const item of [...(queue.pending || []), ...(queue.inFlight ? [queue.inFlight] : [])]) {
        if (typeof item?.outPath === 'string' && item.outPath) queuedPaths.add(resolveProjectPath(root, item.outPath));
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error instanceof SyntaxError) {
        throw new Error(`fila inválida em ${path.join(stateDir, 'publish-queue.json')}: ${error.message}`);
      }
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { records, queuedPaths };
}

async function scanDiskMediaInventory({ root, stateDir = 'data/state', now = new Date(), scanRoots = DEFAULT_SCAN_ROOTS } = {}) {
  const projectRoot = path.resolve(root || path.join(__dirname, '..'));
  const [videos, state] = await Promise.all([
    listVideos(scanRoots, projectRoot),
    readLedgersAndQueues(projectRoot, stateDir)
  ]);
  const files = videos.map(video => {
    const records = state.records.get(video.path) || [];
    const queued = state.queuedPaths.has(video.path);
    return {
      ...video,
      classification: queued ? 'queued' : records.length ? 'ledger-linked' : 'untracked',
      ledger: records
    };
  });
  const totals = files.reduce((acc, file) => {
    acc.files++;
    acc.bytes += file.sizeBytes;
    acc[file.classification]++;
    return acc;
  }, { files: 0, bytes: 0, queued: 0, 'ledger-linked': 0, untracked: 0 });
  return {
    schemaVersion: 1,
    scannedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    root: projectRoot,
    scanRoots: scanRoots.map(candidate => path.resolve(projectRoot, candidate)),
    supportedExtensions: [...MEDIA_EXTENSIONS],
    totals,
    files
  };
}

module.exports = { scanDiskMediaInventory, MEDIA_EXTENSIONS, DEFAULT_SCAN_ROOTS, destinationEvidence, destinationStatuses,
  sourceUrlFromEntry, sourceNameFromEntry, isImageAssetUrl, isAggregatorUrl };
