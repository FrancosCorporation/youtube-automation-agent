import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const takeValue = (name, fallback) => {
  const prefix = `--${name}=`;
  const inline = args.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const requestedSeed = takeValue('seed', process.env.VIDEO_SEED);
const seed = requestedSeed === undefined ? randomBytes(4).readUInt32BE(0) : Number(requestedSeed);
if (!Number.isSafeInteger(seed) || seed < 0) {
  throw new Error(`--seed precisa ser um inteiro não negativo; recebido: ${requestedSeed}`);
}

const defaultOutput = path.join(projectDir, 'renders', `pulso-ia-hyperframes-pilot-16x9-seed-${seed}.mp4`);
const output = path.resolve(projectDir, takeValue('output', defaultOutput));
mkdirSync(path.dirname(output), { recursive: true });
const env = { ...process.env, VIDEO_SEED: String(seed), HYPERFRAMES_NO_TELEMETRY: '1' };

const build = spawnSync(process.execPath, ['scripts/build-pilot.js'], { cwd: projectDir, env, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const render = spawnSync('npx', [
  '--yes', 'hyperframes@0.8.185', 'render',
  '--fps=24', '--quality=high', '--workers=1', `--output=${output}`
], { cwd: projectDir, env, stdio: 'inherit' });
if (render.status !== 0) process.exit(render.status ?? 1);

process.stdout.write(`Vídeo local pronto: ${output}\n`);
