export type ApprovedRobotGestureCues = Partial<{
  hook: number;
  explain: number;
  point: number;
  compare: number;
  emphasize: number;
  conclusion: number;
  /** Legacy cues kept for the approved PulsoStory reference timeline. */
  question: number;
  timestamp: number;
  receipt: number;
  attribution: number;
  close: number;
}>;

export type ApprovedRobotArmBone =
  | "mixamorigLeftShoulder"
  | "mixamorigLeftArm"
  | "mixamorigLeftForeArm"
  | "mixamorigLeftHand"
  | "mixamorigRightShoulder"
  | "mixamorigRightArm"
  | "mixamorigRightForeArm"
  | "mixamorigRightHand";

export type ApprovedRobotArmDeltas = Record<ApprovedRobotArmBone, number>;

export function approvedRobotArmDeltasAtFrame(
  frame: number,
  fps: number,
  cues?: ApprovedRobotGestureCues,
  screenSide?: "left" | "right",
): ApprovedRobotArmDeltas;

export function approvedRobotIdleDeltasAtFrame(
  frame: number,
  fps: number,
): Record<"mixamorigSpine2" | "mixamorigNeck" | "mixamorigHead", { x: number; y: number; z: number }>;
