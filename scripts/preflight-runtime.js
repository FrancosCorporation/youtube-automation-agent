#!/usr/bin/env node
/* Read-only runtime inventory. It never installs packages or loads .env files. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { resolveExecutable } = require('../utils/resolve-executable');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_MODELS_DIR = path.join(os.homedir(), '.cache', 'pulso', 'models');
const DEFAULT_PIPER_MODEL_NAME = path.join('piper', 'pt_BR-faber-medium.onnx');
const DEFAULT_RHUBARB = 'rhubarb';

function parseArgs(args = []) {
  const options = { json: false, neural: false, help: false };
  for (const arg of args) {
    if (arg === '--json') options.json = true;
    else if (arg === '--neural') options.neural = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Opção desconhecida: ${arg}`);
  }
  return options;
}

function sameEntries(left = {}, right = {}) {
  const a = Object.entries(left).sort(([x], [y]) => x.localeCompare(y));
  const b = Object.entries(right).sort(([x], [y]) => x.localeCompare(y));
  return JSON.stringify(a) === JSON.stringify(b);
}

function inspectDependencies({ root, manifest, lock }) {
  const results = [];
  const lockRoot = lock.packages?.[''];
  if (!lockRoot) return [{ level: 'error', name: 'package-lock', detail: 'entrada packages[""] ausente' }];

  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const declared = manifest[section] || {};
    const locked = lockRoot[section] || {};
    if (!sameEntries(declared, locked)) {
      results.push({ level: 'error', name: `package-lock.${section}`, detail: 'declarações do package.json divergem do lock' });
    }
    for (const name of Object.keys(declared)) {
      const expected = lock.packages?.[`node_modules/${name}`]?.version;
      const packagePath = path.join(root, 'node_modules', ...name.split('/'), 'package.json');
      let installed = null;
      try { installed = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version; } catch (error) {
        if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error;
      }
      const optional = section === 'optionalDependencies';
      if (!expected) {
        results.push({ level: 'error', name, detail: 'pacote declarado sem versão resolvida no lock' });
      } else if (!installed) {
        results.push({ level: optional ? 'warning' : 'error', name, detail: `ausente; lock fixa ${expected}` });
      } else if (installed !== expected) {
        results.push({ level: 'error', name, detail: `instalado ${installed}; lock fixa ${expected}` });
      } else {
        results.push({ level: 'ok', name, detail: installed });
      }
    }
  }
  return results;
}

function executableOnPath(command, env = process.env) {
  return resolveExecutable(command, env);
}

function commandResult(name, command, args = ['--version'], options = {}) {
  const resolved = executableOnPath(command, options.env || process.env);
  if (!resolved) return { level: options.required ? 'error' : 'warning', name, detail: 'executável não encontrado ou sem permissão de execução' };
  const run = spawnSync(resolved, args, { encoding: 'utf8', timeout: 8000, maxBuffer: 1024 * 1024 });
  if (run.error || run.status !== 0) {
    return { level: options.required ? 'error' : 'warning', name, detail: `não iniciou corretamente${run.error ? `: ${run.error.message}` : ` (código ${run.status})`}`, path: resolved };
  }
  const version = `${run.stdout || ''}${run.stderr || ''}`.trim().split(/\r?\n/)[0].slice(0, 180);
  return { level: 'ok', name, detail: version || 'executado', path: resolved };
}

function pythonModules(python, names, env = process.env) {
  const code = 'import importlib.util,json,sys; print(json.dumps({"python":sys.version.split()[0],"modules":{n:bool(importlib.util.find_spec(n)) for n in ' + JSON.stringify(names) + '}}))';
  const run = spawnSync(python, ['-c', code], { encoding: 'utf8', timeout: 8000, maxBuffer: 64 * 1024, env });
  if (run.error || run.status !== 0) return { error: run.error?.message || `código ${run.status}` };
  try { return JSON.parse(run.stdout); } catch { return { error: 'resposta Python inválida' }; }
}

function normalizePythonPackageName(name) {
  return String(name).toLowerCase().replace(/[-_.]+/g, '-');
}

function parsePinnedRequirements(contents) {
  const requirements = [];
  const seen = new Set();
  for (const [index, sourceLine] of String(contents).split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s;]+)$/);
    if (!match) throw new Error(`requirements-neural.lock linha ${index + 1} não está fixada com ==`);
    const normalizedName = normalizePythonPackageName(match[1]);
    if (seen.has(normalizedName)) throw new Error(`pacote duplicado em requirements-neural.lock: ${normalizedName}`);
    seen.add(normalizedName);
    requirements.push({ name: match[1], normalizedName, version: match[2] });
  }
  return requirements;
}

function comparePythonLock(requirements, installedVersions) {
  return requirements.map(requirement => {
    const installed = installedVersions[requirement.normalizedName] ?? null;
    if (!installed) return {
      level: 'error', name: `python:${requirement.normalizedName}`,
      detail: `ausente; lock fixa ${requirement.version}`
    };
    if (installed !== requirement.version) return {
      level: 'error', name: `python:${requirement.normalizedName}`,
      detail: `instalado ${installed}; lock fixa ${requirement.version}`
    };
    return { level: 'ok', name: `python:${requirement.normalizedName}`, detail: installed };
  });
}

function inspectPythonLock({ python, lockPath, env = process.env, spawnSyncImpl = spawnSync }) {
  let requirements;
  try {
    requirements = parsePinnedRequirements(fs.readFileSync(lockPath, 'utf8'));
  } catch (error) {
    return [{ level: 'error', name: 'python-lock', detail: error.message }];
  }
  const names = requirements.map(requirement => requirement.name);
  const code = [
    'import importlib.metadata as metadata,json,re,sys',
    'names=json.loads(sys.argv[1])',
    'versions={}',
    'for name in names:',
    ' normalized=re.sub(r"[-_.]+","-",name).lower()',
    ' try: versions[normalized]=metadata.version(name)',
    ' except metadata.PackageNotFoundError: versions[normalized]=None',
    'print(json.dumps(versions))'
  ].join('\n');
  const run = spawnSyncImpl(python, ['-c', code, JSON.stringify(names)], {
    encoding: 'utf8', timeout: 8000, maxBuffer: 256 * 1024, env
  });
  if (run.error || run.status !== 0) {
    return [{ level: 'error', name: 'python-lock', detail: 'não foi possível consultar as versões instaladas' }];
  }
  let installed;
  try { installed = JSON.parse(run.stdout); } catch {
    return [{ level: 'error', name: 'python-lock', detail: 'resposta Python inválida ao consultar versões' }];
  }
  if (!installed || typeof installed !== 'object' || Array.isArray(installed)) {
    return [{ level: 'error', name: 'python-lock', detail: 'resposta Python inválida ao consultar versões' }];
  }
  return comparePythonLock(requirements, installed);
}

function findWhisperModel(env = process.env) {
  if (env.PULSO_WHISPER_MODEL_PATH) return path.resolve(env.PULSO_WHISPER_MODEL_PATH);
  const snapshots = path.join(env.PULSO_MODELS_DIR || DEFAULT_MODELS_DIR, 'models--Systran--faster-whisper-base', 'snapshots');
  try {
    const first = fs.readdirSync(snapshots).sort()[0];
    return first ? path.join(snapshots, first) : null;
  } catch { return null; }
}

function resolvePiperModel(env = process.env) {
  if (env.PULSO_PIPER_MODEL) return path.resolve(env.PULSO_PIPER_MODEL);
  return path.resolve(env.PULSO_MODELS_DIR || DEFAULT_MODELS_DIR, DEFAULT_PIPER_MODEL_NAME);
}

function modelFiles(modelPath, requiredNames) {
  if (!modelPath || !fs.existsSync(modelPath)) return false;
  return requiredNames.every(name => fs.existsSync(path.join(modelPath, name)));
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function collectReport(options = {}, env = process.env) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const checks = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({ level: nodeMajor >= 22 ? 'ok' : 'error', name: 'node', detail: `${process.versions.node}; exigido ${manifest.engines?.node || 'sem faixa'}` });
  checks.push(...inspectDependencies({ root: ROOT, manifest, lock }));

  let bundledFfmpeg = null;
  try { bundledFfmpeg = require('ffmpeg-static'); } catch { bundledFfmpeg = null; }
  const ffmpeg = env.FFMPEG_PATH || bundledFfmpeg || 'ffmpeg';
  checks.push(commandResult('ffmpeg', ffmpeg, ['-version'], { required: true, env }));
  const rhubarb = env.PULSO_RHUBARB_PATH || DEFAULT_RHUBARB;
  checks.push(commandResult('rhubarb', rhubarb, ['--version'], { required: true, env }));

  const python = env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3');
  const pythonResult = commandResult('python', python, ['--version'], { required: true, env });
  checks.push(pythonResult);
  const pyInfo = pythonModules(pythonResult.path || python, ['gtts', 'piper', 'faster_whisper'], env);
  if (pyInfo.error) {
    checks.push({ level: options.neural ? 'error' : 'warning', name: 'python-modules', detail: pyInfo.error });
  } else {
    checks.push({ level: pyInfo.modules.gtts ? 'ok' : 'warning', name: 'gtts', detail: pyInfo.modules.gtts ? `disponível em Python ${pyInfo.python}` : `não instalado em Python ${pyInfo.python}` });
    if (options.neural) {
      checks.push({ level: pyInfo.modules.piper ? 'ok' : 'error', name: 'piper-python', detail: pyInfo.modules.piper ? 'módulo disponível' : 'módulo Python piper ausente' });
      checks.push({ level: pyInfo.modules.faster_whisper ? 'ok' : 'error', name: 'faster-whisper-python', detail: pyInfo.modules.faster_whisper ? 'módulo disponível' : 'módulo Python faster-whisper ausente' });
      checks.push(...inspectPythonLock({
        python: pythonResult.path || python,
        lockPath: path.join(ROOT, 'requirements-neural.lock'),
        env
      }));
    } else {
      checks.push({ level: pyInfo.modules.piper ? 'ok' : 'warning', name: 'piper-python', detail: pyInfo.modules.piper ? 'módulo disponível' : 'necessário somente no perfil --neural' });
      checks.push({ level: pyInfo.modules.faster_whisper ? 'ok' : 'warning', name: 'faster-whisper-python', detail: pyInfo.modules.faster_whisper ? 'módulo disponível' : 'necessário somente no perfil --neural' });
    }
  }

  const edgeCandidates = [env.EDGE_TTS_PATH, path.join(os.homedir(), '.local', 'bin', 'edge-tts'), 'edge-tts'].filter(Boolean);
  const edgePath = edgeCandidates.map(candidate => executableOnPath(candidate, env)).find(Boolean);
  checks.push(commandResult('edge-tts', edgePath || 'edge-tts', ['--help'], { required: false, env }));
  const piperModel = resolvePiperModel(env);
  const piperExists = fs.existsSync(piperModel) && fs.statSync(piperModel).isFile();
  checks.push({ level: piperExists ? 'ok' : options.neural ? 'error' : 'warning', name: 'piper-model', detail: piperExists ? piperModel : `ausente: ${piperModel}` });
  const whisperModel = findWhisperModel(env);
  const whisperExists = modelFiles(whisperModel, ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt']);
  checks.push({ level: whisperExists ? 'ok' : options.neural ? 'error' : 'warning', name: 'whisper-model', detail: whisperExists ? whisperModel : `cache base não encontrado${whisperModel ? `: ${whisperModel}` : ''}` });

  if (options.neural && piperExists) {
    const actualHash = await sha256File(piperModel);
    const expectedHash = env.PULSO_PIPER_MODEL_SHA256;
    checks.push({
      level: expectedHash && expectedHash.toLowerCase() !== actualHash ? 'error' : 'ok',
      name: 'piper-model-sha256',
      detail: actualHash + (expectedHash ? ` (esperado ${expectedHash})` : '')
    });
  }

  return {
    profile: options.neural ? 'neural' : 'production',
    node: process.versions.node,
    platform: `${process.platform}/${process.arch}`,
    checkedAt: new Date().toISOString(),
    checks,
    summary: {
      ok: checks.filter(item => item.level === 'ok').length,
      warnings: checks.filter(item => item.level === 'warning').length,
      errors: checks.filter(item => item.level === 'error').length
    }
  };
}

function renderReport(report) {
  const icon = { ok: 'OK', warning: 'WARN', error: 'FAIL' };
  const lines = report.checks.map(item => `${icon[item.level]}  ${item.name}: ${item.detail}`);
  lines.push(`\nPerfil ${report.profile}: ${report.summary.ok} ok, ${report.summary.warnings} avisos, ${report.summary.errors} erros.`);
  return lines.join('\n');
}

async function main(args = process.argv.slice(2)) {
  let options;
  try { options = parseArgs(args); } catch (error) { console.error(error.message); process.exitCode = 2; return; }
  if (options.help) {
    console.log('Uso: node scripts/preflight-runtime.js [--json] [--neural]\n\nInspeciona versões, binários e modelos sem instalar dependências nem carregar .env. --neural exige Piper, faster-whisper e os modelos locais.');
    return;
  }
  const report = await collectReport(options);
  console.log(options.json ? JSON.stringify(report, null, 2) : renderReport(report));
  if (report.summary.errors) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = {
  parseArgs, sameEntries, inspectDependencies, executableOnPath, findWhisperModel,
  resolvePiperModel, modelFiles, normalizePythonPackageName, parsePinnedRequirements,
  comparePythonLock, inspectPythonLock, collectReport
};
