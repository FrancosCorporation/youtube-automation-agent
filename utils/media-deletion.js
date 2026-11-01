'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function appendRecord(ledgerPath, record) {
  await fsp.mkdir(path.dirname(ledgerPath), { recursive: true, mode: 0o700 });
  const handle = await fsp.open(ledgerPath, 'a', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function hashStableRegularFile(filePath) {
  const before = await fsp.lstat(filePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('artefato não é arquivo regular');
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath, { flags: fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) });
  await new Promise((resolve, reject) => {
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  const after = await fsp.lstat(filePath, { bigint: true });
  if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
    || before.size !== after.size || before.mtimeNs !== after.mtimeNs) {
    throw new Error('artefato mudou durante a conferência do hash');
  }
  return { sha256: hash.digest('hex'), sizeBytes: Number(after.size), stat: after };
}

async function deleteMediaWithEvidence({
  root,
  filePath,
  allowedRoots = [],
  ledgerPath,
  disposition,
  ownerProofs = [],
  expectedSha256 = null
} = {}) {
  const projectRoot = path.resolve(root || process.cwd());
  if (typeof filePath !== 'string' || !filePath || typeof ledgerPath !== 'string' || !ledgerPath) {
    throw new TypeError('caminho da mídia e ledger de exclusão são obrigatórios');
  }
  if (!disposition || typeof disposition.kind !== 'string' || !disposition.kind.trim()) {
    throw new TypeError('a exclusão exige uma disposição comprovada');
  }
  const target = path.resolve(filePath);
  const roots = allowedRoots.map(candidate => path.resolve(projectRoot, candidate));
  const allowedRoot = roots.find(candidate => isWithin(candidate, target));
  if (!allowedRoot) throw new Error('arquivo fora das raízes de mídia autorizadas');
  const realProjectRoot = await fsp.realpath(projectRoot);
  const realAllowedRoot = await fsp.realpath(allowedRoot);
  const expectedRoot = path.resolve(realProjectRoot, path.relative(projectRoot, allowedRoot));
  if (realAllowedRoot !== expectedRoot) throw new Error('raiz autorizada resolve por caminho simbólico');
  const realTarget = await fsp.realpath(target);
  const expectedTarget = path.resolve(realAllowedRoot, path.relative(allowedRoot, target));
  if (realTarget !== expectedTarget) throw new Error('mídia resolve para fora da raiz autorizada');

  const file = await hashStableRegularFile(target);
  if (expectedSha256 && file.sha256 !== expectedSha256) {
    throw new Error('arquivo atual não corresponde ao hash aprovado para publicação');
  }
  const deletionId = crypto.randomUUID();
  const base = {
    schemaVersion: 1,
    deletionId,
    path: path.relative(realProjectRoot, target),
    category: disposition.kind,
    reason: String(disposition.reason || '').slice(0, 300),
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    ownerProofs: ownerProofs.map(owner => ({
      jobId: typeof owner.jobId === 'string' ? owner.jobId : null,
      role: owner.role || null,
      publicationEligible: typeof owner.publicationEligible === 'boolean' ? owner.publicationEligible : null,
      publicationReviewStatus: owner.publicationReviewStatus || null,
      reviewedAssetSha256: typeof owner.reviewedAssetSha256 === 'string' ? owner.reviewedAssetSha256 : null,
      reviewEvidencePath: typeof owner.reviewEvidencePath === 'string' ? owner.reviewEvidencePath : null,
      destinations: Array.isArray(owner.destinations) ? owner.destinations : []
    })),
    recordedAt: new Date().toISOString()
  };
  await appendRecord(ledgerPath, { ...base, action: 'delete_prepared' });
  try {
    const current = await hashStableRegularFile(target);
    if (current.sha256 !== file.sha256 || current.sizeBytes !== file.sizeBytes
      || (expectedSha256 && current.sha256 !== expectedSha256)) {
      throw new Error('hash ou tamanho mudou antes da exclusão');
    }
    const checkedTarget = await fsp.realpath(target);
    if (checkedTarget !== expectedTarget) throw new Error('caminho mudou antes da exclusão');
    await fsp.unlink(target);
    await appendRecord(ledgerPath, {
      ...base,
      action: 'delete_completed',
      completedAt: new Date().toISOString()
    });
    return { deleted: true, bytes: file.sizeBytes, sha256: file.sha256, deletionId };
  } catch (error) {
    await appendRecord(ledgerPath, {
      ...base,
      action: 'delete_failed',
      failedAt: new Date().toISOString(),
      error: String(error.message || error).slice(0, 240)
    }).catch(() => {});
    throw error;
  }
}

module.exports = { deleteMediaWithEvidence };
