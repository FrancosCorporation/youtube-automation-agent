const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parseArgs,
  sameEntries,
  inspectDependencies,
  executableOnPath,
  findWhisperModel,
  resolvePiperModel,
  modelFiles,
  parsePinnedRequirements,
  comparePythonLock,
  inspectPythonLock
} = require('../scripts/preflight-runtime');
const { resolveExecutable } = require('../utils/resolve-executable');

test('runtime preflight accepts supported flags and rejects unknown options', () => {
  assert.deepEqual(parseArgs(['--json', '--neural']), { json: true, neural: true, help: false });
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs(['--install']), /Opção desconhecida/);
});

test('dependency comparison ignores object insertion order but detects drift', () => {
  assert.equal(sameEntries({ a: '^1', b: '^2' }, { b: '^2', a: '^1' }), true);
  assert.equal(sameEntries({ a: '^1' }, { a: '^2' }), false);
});

test('dependency inspection reports missing, matching and mismatched installed packages', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-preflight-'));
  try {
    const install = (name, installedVersion) => {
      const packageDir = path.join(root, 'node_modules', name);
      fs.mkdirSync(packageDir, { recursive: true });
      fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ version: installedVersion }));
    };
    install('present', '1.0.0');
    install('drifted', '1.1.0');
    const manifest = { dependencies: { present: '^1.0.0', drifted: '^1.0.0', missing: '^2.0.0' } };
    const lock = { packages: {
      '': { dependencies: manifest.dependencies },
      'node_modules/present': { version: '1.0.0' },
      'node_modules/drifted': { version: '1.0.0' },
      'node_modules/missing': { version: '2.0.0' }
    } };
    const results = inspectDependencies({ root, manifest, lock });
    assert.equal(results.find(item => item.name === 'present').level, 'ok');
    assert.match(results.find(item => item.name === 'drifted').detail, /instalado 1\.1\.0/);
    assert.match(results.find(item => item.name === 'missing').detail, /ausente/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tool and model path helpers resolve explicit local paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-preflight-path-'));
  try {
    const tool = path.join(root, 'tool');
    fs.writeFileSync(tool, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(tool, 0o755);
    assert.equal(executableOnPath(tool), tool);
    assert.equal(resolveExecutable('tool', { PATH: root }), tool);
    assert.equal(executableOnPath(path.join(root, 'missing')), null);

    const model = path.join(root, 'whisper');
    fs.mkdirSync(model);
    for (const name of ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt']) {
      fs.writeFileSync(path.join(model, name), 'fixture');
    }
    assert.equal(modelFiles(model, ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt']), true);
    assert.equal(findWhisperModel({ PULSO_WHISPER_MODEL_PATH: model }), model);
    assert.equal(findWhisperModel({ PULSO_MODELS_DIR: root }), null);
    assert.equal(resolvePiperModel({ PULSO_MODELS_DIR: root }), path.join(root, 'piper', 'pt_BR-faber-medium.onnx'));
    assert.equal(resolvePiperModel({ PULSO_PIPER_MODEL: path.join(root, 'custom.onnx') }), path.join(root, 'custom.onnx'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('neural lock parser accepts exact pins and rejects loose or duplicate entries', () => {
  assert.deepEqual(parsePinnedRequirements('# lock\nPyYAML==6.0.3\nml_dtypes==0.6.0\n'), [
    { name: 'PyYAML', normalizedName: 'pyyaml', version: '6.0.3' },
    { name: 'ml_dtypes', normalizedName: 'ml-dtypes', version: '0.6.0' }
  ]);
  assert.throws(() => parsePinnedRequirements('faster-whisper>=1.2'), /fixada com ==/);
  assert.throws(() => parsePinnedRequirements('piper-tts==1.8.0\npiper_tts==1.8.0'), /pacote duplicado/);
});

test('neural lock comparison reports exact matches, missing packages, and version drift', () => {
  const requirements = parsePinnedRequirements('PyYAML==6.0.3\nfaster-whisper==1.2.1\nml_dtypes==0.6.0');
  const checks = comparePythonLock(requirements, { pyyaml: '6.0.3', 'faster-whisper': '1.2.0' });
  assert.deepEqual(checks.map(({ level, name }) => [level, name]), [
    ['ok', 'python:pyyaml'],
    ['error', 'python:faster-whisper'],
    ['error', 'python:ml-dtypes']
  ]);
  assert.match(checks[1].detail, /instalado 1\.2\.0; lock fixa 1\.2\.1/);
  assert.match(checks[2].detail, /ausente; lock fixa 0\.6\.0/);
});

test('neural lock inspection compares installed metadata using an injectable Python process', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-preflight-python-lock-'));
  try {
    const lockPath = path.join(root, 'requirements-neural.lock');
    fs.writeFileSync(lockPath, 'PyYAML==6.0.3\nfaster-whisper==1.2.1\n');
    let invocation;
    const checks = inspectPythonLock({
      python: '/fixture/python',
      lockPath,
      env: { PATH: '/fixture' },
      spawnSyncImpl: (command, args, options) => {
        invocation = { command, args, options };
        return { status: 0, stdout: JSON.stringify({ pyyaml: '6.0.3', 'faster-whisper': '1.2.1' }) };
      }
    });
    assert.equal(invocation.command, '/fixture/python');
    assert.deepEqual(JSON.parse(invocation.args[2]), ['PyYAML', 'faster-whisper']);
    assert.ok(invocation.options.timeout <= 8000);
    assert.ok(checks.every(check => check.level === 'ok'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
