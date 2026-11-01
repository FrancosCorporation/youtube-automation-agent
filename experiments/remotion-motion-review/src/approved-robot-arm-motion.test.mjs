import assert from "node:assert/strict";
import test from "node:test";
import { approvedRobotArmDeltasAtFrame, approvedRobotIdleDeltasAtFrame } from "./approved-robot-arm-motion.mjs";

test("arm gesture is deterministic when Remotion seeks frames out of order", () => {
  const cues = { hook: 18, question: 72, timestamp: 120, receipt: 168, attribution: 216, close: 260 };
  const expected = approvedRobotArmDeltasAtFrame(124, 24, cues, "right");
  approvedRobotArmDeltasAtFrame(500, 24, cues, "left");
  const soughtAgain = approvedRobotArmDeltasAtFrame(124, 24, cues, "right");
  assert.deepEqual(soughtAgain, expected);
});

test("timestamp and receipt cues produce a visible inward pointing arm", () => {
  const cues = { timestamp: 120, receipt: 168 };
  const duringTimestamp = approvedRobotArmDeltasAtFrame(124, 24, cues, "right");
  assert.ok(Math.abs(duringTimestamp.mixamorigRightArm) > Math.abs(duringTimestamp.mixamorigLeftArm));
  assert.ok(duringTimestamp.mixamorigRightArm < 0);
  assert.ok(Math.abs(duringTimestamp.mixamorigRightForeArm) > 0.08);
});

test("idle and cue poses remain finite and within a restrained angular range", () => {
  const pose = approvedRobotArmDeltasAtFrame(164, 24, { hook: 18, receipt: 168 }, "left");
  for (const angle of Object.values(pose)) {
    assert.ok(Number.isFinite(angle));
    assert.ok(Math.abs(angle) <= 0.8);
  }
});

test("head and torso idle remains deterministic and subtle", () => {
  const pose = approvedRobotIdleDeltasAtFrame(58, 24);
  assert.deepEqual(approvedRobotIdleDeltasAtFrame(58, 24), pose);
  assert.ok(Math.max(...Object.values(pose).flatMap(Object.values).map(Math.abs)) <= 0.032);
});
