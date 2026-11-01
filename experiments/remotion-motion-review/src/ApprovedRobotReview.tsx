import React from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { ApprovedRobotPresenter } from "./ApprovedRobotPresenter";
import envelope from "../public/pulso-story/audio-envelope.json";

export type ApprovedRobotReviewProps = {
  src?: string;
  side?: "left" | "right";
};

/** Isolated 3D asset review stage; it is not registered in the production Root. */
export const ApprovedRobotReview: React.FC<ApprovedRobotReviewProps> = ({
  src = staticFile("pulso-story/approved-robot-rigged.glb"),
  side = "right",
}) => {
  const isRight = side === "right";
  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        background: "radial-gradient(ellipse at 72% 46%, #18383a 0%, #0b1f21 62%, #071618 100%)",
      }}
    >
      <ApprovedRobotPresenter
        src={src}
        side={side}
        canvasSize={isRight ? { width: 630, height: 940 } : { width: 500, height: 750 }}
        gestureCues={{ hook: 8, question: 20, timestamp: 32, receipt: 46, attribution: 58, close: 68 }}
        lipSyncEnvelope={envelope.levels}
        lipSyncFps={1000 / envelope.stepMs}
        style={isRight ? { top: 80, left: undefined, right: 0 } : { top: 190, left: 5, right: undefined }}
      />
    </AbsoluteFill>
  );
};
