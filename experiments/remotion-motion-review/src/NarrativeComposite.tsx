import React from "react";
import { OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { CalculateMetadataFunction, Composition, AbsoluteFill } from "remotion";
import { ApprovedRobotPresenter, type ApprovedRobotSide } from "./ApprovedRobotPresenter";
import type { ApprovedRobotGestureCues } from "./approved-robot-arm-motion.mjs";

export type NarrativeShot = {
  startFrame: number;
  durationInFrames: number;
  presenter: boolean;
  hidden: boolean;
  side: ApprovedRobotSide;
  framing: "full" | "medium" | "close";
};

export type NarrativeCompositeProps = {
  backgroundSrc: string;
  robotSrc: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  shots: NarrativeShot[];
  accents: string[];
  lipSyncEnvelope: number[];
  lipSyncStepMs: number;
  gestureCues: ApprovedRobotGestureCues;
};

const DEFAULT_PROPS: NarrativeCompositeProps = {
  backgroundSrc: "",
  robotSrc: "pulso-story/approved-robot-rigged.glb",
  width: 1920,
  height: 1080,
  fps: 24,
  durationInFrames: 96,
  shots: [],
  accents: ["#66D9C4", "#E8B46B"],
  lipSyncEnvelope: [],
  lipSyncStepMs: 10,
  gestureCues: {},
};

const calculateMetadata: CalculateMetadataFunction<NarrativeCompositeProps> = ({ props }) => ({
  durationInFrames: Math.max(1, Math.round(props.durationInFrames)),
  fps: Math.max(1, Number(props.fps)),
  width: Math.max(1, Math.round(props.width)),
  height: Math.max(1, Math.round(props.height)),
});

const currentShot = (shots: NarrativeShot[], frame: number) => {
  let active = shots[0];
  for (const shot of shots) {
    if (shot.startFrame > frame) break;
    active = shot;
  }
  return active;
};

const RobotLayer: React.FC<NarrativeCompositeProps> = (props) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const shot = currentShot(props.shots, frame);
  if (shot && (!shot.presenter || shot.hidden)) return null;

  const side = shot?.side || "right";
  const portrait = height > width;
  const canvasSize = portrait
    ? { width: Math.round(width * 0.52), height: Math.round(height * 0.34) }
    : { width: Math.round(width * 0.37), height: Math.round(height * 0.91) };
  const position: React.CSSProperties = portrait
    ? { top: "54%", left: side === "left" ? "3%" : undefined, right: side === "right" ? "3%" : undefined }
    : { top: "5%", left: side === "left" ? "-1%" : undefined, right: side === "right" ? "-1%" : undefined };

  return (
    <ApprovedRobotPresenter
      src={staticFile(props.robotSrc)}
      side={side}
      canvasSize={canvasSize}
      gestureCues={props.gestureCues}
      lipSyncEnvelope={props.lipSyncEnvelope}
      lipSyncFps={1000 / Math.max(1, props.lipSyncStepMs)}
      accents={props.accents}
      style={{ ...position, zIndex: 5 }}
    />
  );
};

const NarrativeComposite: React.FC<NarrativeCompositeProps> = (props) => (
  <AbsoluteFill style={{ backgroundColor: "#0b1718" }}>
    {props.backgroundSrc ? (
      <OffthreadVideo
        src={staticFile(props.backgroundSrc)}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    ) : null}
    <RobotLayer {...props} />
  </AbsoluteFill>
);

export const NarrativeCompositeComposition: React.FC = () => (
  <Composition
    id="NarrativeComposite"
    component={NarrativeComposite}
    calculateMetadata={calculateMetadata}
    durationInFrames={DEFAULT_PROPS.durationInFrames}
    fps={DEFAULT_PROPS.fps}
    width={DEFAULT_PROPS.width}
    height={DEFAULT_PROPS.height}
    defaultProps={DEFAULT_PROPS}
  />
);
