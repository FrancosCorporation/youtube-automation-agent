import {bundle} from '@remotion/bundler';
import {cp, mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Publish the Studio's static review interface. No development server/API is exposed.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = new Date().toISOString().replace(/[^0-9TZ]/g, '');
const publicRoot = '/home/servidor/Git/site_corp/games_public/remotion-review';
const publicPath = `/games/play/remotion-review/releases/${release}/`;
const output = path.join(project, 'build-review-releases', release);
const target = path.join(publicRoot, 'releases', release);
await bundle({
  entryPoint: path.join(project, 'src/index.ts'),
  rootDir: project,
  outDir: output,
  publicPath,
  rspack: true,
  gitSource: null,
  askAIEnabled: false,
});
const htmlPath = path.join(output, 'index.html');
const html = (await readFile(htmlPath, 'utf8'))
  .replace('<title>Remotion Bundle</title>', '<title>Pulso — Remotion Review</title>')
  .replace('<head>', '<head><meta name="robots" content="noindex,nofollow">');
await writeFile(htmlPath, html);
await mkdir(path.dirname(target), {recursive: true});
await cp(output, target, {recursive: true, errorOnExist: true, force: false});
const route = `${publicPath}?/PulsoStory`;
const landing = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Remotion Review</title><style>html,body,iframe{width:100%;height:100%;margin:0;border:0;background:#09090b}iframe{display:block;height:100dvh}</style></head><body><iframe id="studio" title="Remotion Studio — projetos de vídeo" allow="autoplay; fullscreen" allowfullscreen></iframe><noscript><a href="${publicPath}">Abrir Remotion Studio</a></noscript><script>document.getElementById('studio').src=${JSON.stringify(publicPath)}+location.search+location.hash;</script></body></html>`;
const pending = path.join(publicRoot, `index-${release}.tmp`);
await writeFile(pending, landing);
await rename(pending, path.join(publicRoot, 'index.html'));
const manifest = {
  release,
  studioUrl: 'https://francoscorporation.ddns.net/remotion-review/',
  releaseUrl: `https://francoscorporation.ddns.net${route}`,
  output,
  target,
  mode: 'static-remotion-studio-review',
  exportedMp4: false,
};
await mkdir(path.join(project, 'renders'), {recursive: true});
await writeFile(path.join(project, 'renders/remote-review-deployment.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
