import React from "react";
import { Audio } from "@remotion/media";
import {
  AbsoluteFill, CalculateMetadataFunction, Composition, Easing, Img,
  interpolate, staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";
import { ApprovedRobotPresenter } from "./ApprovedRobotPresenter";
import { safeNarrativePose, wrapNarrativeLabel } from "./narrative-layout";
import type { ApprovedRobotGestureCues } from "./approved-robot-arm-motion.mjs";
import { validateNarrativeEpisodeProps } from "../../../utils/narrative-episode-props.js";
import { narrativeConceptVisual } from "../../../utils/narrative-concept-visual.js";
import { narrativeActiveObjectIds } from "../../../utils/narrative-active-objects.js";
import { narrativeBeatRelation } from "../../../utils/narrative-beat-relation.js";

type Aspect = "landscape" | "portrait";
type Point = { x: number; y: number; scale: number };
type ObjectPlan = { id: string; label: string; kind: string; labelType: string; illustrative: boolean };
type ScenePlan = {
  id: string; chapterId: string; title: string; visualThesis: string;
  startFrame: number; durationInFrames: number; sentenceIds: string[];
  objects: ObjectPlan[];
  actions: Array<{
    targetObjectId: string; cueSentenceId: string; kind: string; startFrame: number; endFrame: number;
    trajectories: Record<Aspect, { from: Point; to: Point }>;
  }>;
  cameraShots: Array<{ cueSentenceId: string; kind: string; focusObjectId: string; startFrame: number }>;
  presenter: { side: "left" | "right"; framing: "full" | "medium" | "close"; gestureCues: Array<{ cueSentenceId: string; gesture: string }> };
  layouts: Record<Aspect, { objects: Record<string, Point> }>;
  assetId?: string;
};
type SentencePlan = {
  id: string; text: string; startFrame: number; endFrame: number;
  wordTimings?: Array<{ text: string; startFrame: number; endFrame: number }>;
};
type EpisodePlan = {
  title: string; themeId: string; fps: number; durationMs: number; durationInFrames: number;
  scenes: ScenePlan[]; sentences: SentencePlan[];
  assets: Array<{ id: string; managedPath: string; sha256: string; illustrative: boolean }>;
};
type NarrativeEpisodeProps = {
  episode: EpisodePlan | null;
  audioSrc: string;
  robotSrc: string;
  aspect: Aspect;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  accents: string[];
  lipSyncEnvelope: number[];
  lipSyncStepMs: number;
  gestureCues: ApprovedRobotGestureCues;
};

const DEFAULT_PROPS: NarrativeEpisodeProps = {
  episode: null, audioSrc: "", robotSrc: "pulso-story/approved-robot-rigged.glb",
  aspect: "landscape", width: 1920, height: 1080, fps: 24, durationInFrames: 96,
  accents: ["#22D3EE", "#67E8F9"], lipSyncEnvelope: [], lipSyncStepMs: 10, gestureCues: {},
};
const CLAMP = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const ease = (frame: number, from: number, to: number) => interpolate(frame, [from, Math.max(from + 1, to)], [0, 1], {
  ...CLAMP, easing: Easing.bezier(0.22, 1, 0.36, 1),
});
const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;

const calculateMetadata: CalculateMetadataFunction<NarrativeEpisodeProps> = ({ props }) => {
  const validation = validateNarrativeEpisodeProps(props, { allowPreview: true });
  if (!validation.valid) {
    throw new Error(`NarrativeEpisode props inválidas: ${validation.errors.join(", ")}`);
  }
  if (validation.preview) return {
    durationInFrames: DEFAULT_PROPS.durationInFrames, fps: DEFAULT_PROPS.fps,
    width: DEFAULT_PROPS.width, height: DEFAULT_PROPS.height,
  };
  return {
    durationInFrames: props.durationInFrames,
    fps: props.fps,
    width: props.width,
    height: props.height,
  };
};

function activeScene(scenes: ScenePlan[], frame: number): ScenePlan | null {
  let active: ScenePlan | null = null;
  for (const scene of scenes) {
    if (scene.startFrame > frame) break;
    active = scene;
  }
  return active;
}

function activeSentence(sentences: SentencePlan[], frame: number): SentencePlan | null {
  return sentences.find((sentence) => frame >= sentence.startFrame && frame < sentence.endFrame) ?? null;
}

function activeShot(scene: ScenePlan, frame: number) {
  let active = scene.cameraShots[0];
  for (const shot of scene.cameraShots) {
    if (shot.startFrame > frame) break;
    active = shot;
  }
  return active;
}

function poseAt(scene: ScenePlan, object: ObjectPlan, frame: number, aspect: Aspect): Point {
  const actions = scene.actions.filter((action) => action.targetObjectId === object.id);
  if (!actions.length) return scene.layouts[aspect].objects[object.id];
  let pose = actions[0].trajectories[aspect].from;
  for (const action of actions) {
    const path = action.trajectories[aspect];
    if (frame < action.startFrame) break;
    if (frame >= action.endFrame) {
      pose = path.to;
      continue;
    }
    const progress = ease(frame, action.startFrame, action.endFrame);
    return { x: mix(path.from.x, path.to.x, progress), y: mix(path.from.y, path.to.y, progress),
      scale: mix(path.from.scale, path.to.scale, progress) };
  }
  return pose;
}

export const Glyph: React.FC<{ kind: string; color: string; progress: number; values?: Array<{ label: string; value: number }> }> = ({ kind, color, progress, values = [] }) => {
  const stroke = "#E8F2F1";
  const glow = Math.max(0.3, progress);
  switch (kind) {
    case "energy_bill": return <g strokeLinejoin="round"><path d="M-34 -49H35V49L25 43L15 49L5 43L-5 49L-15 43L-25 49L-34 43Z" fill="#e0eeea" stroke={color} strokeWidth="4" /><path d="M-21 -30H20M-21 -19H3M-21 25H21" stroke="#416670" strokeWidth="4" strokeLinecap="round" /><path d="M9 -12L-3 7H7L2 20L21 0H11L16 -12Z" fill={color} stroke="#315665" strokeWidth="2" /></g>;
    case "wallet": return <g strokeLinejoin="round"><rect x="-47" y="-32" width="94" height="67" rx="9" fill="#244b58" stroke={color} strokeWidth="4" /><path d="M-42 -25L28 -43L36 -30M14 -4H48V19H14Q7 19 7 8Q7 -4 14 -4Z" fill="#35616a" stroke={color} strokeWidth="4" /><circle cx="22" cy="8" r="3" fill="#eef5e8" /></g>;
    case "refrigerator": return <g strokeLinejoin="round"><rect x="-32" y="-51" width="64" height="102" rx="7" fill="#d5e6e4" stroke={color} strokeWidth="4" /><path d="M-32 -13H32M-19 -39V-23M-19 -3V19" fill="none" stroke="#315665" strokeWidth="4" strokeLinecap="round" /><path d="M-22 52V57M22 52V57" stroke="#d5e6e4" strokeWidth="4" strokeLinecap="round" /></g>;
    case "number_text": return <g><text x="0" y="19" textAnchor="middle" fill={stroke} fontSize="48" fontWeight="800" fontFamily="Arial, sans-serif">{values[0]?.label || ""}</text></g>;
    case "percentage": case "percentage_comparison": return <g>
      <path d="M-45 -40V43H46" fill="none" stroke={stroke} strokeWidth="3" />
      {values.map((item, i) => { const barHeight = item.value * 0.83 * progress; const x = values.length === 1 ? -11 : -29 + i * 38;
        return <g key={`${item.label}-${i}`}><rect x={x} y={43 - barHeight} width={22} height={barHeight} rx="3" fill={color} />
          <text x={x + 11} y={-43} textAnchor="middle" fill={stroke} fontSize="12" fontWeight="700">{item.label}</text></g>; })}
      <text x="-48" y="-41" textAnchor="end" fill={stroke} fontSize="8">100%</text><text x="-48" y="45" textAnchor="end" fill={stroke} fontSize="8">0%</text>
    </g>;
    case "airway": return <g fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M0 -48V-11M0 -12L-24 10M0 -12L24 10" stroke={stroke} /><path d="M-24 8C-45 -1 -50 17 -44 41C-40 53 -20 45 -15 32L-7 10M24 8C45 -1 50 17 44 41C40 53 20 45 15 32L7 10" fill="#204B5E" />
      <path d="M0 -39V-17" stroke={stroke} strokeDasharray="5 5" strokeDashoffset={-progress * 20} />
    </g>;
    case "lung_cancer": return <g fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M0 -46V-10M0 -10L-24 10M0 -10L24 10" stroke={stroke} /><path d="M-24 8C-45 -1 -50 17 -44 41C-40 53 -20 45 -15 32L-7 10M24 8C45 -1 50 17 44 41C40 53 20 45 15 32L7 10" fill="#204B5E" /><circle cx="29" cy="26" r="9" fill="#ED9C8B" stroke={stroke} strokeWidth="2" /></g>;
    case "low_oxygen": return <g fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"><circle r="42" fill="#183C4B" /><text x="-22" y="10" fill={stroke} stroke="none" fontSize="28" fontWeight="800" fontFamily="Arial, sans-serif">O₂</text><path d="M23 -21V20M13 10L23 20L33 10" stroke={color} strokeWidth="5" /></g>;
    case "oxygen_recovery": return <g fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"><circle r="42" fill="#183C4B" /><text x="-22" y="10" fill={stroke} stroke="none" fontSize="28" fontWeight="800" fontFamily="Arial, sans-serif">O₂</text><path d="M23 20V-21M13 -11L23 -21L33 -11" stroke={color} strokeWidth="5" /></g>;
    case "tumor_growth": return <g fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"><circle cx="-31" cy="2" r="9" fill="#ED9C8B" stroke={stroke} /><circle cx="21" cy="-13" r="10" fill="#ED9C8B" stroke={stroke} /><circle cx="32" cy="7" r="10" fill="#ED9C8B" stroke={stroke} /><circle cx="11" cy="12" r="10" fill="#ED9C8B" stroke={stroke} /><path d="M-13 0H2M-4 -6L2 0L-4 6" stroke={stroke} strokeWidth="4" /></g>;
    case "oxidative_stress": return <g fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"><circle r="31" fill="#214453" /><circle r="13" fill="#392C58" stroke={stroke} /><path d="M-37 -32L-29 -22M-46 -5L-34 -2M31 -35L25 -25M45 -9L34 -6M-25 37L-18 28M27 37L20 27" stroke={stroke} /><path d="M-40 13L-33 9M40 14L33 10" /></g>;
    case "cpap": return <g fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"><rect x="-48" y="-25" width="48" height="51" rx="6" fill="#183C4B" /><path d="M-38 -12H-10M-38 0H-18M0 13Q15 13 15 -2Q15 -15 28 -15H35" stroke={stroke} /><path d="M24 -29H46V1Q35 13 24 1Z" fill="#204B5E" /><circle cx="-10" cy="15" r="3" fill={stroke} /></g>;
    case "body_clock": return <g fill="none" stroke={color} strokeWidth="5"><circle r="42" fill="#183C4B" /><path d="M0 -31V0L22 12" stroke={stroke} strokeLinecap="round" /><path d="M-25 -34L-18 -41M25 -34L18 -41" stroke={stroke} /></g>;
    case "brain": return <g fill="#244D5B" stroke={color} strokeWidth="4" strokeLinejoin="round"><path d="M0 -42C-14 -54 -33 -45 -34 -29C-49 -25 -48 -7 -40 2C-47 17 -36 33 -22 32C-19 45 -7 47 0 40C7 47 19 45 22 32C36 33 47 17 40 2C48 -7 49 -25 34 -29C33 -45 14 -54 0 -42Z" /><path d="M0 -39V39M-25 -18L-12 -12M25 -18L12 -12M-28 16L-14 11M28 16L14 11" fill="none" stroke={stroke} strokeWidth="3" /></g>;
    case "sleep_study": return <g fill="none" stroke={color} strokeWidth="4"><rect x="-46" y="-38" width="92" height="72" rx="7" fill="#183C4B" /><path d="M-38 5H-23L-15 -10L-7 19L2 -20L12 5H38" stroke={stroke} /><path d="M-22 43H22M0 34V43" /></g>;
    case "temperature": return <g fill="none" stroke={color} strokeWidth="5"><path d="M-10 17V-36A10 10 0 0 1 10 -36V17A19 19 0 1 1 -10 17Z" /><path d="M0 -21V27" stroke={stroke} strokeLinecap="round" strokeWidth="8" /><circle cy="30" r="8" fill={stroke} /></g>;
    case "light": return <g fill="none" stroke={color} strokeWidth="5"><circle r="22" fill="#D68D41" /><path d="M0 -45V-33M0 33V45M-45 0H-33M33 0H45M-32 -32L-24 -24M32 -32L24 -24M-32 32L-24 24M32 32L24 24" strokeLinecap="round" /></g>;
    case "sleep": return <g fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"><path d="M-45 35V-15M-45 22H43V35M-45 8H43V22H-45M-34 5C-34 -14 -8 -14 -8 5" /><path d="M23 -43A19 19 0 1 0 40 -16A16 16 0 0 1 23 -43Z" fill={stroke} stroke="none" /></g>;
    case "appetite": return <g fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"><circle r="30" fill="#183C4B" /><circle r="22" stroke={stroke} /><path d="M-44 -38V-14M-50 -38V-27Q-44 -19 -38 -27V-38M-44 -14V38M40 -38V38M40 -38Q28 -25 40 -16" stroke={stroke} /></g>;
    case "body_weight": return <g fill="none" strokeLinecap="round" strokeWidth="5"><circle cy="-33" r="10" fill={color} stroke={color} /><path d="M-15 -16Q-31 4 -21 27L-15 44M15 -16Q31 4 21 27L15 44M-15 -16H15M-27 1L-42 17M27 1L42 17" stroke={color} /><path d="M-27 10Q0 17 27 10" stroke={stroke} strokeDasharray="5 4" /></g>;
    case "calendar": case "attendance": return <g fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"><rect x="-42" y="-37" width="84" height="77" rx="6" fill="#183C4B" /><path d="M-42 -17H42M-23 -47V-29M23 -47V-29" stroke={stroke} />{kind === "attendance" ? <path d="M-19 8L-5 22L23 -3" stroke={stroke} strokeWidth="6" /> : <path d="M-23 -4H-12M-5 -4H6M13 -4H24M-23 11H-12M-5 11H6M13 11H24M-23 26H-12M-5 26H6" />}</g>;
    case "interview": return <g fill="none" strokeLinecap="round" strokeWidth="4"><circle cx="-28" cy="-21" r="9" fill={color} stroke={color} /><circle cx="28" cy="-21" r="9" fill={stroke} stroke={stroke} /><path d="M-44 22Q-42 -7 -28 -7Q-16 -7 -12 16M44 22Q42 -7 28 -7Q16 -7 12 16M-48 23H48M-28 23V43M28 23V43" stroke={color} /><path d="M-7 -27H10M4 -33L10 -27L4 -21" stroke={stroke} /></g>;
    case "gardening": return <g fill="none" strokeLinecap="round" strokeWidth="4"><path d="M-48 28H48M0 28V-4M0 10Q-25 10 -26 -12Q-4 -12 0 10M0 3Q22 3 24 -20Q4 -19 0 3" stroke={color} /><path d="M-38 -37L-12 -11M-45 -42L-33 -48L-28 -36L-36 -28Z" stroke={stroke} /><path d="M-48 38H48" stroke={stroke} /></g>;
    case "food_benefit": return <g fill="none" strokeLinecap="round" strokeWidth="4"><rect x="-48" y="-32" width="96" height="65" rx="8" fill="#183C4B" stroke={color} /><circle cx="9" cy="1" r="18" stroke={stroke} /><path d="M-28 -13V15M-35 -13V-5Q-28 2 -21 -5V-13" stroke={stroke} /></g>;
    case "webpage": return <g fill="none" strokeLinecap="round" strokeWidth="4"><rect x="-46" y="-35" width="92" height="70" rx="7" fill="#183C4B" stroke={color} /><path d="M-46 -19H46M-28 -27H-27M-17 -27H-16M-6 -27H-5M-29 -4H27M-29 8H14M-29 20H20" stroke={stroke} /></g>;
    case "role_reversal": return <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4"><circle cx="-28" cy="-24" r="10" fill={color} stroke={color} /><path d="M-28 -12V18M-42 2L-28 -6L-15 2M-38 36L-28 18L-18 36" stroke={color} /><circle cx="27" cy="-7" r="7" fill={stroke} stroke={stroke} /><path d="M27 2V22M18 11L27 6L36 11M20 36L27 22L34 36" stroke={stroke} /><path d="M14 -25H-10M-10 -25L-3 -31M-10 -25L-3 -19" stroke={stroke} /></g>;
    case "emotional_support": return <g fill="none" strokeLinecap="round" strokeWidth="4"><circle cx="-29" cy="-13" r="9" fill={color} stroke={color} /><path d="M-29 -3V24M-40 9L-29 3L-17 9M-36 38L-29 24L-22 38" stroke={color} /><circle cx="30" cy="-25" r="11" fill={stroke} stroke={stroke} /><path d="M30 -12V20M17 1L30 -5L43 1M22 38L30 20L38 38" stroke={stroke} /><path d="M-9 -20C-18 -28 -12 -39 -3 -34L0 -30L3 -34C12 -39 18 -28 9 -20L0 -12Z" fill={color} stroke={color} /><path d="M-9 3H10M5 -2L10 3L5 8" stroke={stroke} /></g>;
    case "siblings": return <g fill="none" strokeLinecap="round" strokeWidth="4"><circle cx="-23" cy="-17" r="10" fill={color} stroke={color} /><path d="M-23 -5V24M-36 6L-23 0L-8 9M-32 40L-23 24L-14 40" stroke={color} /><circle cx="26" cy="-4" r="7" fill={stroke} stroke={stroke} /><path d="M26 5V25M17 13L26 8L34 13M19 40L26 25L33 40" stroke={stroke} /><path d="M-8 9L16 13" stroke={color} /></g>;
    case "child_burden": return <g fill="none" strokeLinecap="round" strokeWidth="4"><circle cx="0" cy="-10" r="9" fill={color} stroke={color} /><path d="M0 0V25M-13 11L0 5L13 11M-9 41L0 25L9 41" stroke={color} /><rect x="-32" y="-44" width="64" height="25" rx="4" stroke={stroke} /><path d="M-19 -19L-9 -8M19 -19L9 -8" stroke={stroke} /></g>;
    case "child_growth": return <g fill="none" strokeLinecap="round" strokeWidth="4"><circle cx="-29" cy="5" r="6" fill={stroke} stroke={stroke} /><path d="M-29 12V26M-36 18H-22M-35 38L-29 26L-23 38" stroke={stroke} /><circle cx="23" cy="-17" r="10" fill={color} stroke={color} /><path d="M23 -5V25M9 8L23 0L37 8M14 40L23 25L32 40" stroke={color} /><path d="M-12 -22H8M3 -27L8 -22L3 -17" stroke={stroke} /></g>;
    case "family": return <g fill="none" strokeLinecap="round" strokeWidth="4"><circle cx="-28" cy="-22" r="9" fill={color} stroke={color} /><circle cx="28" cy="-22" r="9" fill={stroke} stroke={stroke} /><circle cy="0" r="7" fill={color} stroke={color} /><path d="M-28 -12V23M-40 3L-28 -4L-16 3M-36 39L-28 23L-20 39M28 -12V23M16 3L28 -4L40 3M20 39L28 23L36 39M0 9V27M-8 17L0 12L8 17M-7 40L0 27L7 40" stroke={color} /></g>;
    case "person": return <g opacity={glow} stroke={color} strokeWidth="7" fill="none" strokeLinecap="round"><circle cx="0" cy="-25" r="18" fill={color} stroke="none" /><path d="M0 -5V48M-29 18L0 2L29 18M-19 55L0 37L19 55" /></g>;
    case "document": return <g><path d="M-37 -48H20L39 -29V48H-37Z" fill="#E7F0EC" stroke={stroke} strokeWidth="4" /><path d="M20 -48V-29H39M-22 -12H22M-22 2H22M-22 16H13" stroke={color} strokeWidth="5" strokeLinecap="round" /></g>;
    case "device": return <g><rect x="-35" y="-47" width="70" height="95" rx="12" fill="#102C40" stroke={color} strokeWidth="5" /><rect x="-26" y="-36" width="52" height="70" rx="5" fill="#204B5E" /><circle cy="41" r="3" fill="#F5F5EB" /></g>;
    case "map": return <g><path d="M-48 -34L-13 -47L18 -34L48 -45V34L16 46L-16 32L-48 44Z" fill="#193D49" stroke={color} strokeWidth="4" /><path d="M-13 -44V31M17 -32V43M-36 14L-9 -6L4 9L32 -18" fill="none" stroke={stroke} strokeWidth="4" /><circle cx="4" cy="9" r="7" fill={color} /></g>;
    case "chart": case "number": return <g><path d="M-44 44V-39M-44 44H46" stroke={stroke} strokeWidth="4" /><path d="M-30 12H32M-30 -9H32" fill="none" stroke={color} strokeWidth="5" strokeDasharray="7 8" /></g>;
    case "product": return <g><path d="M-39 -28L0 -48L39 -28V28L0 49L-39 28Z" fill="#244757" stroke={color} strokeWidth="4" /><path d="M-39 -28L0 -6L39 -28M0 -6V49" fill="none" stroke={stroke} strokeWidth="4" /></g>;
    case "vehicle": return <g><path d="M-43 12L-34 -16Q-30 -27 -19 -27H20Q29 -27 34 -14L44 12V30H-43Z" fill="#1C4354" stroke={color} strokeWidth="4" /><path d="M-25 -17H20L29 5H-32Z" fill="#78B6C4" /><circle cx="-25" cy="31" r="8" fill={stroke} /><circle cx="27" cy="31" r="8" fill={stroke} /></g>;
    case "building": return <g><path d="M-43 43H43M-35 35V-18L0 -43L35 -18V35Z" fill="#193A49" stroke={color} strokeWidth="4" /><path d="M-20 -5V8M0 -5V8M20 -5V8M-8 35V16H8V35" stroke={stroke} strokeWidth="5" /></g>;
    case "nature": return <g><path d="M0 44V-3M0 15L-25 -4M0 6L25 -18" stroke={stroke} strokeWidth="6" strokeLinecap="round" /><circle cx="-28" cy="-13" r="18" fill="#397E73" stroke={color} strokeWidth="3" /><circle cx="25" cy="-27" r="18" fill="#397E73" stroke={color} strokeWidth="3" /><circle cy="-35" r="21" fill="#397E73" stroke={color} strokeWidth="3" /></g>;
    case "cell": return <g><circle r="43" fill="#214453" stroke={color} strokeWidth="4" /><circle r="20" fill="#392C58" stroke="#C3AEFF" strokeWidth="4" /><circle cx="25" cy="-21" r="5" fill="#C6F77B" /><circle cx="-24" cy="17" r="5" fill="#C6F77B" /></g>;
    case "network": return <g stroke={color} strokeWidth="4" fill="#153746"><path d="M-27 -27L27 -27L0 30ZM-27 -27L0 30M27 -27L0 30" fill="none" />{[[-27, -27], [27, -27], [0, 30]].map(([x, y], index) => <circle key={index} cx={x} cy={y} r="11" />)}</g>;
    case "step": return <g><path d="M-30 0H30" fill="none" stroke={color} strokeWidth="6" /><circle cx="-30" r="10" fill={stroke} /><circle cx="0" r="10" fill={color} /><circle cx="30" r="10" fill={stroke} /></g>;
    default: return <g><circle r="37" fill="#153746" stroke={color} strokeWidth="4" /><path d="M-18 0H18M0 -18V18" stroke={stroke} strokeWidth="5" strokeLinecap="round" /></g>;
  }
};

const VisualObject: React.FC<{
  scene: ScenePlan; object: ObjectPlan; frame: number; aspect: Aspect; index: number; accent: string; sentence: string;
}> = ({ scene, object, frame, aspect, index, accent, sentence }) => {
  const pose = safeNarrativePose(poseAt(scene, object, frame, aspect), scene.layouts[aspect].objects[object.id],
    aspect, index, scene.objects.length);
  const activeActions = scene.actions.filter((action) => action.targetObjectId === object.id && frame >= action.startFrame && frame <= action.endFrame);
  const active = activeActions[activeActions.length - 1];
  const progress = active ? ease(frame, active.startFrame, active.endFrame) : 1;
  const fadeIn = active?.kind === "reveal-part" ? 0.28 + progress * 0.72 : 1;
  const rotation = active?.kind === "transform" ? (progress - 0.5) * 10 : 0;
  const emphasis = active?.kind === "compare" ? Math.sin(progress * Math.PI) : 0;
  const viewWidth = aspect === "landscape" ? 1000 : 562.5;
  const viewHeight = aspect === "landscape" ? 562.5 : 1000;
  const centerX = pose.x * viewWidth;
  const centerY = pose.y * viewHeight;
  const boxWidth = aspect === "landscape" ? 208 : 330;
  const boxHeight = aspect === "landscape" ? 132 : 154;
  const labelLines = wrapNarrativeLabel(object.label, aspect === "landscape" ? 18 : 17);
  const cardOpacity = fadeIn;
  const radius = active?.kind === "transform" ? 18 + progress * 9 : 27;
  const from = active ? safeNarrativePose(active.trajectories[aspect].from, scene.layouts[aspect].objects[object.id],
    aspect, index, scene.objects.length) : pose;
  const to = active ? safeNarrativePose(active.trajectories[aspect].to, scene.layouts[aspect].objects[object.id],
    aspect, index, scene.objects.length) : pose;
  const visual = narrativeConceptVisual({ label: object.label, kind: object.kind, sentence });
  return <g transform={`translate(${centerX} ${centerY}) scale(${pose.scale}) rotate(${rotation})`} opacity={cardOpacity}>
    {active?.kind === "travel" && <g opacity={0.34}>
      <path d={`M${(from.x * viewWidth - centerX) / pose.scale} ${(from.y * viewHeight - centerY) / pose.scale} Q0 -46 ${(to.x * viewWidth - centerX) / pose.scale} ${(to.y * viewHeight - centerY) / pose.scale}`} fill="none" stroke={accent} strokeWidth="3" strokeDasharray="8 9" />
      <circle cx={((from.x + (to.x - from.x) * progress) * viewWidth - centerX) / pose.scale}
        cy={((from.y + (to.y - from.y) * progress) * viewHeight - centerY) / pose.scale}
        r="8" fill={accent} />
    </g>}
    <rect x={-boxWidth / 2} y={-boxHeight / 2} width={boxWidth} height={boxHeight} rx={radius}
      fill={index % 2 ? "#122B3A" : "#143344"} fillOpacity="0.96" stroke={accent} strokeWidth={2 + emphasis * 2}
      style={{ filter: emphasis > 0.02 ? `drop-shadow(0 0 ${8 + emphasis * 13}px ${accent})` : undefined }} />
    {visual.kind !== "concept_text" && <g transform="translate(0 -18) scale(0.55)"><Glyph kind={visual.kind} color={accent} progress={progress} values={visual.values} /></g>}
    <text x="0" y={visual.kind === "concept_text" ? (labelLines.length === 1 ? 7 : -6)
      : boxHeight / 2 - (labelLines.length === 1 ? 20 : aspect === "landscape" ? 38 : 46)} fill="#F4F1E8" fontSize={aspect === "landscape" ? (labelLines.some((line) => line.length > 14) ? 18 : 21) : 30}
      fontFamily="Arial, sans-serif" fontWeight="700" textAnchor="middle" letterSpacing="0.25">
      {labelLines.map((line, lineIndex) => <tspan key={`${object.id}-${lineIndex}`} x="0" dy={lineIndex === 0 ? 0 : aspect === "landscape" ? 22 : 32}
        textLength={aspect === "landscape" && line.length > 14 ? boxWidth - 24 : undefined}
        lengthAdjust={aspect === "landscape" && line.length > 14 ? "spacingAndGlyphs" : undefined}>{line}</tspan>)}
    </text>
    {object.illustrative && <text x="0" y={boxHeight / 2 + 16} fill="#B8C8CE" fontSize={aspect === "landscape" ? 8 : 12}
      fontFamily="Arial, sans-serif" textAnchor="middle" letterSpacing="1.1">EXEMPLO ILUSTRATIVO</text>}
  </g>;
};

const Presenter: React.FC<{ props: NarrativeEpisodeProps; scene: ScenePlan }> = ({ props, scene }) => {
  const { width, height } = useVideoConfig();
  const portrait = props.aspect === "portrait";
  const canvasSize = portrait
    ? { width: Math.round(width * 0.58), height: Math.round(height * 0.35) }
    : { width: Math.round(width * 0.37), height: Math.round(height * 0.91) };
  const gestureCues: ApprovedRobotGestureCues = {};
  for (const cue of scene.presenter.gestureCues) {
    const sentence = props.episode?.sentences.find((item) => item.id === cue.cueSentenceId);
    if (sentence) gestureCues[cue.gesture as keyof ApprovedRobotGestureCues] = sentence.startFrame;
  }
  const position: React.CSSProperties = portrait
    // The shared presenter defaults to top/right positioning; explicitly clear
    // those defaults so bottom/left actually place it below the captions.
    ? { top: "auto", right: "auto", bottom: "1%", left: "21%" }
    : { top: "4%", right: "-1%" };
  return <ApprovedRobotPresenter src={staticFile(props.robotSrc)} side={scene.presenter.side}
    canvasSize={canvasSize} gestureCues={gestureCues} lipSyncEnvelope={props.lipSyncEnvelope}
    lipSyncFps={1000 / Math.max(1, props.lipSyncStepMs)} accents={props.accents}
    style={{ ...position, zIndex: 6 }} />;
};

const Backdrop: React.FC<{ aspect: Aspect; accent: string }> = ({ aspect, accent }) => {
  const { width, height } = useVideoConfig();
  const vertical = aspect === "portrait";
  return <AbsoluteFill style={{ background: `radial-gradient(ellipse at ${vertical ? "50% 26%" : "34% 45%"}, #153445 0%, #0B1D2A 51%, #07141D 100%)` }}>
    <svg width={width} height={height} viewBox={`0 0 ${vertical ? 562.5 : 1000} ${vertical ? 1000 : 562.5}`} style={{ position: "absolute", inset: 0, opacity: 0.28 }}>
      <defs><pattern id="episode-grid" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M44 0H0V44" fill="none" stroke={accent} strokeOpacity=".25" strokeWidth=".65" /></pattern></defs>
      <rect width="100%" height="100%" fill="url(#episode-grid)" />
    </svg>
    <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(4,13,20,.06) 0%, rgba(4,13,20,.03) 68%, rgba(4,13,20,.68) 100%)" }} />
  </AbsoluteFill>;
};

const EpisodeScene: React.FC<NarrativeEpisodeProps> = (props) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const episode = props.episode;
  if (!episode) return <AbsoluteFill style={{ backgroundColor: "#07141D" }} />;
  const scene = activeScene(episode.scenes, frame) ?? episode.scenes[episode.scenes.length - 1];
  if (!scene) return <AbsoluteFill style={{ backgroundColor: "#07141D" }} />;
  const portrait = props.aspect === "portrait";
  const viewWidth = portrait ? 562.5 : 1000;
  const viewHeight = portrait ? 1000 : 562.5;
  const activeCaption = activeSentence(episode.sentences, frame);
  // When adjacent measured words share a quantized frame, highlight the
  // latest one only instead of highlighting two words at once.
  const activeWordIndex = (activeCaption?.wordTimings || []).reduce(
    (selected, word, index) => frame >= word.startFrame && frame < word.endFrame ? index : selected, -1
  );
  const accent = props.accents[0] || "#22D3EE";
  const shot = activeShot(scene, frame);
  const visibleObjectIds = narrativeActiveObjectIds(scene, activeCaption?.id, shot);
  const relation = narrativeBeatRelation({ sentence: activeCaption?.text || "", objects: scene.objects.filter((object) => visibleObjectIds.has(object.id)) });
  const focusIndex = Math.max(0, scene.objects.findIndex((object) => object.id === shot?.focusObjectId));
  const authoredFocus = scene.layouts[props.aspect].objects[shot?.focusObjectId] || { x: 0.42, y: 0.4, scale: 1 };
  const focus = safeNarrativePose(authoredFocus, authoredFocus, props.aspect, focusIndex, scene.objects.length);
  // Keep camera emphasis inside the title, presenter and caption safe areas.
  const zoomTarget = shot?.kind === "detail" ? 1.05 : shot?.kind === "follow" ? 1.04 : shot?.kind === "result" ? 1.03 : 1;
  const cameraProgress = shot ? ease(frame, shot.startFrame, shot.startFrame + Math.round(props.fps * 0.48)) : 1;
  const zoom = mix(1, zoomTarget, cameraProgress);
  const asset = scene.assetId ? episode.assets.find((item) => item.id === scene.assetId) : null;
  const imageSource = asset?.managedPath ? staticFile(asset.managedPath.replace(/^experiments\/remotion-motion-review\/public\//, "")) : null;
  const chapterIndex = episode.scenes.findIndex((item) => item.id === scene.id) + 1;
  const chapterCount = episode.scenes.length;
  return <AbsoluteFill>
    <Backdrop aspect={props.aspect} accent={accent} />
    {imageSource && <Img src={imageSource} style={{ position: "absolute", left: portrait ? "7%" : "7%", top: portrait ? "9%" : "14%",
      width: portrait ? "34%" : "27%", height: portrait ? "18%" : "26%", objectFit: "cover", opacity: 0.22,
      borderRadius: 22, border: `1px solid ${accent}`, filter: "saturate(.82)" }} />}
    <div style={{ position: "absolute", left: portrait ? "8%" : "8%", top: portrait ? "7%" : "7%",
      color: accent, fontFamily: "Arial, sans-serif", fontSize: portrait ? 20 : 17, fontWeight: 700,
      letterSpacing: 2.2, textTransform: "uppercase" }}>
      {episode.themeId} <span style={{ color: "#97AFBA", marginLeft: 12 }}>{String(chapterIndex).padStart(2, "0")} / {String(chapterCount).padStart(2, "0")}</span>
    </div>
    <div style={{ position: "absolute", left: portrait ? "8%" : "8%", top: portrait ? "11%" : "12%",
      maxWidth: portrait ? "82%" : "58%", color: "#F4F1E8", fontFamily: "Arial, sans-serif",
      fontSize: portrait ? 31 : 35, lineHeight: 1.08, fontWeight: 700, textShadow: "0 2px 12px #07141D",
      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{scene.title}</div>
    <svg width={width} height={height} viewBox={`0 0 ${viewWidth} ${viewHeight}`} preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <defs><marker id="narrative-relation-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M0 0L8 4L0 8Z" fill={accent} /></marker></defs>
      <g transform={`translate(${(1 - zoom) * focus.x * viewWidth} ${(1 - zoom) * focus.y * viewHeight}) scale(${zoom})`}>
        {relation && (() => {
          const positions = relation.objectIds.map((id) => {
            const index = scene.objects.findIndex((object) => object.id === id);
            const object = scene.objects[index];
            const base = scene.layouts[props.aspect].objects[id];
            return safeNarrativePose(poseAt(scene, object, frame, props.aspect), base, props.aspect, index, scene.objects.length);
          });
          const [from, to] = positions;
          const ax = from.x * viewWidth, ay = from.y * viewHeight, bx = to.x * viewWidth, by = to.y * viewHeight;
          const dx = bx - ax, dy = by - ay, distance = Math.hypot(dx, dy);
          if (distance < 1) return null;
          const ux = dx / distance, uy = dy / distance;
          const halfWidth = portrait ? 165 : 104, halfHeight = portrait ? 77 : 66;
          const edge = (scale: number) => Math.min(halfWidth * scale / Math.max(Math.abs(ux), 0.001), halfHeight * scale / Math.max(Math.abs(uy), 0.001)) + 6;
          const left = edge(from.scale), right = edge(to.scale);
          if (distance <= left + right + 8) return null;
          const x1 = ax + ux * left, y1 = ay + uy * left, x2 = bx - ux * right, y2 = by - uy * right;
          return <g opacity="0.8"><line x1={x1} y1={y1} x2={x2} y2={y2} stroke={accent} strokeWidth="3"
            markerStart={relation.kind === "bidirectional" ? "url(#narrative-relation-arrow)" : undefined}
            markerEnd={relation.kind === "bidirectional" ? "url(#narrative-relation-arrow)" : undefined} />
          {relation.kind === "comparison" && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} fill="#F4F1E8" textAnchor="middle" fontSize="15" fontWeight="700">vs</text>}</g>;
        })()}
        {scene.actions.filter((action) => action.kind === "travel" && frame >= action.startFrame && frame <= action.endFrame).map((action, index) => {
          const path = action.trajectories[props.aspect];
          const objectIndex = Math.max(0, scene.objects.findIndex((object) => object.id === action.targetObjectId));
          const base = scene.layouts[props.aspect].objects[action.targetObjectId];
          const from = safeNarrativePose(path.from, base, props.aspect, objectIndex, scene.objects.length);
          const to = safeNarrativePose(path.to, base, props.aspect, objectIndex, scene.objects.length);
          const progress = ease(frame, action.startFrame, action.endFrame);
          const x = mix(from.x, to.x, progress) * viewWidth;
          const y = mix(from.y, to.y, progress) * viewHeight;
          return <g key={`${action.targetObjectId}-travel-${index}`}><circle cx={x} cy={y} r={portrait ? 9 : 7} fill={accent} />
            <circle cx={x} cy={y} r={portrait ? 19 : 15} fill="none" stroke={accent} strokeOpacity=".38" strokeWidth="2" /></g>;
        })}
        {scene.objects.map((object, index) => visibleObjectIds.has(object.id) && <VisualObject key={`${scene.id}-${object.id}`} scene={scene} object={object} frame={frame}
          aspect={props.aspect} index={index} accent={props.accents[index % Math.max(1, props.accents.length)] || accent} sentence={activeCaption?.text || ""} />)}
      </g>
    </svg>
    <div style={{ position: "absolute", left: portrait ? "8%" : "8%", right: portrait ? "8%" : "39%",
      bottom: portrait ? "45%" : "10%", minHeight: portrait ? 112 : 82, padding: portrait ? "18px 20px" : "14px 18px",
      boxSizing: "border-box", borderRadius: 16, background: "rgba(7,20,29,.86)", borderLeft: `4px solid ${accent}`,
      color: "#F5F4EA", fontFamily: "Arial, sans-serif", fontSize: portrait ? 26 : 25, fontWeight: 600,
      lineHeight: 1.18, display: "flex", alignItems: "center", zIndex: 3,
      boxShadow: "0 8px 28px rgba(0,0,0,.24)" }}>
      {activeCaption?.wordTimings?.length ? <span>{activeCaption.wordTimings.map((word, index) => {
        const isSpeaking = index === activeWordIndex;
        return <React.Fragment key={`${activeCaption.id}-${index}`}>
          <span style={isSpeaking ? { color: "#07141D", backgroundColor: accent, borderRadius: 4, padding: "0 3px" } : undefined}>
            {word.text}
          </span>{index < activeCaption.wordTimings!.length - 1 ? " " : ""}
        </React.Fragment>;
      })}</span> : activeCaption?.text || scene.visualThesis}
    </div>
    <Presenter props={props} scene={scene} />
    <div style={{ position: "absolute", left: "8%", right: "8%", bottom: portrait ? "7%" : "3.5%", height: 3,
      background: "rgba(192,213,219,.18)", zIndex: 8 }}>
      <div style={{ width: `${Math.min(100, (frame / Math.max(1, episode.durationInFrames - 1)) * 100)}%`, height: "100%", background: accent }} />
    </div>
  </AbsoluteFill>;
};

const NarrativeEpisode: React.FC<NarrativeEpisodeProps> = (props) => <AbsoluteFill>
  <EpisodeScene {...props} />
  {props.audioSrc ? <Audio src={staticFile(props.audioSrc)} /> : null}
</AbsoluteFill>;

export const NarrativeEpisodeComposition: React.FC = () => <Composition
  id="NarrativeEpisode" component={NarrativeEpisode} calculateMetadata={calculateMetadata}
  durationInFrames={DEFAULT_PROPS.durationInFrames} fps={DEFAULT_PROPS.fps}
  width={DEFAULT_PROPS.width} height={DEFAULT_PROPS.height} defaultProps={DEFAULT_PROPS} />;
