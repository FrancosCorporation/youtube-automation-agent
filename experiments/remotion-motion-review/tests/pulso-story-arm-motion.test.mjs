import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPulsoArmPose,
  capturePulsoArmBindPose,
  pulsoStoryArmPoseAtFrame,
  resolvePulsoStoryArmCueFrames,
} from "../src/pulso-story-arm-motion.mjs";
import { approvedRobotArmDeltasAtFrame } from "../src/approved-robot-arm-motion.mjs";

const words = [
  { text: "três", startMs: 2300 },
  { text: "aconteceu?", startMs: 9840 },
  { text: "23", startMs: 13680 },
  { text: "recebeu", startMs: 18300 },
  { text: "atribuída", startMs: 27780 },
  { text: "Anthropic.", startMs: 30580 },
];

const makeBones = () => Object.fromEntries(
  ["UpperArm_L", "Forearm_L", "Hand_L", "UpperArm_R", "Forearm_R", "Hand_R"].map((name) => [name, {
    rotation: {
      x: 0.1,
      y: -0.2,
      z: 0.3,
      set(x, y, z) { this.x = x; this.y = y; this.z = z; },
    },
  }]),
);

test("resolves aligned story words to deterministic frame cues", () => {
  const cues = resolvePulsoStoryArmCueFrames(words, 24);
  assert.deepEqual(cues, { hook: 55, question: 236, timestamp: 328, receipt: 439, attribution: 667, close: 734 });
  assert.deepEqual(resolvePulsoStoryArmCueFrames(words, 24), cues);
});

test("arm poses are frame deterministic and gesture at each narrated reveal", () => {
  const cues = resolvePulsoStoryArmCueFrames(words, 24);
  const baseline = pulsoStoryArmPoseAtFrame(0, 24, cues, "right");
  for (const frame of [cues.hook, cues.question, cues.timestamp, cues.receipt, cues.attribution, cues.close]) {
    const pose = pulsoStoryArmPoseAtFrame(frame, 24, cues, "right");
    assert.notDeepEqual(pose, baseline, `expected an arm gesture around frame ${frame}`);
    assert.deepEqual(pulsoStoryArmPoseAtFrame(frame, 24, cues, "right"), pose);
    for (const angles of Object.values(pose)) {
      assert.equal(angles.length, 3);
      assert.ok(angles.every(Number.isFinite));
      assert.ok(angles.every((angle) => Math.abs(angle) < 0.8));
    }
  }
});

test("idle includes restrained continuous arm motion between speech gestures", () => {
  const cues = resolvePulsoStoryArmCueFrames(words, 24);
  const rest = pulsoStoryArmPoseAtFrame(8, 24, cues);
  const later = pulsoStoryArmPoseAtFrame(20, 24, cues);
  assert.notEqual(rest.UpperArm_L[2], later.UpperArm_L[2]);
  assert.ok(Math.abs(rest.UpperArm_L[2]) < 0.02);
  assert.ok(Math.abs(later.UpperArm_L[2]) < 0.02);
});

test("the presenter gestures inward from either side without a position-slide cue", () => {
  const cues = resolvePulsoStoryArmCueFrames(words, 24);
  const right = pulsoStoryArmPoseAtFrame(cues.receipt, 24, cues, "right");
  const left = pulsoStoryArmPoseAtFrame(cues.receipt, 24, cues, "left");
  assert.ok(Math.abs(right.UpperArm_R[2]) > Math.abs(right.UpperArm_L[2]));
  assert.ok(Math.abs(left.UpperArm_L[2]) > Math.abs(left.UpperArm_R[2]));
  assert.notDeepEqual(right, left);
});

test("generic production gesture cues preserve the approved reference gesture poses", () => {
  const legacy = approvedRobotArmDeltasAtFrame(328, 24, {
    hook: 55, question: 236, timestamp: 328, receipt: 439, attribution: 667, close: 734,
  }, "right");
  const generic = approvedRobotArmDeltasAtFrame(328, 24, {
    hook: 55, explain: 236, point: 328, compare: 439, emphasize: 667, conclusion: 734,
  }, "right");
  assert.deepEqual(generic, legacy);
});

test("bind-relative application restores exact frame pose on every seek", () => {
  const bones = makeBones();
  const bind = capturePulsoArmBindPose(bones);
  const cues = resolvePulsoStoryArmCueFrames(words, 24);
  const early = pulsoStoryArmPoseAtFrame(cues.hook, 24, cues);
  const late = pulsoStoryArmPoseAtFrame(cues.attribution, 24, cues);

  applyPulsoArmPose(bones, bind, late);
  applyPulsoArmPose(bones, bind, early);
  for (const name of Object.keys(bind)) {
    assert.deepEqual(
      [bones[name].rotation.x, bones[name].rotation.y, bones[name].rotation.z],
      bind[name].map((angle, axis) => angle + early[name][axis]),
    );
  }
});

test("rejects a rig whose arm names do not match the existing rig contract", () => {
  assert.throws(() => capturePulsoArmBindPose({}), /UpperArm_L/);
});
