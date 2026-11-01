import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({ entryPoints: [path.join(root, 'src/generated-robot-preview.js')],
  outfile: path.join(root, 'variants/robo-gerado/assets/generated.bundle.js'),
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', minify: true });
console.log('Prévia do GLB preparado.');
