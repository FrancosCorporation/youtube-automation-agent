'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const catalog = require('../experiments/remotion-motion-review/public/pulso-humans/catalog.json');

const ROOT = path.resolve(__dirname, '..');
const ACTORS = new Map(catalog.actors.map(actor => [actor.id, actor]));
const MOTIONS = new Set(['Idle', 'Walk', 'Carry idle', 'Carry walk', 'Use / press']);

function resolveHumanActor(id) {
  return ACTORS.get(String(id || '')) || null;
}

async function verifyHumanActorAssets(actorIds, { root = ROOT } = {}) {
  const failures = [];
  for (const id of [...new Set(actorIds || [])]) {
    const actor = resolveHumanActor(id);
    if (!actor) {
      failures.push({ id, reason: 'unknown_actor' });
      continue;
    }
    const file = path.resolve(root, 'experiments/remotion-motion-review/public', 'pulso-humans', actor.file);
    if (!file.startsWith(`${path.resolve(root)}${path.sep}`)) {
      failures.push({ id, reason: 'outside_project' });
      continue;
    }
    try {
      const bytes = await fs.readFile(file);
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== actor.sha256 || bytes.length !== actor.bytes) failures.push({ id, reason: 'sha256_mismatch' });
    } catch (error) {
      failures.push({ id, reason: error.code === 'ENOENT' ? 'missing' : 'unreadable' });
    }
  }
  if (failures.length) throw Object.assign(new Error('assets humanos ausentes ou alterados'), {
    code: 'NARRATIVE_HUMAN_ASSET_INVALID', failures
  });
  return { verified: [...new Set(actorIds || [])].length };
}

module.exports = { ACTOR_CATALOG: catalog, MOTIONS, resolveHumanActor, verifyHumanActorAssets };
