#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { scanDiskMediaInventory } = require('../utils/disk-media-inventory');

const ROOT = path.resolve(__dirname, '..');
const WORKSPACE = path.dirname(ROOT);
require('dotenv').config({ path: path.join(ROOT, '.env') });
const BASELINE_PATH = path.join(ROOT, 'docs/evidencias/backlog-drain-baseline-2026-10-21.json');

function outsideLedgerDisposition(relativePath) {
  if (relativePath.startsWith('data/videos/')) return 'orphan_requires_provenance';
  if (relativePath.startsWith('docs/evidencias/')) return 'qa_evidence_preserve';
  if (/^experiments\/hyperframes-pulso-pilot\/renders\/(?:pulso-ia-piloto-robot-aprovado|pulso-ia-robo-referencia-aprovada)-.*\.mp4$/i.test(relativePath)) {
    return 'mascot_pilot_review_pending';
  }
  if (relativePath.startsWith('data/previews/') || relativePath.startsWith('renders/')
    || relativePath.startsWith('experiments/') && relativePath.includes('/renders/')) return 'evaluation_render_discard_candidate';
  if (relativePath.startsWith('../remotion-pilot/out/')) return 'legacy_remotion_render_requires_review';
  return 'unclassified_output_requires_review';
}

function nextActionFor(classification) {
  return ({
    active_queue_protected: 'aguardar o fluxo ativo e reclassificar após conclusão',
    all_destinations_confirmed_cleanup_ready: 'excluir com SHA revalidado e registrar a liberação',
    publication_pending: 'validar QA/hash e deixar o scheduler enviar os destinos ainda sem confirmação',
    reconcile_before_retry_or_delete: 'reconciliar na conta correta; não reenviar nem excluir enquanto incerto',
    qa_rejected_destination_reconciliation_required: 'recuperar prova de cada destino do ativo reprovado; não excluir enquanto houver resultado ausente ou incerto',
    qa_unapproved_delete_before_recreate: 'aposentar o arquivo com SHA e preservar a fonte para recriação posterior',
    shared_unapproved_with_legacy_owner_requires_disposition: 'resolver todas as referências ao mesmo arquivo antes de limpar',
    legacy_or_no_target_requires_disposition: 'recuperar alvo/QA da origem antiga; não enviar automaticamente',
    orphan_requires_provenance: 'localizar produção, fonte e QA; então publicar ou descartar conforme evidência',
    qa_evidence_preserve: 'preservar como prova, fora do backlog de publicação',
    mascot_pilot_review_pending: 'manter o piloto da nova referência até concluir QA visual/auditivo e registrar a promoção',
    evaluation_render_discard_candidate: 'excluir como render de avaliação após confirmar que não é evidência',
    qa_recovery_required: 'recuperar ou reconstruir QA hash-bound antes de liberar publicação; manter o arquivo preservado',
    publication_eligibility_review_required: 'reconciliar fonte e revisão factual no ledger antes de publicar ou excluir',
    destination_setup_required: 'resolver handler, identidade ou sessão desta conta; manter o destino em espera',
    baseline_missing_unproven: 'localizar evidência de aposentadoria; caminho ausente não prova exclusão segura',
    baseline_retired_path_size_match: 'manter registro de exclusão com hash/tamanho; comparar SHA da baseline se disponível',
    legacy_remotion_render_requires_review: 'confirmar se é saída de avaliação ou produção antes de publicar/excluir',
    unclassified_output_requires_review: 'identificar origem e função antes de publicar/excluir'
  })[classification] || 'investigar a origem e registrar a próxima ação';
}

function compactOwnerMetadata(owner) {
  return {
    jobId: owner.jobId,
    role: owner.role,
    kind: owner.kind || null,
    title: owner.title || null,
    themeId: owner.themeId || null,
    sourceName: owner.sourceName || null,
    originTitle: owner.originTitle || null,
    sourceUrl: owner.sourceUrl || null,
    originUrl: owner.originUrl || null,
    sourceEvidence: owner.sourceEvidence || null,
    platforms: owner.platforms || [],
    requiredDestinations: owner.requiredDestinations || [],
    publicationEligible: owner.publicationEligible,
    publicationReviewStatus: owner.publicationReviewStatus,
    qaManifestPath: owner.qaManifestPath,
    destinations: owner.destinations,
    destinationProofs: owner.destinationProofs
  };
}

function classifyFile(file, relativePath, qaRecords = file.qa || []) {
  if (file.classification === 'queued') return 'active_queue_protected';
  if (file.classification === 'untracked') return outsideLedgerDisposition(relativePath);
  const owners = Array.isArray(file.ledger) ? file.ledger : [];
  const targets = owners.flatMap(owner => owner.requiredDestinations || []);
  const unapprovedOwners = owners.filter(owner => owner.publicationEligible === false || owner.publicationReviewStatus === 'rejected');
  const uncertainStatuses = new Set(['unknown', 'submitted', 'processing', 'attempting']);
  if (owners.some(owner => Object.values(owner.destinations || {}).some(status => uncertainStatuses.has(status)))) {
    return 'reconcile_before_retry_or_delete';
  }
  if (unapprovedOwners.length && unapprovedOwners.length !== owners.length) {
    return 'shared_unapproved_with_legacy_owner_requires_disposition';
  }
  if (unapprovedOwners.length) {
    const hasCompleteDestinationProof = owners.every(owner => {
      const destinations = Object.entries(owner.destinations || {});
      if (!destinations.length) return false;
      if ((owner.requiredDestinations || []).some(platform => !Object.hasOwn(owner.destinations || {}, platform))) {
        return false;
      }
      return destinations.every(([platform, status]) => {
        const proof = owner.destinationProofs?.[platform] || {};
        if (['not_attempted', 'not_logged_legacy', 'skipped', 'disabled_or_not_targeted_legacy', 'quota_skipped_legacy'].includes(status)) {
          return true;
        }
        if (status === 'failed' && proof.evidenceKind === 'confirmed_no_send') return true;
        return status === 'confirmed' && Boolean(file.currentSha256)
          && proof.artifactSha256 === file.currentSha256 && proof.legacyProof !== true;
      });
    });
    return hasCompleteDestinationProof
      ? 'qa_unapproved_delete_before_recreate'
      : 'qa_rejected_destination_reconciliation_required';
  }
  if (!targets.length) return 'legacy_or_no_target_requires_disposition';

  const qaByOwner = new Map(qaRecords.map(record => [record.ownerIndex, record]));
  const allTargets = owners.flatMap(owner => (owner.requiredDestinations || []).map(platform => {
    const proof = owner.destinationProofs?.[platform] || {};
    return {
      platform,
      status: owner.destinations?.[platform] || 'not_attempted',
      artifactSha256: proof.artifactSha256 || null,
      legacyProof: proof.legacyProof === true,
      failureCode: proof.failureCode || null
    };
  }));
  if (allTargets.some(target => target.status === 'confirmed'
    && (target.artifactSha256 !== file.currentSha256 || target.legacyProof))) {
    return 'reconcile_before_retry_or_delete';
  }
  if (allTargets.some(target => target.legacyProof || target.status === 'legacy_or_unstructured')) {
    return 'reconcile_before_retry_or_delete';
  }
  if (owners.some(owner => owner.publicationEligible !== true)) return 'publication_eligibility_review_required';
  if (owners.some((_owner, ownerIndex) => qaByOwner.get(ownerIndex)?.publicationReady !== true)) return 'qa_recovery_required';
  if (allTargets.some(target => ['social_handler_unavailable', 'social_account_identity_unverified'].includes(target.failureCode))) {
    return 'destination_setup_required';
  }
  if (allTargets.length && allTargets.every(target => target.status === 'confirmed')) return 'all_destinations_confirmed_cleanup_ready';
  return 'publication_pending';
}

function destinationProof(value, status) {
  if (typeof value === 'string') {
    return {
      status,
      account: null,
      artifactSha256: null,
      legacyProof: /^https?:\/\//i.test(value.trim()),
      ...( /^https?:\/\//i.test(value.trim()) ? { url: value.trim() } : {} )
    };
  }
  if (!value || typeof value !== 'object') return { status, account: null, artifactSha256: null, legacyProof: false };
  return {
    status: value.status || status,
    account: typeof value.account === 'string' ? value.account : null,
    artifactSha256: typeof value.artifactSha256 === 'string' ? value.artifactSha256
      : typeof value.artifact?.sha256 === 'string' ? value.artifact.sha256 : null,
    legacyProof: value.legacyProof === true,
    ...(typeof value.url === 'string' ? { url: value.url } : {}),
    ...(typeof value.externalId === 'string' ? { externalId: value.externalId } : {}),
    ...(typeof value.failureCode === 'string' ? { failureCode: value.failureCode } : {}),
    ...(typeof value.confirmedAt === 'string' ? { confirmedAt: value.confirmedAt } : {}),
    ...(typeof value.evidence?.kind === 'string' ? { evidenceKind: value.evidence.kind } : {})
  };
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isConclusiveBaselineDeletion(record, { baselineTime, baselineSize, baselineSha } = {}) {
  const deletionTime = Date.parse(record?.completedAt || record?.recordedAt || '');
  const hashValid = /^[a-f0-9]{64}$/i.test(String(record?.sha256 || ''));
  const sizeMatches = Number.isSafeInteger(record?.sizeBytes) && record.sizeBytes === baselineSize;
  const hashMatches = baselineSha ? record.sha256 === baselineSha : null;
  return Number.isFinite(baselineTime) && Number.isFinite(deletionTime) && deletionTime >= baselineTime
    && hashValid && sizeMatches && hashMatches !== false;
}

function indexBaselineDeletions(records, baselinePaths, { root = ROOT, workspace = WORKSPACE } = {}) {
  const knownBaselinePaths = baselinePaths instanceof Set ? baselinePaths : new Set(baselinePaths);
  const byPath = new Map();
  for (const record of records || []) {
    if (typeof record?.path !== 'string' || !record.path.trim()) continue;
    const candidates = path.isAbsolute(record.path)
      ? [path.resolve(record.path)]
      : [...new Set([path.resolve(root, record.path), path.resolve(workspace, record.path)])];
    const matchedPaths = candidates.filter(candidate => knownBaselinePaths.has(candidate));
    // A relative deletion path can be project-relative or workspace-relative.
    // Ignore it when both interpretations point at baseline candidates.
    if (matchedPaths.length !== 1) continue;
    const [key] = matchedPaths;
    const list = byPath.get(key) || [];
    list.push(record);
    byPath.set(key, list);
  }
  return byPath;
}

function isPublicationQaReady({ owner, manifest, recordedAsset, filePath, currentSha256,
  currentSizeBytes, manifestHashMatches, root } = {}) {
  const target = path.resolve(filePath || '');
  const projectRoot = path.resolve(root || ROOT);
  if (!isWithin(path.join(projectRoot, 'data', 'videos'), target)) return false;
  const recordedPathMatches = Boolean(recordedAsset?.path
    && path.resolve(projectRoot, recordedAsset.path) === target);
  const sourceHash = owner?.sourceEvidence?.contextHash;
  const sourceHashMatches = /^[a-f0-9]{64}$/i.test(String(sourceHash || ''))
    && manifest?.sourceReview?.sourceHash === sourceHash;
  const visualApproved = manifest?.visualReview?.status === 'approved'
    && Array.isArray(manifest.visualReview.approvedAssets)
    && manifest.visualReview.approvedAssets.some(asset => asset
      && path.resolve(projectRoot, asset.path) === target
      && asset.sha256 === currentSha256);
  return Boolean(manifestHashMatches && recordedPathMatches
    && recordedAsset.sha256 === currentSha256
    && recordedAsset.sizeBytes === currentSizeBytes
    && recordedAsset.technical?.status === 'passed'
    && manifest.technicalStatus === 'passed'
    && sourceHashMatches
    && manifest.sourceReview?.factualReviewStatus === 'approved'
    && owner?.publicationEligible === true
    && owner?.publicationReviewStatus === 'approved'
    && visualApproved);
}

function baselineCaptureTimestamp(baseline) {
  const value = baseline?.scannedAt || baseline?.capturedAt;
  return Number.isFinite(Date.parse(value || '')) ? new Date(value).toISOString() : null;
}

async function inspectQa(root, file, owners, currentSha256) {
  const records = [];
  for (const [ownerIndex, owner] of owners.entries()) {
    if (!owner.qaManifestPath) {
      records.push({ ownerIndex, jobId: owner.jobId, status: 'missing_manifest_reference', publicationReady: false });
      continue;
    }
    const manifestPath = path.isAbsolute(owner.qaManifestPath)
      ? path.resolve(owner.qaManifestPath)
      : path.resolve(root, owner.qaManifestPath);
    const qaRoot = path.join(root, 'data', 'reports', 'qa');
    if (!isWithin(qaRoot, manifestPath)) {
      records.push({ ownerIndex, jobId: owner.jobId, status: 'invalid_manifest_path', publicationReady: false });
      continue;
    }
    try {
      const realManifestPath = await fs.realpath(manifestPath);
      if (!isWithin(qaRoot, realManifestPath)) {
        records.push({ ownerIndex, jobId: owner.jobId, status: 'invalid_manifest_path', publicationReady: false });
        continue;
      }
      const bytes = await fs.readFile(realManifestPath);
      const actualManifestHash = crypto.createHash('sha256').update(bytes).digest('hex');
      const manifest = JSON.parse(bytes.toString('utf8'));
      const recordedAsset = (manifest.assets || []).find(asset =>
        path.resolve(root, asset.path) === path.resolve(file.path));
      const manifestHashMatches = Boolean(owner.qaManifestSha256 && owner.qaManifestSha256 === actualManifestHash);
      const currentSizeMatchesManifest = Boolean(recordedAsset && recordedAsset.sizeBytes === file.sizeBytes);
      const currentHashMatchesManifest = Boolean(recordedAsset?.sha256 && recordedAsset.sha256 === currentSha256);
      const factualReviewStatus = manifest.sourceReview?.factualReviewStatus || owner.publicationReviewStatus || null;
      const sourceHashMatches = Boolean(owner.sourceEvidence?.contextHash
        && manifest.sourceReview?.sourceHash === owner.sourceEvidence.contextHash);
      const visualApproved = manifest.visualReview?.status === 'approved'
        && Array.isArray(manifest.visualReview?.approvedAssets)
        && manifest.visualReview.approvedAssets.some(asset => asset
          && path.resolve(root, asset.path) === path.resolve(file.path)
          && asset.sha256 === currentSha256);
      const qaStatus = !owner.qaManifestSha256 ? 'manifest_hash_unbound'
        : !manifestHashMatches ? 'manifest_hash_mismatch'
          : !recordedAsset ? 'asset_missing_from_manifest'
            : !currentSizeMatchesManifest || !currentHashMatchesManifest ? 'asset_hash_mismatch'
              : manifest.technicalStatus !== 'passed' ? 'technical_qa_failed'
                : 'verified';
      const publicationReady = isPublicationQaReady({
        owner,
        manifest,
        recordedAsset,
        filePath: file.path,
        currentSha256,
        currentSizeBytes: file.sizeBytes,
        manifestHashMatches,
        root
      });
      records.push({
        ownerIndex,
        jobId: owner.jobId,
        status: qaStatus,
        publicationReady,
        manifestHashMatches,
        manifestPath: path.relative(root, realManifestPath),
        manifestSha256: actualManifestHash,
        technicalStatus: manifest.technicalStatus || null,
        factualReviewStatus,
        sourceHashMatches,
        visualReviewStatus: manifest.visualReview?.status || null,
        visualApproved,
        recordedAssetSha256: recordedAsset?.sha256 || null,
        recordedAssetSizeBytes: recordedAsset?.sizeBytes ?? null,
        currentSizeMatchesManifest,
        currentHashMatchesManifest
      });
    } catch (error) {
      records.push({ ownerIndex, jobId: owner.jobId, status: error.code === 'ENOENT' ? 'missing_manifest' : 'invalid_manifest', publicationReady: false });
    }
  }
  return records;
}

async function createBacklogReport({ now = new Date() } = {}) {
  const baseline = JSON.parse(await fs.readFile(BASELINE_PATH, 'utf8'));
  const inventory = await scanDiskMediaInventory({ root: ROOT, now });
  const deletionLedgerPath = path.join(ROOT, 'data/state/media-deletions.jsonl');
  const deletionRows = await fs.readFile(deletionLedgerPath, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error));
  const completedDeletions = deletionRows.split('\n').filter(Boolean).map(line => JSON.parse(line))
    .filter(record => record.action === 'delete_completed');
  const reconciliationEvents = deletionRows.split('\n').filter(Boolean).map(line => JSON.parse(line))
    .filter(record => record.action === 'reconciliation_required');
  const baselineFiles = new Map(baseline.files
    .filter(file => file.backlogCandidate)
    .map(file => [path.resolve(WORKSPACE, file.path), file]));
  const rows = [];
  for (const file of inventory.files) {
    const absolutePath = path.resolve(file.path);
    const baselineFile = baselineFiles.get(absolutePath) || null;
    const relativeWorkspacePath = path.relative(WORKSPACE, absolutePath);
    const currentSha256 = await sha256File(absolutePath);
    const baselineSha256 = baselineFile?.metadata?.sha256 || baselineFile?.sha256 || null;
    const baselineSizeBytes = baselineFile?.bytes ?? baselineFile?.metadata?.bytes ?? null;
    const baselineModifiedAt = baselineFile?.modifiedAt || baselineFile?.metadata?.modifiedAt || null;
    const qa = await inspectQa(ROOT, file, file.ledger, currentSha256);
    const owners = file.ledger.map((owner, ownerIndex) => {
      const destinationProofs = Object.fromEntries(Object.entries(owner.destinations || {}).map(([platform, status]) => [
        platform, destinationProof(owner.destinationEvidence?.[platform], status)
      ]));
      return { ...owner, destinationProofs, ownerIndex };
    });
    const qaByOwner = new Map(qa.map(record => [record.ownerIndex, record]));
    const targets = owners.flatMap((owner, ownerIndex) => (owner.requiredDestinations || []).map(platform => {
      const proof = owner.destinationProofs[platform] || { status: owner.destinations?.[platform] || 'not_attempted' };
      const assetQa = qaByOwner.get(ownerIndex);
      return {
        jobId: owner.jobId,
        role: owner.role,
        platform,
        status: proof.status,
        account: proof.account || null,
        artifactSha256: proof.artifactSha256 || null,
        qaAssetSha256: assetQa?.recordedAssetSha256 || null,
        hashMatchesCurrent: Boolean(proof.artifactSha256 && proof.artifactSha256 === currentSha256),
        ...(proof.legacyProof ? { legacyProof: true } : {}),
        ...(proof.url ? { url: proof.url } : {}),
        ...(proof.externalId ? { externalId: proof.externalId } : {}),
        ...(proof.failureCode ? { failureCode: proof.failureCode } : {}),
        ...(proof.confirmedAt ? { confirmedAt: proof.confirmedAt } : {})
      };
    }));
    const reportFile = { ...file, currentSha256, ledger: owners, qa };
    const classification = classifyFile(reportFile, path.relative(ROOT, absolutePath), qa);
    rows.push({
      path: relativeWorkspacePath,
      sizeBytes: file.sizeBytes,
      modifiedAt: file.modifiedAt,
      currentSha256,
      baselineSha256,
      baselineHashMatches: baselineSha256 ? baselineSha256 === currentSha256 : null,
      baselineSizeBytes,
      baselineSizeMatches: baselineSizeBytes == null ? null : baselineSizeBytes === file.sizeBytes,
      baselineModifiedAt,
      baselineModifiedAtMatches: baselineModifiedAt ? baselineModifiedAt === file.modifiedAt : null,
      classification,
      nextAction: nextActionFor(classification),
      scannerClassification: file.classification,
      baselineRoleAssessment: baselineFile?.roleAssessment || null,
      ownerReferenceCount: owners.length,
      sharedAsset: owners.length > 1,
      owners: owners.map(compactOwnerMetadata),
      targets,
      qa
    });
  }

  const grouped = {};
  for (const row of rows) {
    const group = grouped[row.classification] || { files: 0, bytes: 0 };
    group.files++;
    group.bytes += row.sizeBytes;
    grouped[row.classification] = group;
  }
  const baselinePaths = new Set(baselineFiles.keys());
  const livePaths = new Set(rows.map(row => path.resolve(WORKSPACE, row.path)));
  const completedByPath = indexBaselineDeletions(completedDeletions, baselinePaths);
  const missingBaselinePaths = [...baselinePaths].filter(filePath => !livePaths.has(filePath));
  const baselineAt = baselineCaptureTimestamp(baseline);
  const baselineTime = Date.parse(baselineAt || '');
  const baselineCandidateOutcomes = [...baselineFiles.entries()].map(([filePath, baselineFile]) => {
    const live = rows.find(row => path.resolve(WORKSPACE, row.path) === filePath) || null;
    if (live) return {
      path: path.relative(WORKSPACE, filePath),
      status: 'live',
      classification: live.classification,
      sizeBytes: live.sizeBytes,
      sha256: live.currentSha256,
      nextAction: live.nextAction
    };
    const baselineSize = baselineFile.bytes ?? baselineFile.metadata?.bytes ?? null;
    const baselineSha = baselineFile.sha256 || baselineFile.metadata?.sha256 || null;
    const deletions = completedByPath.get(filePath) || [];
    const validDeletion = deletions.find(record => isConclusiveBaselineDeletion(record, {
      baselineTime, baselineSize, baselineSha
    })) || null;
    if (validDeletion) {
      return {
        path: path.relative(WORKSPACE, filePath),
        status: 'retired_path_size_match',
        sizeBytes: validDeletion.sizeBytes,
        deletion: validDeletion,
        baselineHashAvailable: Boolean(baselineSha),
        baselineHashMatches: baselineSha ? validDeletion.sha256 === baselineSha : null,
        nextAction: nextActionFor('baseline_retired_path_size_match')
      };
    }
    return {
      path: path.relative(WORKSPACE, filePath),
      status: 'missing_without_conclusive_deletion_proof',
      sizeBytes: baselineSize,
      deletionRecords: deletions.length,
      nextAction: nextActionFor('baseline_missing_unproven')
    };
  });
  const retired = baselineCandidateOutcomes.filter(row => row.status === 'retired_path_size_match');
  const missingWithoutDeletionProof = baselineCandidateOutcomes
    .filter(row => row.status === 'missing_without_conclusive_deletion_proof');
  const baselineCoverage = baselineCandidateOutcomes.reduce((totals, row) => {
    totals[row.status] = (totals[row.status] || 0) + 1;
    totals.bytes[row.status] = (totals.bytes[row.status] || 0) + Number(row.sizeBytes || 0);
    return totals;
  }, { bytes: {} });
  return {
    schemaVersion: 2,
    scannedAt: inventory.scannedAt,
    baselinePath: path.relative(ROOT, BASELINE_PATH),
    baselineAt,
    baselineCandidateCount: baselinePaths.size,
    baselineCandidatesMissing: missingBaselinePaths.map(filePath => path.relative(WORKSPACE, filePath)),
    baselineCandidatesRetired: retired,
    baselineCandidatesWithoutConclusiveDeletionProof: missingWithoutDeletionProof,
    baselineCandidateOutcomes,
    baselineCoverage,
    baselineCandidatesRequiringRemoteReconciliation: reconciliationEvents.map(record => ({
      path: path.relative(WORKSPACE, path.resolve(ROOT, record.path)),
      jobId: record.jobId || null,
      platform: record.platform || null,
      status: record.previousStatus || 'unknown',
      reason: record.reason || null,
      evidencePath: record.evidencePath || null
    })),
    baselineCandidatesMissingWithoutDeletionProof: missingWithoutDeletionProof.map(row => row.path),
    liveFilesOutsideBaseline: rows.filter(row => !baselinePaths.has(path.resolve(WORKSPACE, row.path))).map(row => row.path),
    physicalInventory: inventory.totals,
    classifications: grouped,
    files: rows
  };
}

if (require.main === module) {
  const outputPath = path.resolve(process.argv[2] || path.join(ROOT, 'docs/evidencias/backlog-reconciliation-live-2026-10-21.json'));
  createBacklogReport().then(async report => {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ output: path.relative(ROOT, outputPath), scan: report.physicalInventory,
      baselineCandidateCount: report.baselineCandidateCount, baselineCandidatesMissing: report.baselineCandidatesMissing.length,
      liveFilesOutsideBaseline: report.liveFilesOutsideBaseline.length, classifications: report.classifications }, null, 2));
  }).catch(error => {
    console.error(`Falha ao reconciliar backlog: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  createBacklogReport,
  classifyFile,
  nextActionFor,
  outsideLedgerDisposition,
  sha256File,
  isConclusiveBaselineDeletion,
  isPublicationQaReady,
  baselineCaptureTimestamp,
  compactOwnerMetadata,
  indexBaselineDeletions
};
