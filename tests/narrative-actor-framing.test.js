'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PerspectiveCamera, Vector3 } = require('../experiments/remotion-motion-review/node_modules/three');
const { normalizeIllustrations } = require('../utils/narrative-illustration-plan');
const { assertActorFraming, repairActorFraming, MIN_ACTOR_VIEWPORT_HEIGHT } = require('../utils/narrative-actor-framing');
const { bodyAt } = require('../utils/narrative-spatial-audit');
const { animationState } = require('../utils/narrative-animation-tracks');
const { illustrationViewport } = require('../utils/narrative-illustration-viewport');
const sentence = { id: 's1', text: 'A pessoa caminha perto da mesa sobre o piso.', startFrame: 0, endFrame: 48 };
const pose = (x, y, scale = 1) => ({ landscape: { x, y, scale }, portrait: { x: .5, y, scale } });
function drawing() {
  return { dimension: '3d', cueSentenceId: 's1', explanation: 'A pessoa caminha pelo piso perto da mesa.', nodes: [
    { id: 'person', evidence: 'pessoa', actorId: 'person-a', actorMotion: 'Walk', actorMotionCueText: 'caminha', depth: 4, layout: pose(.35, .85, .9) },
    { id: 'floor', evidence: 'piso', layout: pose(.5, .85), meshes: [{ type: 'box', size: [12, .1, 9.45], position: [0, -.05, 0], color: '#f3eee0' }] },
    { id: 'table', evidence: 'mesa', depth: 1, layout: pose(.35, .85), meshes: [{ type: 'box', size: [2.2, .75, 1.2], position: [0, .4, 0], color: '#163b3e' }] }
  ], camera: { landscape: { position: [0, 3, 14], target: [0, 0, 0], fov: 34 },
    portrait: { position: [0, 3, 11], target: [0, 0, 0], fov: 34 } }, tracks: [
    { targetId: 'person', property: 'position3d', keyframes: [
      { cueSentenceId: 's1', boundary: 'start', value: [0, 0, 0] }, { cueSentenceId: 's1', boundary: 'end', value: [0, 0, .4] }] },
    { targetId: 'camera', property: 'position3d', keyframes: [
      { cueSentenceId: 's1', boundary: 'start', value: [0, 0, 0] }, { cueSentenceId: 's1', boundary: 'end', value: [.5, 0, -1] }] }
  ], spatialChecks: [{ subject: { nodeId: 'person' }, obstacles: [{ nodeId: 'floor', meshIndex: 0 }, { nodeId: 'table', meshIndex: 0 }] }] };
}

test('cropped actors are rejected and authoring reframes both aspects without changing bodies or cues', () => {
  const raw = drawing(), before = globalThis.structuredClone(raw);
  assert.throws(() => normalizeIllustrations([raw], [sentence], 24), /câmera corta person/);
  const [fixed] = normalizeIllustrations([raw], [sentence], 24, { repairLayout: repairActorFraming });
  assert.deepEqual(raw, before);
  assert.equal(fixed.nodes[0].depth, 4);
  assert.equal(fixed.nodes[0].layout.portrait.scale, .9);
  assert.deepEqual(fixed.tracks[0].keyframes.map(key => key.value), [[0, 0, 0], [0, 0, .4]]);
  assert.equal(repairActorFraming(fixed, sentence), fixed);
  assert.deepEqual(normalizeIllustrations([fixed], [sentence], 24), [fixed]);
  // Independent Three.js projection oracle checks the actual canvas ratios.
  for (const aspect of ['landscape', 'portrait']) for (let frame = 0; frame <= 48; frame += .25) {
    const viewport = illustrationViewport(aspect, aspect === 'portrait' ? 1080 : 1920, aspect === 'portrait' ? 1920 : 1080);
    const plan = fixed.camera[aspect], motion = animationState(fixed.tracks, 'camera', frame);
    const camera = new PerspectiveCamera(plan.fov, viewport.width / viewport.height, .1, 100);
    camera.position.set(...plan.position.map((v, i) => v + (motion.position3d?.[i] || 0)));
    camera.lookAt(...plan.target); camera.updateMatrixWorld();
    const body = bodyAt(fixed, { nodeId: 'person' }, aspect, frame);
    for (let mask = 0; mask < 8; mask++) {
      const point = body.center.map((v, axis) => v + body.half.reduce((sum, half, i) => sum + ((mask >> i) & 1 ? 1 : -1) * half * body.axes[i][axis], 0));
      const projected = new Vector3(...point).project(camera);
      assert(Math.abs(projected.x) <= .82 && Math.abs(projected.y) <= .82 && Math.abs(projected.z) < 1);
    }
  }
});

test('framing audits the middle of a camera path and rejects an unrepairable sweep', () => {
  const [fixed] = normalizeIllustrations([drawing()], [sentence], 24, { repairLayout: repairActorFraming });
  const track = fixed.tracks.find(item => item.targetId === 'camera');
  track.property = 'target3d';
  track.keyframes.splice(1, 0, { ...track.keyframes[0], frame: 24, value: [24, 24, -24] });
  assert.throws(() => assertActorFraming(fixed, sentence), /câmera corta/);
  assert.throws(() => assertActorFraming(repairActorFraming(fixed, sentence), sentence), /câmera corta/);
});

test('a distant but uncropped actor is brought closer without moving the actor or cropping other props', () => {
  const [initial] = normalizeIllustrations([drawing()], [sentence], 24, { repairLayout: repairActorFraming });
  for (const aspect of ['landscape', 'portrait']) {
    const camera = initial.camera[aspect];
    camera.position = camera.position.map((value, axis) => camera.target[axis] + 2.5 * (value - camera.target[axis]));
  }
  assert.doesNotThrow(() => assertActorFraming(initial, sentence));
  assert.throws(() => assertActorFraming(initial, sentence, { minHeight: MIN_ACTOR_VIEWPORT_HEIGHT }), /pequeno demais/);
  const fixed = repairActorFraming(initial, sentence);
  assert.deepEqual(fixed.nodes, initial.nodes);
  assert.deepEqual(fixed.tracks, initial.tracks);
  assert.doesNotThrow(() => assertActorFraming(fixed, sentence));
  for (const aspect of ['landscape', 'portrait']) {
    const viewport = illustrationViewport(aspect, aspect === 'portrait' ? 1080 : 1920, aspect === 'portrait' ? 1920 : 1080);
    function actorHeight(plan) {
      const camera = new PerspectiveCamera(plan.fov, viewport.width / viewport.height, .1, 100);
      camera.position.set(...plan.position); camera.lookAt(...plan.target); camera.updateMatrixWorld();
      const body = bodyAt(initial, { nodeId: 'person' }, aspect, 0);
      const ys = Array.from({ length: 8 }, (_, mask) => {
        const point = body.center.map((v, axis) => v + body.half.reduce((sum, half, i) => sum + ((mask >> i) & 1 ? 1 : -1) * half * body.axes[i][axis], 0));
        return new Vector3(...point).project(camera).y;
      });
      return Math.max(...ys) - Math.min(...ys);
    }
    assert(actorHeight(fixed.camera[aspect]) > actorHeight(initial.camera[aspect]) * 1.1, aspect);
  }
});

test('authorship rejects readable-frame failures and returns the audited draft for repair', () => {
  const initial = drawing();
  for (const aspect of ['landscape', 'portrait']) {
    initial.camera[aspect] = { position: [0, 3, 24], target: [0, 1, 0], fov: 65 };
    initial.nodes[0].layout[aspect].scale = .3;
  }
  initial.tracks = [];
  assert.throws(() => normalizeIllustrations([initial], [sentence], 24, {
    repairLayout: value => value, requireReadableActors: true
  }), error => {
    assert.match(error.message, /pequeno demais/);
    assert.equal(error.illustrationDrafts.length, 1);
    assert.equal(error.illustrationDrafts[0].nodes[0].actorId, 'person-a');
    return true;
  });
  const { normalizeScene } = require('../utils/narrative-scene-author');
  const input = { id: 'scene-01', narration: [sentence], sentenceIds: [sentence.id], startFrame: 0, durationInFrames: 48 };
  assert.throws(() => normalizeScene({ id: input.id, visualThesis: initial.explanation, illustrations: [initial] },
    input, { fps: 24, themeId: 'psicologia', title: sentence.text, assets: [] }, sentence.text,
    { repairLayout: value => value }), /pequeno demais/);
});
