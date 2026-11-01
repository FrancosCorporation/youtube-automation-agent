const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'renders/gps-v2-review');
const publicRoot = '/home/servidor/Git/site_corp/games_public/remotion-review/previews';
const name = 'gps-explainer-20261023-v2';
const url = `https://francoscorporation.ddns.net/remotion-review/previews/${name}/`;
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
(async () => {
  const tech = JSON.parse(await fs.readFile(path.join(output, 'technical-qa.json')));
  const visual = JSON.parse(await fs.readFile(path.join(output, 'visual-review.json')));
  assert.equal(visual.status, 'approved');
  assert.equal(tech.masters.length, 2);
  const stamp = new Date().toISOString().replace(/[^0-9TZ]/g, '');
  const staging = path.join(publicRoot, `.${name}-${stamp}`);
  const target = path.join(publicRoot, name);
  await fs.mkdir(staging, { recursive: true });
  const manifest = { title: 'Como o GPS encontra você?', version: 2, previewUrl: url, publishedAt: new Date().toISOString(), videos: [] };
  for (const master of tech.masters) {
    assert.equal(master.decodePassed, true);
    assert.equal(visual.masters[master.aspect].sha256, master.sha256, 'Visual review must match this exact MP4');
    const bytes = await fs.readFile(master.file);
    assert.equal(hash(bytes), master.sha256, 'Master changed after QA');
    await fs.writeFile(path.join(staging, `${master.aspect}.mp4`), bytes);
    await fs.copyFile(path.join(output, `poster-${master.aspect}.jpg`), path.join(staging, `poster-${master.aspect}.jpg`));
    manifest.videos.push({ aspect: master.aspect, file: `${master.aspect}.mp4`, sha256: master.sha256, bytes: bytes.length, width: master.width, height: master.height, durationSeconds: master.durationSeconds, fps: master.fps });
  }
  await fs.copyFile(path.join(root, 'templates/gps-v2-preview.html'), path.join(staging, 'index.html'));
  await fs.copyFile(path.join(root, 'public/gps-explainer/narration.srt'), path.join(staging, 'legendas.srt'));
  await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  try { await fs.access(target); await fs.rename(target, `${target}-previous-${stamp}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.rename(staging, target);
  await fs.writeFile(path.join(output, 'preview-deployment.json'), JSON.stringify({ ...manifest, target }, null, 2) + '\n');
  console.log(JSON.stringify({ previewUrl: url, target, videos: manifest.videos }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
