import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(await readFile(path.join(root, 'models/catalog.json'), 'utf8'));

test('catalog distinguishes model geometry families and asset packaging states', () => {
  assert.equal(catalog.catalogVersion, 1);
  assert.equal(catalog.models.filter((model) => model.status === 'bundled').length, 2);
  assert.ok(catalog.models.some((model) => model.id === 'pulso-robot-web' && model.geometryFamily === 'Pulso robot'));
  assert.ok(catalog.models.some((model) => model.geometryFamily === 'distinct humanoid robot'));
  assert.ok(catalog.models.some((model) => model.geometryFamily === 'modern multi-mesh robot'));
  assert.ok(catalog.models.every((model) => ['bundled', 'workspace-reference'].includes(model.status)));
});

test('each bundled GLB matches its catalog size, SHA-256, and glTF metadata', async () => {
  const models = catalog.models.filter((entry) => entry.status === 'bundled');
  for (const model of models) {
    const filePath = path.resolve(root, model.path);
    const [buffer, fileInfo] = await Promise.all([readFile(filePath), stat(filePath)]);

    assert.equal(fileInfo.size, model.sizeBytes, `${model.id} size`);
    assert.equal(createHash('sha256').update(buffer).digest('hex'), model.sha256, `${model.id} SHA-256`);
    assert.equal(buffer.toString('ascii', 0, 4), 'glTF', `${model.id} magic`);
    assert.equal(buffer.readUInt32LE(4), 2, `${model.id} version`);
    assert.equal(buffer.readUInt32LE(8), buffer.length, `${model.id} total length`);
    assert.equal(buffer.toString('ascii', 16, 20), 'JSON', `${model.id} JSON chunk`);

    const jsonLength = buffer.readUInt32LE(12);
    const gltf = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
    assert.equal(gltf.asset.version, '2.0', `${model.id} glTF version`);
    assert.equal(gltf.skins?.length ?? 0, model.skinCount, `${model.id} skins`);
    if (model.meshCount !== undefined) assert.equal(gltf.meshes?.length ?? 0, model.meshCount, `${model.id} meshes`);
    assert.equal(gltf.animations?.length ?? 0, 0, `${model.id} baked animations`);
  }
});

test('workspace-reference entries match their files when the original workspace is present', async (t) => {
  const references = catalog.models.filter((model) => model.status === 'workspace-reference');
  assert.equal(references.length, 3);

  for (const model of references) {
    const filePath = path.resolve(root, model.path);
    try {
      const fileInfo = await stat(filePath);
      assert.equal(fileInfo.size, model.sizeBytes, `${model.id} size`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        t.diagnostic(`${model.id} remains an external workspace reference and is not bundled.`);
        continue;
      }
      throw error;
    }
  }
});
