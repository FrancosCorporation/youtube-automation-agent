import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawSeed = process.env.VIDEO_SEED ?? '20261011';
const seed = Number(rawSeed);

if (!Number.isSafeInteger(seed) || seed < 0) {
  throw new Error(`VIDEO_SEED precisa ser um inteiro não negativo; recebido: ${rawSeed}`);
}

const themeConfigPath = path.resolve(projectDir, '../../config/themes.json');
const themeConfig = JSON.parse(readFileSync(themeConfigPath, 'utf8'));
const theme = themeConfig.themes.find(entry => entry.id === (process.env.VIDEO_THEME || 'ia')) || themeConfig.themes[0];
const palettes = theme.visualPalettes?.variants || [];
const themePalette = palettes.length ? palettes[seed % palettes.length] : { accents: ['#5EEAD4', '#60A5FA', '#A78BFA', '#FBBF24'] };
const narrationPath = path.join(projectDir, 'assets/narration.m4a');
const karaoke = JSON.parse(readFileSync(path.join(projectDir, 'assets/narration-word-timings.json'), 'utf8'));
const actualAudioHash = createHash('sha256').update(readFileSync(narrationPath)).digest('hex');
if (karaoke.sourceAudioSha256 !== actualAudioHash) {
  throw new Error('As palavras alinhadas não correspondem ao áudio do piloto');
}

await build({
  entryPoints: [path.join(projectDir, 'src/pilot.js')],
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  outfile: path.join(projectDir, 'assets/pilot.bundle.js'),
  define: {
    __VIDEO_SEED__: String(seed),
    __VIDEO_THEME__: JSON.stringify(theme.id),
    __THEME_PALETTE__: JSON.stringify(themePalette)
  }
});

const landscapeHtml = readFileSync(path.join(projectDir, 'index.html'), 'utf8');
const portraitHtml = landscapeHtml
  .replace('<html lang="pt-BR" data-resolution="landscape">', '<html lang="pt-BR" data-resolution="portrait">')
  .replace('width=1920, height=1080, initial-scale=1', 'width=1080, height=1920, initial-scale=1')
  .replace('data-width="1920" data-height="1080"', 'data-width="1080" data-height="1920"');
if (portraitHtml === landscapeHtml || !portraitHtml.includes('data-width="1080" data-height="1920"')) {
  throw new Error('Não foi possível gerar a composição vertical 9:16');
}
const oldPortraitPath = path.join(projectDir, 'portrait.html');
if (existsSync(oldPortraitPath) && readFileSync(oldPortraitPath, 'utf8').includes('data-resolution="portrait"')) {
  unlinkSync(oldPortraitPath);
}
const portraitDir = path.join(projectDir, 'variants/portrait');
const portraitAssetsDir = path.join(portraitDir, 'assets');
mkdirSync(portraitAssetsDir, { recursive: true });
for (const asset of ['narration.m4a', 'pilot.bundle.js', 'tip-portal-reconstruction.svg', 'pulso-robot-approved-reference.png']) {
  copyFileSync(path.join(projectDir, 'assets', asset), path.join(portraitAssetsDir, asset));
}
copyFileSync(
  path.join(projectDir, 'assets/tip-portal-reconstruction-portrait.svg'),
  path.join(portraitAssetsDir, 'tip-portal-reconstruction.svg')
);
writeFileSync(path.join(portraitDir, 'index.html'), portraitHtml);

process.stdout.write(`Referência visual aprovada, master 16:9, variante 9:16, narração alinhada e paleta ${theme.id} preparados com seed ${seed}.\n`);
