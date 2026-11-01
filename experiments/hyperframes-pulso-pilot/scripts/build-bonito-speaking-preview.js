import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] || 'robo-bonito-animado';
if (!['robo-bonito-animado', 'robo-bonito-temas', 'robo-bonito-temas-v3'].includes(name)) throw Error('Unknown variant');
const variant = path.join(root, 'variants', name);
await build({ entryPoints: [path.join(root, 'src/bonito-speaking-preview.js')],
  outfile: path.join(variant, 'assets/speaking.bundle.js'), bundle: true,
  format: 'iife', platform: 'browser', target: 'chrome120', minify: true });
for (const name of ['inter-regular.woff2', 'inter-bold.woff2'])
  await fs.copyFile(path.join(root, 'variants/robo-bonito/assets', name), path.join(variant, 'assets', name));
console.log('Rig, visor e narração preparados para HyperFrames.');
