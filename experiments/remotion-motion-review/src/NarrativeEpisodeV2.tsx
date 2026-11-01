import React from "react";
import { Audio } from "@remotion/media";
import { ThreeCanvas } from "@remotion/three";
import { AbsoluteFill, CalculateMetadataFunction, Composition, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ApprovedRobotPresenter } from "./ApprovedRobotPresenter";
import { wrapNarrativeLabel } from "./narrative-layout";
import type { ApprovedRobotGestureCues } from "./approved-robot-arm-motion.mjs";
import { validateNarrativeEpisodeProps } from "../../../utils/narrative-episode-props.js";
import { cueRequiresPairedVisual, cueRequiresRoutes } from "../../../utils/narrative-visual-semantics.js";
import { narrativeObjectVisual } from "../../../utils/narrative-concept-visual.js";
import { narrativeAlternativeRelation, narrativeBeatRelation, narrativeCauseRelation } from "../../../utils/narrative-beat-relation.js";
import { narrativeLabelMaxWidth } from "../../../utils/narrative-label-fit.js";
import { narrativeActionMotion } from "../../../utils/narrative-visual-motion.js";
import { narrativeLabelCueFrame } from "../../../utils/narrative-word-cue.js";
import { selectNarrativeFlowPhase } from "../../../utils/narrative-flow-phase.js";
import { narrativeObjectQualifier } from "../../../utils/narrative-object-qualifier.js";
import { transitBeat } from "../../../utils/narrative-transit-scene.js";
import { applianceVisualMode } from "../../../utils/narrative-appliance-scene.js";
import { gratitudeResearchBeat } from "../../../utils/narrative-research-gratitude.js";
import { NarrativeTransitScene } from "./NarrativeTransitScene";
import { NarrativeApplianceScene } from "./NarrativeApplianceScene";
import { NarrativeResearchGratitudeScene } from "./NarrativeResearchGratitudeScene";
import { Glyph as NarrativeConceptGlyph } from "./NarrativeEpisode";
import { directNarrativeBeat } from "../../../utils/narrative-direction.js";
import type { DirectedBeat } from "../../../utils/narrative-direction.js";
import { NarrativeDirectedScene } from "./NarrativeDirectedScene";
import { NarrativeIllustrationScene } from "./NarrativeIllustrationScene";
import type { NarrativeIllustration } from "../../../utils/narrative-illustration-plan.js";

type Aspect = "landscape" | "portrait";
type Point = { x: number; y: number; scale: number };
type ObjectPlan = { id: string; label: string; kind: string; labelType: string; illustrative: boolean };
type Action = { targetObjectId: string; cueSentenceId: string; kind: string; startFrame: number; endFrame: number; trajectories: Record<Aspect, { from: Point; to: Point }> };
type Camera = { cueSentenceId: string; kind: string; focusObjectId: string; startFrame: number };
type ScenePlan = { id: string; chapterId: string; title: string; visualThesis: string; startFrame: number; durationInFrames: number; sentenceIds: string[];
  objects: ObjectPlan[]; actions: Action[]; cameraShots: Camera[]; direction?: DirectedBeat[]; illustrations?: NarrativeIllustration[]; presenter: { side: "left" | "right"; framing: "full" | "medium" | "close"; gestureCues: Array<{ cueSentenceId: string; gesture: string }> }; assetId?: string };
type SentencePlan = { id: string; text: string; startFrame: number; endFrame: number; wordTimings?: Array<{ text: string; startFrame: number; endFrame: number }> };
type EpisodePlan = { title: string; themeId: string; fps: number; durationMs: number; durationInFrames: number; source?: { eligible?: boolean; sourceTitle?: string; sourceUrl?: string; sourceName?: string };
  scenes: ScenePlan[]; sentences: SentencePlan[];
  chapters: Array<{ id: string; kind: string; sentenceIds: string[] }>;
  assets: Array<{ id: string; managedPath: string; sha256: string; illustrative: boolean; sentenceId?: string }> };
type Props = { episode: EpisodePlan | null; audioSrc: string; robotSrc: string; aspect: Aspect; width: number; height: number; fps: number; durationInFrames: number;
  accents: string[]; lipSyncEnvelope: number[]; lipSyncStepMs: number; gestureCues: ApprovedRobotGestureCues };
const DEFAULT_PROPS: Props = { episode: null, audioSrc: "", robotSrc: "pulso-story/approved-robot-rigged.glb", aspect: "landscape", width: 1920, height: 1080, fps: 24, durationInFrames: 96,
  accents: ["#22D3EE", "#67E8F9"], lipSyncEnvelope: [], lipSyncStepMs: 10, gestureCues: {} };
const CLAMP = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const ease = (f: number, a: number, b: number) => interpolate(f, [a, Math.max(a + 1, b)], [0, 1], { ...CLAMP, easing: Easing.bezier(.22, 1, .36, 1) });
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const calculateMetadata: CalculateMetadataFunction<Props> = ({ props }) => {
  const validation = validateNarrativeEpisodeProps(props, { allowPreview: true });
  if (!validation.valid) throw new Error(`NarrativeEpisode props inválidas: ${validation.errors.join(", ")}`);
  if (validation.preview) return { durationInFrames: DEFAULT_PROPS.durationInFrames, fps: DEFAULT_PROPS.fps, width: DEFAULT_PROPS.width, height: DEFAULT_PROPS.height };
  return { durationInFrames: props.durationInFrames, fps: props.fps, width: props.width, height: props.height };
};

function currentScene(scenes: ScenePlan[], frame: number): ScenePlan | null {
  let current: ScenePlan | null = null;
  for (const scene of scenes) { if (scene.startFrame > frame) break; current = scene; }
  return current;
}
function currentSentence(scene: ScenePlan, sentences: SentencePlan[], frame: number): SentencePlan | null {
  const items = scene.sentenceIds.map(id => sentences.find(sentence => sentence.id === id)).filter((s): s is SentencePlan => Boolean(s));
  let current = items[0] || null;
  for (const item of items) { if (item.startFrame > frame) break; current = item; }
  return current;
}
function currentShot(scene: ScenePlan, cueId: string, frame: number): Camera | null {
  const items = scene.cameraShots.filter(shot => shot.cueSentenceId === cueId);
  let current = items[0] || null;
  for (const item of items) { if (item.startFrame > frame) break; current = item; }
  return current;
}
function captionAt(sentence: SentencePlan, frame: number, portrait: boolean): string {
  const timed = sentence.wordTimings?.length ? sentence.wordTimings : sentence.text.split(/\s+/).filter(Boolean).map((text, index, words) => ({
    text, startFrame: sentence.startFrame + Math.floor((sentence.endFrame-sentence.startFrame)*index/words.length),
    endFrame: sentence.startFrame + Math.ceil((sentence.endFrame-sentence.startFrame)*(index+1)/words.length)
  }));
  const limit = portrait ? 54 : 78;
  const groups: Array<{ startFrame: number; words: string[] }> = [];
  for (const word of timed) {
    const current = groups[groups.length-1];
    if (!current || [...current.words, word.text].join(" ").length > limit) groups.push({ startFrame: word.startFrame, words: [word.text] });
    else current.words.push(word.text);
  }
  let selected = groups[0];
  for (const group of groups) { if (group.startFrame > frame) break; selected = group; }
  return selected?.words.join(" ") || sentence.text;
}
function selectedObjects(scene: ScenePlan, sentence: SentencePlan, shot: Camera | null, frame: number): ObjectPlan[] {
  const cueId = sentence.id;
  const cueActions = scene.actions.filter(action => action.cueSentenceId === cueId);
  const ids = new Set(cueActions.map(action => action.targetObjectId));
  if (shot?.focusObjectId) ids.add(shot.focusObjectId);
  if (cueRequiresPairedVisual(sentence.text)) {
    for (const camera of scene.cameraShots.filter(item => item.cueSentenceId === cueId)) ids.add(camera.focusObjectId);
  }
  const relation = narrativeBeatRelation({ sentence: sentence.text, objects: scene.objects });
  if (relation && new Set([...ids, ...relation.objectIds]).size <= 8) for (const id of relation.objectIds) ids.add(id);
  const selected = scene.objects.filter(object => ids.has(object.id));
  return selectNarrativeFlowPhase({ objects: selected.length ? selected : scene.objects.slice(0, 1), relation, sentence, frame });
}

const NarrativeSourceCard: React.FC<{ episode: EpisodePlan; scene: ScenePlan; frame: number; portrait: boolean; accent: string }> = ({ episode, scene, frame, portrait, accent }) => {
  const source = episode.source;
  if (source?.eligible !== true || !source.sourceUrl || !source.sourceTitle) return null;
  const firstScene = episode.scenes[0];
  if (!firstScene || scene.id !== firstScene.id) return null;
  const reveal = ease(frame, scene.startFrame, scene.startFrame + Math.round(episode.fps * .45));
  const end = scene.startFrame + Math.min(scene.durationInFrames, Math.round(episode.fps * 3.2));
  const fade = interpolate(frame, [end - Math.round(episode.fps * .35), end], [1, 0], { ...CLAMP });
  let domain = source.sourceName || '';
  try { domain = new URL(source.sourceUrl).hostname.replace(/^www\./i, ''); } catch { /* sourceUrl was already validated upstream */ }
  return <div data-qa="narrative-source-card" data-source-domain={domain} style={{
    position: "absolute", left: portrait ? "6%" : "6%", top: portrait ? "20%" : "25%",
    width: portrait ? "88%" : "57%", height: portrait ? "26%" : "31%", zIndex: 5,
    opacity: Math.max(0, Math.min(1, reveal * fade)), transform: `translateY(${(1 - reveal) * 16}px)`,
    borderRadius: 14, overflow: "hidden", background: "#f3f0e7", color: "#17313c",
    boxShadow: "0 18px 44px rgba(0,0,0,.34)", fontFamily: "Arial, sans-serif"
  }}>
    <div style={{ height: portrait ? 34 : 30, display: "flex", alignItems: "center", gap: 7, padding: "0 12px", background: "#d8e2dc", color: "#42616a", fontSize: portrait ? 12 : 11 }}>
      <span style={{ color: "#c77762", letterSpacing: 2 }}>●●●</span><span style={{ marginLeft: 5, opacity: .85 }}>{domain}</span>
    </div>
    <div style={{ padding: portrait ? "18px 20px" : "16px 20px" }}>
      <div style={{ color: accent, fontSize: portrait ? 12 : 11, fontWeight: 800, letterSpacing: 2, marginBottom: 10 }}>FONTE DA MATÉRIA</div>
      <div style={{ fontSize: portrait ? 22 : 25, lineHeight: 1.12, fontWeight: 800, display: "-webkit-box", WebkitLineClamp: portrait ? 4 : 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{source.sourceTitle}</div>
      <div style={{ marginTop: 12, color: "#587178", fontSize: portrait ? 12 : 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{source.sourceUrl}</div>
    </div>
  </div>;
};
const Glyph: React.FC<{ kind: string; color: string; progress: number; values?: Array<{ label: string; value: number }> }> = ({ kind, color, progress, values }) => {
  if (["number_text", "percentage", "percentage_comparison", "airway", "lung_cancer", "low_oxygen", "oxygen_recovery", "tumor_growth", "oxidative_stress", "cpap", "body_clock", "brain", "sleep_study", "temperature", "light", "sleep", "appetite", "body_weight", "calendar", "attendance", "interview", "gardening", "food_benefit", "webpage", "role_reversal", "emotional_support", "siblings", "child_burden", "child_growth", "family"].includes(kind)) {
    return <NarrativeConceptGlyph kind={kind} color={color} progress={progress} values={values} />;
  }
  const stroke = "#E8F2F1";
  const glow = Math.max(0.3, progress);
  switch (kind) {
    case "food": return <g strokeLinejoin="round"><ellipse cy="20" rx="50" ry="20" fill="#d5e7e2" stroke={color} strokeWidth="4" /><ellipse cy="17" rx="30" ry="11" fill="#72989b" /><path d="M-16 13Q-10 -11 8 -7Q24 -4 21 14Z" fill="#d2a16e" /><path d="M-6 -6Q0 -18 9 -18" fill="none" stroke="#78a97a" strokeWidth="4" strokeLinecap="round" /></g>;
    case "food-storage": return <g strokeLinejoin="round"><rect x="-42" y="-29" width="84" height="76" rx="12" fill="#adc9c2" fillOpacity=".8" stroke={color} strokeWidth="4" /><path d="M-27 19Q-16 -4 -3 11Q7 -5 24 13V28H-27Z" fill="#d0a678" opacity={progress} /><g transform={`translate(0 ${mix(-38, 8, progress)})`} opacity={1-progress}><ellipse rx="17" ry="8" fill="#d0a678" /><path d="M-2 -6Q3 -13 10 -12" fill="none" stroke="#78a97a" strokeWidth="3" /></g><path d="M-47 -30H47V-43H-47Z" transform={`translate(0 ${mix(-25, 0, progress)})`} fill="#597e83" stroke={color} strokeWidth="3" /><path d="M-31 -18H28" stroke="#e5f1e9" strokeWidth="3" /></g>;
    case "empty-containers": return <g strokeLinejoin="round"><g transform={`translate(${mix(-18, 0, progress)} 0)`}><rect x="-44" y="-22" width="40" height="65" rx="8" fill="#89b2b1" fillOpacity=".35" stroke={color} strokeWidth="4" /><path d="M-47 -24H-1" stroke={color} strokeWidth="5" strokeLinecap="round" /></g><g transform={`translate(${mix(18, 0, progress)} 0)`}><rect x="6" y="-35" width="38" height="78" rx="8" fill="#89b2b1" fillOpacity=".35" stroke={color} strokeWidth="4" /><path d="M3 -37H47" stroke={color} strokeWidth="5" strokeLinecap="round" /></g></g>;
    case "spoiled-item": return <g strokeLinejoin="round"><path d="M-38 -29L-4 -44L39 -28L4 -12Z" fill="#b7ae82" stroke={color} strokeWidth="3" /><path d="M-38 -29V27L4 45V-12Z" fill="#8f8561" stroke={color} strokeWidth="3" /><path d="M4 -12L39 -28V28L4 45Z" fill="#746c51" stroke={color} strokeWidth="3" /><circle cx="-15" cy="2" r="5" fill="#678d69" /><circle cx="20" cy="12" r="4" fill="#678d69" /><path d="M-19 -52Q-25 -61 -18 -69M2 -54Q-4 -63 3 -71" fill="none" stroke="#a1c3a1" strokeWidth="3" strokeLinecap="round" /></g>;
    case "discard-spoiled": return <g strokeLinejoin="round"><path d="M5 -19H51L46 39H10Z" fill="#315665" stroke={color} strokeWidth="3" /><path d="M2 -23H54M19 -31H37" stroke={color} strokeWidth="4" strokeLinecap="round" /><g transform={`translate(${mix(-37, 28, progress)} ${mix(-16, 6, progress)}) scale(${mix(.7, .4, progress)})`} opacity={1-progress*.7}><path d="M-22 -18L0 -28L22 -18V20L0 30L-22 20Z" fill="#a49a72" stroke={color} strokeWidth="3" /><circle cx="-7" cy="3" r="5" fill="#678d69" /></g></g>;
    case "recipe-book": return <g strokeLinejoin="round"><path d="M-46 -45Q-18 -52 0 -38Q18 -52 46 -45V42Q18 35 0 48Q-18 35 -46 42Z" fill="#e2eee7" stroke={color} strokeWidth="4" /><path d="M0 -38V48M-35 -25H-10M-35 -14H-14M10 -25H35M10 -14H30M10 -3H34" fill="none" stroke="#54777b" strokeWidth="3" /></g>;
    case "shopping-bag": return <g strokeLinejoin="round"><path d="M-43 -22H43L38 46H-38Z" fill="#c8a77e" stroke={color} strokeWidth="4" /><path d="M-20 -22V-30Q-20 -48 0 -48T20 -30V-22" fill="none" stroke={color} strokeWidth="4" /><path d="M-23 2H23" stroke="#8f6b54" strokeWidth="3" /></g>;
    case "planet": return <g strokeLinejoin="round"><circle r="46" fill="#315b75" stroke={color} strokeWidth="4" /><path d="M-37 -21L-17 -32L-4 -21L-9 -9L8 -2L-1 12L-15 8L-19 30L-36 18ZM14 -30L29 -22L32 -8L19 -5L15 8L3 3L5 -12Z" fill="#8ebf8f" /></g>;
    case "scarcity": return <g strokeLinejoin="round"><path d="M-50 -45V43H50V-45M-50 -5H50M-50 32H50" fill="#193b48" stroke={color} strokeWidth="4" /><rect x="-37" y="-30" width="18" height="24" rx="3" fill="#d7c5a8" /><rect x="12" y="9" width="19" height="22" rx="3" fill="#a8c5ba" /><path d="M-9 -28H32M-38 10H-12" stroke="#73949a" strokeWidth="3" strokeDasharray="5 5" /></g>;
    case "memory-scarcity": return <g strokeLinejoin="round"><path d="M-55 -17Q-64 -39 -43 -44Q-34 -61 -14 -53Q2 -69 20 -54Q46 -55 49 -35Q65 -25 52 -7Q48 7 34 9H-41Q-58 5 -55 -17Z" fill="#193b48" stroke={color} strokeWidth="3" /><path d="M-28 -31V-2H28V-31M-28 -17H28" fill="none" stroke="#a4c3bf" strokeWidth="3" /><rect x="-20" y="-27" width="9" height="9" fill="#d7c5a8" /><circle cx="-38" cy="20" r="5" fill={color} /><circle cx="-50" cy="31" r="3" fill={color} /></g>;
    case "anxiety": return <g strokeLinejoin="round"><circle cy="-9" r="34" fill="#d8bda5" stroke={color} strokeWidth="3" /><path d="M-20 -20l12 -4M8 -24l12 4M-15 11Q0 0 15 11M-51 -48l-11 -9M51 -48l11 -9M-62 -20h-12M62 -20h12" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" /><circle cx="-13" cy="-8" r="3" fill="#315665" /><circle cx="13" cy="-8" r="3" fill="#315665" /></g>;
    case "choice": return <g stroke={color} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M0 47V2Q0 -16 -29 -30M0 2Q0 -16 29 -30M-42 -27L-29 -31L-30 -17M42 -27L29 -31L30 -17" /><circle cy="47" r="7" fill={color} /></g>;
    case "healthcare-facility": return <g strokeLinejoin="round"><path d="M-48 48V-24H48V48Z" fill="#d5e7e2" stroke={color} strokeWidth="4" /><path d="M-52 -24L0 -48L52 -24Z" fill="#688f94" stroke={color} strokeWidth="3" /><path d="M-9 -28H9V-18H19V0H9V10H-9V0H-19V-18H-9Z" fill="#b85d6c" /><path d="M-13 48V23H13V48M-37 10H-25M25 10H37" fill="none" stroke="#3c666d" strokeWidth="4" /></g>;
    case "discarded-item": return <g strokeLinejoin="round"><path d="M-38 -29L-4 -44L39 -28L4 -12Z" fill="#d6b589" stroke={color} strokeWidth="3" /><path d="M-38 -29V27L4 45V-12Z" fill="#a67b59" stroke={color} strokeWidth="3" /><path d="M4 -12L39 -28V28L4 45Z" fill="#835e49" stroke={color} strokeWidth="3" /></g>;
    case "waste-bin": return <g strokeLinejoin="round"><path d="M-39 -34H39L32 44Q31 50 25 50H-25Q-31 50-32 44Z" fill="#315665" stroke={color} strokeWidth="4" /><path d="M-45 -37H45M-16 -46H16M-14 -20V30M0 -20V30M14 -20V30" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" /></g>;
    case "energy_bill": return <g strokeLinejoin="round"><path d="M-34 -49H35V49L25 43L15 49L5 43L-5 49L-15 43L-25 49L-34 43Z" fill="#e0eeea" stroke={color} strokeWidth="4" /><path d="M-21 -30H20M-21 -19H3M-21 25H21" stroke="#416670" strokeWidth="4" strokeLinecap="round" /><path d="M9 -12L-3 7H7L2 20L21 0H11L16 -12Z" fill={color} stroke="#315665" strokeWidth="2" /></g>;
    case "wallet": return <g strokeLinejoin="round"><rect x="-47" y="-32" width="94" height="67" rx="9" fill="#244b58" stroke={color} strokeWidth="4" /><path d="M-42 -25L28 -43L36 -30M14 -4H48V19H14Q7 19 7 8Q7 -4 14 -4Z" fill="#35616a" stroke={color} strokeWidth="4" /><circle cx="22" cy="8" r="3" fill="#eef5e8" /></g>;
    case "refrigerator": return <g strokeLinejoin="round"><rect x="-32" y="-51" width="64" height="102" rx="7" fill="#d5e6e4" stroke={color} strokeWidth="4" /><path d="M-32 -13H32M-19 -39V-23M-19 -3V19" fill="none" stroke="#315665" strokeWidth="4" strokeLinecap="round" /><path d="M-22 52V57M22 52V57" stroke="#d5e6e4" strokeWidth="4" strokeLinecap="round" /></g>;
    case "router": return <g strokeLinejoin="round"><path d="M-59 9L-18 -12L58 3L20 26Z" fill="#305868" stroke={color} strokeWidth="3" /><path d="M-59 9V25L20 42V26Z" fill="#102b3a" stroke={color} strokeWidth="3" /><path d="M20 26L58 3V19L20 42Z" fill="#183b48" stroke={color} strokeWidth="3" /><path d="M-37 2V-30M40 0V-30" stroke={color} strokeWidth="4" strokeLinecap="round" /><circle cx="-43" cy="21" r="2.5" fill="#a0f1db" /><circle cx="-31" cy="24" r="2.5" fill="#a0f1db" /><circle cx="-19" cy="27" r="2.5" fill="#a0f1db" /><path d="M-13 -3Q0 -19 13 -3M-6 1Q0 -6 6 1" fill="none" stroke="#d6faf3" strokeWidth="3" strokeLinecap="round" /></g>;
    case "data-packet": return <g strokeLinejoin="round"><path d="M-43 -30L0 -48L43 -30V26L0 47L-43 26Z" fill="#1c4051" stroke={color} strokeWidth="3" /><path d="M-43 -30L0 -10L43 -30M0 -10V47" fill="none" stroke="#d6faf3" strokeWidth="3" /><path d="M-31 -15L-10 -5M-31 -5L-10 5M-31 5L-16 12" stroke={color} strokeWidth="3" strokeLinecap="round" /><circle cx="22" cy="6" r="5" fill={color} /></g>;
    case "computer": return <g><rect x="-48" y="-38" width="96" height="62" rx="5" fill="#153746" stroke={color} strokeWidth="4" /><path d="M-40 -29H40V13H-40Z" fill="#285467" /><path d="M0 25V39M-23 41H23" stroke="#d6faf3" strokeWidth="5" strokeLinecap="round" /></g>;
    case "sachet": return <g><path d="M-27 -51H27L31 -45V47L27 52H-27L-31 47V-45Z" fill="#def1e4" stroke={color} strokeWidth="3" /><path d="M-24 -42H24M-24 43H24" stroke="#7daca4" strokeWidth="3" /><rect x="-22" y="-21" width="44" height="42" rx="5" fill="#23544e" /><path d="M-14 -6H14M-14 3H8" stroke="#b8eee2" strokeWidth="3" strokeLinecap="round" /></g>;
    case "ingredients": return <g><circle cx="-27" cy="-16" r="19" fill="#1f504a" stroke={color} strokeWidth="3" /><circle cx="28" cy="-18" r="19" fill="#214856" stroke="#c5e5df" strokeWidth="3" /><circle cx="0" cy="28" r="19" fill="#35534b" stroke={color} strokeWidth="3" /><path d="M-15 -5L-5 11M14 -5L5 11M-7 -17H8" stroke="#d0ebe3" strokeWidth="3" /><circle cx="-27" cy="-16" r="5" fill="#d8f7e8" /><circle cx="28" cy="-18" r="5" fill="#d8f7e8" /><circle cy="28" r="5" fill="#d8f7e8" /></g>;
    case "person": return <g opacity={glow} strokeLinejoin="round"><circle cx="0" cy="-31" r="18" fill="#d8b99d" stroke={color} strokeWidth="2" /><path d="M-29 30V6Q-26 -11 -12 -12H12Q26 -11 29 6V30Z" fill="#5b8390" stroke={color} strokeWidth="3" /><path d="M-18 30V54M18 30V54M-29 3L-39 27M29 3L39 27" fill="none" stroke="#aac6c5" strokeWidth="7" strokeLinecap="round" /></g>;
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

function visualKind(object: ObjectPlan, sentence: SentencePlan): { kind: string; values: Array<{ label: string; value: number }> } {
  return narrativeObjectVisual(object, sentence);
}

const StageObject: React.FC<{ object: ObjectPlan; sentence: SentencePlan; action: Action | undefined; frame: number; x: number; y: number; scale: number; accent: string; portrait: boolean; maxLabelWidth: number; visibleFrom?: number }> = ({ object, sentence, action, frame, x, y, scale, accent, portrait, maxLabelWidth, visibleFrom }) => {
  const { fps } = useVideoConfig();
  const startFrame = action && visibleFrom !== undefined ? Math.max(action.startFrame, visibleFrom) : action?.startFrame;
  const timedAction = action && startFrame !== undefined && visibleFrom !== undefined ? { ...action, startFrame,
    endFrame: Math.max(action.endFrame, Math.min(sentence.endFrame, startFrame + Math.round(fps * 1.35))) } : action;
  const motion = narrativeActionMotion({ action: timedAction, sentence, frame, aspect: portrait ? "portrait" : "landscape", width: portrait ? 562.5 : 1000, height: portrait ? 1000 : 562.5 });
  const dx = motion.dx;
  const dy = motion.dy;
  const pre = motion.progress;
  const reveal = action?.kind === "reveal-part" ? .45 + .55 * pre : 1;
  const rotate = action?.kind === "transform" ? mix(-9, 0, pre) : 0;
  const lines = wrapNarrativeLabel(object.label, portrait ? 16 : 18);
  const visual = visualKind(object, sentence);
  const labelFontSize = visual.kind === "concept_text" ? (portrait ? 30 : 27) : (portrait ? 20 : 18);
  const labelY = visual.kind === "concept_text" ? y : y + 106 * scale;
  const qualifier = narrativeObjectQualifier(object.label, sentence);
  const qualifierFrame = qualifier ? narrativeLabelCueFrame(qualifier.trigger, sentence) : null;
  const qualifierVisible = qualifierFrame !== null && frame >= qualifierFrame;
  return <g opacity={visibleFrom === undefined ? 1 : ease(frame, visibleFrom, visibleFrom + 8)}>
    {action?.kind === "travel" && <g opacity=".7"><path d={`M${x} ${y+55}L${x+dx} ${y+55+dy}`} fill="none" stroke={accent} strokeWidth="2.5" strokeDasharray="6 7" />
      <circle cx={x+dx} cy={y+55+dy} r="5" fill={accent} /></g>}
    {visual.kind !== "concept_text" && <ellipse cx={x} cy={y+67*scale} rx={73*scale} ry={13*scale} fill="#020c13" opacity=".6" />}
    {visual.kind !== "concept_text" && <g transform={`translate(${x+dx} ${y+dy}) rotate(${rotate}) scale(${scale*reveal*motion.scale})`} opacity={reveal}>
      <Glyph kind={visual.kind} color={accent} progress={pre} values={visual.values} />
    </g>}
    {qualifierVisible && <path d={`M${x-49*scale} ${y+49*scale}L${x+49*scale} ${y-49*scale}`} stroke="#ff9fa5" strokeWidth="5" strokeLinecap="round" />}
    <text x={x} y={labelY} fill="#F4F1E8" fontSize={labelFontSize} fontFamily="Arial, sans-serif" fontWeight="700" textAnchor="middle">
      {lines.map((line, index) => <tspan key={`${object.id}-${index}`} x={x} dy={index ? labelFontSize + 3 : 0}
        textLength={line.length * labelFontSize * .6 > maxLabelWidth ? maxLabelWidth : undefined}
        lengthAdjust={line.length * labelFontSize * .6 > maxLabelWidth ? "spacingAndGlyphs" : undefined}>{line}</tspan>)}
    </text>
    {(object.illustrative || object.kind === "map" || ["scarcity", "memory-scarcity", "anxiety", "choice", "discarded-item", "spoiled-item", "discard-spoiled", "waste-bin", "food", "food-storage", "empty-containers", "recipe-book", "shopping-bag", "planet", "family"].includes(visual.kind)) && <text x={x} y={labelY+lines.length*(labelFontSize+3)+13} fill="#B7CAC9" fontSize={portrait ? 11 : 10} textAnchor="middle" letterSpacing="1">ILUSTRATIVO</text>}
    {qualifierVisible && <text x={x} y={labelY+lines.length*(labelFontSize+3)+31} fill="#ffb6bd" fontSize={portrait ? 13 : 12} fontWeight="700" textAnchor="middle">{qualifier?.label}</text>}
  </g>;
};

const IllustrativeMap: React.FC<{ frame: number; cueStart: number; width: number; height: number; accent: string; routes: boolean }> = ({ frame, cueStart, width, height, accent, routes }) => {
  const turn = mix(-.12, .10, ease(frame, cueStart, cueStart + 90));
  const routeProgress = ease(frame, cueStart + 4, cueStart + 65);
  return <ThreeCanvas width={width} height={height} camera={{ position: [9, 12, 14], fov: 29, near: .1, far: 100 }}
    gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }} style={{ width: "100%", height: "100%" }}>
    <ambientLight intensity={1.05} /><directionalLight position={[4, 10, 5]} intensity={1.5} />
    <group rotation={[0, turn, 0]}>
      <mesh position={[0, -.15, 0]}><boxGeometry args={[8.5, .25, 6.5]} /><meshStandardMaterial color="#102c38" /></mesh>
      {Array.from({ length: 48 }, (_, index) => {
        const x = index % 8 - 3.5, z = Math.floor(index / 8) - 2.5;
        const height = .18 + .12 * (1 + Math.sin(x * .65) * Math.cos(z * .75));
        return <mesh key={index} position={[x, height / 2, z]}><boxGeometry args={[.96, height, .96]} /><meshStandardMaterial color={height > .31 ? "#34616b" : "#1a414a"} /></mesh>;
      })}
      <mesh position={[0, .72, 0]}><cylinderGeometry args={[.08, .08, .8, 12]} /><meshStandardMaterial color={accent} /></mesh>
      <mesh position={[0, 1.16, 0]}><sphereGeometry args={[.26, 16, 12]} /><meshStandardMaterial color={accent} emissive="#285b54" /></mesh>
      {routes && [-1, 0, 1].map((route, routeIndex) => Array.from({ length: 24 }, (_, index) => {
        const t = index / 23;
        const x = -3.4 + t * 6.8;
        const z = route * 1.5 * Math.sin(Math.PI * t);
        return <mesh key={`${routeIndex}-${index}`} visible={t <= routeProgress} position={[x, .43, z]}>
          <sphereGeometry args={[.07, 8, 6]} /><meshStandardMaterial color={[accent, "#bcb2ff", "#ffbe7e"][routeIndex]} />
        </mesh>;
      }))}
    </group>
  </ThreeCanvas>;
};

const Stage: React.FC<{ scene: ScenePlan; sentence: SentencePlan; shot: Camera | null; frame: number; aspect: Aspect; presenter: boolean; side: "left" | "right"; accents: string[] }> = ({ scene, sentence, shot, frame, aspect, presenter, side, accents }) => {
  const config = useVideoConfig();
  const portrait = aspect === "portrait", width = portrait ? 562.5 : 1000, height = portrait ? 1000 : 562.5;
  const selected = selectedObjects(scene, sentence, shot, frame), count = selected.length;
  const start = Math.max(sentence.startFrame, shot?.startFrame || sentence.startFrame);
  const reveal = ease(frame, start, start + 11);
  const areaLeft = portrait ? 48 : presenter && side === "left" ? 385 : 65;
  const areaRight = portrait ? 515 : presenter && side === "right" ? 620 : 935;
  const centerY = portrait ? (presenter ? 380 : 400) : 260;
  const baseScale = portrait ? (count === 1 ? 1.7 : count === 2 ? 1.25 : count === 3 ? 1.0 : .8) : (count === 1 ? 1.65 : count === 2 ? 1.3 : count === 3 ? 1.05 : .85);
  const iconScale = baseScale * (shot?.kind === "detail" ? 1.12 : shot?.kind === "wide" ? .93 : 1);
  const isCompare = scene.actions.some(action => action.cueSentenceId === sentence.id && action.kind === "compare");
  const routes = cueRequiresRoutes(sentence.text);
  if ((count === 1 && visualKind(selected[0], sentence).kind === "map") || (routes && selected.some(object => ["map", "network"].includes(visualKind(object, sentence).kind)))) {
    const panel = portrait ? { left: .04, top: .24, width: .92, height: presenter ? .32 : .40 }
      : { left: presenter && side === "left" ? .38 : .04, top: .23, width: presenter ? .58 : .92, height: .57 };
    const panelWidth = Math.round(config.width * panel.width), panelHeight = Math.round(config.height * panel.height);
    return <AbsoluteFill data-qa="narrative-stage" data-cue={sentence.id} data-shot="illustrative-map">
      <div style={{ position:"absolute",left:`${panel.left*100}%`,top:`${panel.top*100}%`,width:panelWidth,height:panelHeight,opacity:reveal }}>
        <IllustrativeMap frame={frame} cueStart={start} width={panelWidth} height={panelHeight} accent={accents[0] || "#80e6d7"} routes={routes} />
      </div>
      <div style={{ position:"absolute",left:portrait?"8%":presenter&&side==="left"?"39%":"7%",top:portrait?(presenter?"58%":"65%") : "78%",
        color:"#b7cac9",fontFamily:"Arial, sans-serif",fontSize:portrait?19:18,letterSpacing:1 }}>{routes ? "PERCURSOS ILUSTRATIVOS" : "MAPA ILUSTRATIVO"}</div>
    </AbsoluteFill>;
  }
  const text = sentence.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\bdados\b/.test(text) && /\borganiz\w*\b/.test(text) && /\baparelho\b/.test(text) && /\bmensagem\b/.test(text)
    && selected.some(object => object.labelType === "literal" && /\bdados\b/i.test(object.label))) {
    const middle = (areaLeft + areaRight) / 2, progress = ease(frame, sentence.startFrame, Math.min(sentence.endFrame - 1, sentence.startFrame + 100));
    return <svg data-qa="narrative-stage" data-cue={sentence.id} data-shot="data-reassembly" width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ position:"absolute",inset:0 }}>
      <g transform={`translate(${middle} ${centerY}) scale(${portrait ? 1.55 : 1.7})`}><Glyph kind="device" color={accents[0] || "#80e6d7"} progress={1} />
        <g opacity={progress}><rect x="-20" y="-20" width="40" height="29" rx="5" fill={accents[0] || "#80e6d7"} /><path d="M-14 -10H14M-14 -2H6" stroke="#153746" strokeWidth="3" strokeLinecap="round" /></g></g>
      {[0,1,2].map(index => <g key={index} transform={`translate(${mix(middle-190+index*65,middle,progress)} ${mix(centerY-72-index*18,centerY,progress)}) scale(.42)`} opacity={1-progress}>
        <Glyph kind="data-packet" color={accents[index % accents.length] || "#80e6d7"} progress={1} /></g>)}
      <text x={middle} y={centerY+132} fill="#f4f1e8" fontSize="19" fontWeight="700" textAnchor="middle">mensagem</text>
      <text x={middle} y={centerY+158} fill="#b7cac9" fontSize="10" letterSpacing="1" textAnchor="middle">RECOMPOSIÇÃO ILUSTRATIVA</text>
    </svg>;
  }
  if (/\bpacotes?\b/.test(text) && /\binformacoes\b/.test(text) && /\bcarreg\w*\b/.test(text)
    && selected.some(object => object.labelType === "literal" && /\bpacotes?\b/i.test(object.label))) {
    const middle = (areaLeft + areaRight) / 2;
    const progress = ease(frame, sentence.startFrame + 3, Math.min(sentence.endFrame - 1, sentence.startFrame + 35));
    return <svg data-qa="narrative-stage" data-cue={sentence.id} data-shot="packet-information" width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
      <g transform={`translate(${middle} ${centerY}) scale(${portrait ? 1.35 : 1.55})`}>
        <rect x="-95" y="-64" width="190" height="128" rx="13" fill="#102f3d" stroke={accents[0] || "#80e6d7"} strokeWidth="3" />
        <rect x="-80" y="-48" width="38" height="96" rx="6" fill={accents[0] || "#80e6d7"} />
        <g opacity={.25+.75*progress} stroke="#edf5ed" strokeWidth="6" strokeLinecap="round"><path d="M-24 -27H75M-24 -5H60M-24 17H68M-24 39H35" /></g>
      </g>
      <text x={middle} y={centerY+135} fill="#f4f1e8" fontSize="19" fontWeight="700" textAnchor="middle">informações</text>
      <text x={middle} y={centerY+161} fill="#b7cac9" fontSize="10" letterSpacing="1" textAnchor="middle">REPRESENTAÇÃO ILUSTRATIVA</text>
    </svg>;
  }
  if (/\broteadores?\b/.test(text) && /\bpacotes?\b/.test(text) && /\b(?:receb\w*|encaminh\w*|envi\w*)\b/.test(text)
    && selected.some(object => object.labelType === "literal" && /\broteadores?\b/i.test(object.label))) {
    const middle = (areaLeft + areaRight) / 2, span = portrait ? 190 : 285;
    const progress = ease(frame, sentence.startFrame, Math.min(sentence.endFrame - 1, sentence.startFrame + 100));
    return <svg data-qa="narrative-stage" data-cue={sentence.id} data-shot="router-forwarding" width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
      <path d={`M${middle-span} ${centerY}H${middle+span}`} fill="none" stroke={accents[0] || "#80e6d7"} strokeWidth="3" strokeDasharray="7 8" opacity=".65" />
      <g transform={`translate(${middle} ${centerY}) scale(${portrait ? 1.35 : 1.65})`}><Glyph kind="router" color={accents[0] || "#80e6d7"} progress={1} /></g>
      <g transform={`translate(${mix(middle-span, middle+span, progress)} ${centerY-26}) scale(${portrait ? .44 : .53})`}><Glyph kind="data-packet" color={accents[2] || "#ffbe7e"} progress={1} /></g>
      <text x={middle} y={centerY+130} fill="#f4f1e8" fontSize="19" fontWeight="700" textAnchor="middle">roteadores</text>
      <text x={middle} y={centerY+156} fill="#b7cac9" fontSize="10" letterSpacing="1" textAnchor="middle">ENCAMINHAMENTO ILUSTRATIVO</text>
    </svg>;
  }
  const data = selected.find(object => object.labelType === "literal" && /\bdados\b/i.test(object.label));
  const packet = selected.find(object => object.labelType === "literal" && /\bpacotes?\b/i.test(object.label));
  if (data && packet && /\bdivid\w*\b.{0,100}\bem\b/.test(text)) {
    const middle = (areaLeft + areaRight) / 2, offset = portrait ? 125 : 185;
    const progress = ease(frame, sentence.startFrame + 3, Math.min(sentence.endFrame - 1, sentence.startFrame + 55));
    const left = middle - offset, right = middle + offset;
    return <svg data-qa="narrative-stage" data-cue={sentence.id} data-shot="data-division" width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
      <path d={`M${left+65} ${centerY}H${right-70}`} fill="none" stroke={accents[0] || "#80e6d7"} strokeWidth="3" strokeDasharray="7 8" opacity=".7" />
      <g transform={`translate(${left} ${centerY}) scale(${portrait ? 1.2 : 1.35})`}><Glyph kind="document" color={accents[0] || "#80e6d7"} progress={1} /></g>
      {[0, 1, 2].map(index => <g key={index} transform={`translate(${mix(left+70, right, progress)} ${mix(centerY, centerY+(index-1)*70, progress)}) scale(${portrait ? .52 : .6})`} opacity={.25+.75*progress}>
        <Glyph kind="data-packet" color={accents[index % accents.length] || "#80e6d7"} progress={progress} />
      </g>)}
      <text x={left} y={centerY+135} fill="#f4f1e8" fontSize="19" fontWeight="700" textAnchor="middle">{data.label}</text>
      <text x={right} y={centerY+135} fill="#f4f1e8" fontSize="19" fontWeight="700" textAnchor="middle">{packet.label}</text>
      <text x={middle} y={centerY+162} fill="#b7cac9" fontSize="10" letterSpacing="1" textAnchor="middle">REPRESENTAÇÃO ILUSTRATIVA</text>
    </svg>;
  }
  const relation = narrativeBeatRelation({ sentence: sentence.text, objects: selected }) || narrativeCauseRelation({ sentence: sentence.text, objects: selected });
  const ordered = [...selected].sort((a, b) => {
    if (relation?.kind === "flow" || relation?.kind === "cause") {
      const left = relation.objectIds.indexOf(a.id), right = relation.objectIds.indexOf(b.id);
      const order = (left < 0 ? 2 : left) - (right < 0 ? 2 : right);
      if (order) return order;
    }
    const aCue = narrativeLabelCueFrame(a.label, sentence), bCue = narrativeLabelCueFrame(b.label, sentence);
    if (aCue !== null && bCue !== null && aCue !== bCue) return aCue - bCue;
    if (!cueRequiresPairedVisual(sentence.text)) return 0;
    const at = (object: ObjectPlan) => text.indexOf(object.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
    const left = at(a), right = at(b);
    return left < 0 || right < 0 ? 0 : left - right;
  });
  const spokenRelationFrame = sentence.wordTimings?.find(word => relation?.trigger
    && word.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().startsWith(relation.trigger))?.startFrame ?? sentence.startFrame;
  const flowProgress = ease(frame, spokenRelationFrame, Math.min(sentence.endFrame - 1, spokenRelationFrame + Math.round(config.fps * 1.4)));
  const flowDrawn = (relation?.kind === "flow" || relation?.kind === "cause") && relation.objectIds.every(id => {
    const object = ordered.find(item => item.id === id);
    return object && visualKind(object, sentence).kind !== "concept_text";
  });
  const spread = Math.min((areaRight - areaLeft) * .36, portrait ? 165 : 250);
  const positionFor = (index: number) => count === 1 ? (areaLeft + areaRight) / 2 : mix((areaLeft + areaRight) / 2 - spread, (areaLeft + areaRight) / 2 + spread, index / (count - 1));
  const flowFrom = flowDrawn ? positionFor(ordered.findIndex(object => object.id === relation.objectIds[0])) + 72 * iconScale : 0;
  const flowTo = flowDrawn ? positionFor(ordered.findIndex(object => object.id === relation.objectIds[1])) - 72 * iconScale : 0;
  const flowSource = flowDrawn ? ordered.find(object => object.id === relation.objectIds[0]) : undefined;
  const flowDestination = flowDrawn ? ordered.find(object => object.id === relation.objectIds[1]) : undefined;
  const flowTransforms = /^(?:transform|convert|substitu|trocad|dividid)/.test(relation?.trigger || "");
  const alternative = narrativeAlternativeRelation({ sentence: sentence.text, objects: ordered });
  const alternativeFrame = alternative ? narrativeLabelCueFrame(alternative.trigger, sentence) : null;
  const alternativeX = alternative ? (positionFor(ordered.findIndex(object => object.id === alternative.objectIds[0]))
    + positionFor(ordered.findIndex(object => object.id === alternative.objectIds[1]))) / 2 : 0;
  const firstLabelCue = Math.min(...ordered.map(object => object.labelType === "literal" ? narrativeLabelCueFrame(object.label, sentence) ?? Infinity : Infinity));
  return <svg data-qa="narrative-stage" data-cue={sentence.id} data-shot={shot?.kind || "wide"} width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
    <defs><marker id="narrative-v2-relation-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M0 0L7 3.5L0 7Z" fill={accents[0] || "#80e6d7"} /></marker></defs>
    <g opacity={.35+.65*reveal} transform={`translate(0 ${(1-reveal)*12})`}>
      {relation && relation.kind !== "flow" && relation.kind !== "cause" && count === 2 && <g>
        <line x1={(areaLeft+areaRight)/2-55} y1={centerY} x2={(areaLeft+areaRight)/2+55} y2={centerY} stroke={accents[0] || "#80e6d7"} strokeWidth="3"
          markerStart={relation.kind === "bidirectional" ? "url(#narrative-v2-relation-arrow)" : undefined}
          markerEnd={relation.kind === "bidirectional" ? "url(#narrative-v2-relation-arrow)" : undefined} />
        {relation.kind === "comparison" && <text x={(areaLeft+areaRight)/2} y={centerY-14} fill="#F4F1E8" fontSize="18" fontWeight="700" textAnchor="middle">vs</text>}
      </g>}
      {flowDrawn && flowTo > flowFrom && <g opacity={flowProgress > 0 ? 1 : 0}>
        <path d={`M${flowFrom} ${centerY}H${flowTo}`} pathLength="1" stroke={accents[0] || "#80e6d7"} strokeWidth="3" fill="none"
          strokeDasharray="1" strokeDashoffset={1 - flowProgress} markerEnd={flowProgress > .95 ? "url(#narrative-v2-relation-arrow)" : undefined} />
        {flowSource && flowDestination && <g transform={`translate(${mix(flowFrom, flowTo, flowProgress)} ${centerY}) scale(${.38 * iconScale})`} opacity={flowProgress < .98 ? 1 : 0}>
          <g opacity={flowTransforms ? 1 - flowProgress : 1}><Glyph kind={visualKind(flowSource, sentence).kind} color={accents[0] || "#80e6d7"} progress={flowProgress} values={visualKind(flowSource, sentence).values} /></g>
          {flowTransforms && <g opacity={flowProgress}><Glyph kind={visualKind(flowDestination, sentence).kind} color={accents[1] || "#bcb2ff"} progress={flowProgress} values={visualKind(flowDestination, sentence).values} /></g>}
        </g>}
        {relation?.conditional && <text x={(flowFrom + flowTo) / 2} y={centerY - 38} fill="#c6d8d3" fontSize="13" textAnchor="middle" letterSpacing="1">EXEMPLO CONDICIONAL</text>}
      </g>}
      {alternativeFrame !== null && frame >= alternativeFrame && <text x={alternativeX} y={centerY - 88} fill="#f4f1e8" fontSize="16" fontWeight="700" textAnchor="middle">OU</text>}
      {isCompare && relation?.kind === "comparison" && count > 1 && <path d={`M${(areaLeft+areaRight)/2} ${centerY-105}V${centerY+120}`} stroke="#86b8b8" strokeWidth="2" strokeOpacity=".3" strokeDasharray="6 8" />}
      {ordered.map((object, index) => {
        const middle = (areaLeft + areaRight) / 2;
        const spread = Math.min((areaRight - areaLeft) * .36, portrait ? 165 : 250);
        const x = count === 1 ? middle : mix(middle-spread, middle+spread, index/(count-1));
        const spacing = count === 1 ? areaRight - areaLeft : 2 * spread / (count - 1);
        const maxLabelWidth = narrativeLabelMaxWidth({ x, width, spacing });
        const cueActions = scene.actions.filter(action => action.cueSentenceId === sentence.id && action.targetObjectId === object.id);
        let action = cueActions[0];
        for (const candidate of cueActions) { if (candidate.startFrame <= frame) action = candidate; }
        const labelCue = count > 1 && object.labelType === "literal" ? narrativeLabelCueFrame(object.label, sentence) : null;
        const visibleFrom = labelCue === null ? undefined : labelCue === firstLabelCue
          ? sentence.startFrame : (relation?.kind === "flow" || relation?.kind === "cause") && object.id === relation.objectIds[1]
            ? Math.min(labelCue, spokenRelationFrame) : labelCue;
        return <StageObject key={object.id} object={object} sentence={sentence} action={action} frame={frame} x={x} y={centerY} scale={iconScale} accent={accents[index % accents.length] || "#80e6d7"} portrait={portrait} maxLabelWidth={maxLabelWidth} visibleFrom={visibleFrom} />;
      })}
    </g>
  </svg>;
};

const Presenter: React.FC<{ props: Props; scene: ScenePlan; compact?: boolean }> = ({ props, scene, compact = false }) => {
  const { width, height } = useVideoConfig(); const portrait = props.aspect === "portrait";
  const gestureCues: ApprovedRobotGestureCues = {};
  for (const cue of scene.presenter.gestureCues) {
    const sentence = props.episode?.sentences.find(item => item.id === cue.cueSentenceId);
    if (sentence) gestureCues[cue.gesture as keyof ApprovedRobotGestureCues] = sentence.startFrame;
  }
  const side = scene.presenter.side;
  const style: React.CSSProperties = compact
    ? { top: "auto", bottom: portrait ? "1%" : "8%", right: "-1%", left: "auto", zIndex: 4 }
    : portrait
    ? { top: "auto", bottom: "1%", left: "auto", right: "3%", zIndex: 4 }
    : side === "right" ? { top: "8%", right: "-1%", left: "auto", zIndex: 4 } : { top: "8%", left: "-1%", right: "auto", zIndex: 4 };
  return <ApprovedRobotPresenter src={staticFile(props.robotSrc)} side={side} accents={props.accents}
    gestureCues={gestureCues} lipSyncEnvelope={props.lipSyncEnvelope} lipSyncFps={1000 / Math.max(1, props.lipSyncStepMs)}
    canvasSize={{ width: Math.round(width*(compact ? portrait ? .42 : .19 : portrait ? .55 : .34)), height: Math.round(height*(compact ? portrait ? .26 : .46 : portrait ? .34 : .82)) }} style={style} />;
};

const EpisodeScene: React.FC<Props> = props => {
  const frame = useCurrentFrame(); const episode = props.episode;
  if (!episode) return <AbsoluteFill style={{ background: "#081923" }} />;
  const scene = currentScene(episode.scenes, frame); if (!scene) return <AbsoluteFill style={{ background: "#081923" }} />;
  const sentence = currentSentence(scene, episode.sentences, frame); if (!sentence) return <AbsoluteFill style={{ background: "#081923" }} />;
  // The approved direction uses the presenter throughout the explanation,
  // while each aspect reserves a separate area for the visual and captions.
  const presenter = true;
  const shot = currentShot(scene, sentence.id, frame);
  const portrait = props.aspect === "portrait", accent = props.accents[0] || "#80e6d7";
  const side = scene.presenter.side;
  const transit = transitBeat({ title: episode.title, episodeText: episode.sentences.map(item => item.text).join(" "), sentence });
  const applianceMode = applianceVisualMode({ title: episode.title, sentence });
  const gratitudeResearch = gratitudeResearchBeat(sentence);
  const sentenceIndex = episode.sentences.findIndex(item => item.id === sentence.id);
  const directed = scene.direction?.find(item => item.cueSentenceId === sentence.id)
    || directNarrativeBeat({ sentence, previousSentence: episode.sentences[sentenceIndex - 1], source: episode.source, fps: episode.fps });
  const illustration = scene.illustrations?.find(item => item.cueSentenceId === sentence.id);
  const appliance = applianceMode === "exchange";
  const applianceContext = applianceMode && applianceMode !== "exchange" ? applianceMode : null;
  const title = gratitudeResearch ? "Pesquisas sobre gratidão" : transit === "journey" ? "Passageiros no ônibus" : transit === "gratitude" ? "Um gesto de gratidão" : appliance ? "A troca de geladeiras" : applianceContext === "savings" ? "Energia e orçamento" : applianceContext === "criteria" ? "Critérios do programa" : applianceContext === "family" ? "Famílias beneficiadas" : applianceContext === "forecast" ? "Previsão do programa" : scene.title;
  const titleLeft = !portrait && presenter && side === "left" ? "38%" : "6%";
  const titleFontSize = portrait ? Math.max(34, Math.min(48, 3600 / Math.max(1, title.length)))
    : Math.max(38, Math.min(58, 4200 / Math.max(1, title.length)));
  const sceneStart = Math.max(sentence.startFrame, shot?.startFrame || sentence.startFrame);
  const titleIn = ease(frame, sceneStart, sceneStart + Math.round(props.fps*.4));
  return <AbsoluteFill data-qa="narrative-episode-scene" style={{ background: "radial-gradient(ellipse at 65% 45%, #173c46 0%, #0c2632 42%, #081923 80%)", color: "#f5f3e9", fontFamily: "Arial, sans-serif", overflow: "hidden" }}>
    <div style={{ position:"absolute",left:"6%",top:portrait?"5%":"5.2%",fontSize:portrait?24:23,fontWeight:700,letterSpacing:3,color:accent }}>PULSO / EXPLICA</div>
    <div style={{ position:"absolute",left:titleLeft,top:portrait?"10.5%":"10.5%",maxWidth:portrait?"88%":presenter?"57%":"86%", opacity:.55+.45*titleIn, transform:`translateY(${(1-titleIn)*14}px)` }}>
      <div style={{ fontSize:portrait?20:18,letterSpacing:2.6,color:"#adc5c9",fontWeight:700,marginBottom:12 }}>{episode.themeId.toLocaleUpperCase("pt-BR")}</div>
      <div style={{ fontSize:titleFontSize,fontWeight:750,lineHeight:1.08,letterSpacing:-1,display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical",overflow:"hidden" }}>{title}</div>
    </div>
    {illustration ? <NarrativeIllustrationScene illustration={illustration} frame={frame} portrait={portrait} side={side} />
      : gratitudeResearch ? <NarrativeResearchGratitudeScene sentence={sentence} frame={frame} portrait={portrait} side={side} accent={accent} />
      : transit ? <NarrativeTransitScene sentence={sentence} frame={frame} mode={transit} portrait={portrait} presenter={Boolean(presenter)} side={side} accent={accent} />
      : appliance ? <NarrativeApplianceScene sentence={sentence} frame={frame} portrait={portrait} presenter={Boolean(presenter)} side={side} accent={accent} />
      : applianceContext ? <NarrativeApplianceScene sentence={sentence} frame={frame} portrait={portrait} presenter={Boolean(presenter)} side={side} accent={accent} mode={applianceContext} />
      : directed ? <NarrativeDirectedScene beat={directed} sentence={sentence} source={episode.source} frame={frame} fps={episode.fps} portrait={portrait} side={side} />
      : <Stage scene={scene} sentence={sentence} shot={shot} frame={frame} aspect={props.aspect} presenter={Boolean(presenter)} side={side} accents={props.accents} />}
    {!directed && !illustration && <NarrativeSourceCard episode={episode} scene={scene} frame={frame} portrait={portrait} accent={accent} />}
    {presenter && <Presenter props={props} scene={scene} compact={illustration?.dimension === "3d"} />}
    <div style={{ position:"absolute",left:"6%",bottom:portrait?(presenter?"35%":"22.5%") : "7.5%",maxWidth:portrait?"88%":presenter?"62%":"88%",padding:"16px 22px",borderLeft:`4px solid ${accent}`,borderRadius:"0 8px 8px 0",background:"rgba(4,17,24,.93)",color:"#f5f4ea",fontSize:portrait?30:30,fontWeight:650,lineHeight:1.25,zIndex:3 }}>{captionAt(sentence, frame, portrait)}</div>
    <div style={{ position:"absolute",left:portrait&&presenter&&side==="left"?"58%":"6%",right:portrait&&presenter&&side==="right"?"58%":"6%",bottom:portrait?"13%":"2.5%",height:3,background:"rgba(160,201,197,.2)",zIndex:2 }}><div style={{width:`${Math.min(100,frame/Math.max(1,episode.durationInFrames-1)*100)}%`,height:"100%",background:accent}} /></div>
  </AbsoluteFill>;
};
export const NarrativeEpisodeV2: React.FC<Props> = props => <AbsoluteFill><EpisodeScene {...props}/>{props.audioSrc && <Audio src={staticFile(props.audioSrc)}/>}</AbsoluteFill>;
export const NarrativeEpisodeComposition: React.FC = () => <Composition id="NarrativeEpisode" component={NarrativeEpisodeV2} calculateMetadata={calculateMetadata}
  durationInFrames={DEFAULT_PROPS.durationInFrames} fps={DEFAULT_PROPS.fps} width={DEFAULT_PROPS.width} height={DEFAULT_PROPS.height} defaultProps={DEFAULT_PROPS} />;
