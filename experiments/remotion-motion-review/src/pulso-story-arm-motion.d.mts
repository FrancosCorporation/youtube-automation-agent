export type PulsoArmBone =
  | "UpperArm_L"
  | "Forearm_L"
  | "Hand_L"
  | "UpperArm_R"
  | "Forearm_R"
  | "Hand_R";

export type PulsoArmAngles = [number, number, number];
export type PulsoArmPose = Record<PulsoArmBone, PulsoArmAngles>;

export type PulsoStoryArmCueFrames = {
  hook: number;
  question: number;
  timestamp: number;
  receipt: number;
  attribution: number;
  close: number;
};

export type PulsoAlignedWord = { text: string; startMs: number };
export type PulsoScreenSide = "left" | "right" | "center";
export type PulsoArmBoneLike = { rotation: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void } };

export const PULSO_ARM_BONES: readonly PulsoArmBone[];

export function resolvePulsoStoryArmCueFrames(
  wordEvents: readonly PulsoAlignedWord[],
  fps: number,
): PulsoStoryArmCueFrames;

export function pulsoStoryArmPoseAtFrame(
  frame: number,
  fps: number,
  cueFrames: PulsoStoryArmCueFrames,
  screenSide?: PulsoScreenSide,
): PulsoArmPose;

export function capturePulsoArmBindPose(
  bones: Partial<Record<PulsoArmBone, PulsoArmBoneLike>>,
): Record<PulsoArmBone, PulsoArmAngles>;

export function applyPulsoArmPose(
  bones: Partial<Record<PulsoArmBone, PulsoArmBoneLike>>,
  bindPose: Record<PulsoArmBone, PulsoArmAngles>,
  pose: PulsoArmPose,
): void;
