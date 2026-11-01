'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTOR_CATALOG, verifyHumanActorAssets } = require('../utils/narrative-human-actors');

test('local production actors have verified provenance, animation clips and no per-video service dependency', async () => {
  assert.equal(ACTOR_CATALOG.generator, 'Ara 3D Gen');
  assert.equal(ACTOR_CATALOG.sourceCodeLicense, 'MIT');
  assert.equal(ACTOR_CATALOG.baseAssetsLicense, 'CC0-1.0');
  assert.match(ACTOR_CATALOG.motionLicense, /commercial use permitted/i);
  assert.equal(ACTOR_CATALOG.actors.length, 2);
  for (const actor of ACTOR_CATALOG.actors) {
    assert.match(actor.sha256, /^[a-f0-9]{64}$/);
    assert.ok(actor.animations.includes('Walk'));
    assert.ok(actor.animations.includes('Idle'));
    assert.equal(actor.illustrative, true);
  }
  assert.deepEqual(await verifyHumanActorAssets(ACTOR_CATALOG.actors.map(actor => actor.id)), { verified: 2 });
});

test('a missing human asset fails closed before render', async () => {
  await assert.rejects(verifyHumanActorAssets(['not-a-profile']), error => {
    assert.equal(error.code, 'NARRATIVE_HUMAN_ASSET_INVALID');
    assert.equal(error.failures[0].reason, 'unknown_actor');
    return true;
  });
});
