import React from "react";
import { Composition, registerRoot, staticFile } from "remotion";
import { ApprovedRobotReview } from "./ApprovedRobotReview";

const ApprovedRobotReviewRoot: React.FC = () => (
  <Composition
    id="ApprovedRobotReview"
    component={ApprovedRobotReview}
    durationInFrames={72}
    fps={24}
    width={1920}
    height={1080}
    defaultProps={{ src: staticFile("pulso-story/approved-robot-rigged.glb"), side: "right" }}
  />
);

registerRoot(ApprovedRobotReviewRoot);
