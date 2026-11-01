import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [path.join(root, 'src/modern-preview.js')],
  outfile: path.join(root, 'variants/robo-moderno/assets/modern.bundle.js'),
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', minify: true
});
console.log('Prévia do robô moderno preparada.');
