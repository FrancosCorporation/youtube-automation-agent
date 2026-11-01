const smoothstep = (value) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

const cuePulse = (frame, cueFrame, fps, { lead = 0.2, attack = 0.22, hold = 0.24, release = 0.55 } = {}) => {
  if (!Number.isFinite(cueFrame)) return 0;
  const start = cueFrame - lead * fps;
  const peak = cueFrame + attack * fps;
  const holdEnd = peak + hold * fps;
  const end = holdEnd + release * fps;
  const rise = smoothstep((frame - start) / Math.max(1, peak - start));
  const fall = 1 - smoothstep((frame - holdEnd) / Math.max(1, end - holdEnd));
  return Math.max(0, Math.min(1, rise * fall));
};

/**
 * Deterministic frame-addressable gesture deltas for the verified Mixamo rig.
 * Angles are around camera-facing world Z and are converted to each bone's local
 * parent space by ApprovedRobotPresenter, so the source bind rotations stay intact.
 */
export const approvedRobotArmDeltasAtFrame = (frame, fps, cues = {}, screenSide = "right") => {
  if (!Number.isFinite(frame) || !Number.isFinite(fps) || fps <= 0) {
    throw new TypeError("frame e fps precisam ser números válidos");
  }
  if (!["left", "right"].includes(screenSide)) {
    throw new TypeError('screenSide precisa ser "left" ou "right"');
  }

  const t = frame / fps;
  const idle = Math.sin(t * 1.42) * 0.024;
  const hook = cuePulse(frame, cues.hook, fps, { attack: 0.18, hold: 0.3, release: 0.5 });
  const explain = cuePulse(frame, cues.explain ?? cues.question, fps, { attack: 0.24, hold: 0.38, release: 0.6 });
  const point = cuePulse(frame, cues.point ?? cues.timestamp, fps, { lead: 0.14, attack: 0.18, hold: 0.18, release: 0.42 });
  const compare = cuePulse(frame, cues.compare ?? cues.receipt, fps, { lead: 0.16, attack: 0.22, hold: 0.3, release: 0.52 });
  const emphasize = cuePulse(frame, cues.emphasize ?? cues.attribution, fps, { lead: 0.18, attack: 0.28, hold: 0.48, release: 0.62 });
  const conclusion = cuePulse(frame, cues.conclusion ?? cues.close, fps, { lead: 0.16, attack: 0.2, hold: 0.24, release: 0.54 });

  const broad = 0.3 * hook + 0.18 * explain + 0.34 * emphasize + 0.12 * conclusion;
  const pointing = 0.66 * point + 0.5 * compare + 0.18 * emphasize;
  const focus = screenSide === "right" ? "Right" : "Left";

  const result = {};
  for (const anatomicalSide of ["Left", "Right"]) {
    const sideSign = anatomicalSide === "Left" ? 1 : -1;
    const focused = anatomicalSide === focus;
    const focusWeight = focused ? 1 : 0.08;
    const micro = idle * (anatomicalSide === "Left" ? 1 : -1);

    result[`mixamorig${anatomicalSide}Shoulder`] = sideSign * (micro * 0.24 + broad * 0.1 + pointing * focusWeight * 0.08);
    result[`mixamorig${anatomicalSide}Arm`] = sideSign * (micro * 0.5 + broad * 0.48 + pointing * focusWeight * 0.62);
    result[`mixamorig${anatomicalSide}ForeArm`] = sideSign * (broad * 0.1 + pointing * focusWeight * 0.4 + compare * focusWeight * 0.08);
    result[`mixamorig${anatomicalSide}Hand`] = sideSign * (micro * 0.38 + pointing * focusWeight * 0.1);
  }

  return result;
};

/** Small deterministic idle rotations for the verified torso/neck/head bones. */
export const approvedRobotIdleDeltasAtFrame = (frame, fps) => {
  if (!Number.isFinite(frame) || !Number.isFinite(fps) || fps <= 0) {
    throw new TypeError("frame e fps precisam ser números válidos");
  }
  const time = Math.max(0, frame / fps);
  const breath = Math.sin(time * 1.48 + 0.25);
  return {
    mixamorigSpine2: { x: breath * 0.012, y: 0, z: Math.sin(time * 0.62) * 0.006 },
    mixamorigNeck: {
      x: Math.sin(time * 0.9 + 0.35) * 0.012,
      y: Math.sin(time * 0.46 + 0.4) * 0.012,
      z: Math.sin(time * 0.58 + 0.5) * 0.018,
    },
    mixamorigHead: {
      x: Math.sin(time * 0.82 + 0.7) * 0.018,
      y: Math.sin(time * 0.46 + 0.4) * 0.02,
      z: Math.sin(time * 0.61 + 0.2) * 0.032,
    },
  };
};
