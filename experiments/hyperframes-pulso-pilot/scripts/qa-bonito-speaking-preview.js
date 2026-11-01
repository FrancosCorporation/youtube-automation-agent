import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const variantName = process.argv[2] || 'robo-bonito-animado';
if (!['robo-bonito-animado', 'robo-bonito-animado-vertical', 'robo-bonito-temas', 'robo-bonito-temas-vertical'].includes(variantName)) throw Error('Unknown variant');
const variant = path.join(root, 'variants', variantName);
const auditVariantName = variantName.startsWith('robo-bonito-temas') ? 'robo-bonito-temas' : 'robo-bonito-animado';
const rigAudit = JSON.parse(await readFile(path.join(root, 'variants', auditVariantName, 'serialized-rig-audit.json'), 'utf8'));
const evidenceDir = path.resolve(process.env.PULSO_BONITO_QA_DIR || path.join(root, 'renders'));
const reportPath = process.env.PULSO_BONITO_QA_DIR
  ? path.join(evidenceDir, `animation-qa-${variantName}.json`)
  : path.join(variant, 'animation-qa.json');
await mkdir(evidenceDir, { recursive: true });
const proof = JSON.parse(await readFile(path.join(root, 'variants/robo-bonito-animado/audio-proof-times.json'), 'utf8'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.wav': 'audio/wav' };
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(variant, '.'+new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(variant+path.sep)) throw Error('Invalid path');
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl'] });
  const portrait = variantName.endsWith('vertical');
  const page = await browser.newPage({ viewport: portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 } });
  const waitForPaint = () => page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.pulsoSpeakingReady || window.pulsoSpeakingError, null, { timeout: 60000 });
  const error = await page.evaluate(() => window.pulsoSpeakingError);
  if (error) throw Error(error);
  await waitForPaint();
  const capture = async t => {
    const url = await page.evaluate(time => {
      window.pulsoTimeline.seek(time);
      window.seekPulsoSpeaking(time);
      return document.getElementById('three-layer').toDataURL('image/png');
    }, t);
    return Buffer.from(url.split(',')[1], 'base64');
  };
  const rigGeometry = await page.evaluate(() => {
    const meshes = [];
    window.pulsoModel.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
    const geometry = meshes.map((mesh, index) => ({
      index, name: mesh.name,
      vertices: mesh.geometry.attributes.position.count,
      indices: mesh.geometry.index?.count ?? null,
      triangles: mesh.geometry.index ? mesh.geometry.index.count / 3 : null
    }));
    const anchors = {};
    for (const name of ['Head', 'UpperArm_L', 'Forearm_L', 'Hand_L', 'UpperArm_R', 'Forearm_R', 'Hand_R']) {
      anchors[name] = [];
      for (const [meshIndex, mesh] of meshes.entries()) {
        const pos = mesh.geometry.attributes.position, joints = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
        const boneIndex = mesh.skeleton.bones.findIndex(b => b.name === name);
        let first = -1, farthest = -1, largest = -1;
        for (let i = 0; i < pos.count; i++) {
          if (joints.getX(i) !== boneIndex || weights.getX(i) < .99999) continue;
          if (first < 0) first = i;
          const d = (pos.getX(i)-pos.getX(first))**2+(pos.getY(i)-pos.getY(first))**2+(pos.getZ(i)-pos.getZ(first))**2;
          if (d > largest) { farthest = i; largest = d; }
        }
        if (first >= 0 && farthest >= 0) anchors[name].push({ meshIndex, first, farthest });
      }
      if (!anchors[name].length) throw Error(`No rigid geometry anchors for ${name}`);
    }
    return { meshes: geometry, anchors };
  });
  const runtimeTriangles = rigGeometry.meshes.reduce((sum, mesh) => sum + (mesh.triangles ?? 0), 0);
  const geometryMatchesSerializedRigAudit = runtimeTriangles === rigAudit.sourceTrianglesCovered;
  const times = [0, .92, 1.5, 2.15, 2.4, 4.11, 5.25, 10.07, 12.1, 15.16, 16.4, 17.8, 19.9, 22, 25.4, 26.2, 27.1];
  const poseChecks = [];
  for (const time of times) {
    const png = await capture(time);
    await writeFile(path.join(evidenceDir, `pulso-${variantName}-${time.toFixed(2).replace('.', '-')}.png`), png);
    if ([0, 1.5, 2.4, 17.8].includes(time))
      await page.screenshot({path:path.join(evidenceDir, `pulso-${variantName}-full-${time}.png`)});
    const check = await page.evaluate(rigGeometry => {
      const model = window.pulsoModel;
      const meshes = [];
      model.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
      const pairs = {}, geometry = meshes.map((mesh, index) => ({
        index, name: mesh.name,
        vertices: mesh.geometry.attributes.position.count,
        indices: mesh.geometry.index?.count ?? null,
        triangles: mesh.geometry.index ? mesh.geometry.index.count / 3 : null
      }));
      for (const name of ['Head', 'UpperArm_L', 'Forearm_L', 'Hand_L', 'UpperArm_R', 'Forearm_R', 'Hand_R']) {
        pairs[name] = [];
        for (const anchor of rigGeometry.anchors[name]) {
          const mesh = meshes[anchor.meshIndex];
          const a = window.pulsoBones.Head.position.clone(), b = a.clone();
          mesh.getVertexPosition(anchor.first, a); mesh.getVertexPosition(anchor.farthest, b);
          a.applyMatrix4(mesh.matrixWorld); b.applyMatrix4(mesh.matrixWorld);
          pairs[name].push(a.distanceTo(b));
        }
      }
      const points = [], projected = [];
      for (const mesh of meshes) {
        const pos = mesh.geometry.attributes.position;
        for (let i = 0; i < pos.count; i += 101) {
          const point = window.pulsoBones.Head.position.clone();
          mesh.getVertexPosition(i, point); point.applyMatrix4(mesh.matrixWorld);
          points.push([point.x, point.y, point.z]);
          point.project(window.pulsoCamera); projected.push([point.x, point.y]);
        }
      }
      const finite = points.every(p => p.every(Number.isFinite));
      const bounds = [0,1,2].map(axis => [Math.min(...points.map(p=>p[axis])), Math.max(...points.map(p=>p[axis]))]);
      const clipped = window.pulsoAnimationState.close ? 0 : projected.filter(p => Math.abs(p[0])>1 || Math.abs(p[1])>1).length;
      return { state: window.pulsoAnimationState, pairs, finite, bounds, sampledClippedVertices: clipped,
        geometry,
        leftArm: window.pulsoBones.UpperArm_L.rotation.toArray().slice(0,3),
        rightArm: window.pulsoBones.UpperArm_R.rotation.toArray().slice(0,3),
        mouthVisible: window.pulsoControls.FaceMouth.visible,
        smileVisible: window.pulsoControls.FaceSmile.visible,
        eyeScale: window.pulsoControls.FaceEye_L.scale.y };
    }, rigGeometry);
    poseChecks.push({ time, ...check });
  }
  const reference = poseChecks[0].pairs;
  const sourceGeometry = JSON.stringify(rigGeometry.meshes);
  const geometryStableAcrossPoses = poseChecks.every(p => JSON.stringify(p.geometry) === sourceGeometry);
  let rigidError = 0;
  for (const p of poseChecks) for (const [name, values] of Object.entries(p.pairs)) {
    if (values.length !== reference[name].length) rigidError = Infinity;
    values.forEach((value, index) => { rigidError = Math.max(rigidError, Math.abs(value-reference[name][index])); });
  }
  const audioChecks = [];
  for (const [kind, times] of [['speaking', proof.speaking_times], ['silent', proof.silent_times]]) {
    for (const time of times) {
      await capture(time);
      const state = await page.evaluate(() => ({ voice: window.pulsoAnimationState.voice,
        mouth: window.pulsoControls.FaceMouth.visible, smile: window.pulsoControls.FaceSmile.visible }));
      audioChecks.push({ kind, time, ...state });
    }
  }
  const hash = b => createHash('sha256').update(b).digest('hex');
  const poseSnapshot = () => page.evaluate(() => {
    const geometry = [];
    window.pulsoModel.traverse(mesh => {
      if (mesh.isSkinnedMesh) geometry.push({
        name: mesh.name,
        vertices: mesh.geometry.attributes.position.count,
        indices: mesh.geometry.index?.count ?? null,
        triangles: mesh.geometry.index ? mesh.geometry.index.count / 3 : null
      });
    });
    return {
      animation: window.pulsoAnimationState,
      geometry,
      bones: Object.fromEntries(Object.entries(window.pulsoBones).sort(([a], [b]) => a.localeCompare(b))
        .map(([name, bone]) => [name, {
          position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray()
        }])),
      face: Object.fromEntries(Object.entries(window.pulsoControls).sort(([a], [b]) => a.localeCompare(b))
        .map(([name, control]) => [name, {
          visible: control.visible, position: control.position.toArray(), quaternion: control.quaternion.toArray(),
          scale: control.scale.toArray()
        }]))
    };
  });
  const before = hash(await capture(22));
  await capture(2.4);
  const after = hash(await capture(22));
  const metrics = await page.evaluate(() => window.pulsoRigMetrics);
  const warmPoseBuffer = await capture(1.5);
  const warmPose = hash(warmPoseBuffer);
  const warmPoseState = await poseSnapshot();
  await writeFile(path.join(evidenceDir, `pulso-${variantName}-warm-reload.png`), warmPoseBuffer);
  for (const t of [27.1, 0, 17.8, 2.4, 22]) await capture(t);
  const revisitedPose = hash(await capture(1.5));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.pulsoSpeakingReady, null, {timeout:60000});
  await waitForPaint();
  const freshPoseBuffer = await capture(1.5);
  const freshPose = hash(freshPoseBuffer);
  await writeFile(path.join(evidenceDir, `pulso-${variantName}-fresh-reload.png`), freshPoseBuffer);
  const freshPoseState = await poseSnapshot();
  const freshRepeatPose = hash(await capture(1.5));
  await new Promise(resolve => setTimeout(resolve, 250));
  const freshSettledBuffer = await capture(1.5);
  const freshSettledPose = hash(freshSettledBuffer);
  await writeFile(path.join(evidenceDir, `pulso-${variantName}-fresh-settled.png`), freshSettledBuffer);
  const historyIndependentPose = {
    time:1.5,warmPose,revisitedPose,freshPose,freshRepeatPose,freshSettledPose,
    warmMatchesRevisit:warmPose===revisitedPose,
    freshContextStable:freshPose===freshRepeatPose && freshPose===freshSettledPose,
    poseStateMatchesReload:JSON.stringify(warmPoseState)===JSON.stringify(freshPoseState),
    warmPoseState,freshPoseState
  };
  const report = { variant: variantName, metrics, errors, poseChecks, audioChecks,
    rigidDistanceMaxError: rigidError, geometryStableAcrossPoses,
    geometryAudit: { expectedSourceTriangles: rigAudit.sourceTrianglesCovered,
      runtimeSkinnedMeshes: rigGeometry.meshes, runtimeTriangles, matchesSerializedRigAudit: geometryMatchesSerializedRigAudit },
    deterministicSeek: { times: [22, 2.4, 22], before, after, identical: before===after }, historyIndependentPose,
    limitations: ['Bounds sampled at every 101st source vertex; not an exhaustive self-intersection audit.', 'Audio-envelope opening, not phoneme-aligned visemes.'] };
  await writeFile(reportPath, JSON.stringify(report, null, 2)+'\n');
  if (errors.length || before!==after || !historyIndependentPose.warmMatchesRevisit ||
      !historyIndependentPose.freshContextStable || !historyIndependentPose.poseStateMatchesReload ||
      !geometryStableAcrossPoses || !geometryMatchesSerializedRigAudit ||
      rigidError > 1e-4 || poseChecks.some(p=>!p.finite || p.sampledClippedVertices))
    throw Error('Rig/seek/geometry/framing QA failed');
  if (audioChecks.some(p=>p.kind==='silent' ? p.mouth || !p.smile : !p.mouth || p.smile)) throw Error('Mouth audio synchronization QA failed');
  if (!poseChecks.some(p=>p.eyeScale<.05)) throw Error('Blink did not close');
  console.log(JSON.stringify({ variant: variantName, bones: metrics.bones.length, poses: poseChecks.length,
    audioChecks: audioChecks.length, rigidError, deterministicSeek: before===after, errors }));
} finally {
  await browser?.close();
  server.closeAllConnections(); await new Promise(r => server.close(r));
}
