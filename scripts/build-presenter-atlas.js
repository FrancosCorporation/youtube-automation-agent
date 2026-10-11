#!/usr/bin/env node
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { assemblePresenterAtlas, WIDTH, HEIGHT } = require('./assemble-presenter-atlas');

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'assets', 'scenes', 'presenter-atlas.png');
const SCRIPT = path.join(__dirname, 'render-presenter-atlas.py');
const ATLAS_REVISION = 'pulso-mascot-pbr-eevee-v3-perspective-studio';

function renderCells(outDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.BLENDER_BIN || 'blender', [
      '-b', '--python', SCRIPT, '--', '--out-dir', outDir,
      '--width', String(WIDTH), '--height', String(HEIGHT)
    ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.stdout.on('data', chunk => {
      const line = chunk.toString().trim();
      if (line) process.stdout.write(`[presenter-3d] ${line}\n`);
    });
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve()
      : reject(new Error(`Blender terminou com código ${code}: ${stderr.slice(-1400)}`)));
  });
}

async function buildPresenterAtlas(outputPath = OUTPUT) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-ia-avatar-'));
  try {
    await renderCells(workDir);
    await assemblePresenterAtlas(workDir, outputPath);
    const revisionPath = `${outputPath}.revision`;
    const revisionTemp = `${revisionPath}.tmp-${process.pid}`;
    await fs.writeFile(revisionTemp, `${ATLAS_REVISION}\n`);
    await fs.rename(revisionTemp, revisionPath);
    const stat = await fs.stat(outputPath);
    process.stdout.write(`Atlas 3D pronto: ${outputPath} (${(stat.size / 1048576).toFixed(1)} MB)\n`);
    return outputPath;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

if (require.main === module) {
  buildPresenterAtlas().catch(error => {
    process.stderr.write(`Falha ao montar atlas 3D: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildPresenterAtlas, OUTPUT, ATLAS_REVISION };
