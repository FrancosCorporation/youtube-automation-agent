const ARM_BONES = [
  "UpperArm_L",
  "Forearm_L",
  "Hand_L",
  "UpperArm_R",
  "Forearm_R",
  "Hand_R",
];

const smoothstep = (value) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const pulse = (frame, cueFrame, fps, { lead = 0.18, attack = 0.24, hold = 0.28, release = 0.56 } = {}) => {
  if (!Number.isFinite(cueFrame)) return 0;
  const start = cueFrame - lead * fps;
  const peak = cueFrame + attack * fps;
  const holdEnd = peak + hold * fps;
  const end = holdEnd + release * fps;
  const rise = smoothstep((frame - start) / Math.max(1, peak - start));
  const fall = 1 - smoothstep((frame - holdEnd) / Math.max(1, end - holdEnd));
  return clamp01(rise * fall);
};

const add = (...vectors) => [
  vectors.reduce((sum, vector) => sum + vector[0], 0),
  vectors.reduce((sum, vector) => sum + vector[1], 0),
  vectors.reduce((sum, vector) => sum + vector[2], 0),
];

/**
 * Convert the narration word alignment into frame cues for the current Pulso story.
 * Matching uses complete normalized words, so punctuation/case differences are safe.
 */
export const resolvePulsoStoryArmCueFrames = (wordEvents, fps) => {
  if (!Array.isArray(wordEvents) || !Number.isFinite(fps) || fps <= 0) {
    throw new TypeError("wordEvents e fps válidos são necessários para coreografar os braços");
  }

  const normalize = (value) => String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, "");
  const firstFrameFor = (word) => {
    const target = normalize(word);
    const event = wordEvents.find((candidate) => normalize(candidate.text) === target);
    if (!event || !Number.isFinite(event.startMs)) {
      throw new Error(`A narração não contém a palavra alinhada necessária: ${word}`);
    }
    return Math.round((event.startMs / 1000) * fps);
  };

  return {
    hook: firstFrameFor("três"),
    question: firstFrameFor("aconteceu"),
    timestamp: firstFrameFor("23"),
    receipt: firstFrameFor("recebeu"),
    attribution: firstFrameFor("atribuída"),
    close: firstFrameFor("Anthropic"),
  };
};

/**
 * Deterministic, frame-addressable arm performance, expressed as Euler deltas in radians.
 * Bone axes follow the named pulso-bonito rig contract used by the existing preview.
 * The deltas are added to the new rig's captured bind pose; no geometry is created here.
 */
export const pulsoStoryArmPoseAtFrame = (frame, fps, cueFrames, screenSide = "right") => {
  if (!Number.isFinite(frame) || !Number.isFinite(fps) || fps <= 0) {
    throw new TypeError("frame e fps precisam ser números válidos");
  }
  if (!cueFrames || typeof cueFrames !== "object") {
    throw new TypeError("cueFrames de narração são necessários");
  }
  if (!["left", "right", "center"].includes(screenSide)) {
    throw new TypeError('screenSide precisa ser "left", "right" ou "center"');
  }

  const t = frame / fps;
  const idle = Math.sin(t * 1.7) * 0.012;
  const hook = pulse(frame, cueFrames.hook, fps, { attack: 0.2, hold: 0.36, release: 0.48 });
  const question = pulse(frame, cueFrames.question, fps, { attack: 0.22, hold: 0.44, release: 0.62 });
  const timestamp = pulse(frame, cueFrames.timestamp, fps, { lead: 0.12, attack: 0.16, hold: 0.16, release: 0.36 });
  const receipt = pulse(frame, cueFrames.receipt, fps, { lead: 0.14, attack: 0.2, hold: 0.32, release: 0.48 });
  const attribution = pulse(frame, cueFrames.attribution, fps, { lead: 0.16, attack: 0.3, hold: 0.72, release: 0.68 });
  const close = pulse(frame, cueFrames.close, fps, { lead: 0.16, attack: 0.18, hold: 0.18, release: 0.48 });

  // The hand nearer the content points inward when the character is framed at an edge.
  // A centered host uses the right arm consistently to avoid alternating without a cut.
  const focusSide = screenSide === "left" ? "L" : "R";
  const focusSign = focusSide === "L" ? 1 : -1;
  const broad = hook * 0.22 + question * 0.34 + attribution * 0.2 + close * 0.12;
  const point = timestamp * 0.28 + receipt * 0.34 + attribution * 0.1;
  const cue = (point + close * 0.12) * focusSign;

  const leftShoulder = add(
    [idle * 0.22, 0, idle],
    [0, (hook + question + attribution) * -0.025, broad + (focusSide === "L" ? cue : 0)],
  );
  const rightShoulder = add(
    [-idle * 0.18, 0, -idle],
    [0, (hook + question + attribution) * 0.025, -broad + (focusSide === "R" ? cue : 0)],
  );
  const leftElbow = add(
    [0.008 * Math.sin(t * 1.3), 0, idle * 0.45],
    [broad * 0.06, 0, broad * 0.09 + (focusSide === "L" ? point * 0.11 : 0)],
  );
  const rightElbow = add(
    [-0.006 * Math.sin(t * 1.3), 0, -idle * 0.45],
    [broad * 0.06, 0, -broad * 0.09 + (focusSide === "R" ? -point * 0.11 : 0)],
  );
  const leftHand = [0, (hook + question + attribution) * 0.04, broad * 0.08 + (focusSide === "L" ? point * 0.12 : 0)];
  const rightHand = [0, -(hook + question + attribution) * 0.04, -broad * 0.08 + (focusSide === "R" ? -point * 0.12 : 0)];

  return {
    UpperArm_L: leftShoulder,
    Forearm_L: leftElbow,
    Hand_L: leftHand,
    UpperArm_R: rightShoulder,
    Forearm_R: rightElbow,
    Hand_R: rightHand,
  };
};

/** Capture the arm rig's original Euler orientation once after loading the approved GLB. */
export const capturePulsoArmBindPose = (bones) => {
  const missing = ARM_BONES.filter((name) => !bones?.[name]?.rotation);
  if (missing.length) throw new Error(`Rig incompatível; faltam ossos: ${missing.join(", ")}`);

  return Object.fromEntries(ARM_BONES.map((name) => {
    const { x, y, z } = bones[name].rotation;
    return [name, [x, y, z]];
  }));
};

/** Apply an absolute frame pose relative to bind rotations; safe to seek in either direction. */
export const applyPulsoArmPose = (bones, bindPose, pose) => {
  for (const name of ARM_BONES) {
    const bone = bones?.[name];
    const bind = bindPose?.[name];
    const delta = pose?.[name];
    if (!bone?.rotation?.set || !bind || !delta) {
      throw new Error(`Rig/pose incompatível no osso ${name}`);
    }
    bone.rotation.set(bind[0] + delta[0], bind[1] + delta[1], bind[2] + delta[2]);
  }
};

export { ARM_BONES as PULSO_ARM_BONES };
