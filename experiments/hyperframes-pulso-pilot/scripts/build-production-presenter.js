import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.resolve(process.argv[2] || path.join(projectDir, 'assets/production-presenter.js'));

await build({
  entryPoints: [path.join(projectDir, 'src/production-presenter.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
  outfile: outputPath
});

process.stdout.write(`Runtime 3D de produção preparado: ${outputPath}\n`);
