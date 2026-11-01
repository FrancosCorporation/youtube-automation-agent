import { Audio } from "@remotion/media";
import type { Caption } from "@remotion/captions";
import {
  AbsoluteFill,
  Composition,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import alignment from "../public/pulso-story/word-timings.json";
import envelope from "../public/pulso-story/audio-envelope.json";
import { PromptAndPoliceScene, PortalReceiptScene } from "./PulsoStoryScenes";
import { HumanMessageScene } from "./PulsoStoryHumanScene";
import { ApprovedRobotPresenter } from "./ApprovedRobotPresenter";
import type { ApprovedRobotAccents } from "./approved-robot-accents.mjs";
import { captionAt } from "./pulso-story-timing.mjs";

const FPS = 24;
const HOLD_FRAMES = 9;
const DURATION = Math.ceil((alignment.durationMs / 1000) * FPS) + HOLD_FRAMES;
const PALETTE = {
  paper: "#edf0e9",
  ink: "#f2f0e5",
  teal: "#0a514e",
  mint: "#8bcbb9",
  cyan: "#69d9ea",
  lime: "#c6f77b",
  amber: "#e6aa70",
  muted: "#afc1b9",
};
const CLAMP = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const ease = Easing.bezier(0.16, 1, 0.3, 1);

const captions: Caption[] = alignment.events.map((event) => ({
  text: event.text,
  startMs: event.startMs,
  endMs: event.endMs,
  timestampMs: null,
  confidence: event.confidence ?? null,
}));

const captionPages: Caption[][] = [];
let page: Caption[] = [];
for (const word of captions) {
  page.push(word);
  if (/[.!?][”’"')\]]*$/.test(word.text) || page.length === 7) {
    captionPages.push(page);
    page = [];
  }
}
if (page.length) captionPages.push(page);

const sentenceStarts = [0];
for (let index = 0; index < captions.length - 1; index += 1) {
  if (/[.!?][”’"')\]]*$/.test(captions[index].text)) {
    sentenceStarts.push(captions[index + 1].startMs);
  }
}
if (sentenceStarts.length !== 3) {
  throw new Error(`Esperava três beats narrativos, encontrei ${sentenceStarts.length}`);
}
const beatOne = Math.round((sentenceStarts[1] / 1000) * FPS);
const beatTwo = Math.round((sentenceStarts[2] / 1000) * FPS);
const wordFrame = (word: string) => {
  const normalized = word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const event = captions.find((candidate) => candidate.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === normalized);
  if (!event) throw new Error(`Palavra necessária ausente do alinhamento: ${word}`);
  return Math.round((event.startMs / 1000) * FPS);
};
const cue = {
  sent: wordFrame("enviado"),
  false: wordFrame("falsa"),
  discovered: wordFrame("descoberta"),
  timeStart: wordFrame("às"),
  timeEnd: wordFrame("27"),
  received: wordFrame("recebeu"),
  message: wordFrame("mensagem"),
  human: wordFrame("alguém"),
  attributed: wordFrame("atribuída"),
  model: wordFrame("modelo"),
  source: wordFrame("Anthropic"),
};

const smooth = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], { ...CLAMP, easing: ease });

const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color = PALETTE.mint,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 14,
      color,
      fontSize: 17,
      fontWeight: 700,
      letterSpacing: 3.5,
      textTransform: "uppercase",
      whiteSpace: "nowrap",
    }}
  >
    <span style={{ width: 32, height: 2, background: color, boxShadow: `0 0 12px ${color}` }} />
    {children}
  </div>
);

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame * 0.012) * 2.5;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at ${72 + drift}% 55%, rgba(87,151,132,.16), transparent 48%), radial-gradient(ellipse at 15% 94%, rgba(105,217,234,.04), transparent 34%), linear-gradient(150deg,#102527 0%,#0c2224 52%,#071718 100%)`,
      }}
    >
      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }} aria-hidden>
        <defs>
          <pattern id="paper-grid" width="44" height="44" patternUnits="userSpaceOnUse">
            <path d="M44 0H0V44" fill="none" stroke="rgba(139,203,185,.025)" strokeWidth="1" />
          </pattern>
          <radialGradient id="signal-glow">
            <stop stopColor={PALETTE.mint} stopOpacity=".34" />
            <stop offset="1" stopColor={PALETTE.mint} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1920" height="1080" fill="url(#paper-grid)" />
      </svg>
    </AbsoluteFill>
  );
};

const NarrativeField: React.FC = () => {
  const frame = useCurrentFrame();
  // Match cuts keep presenter position and the narrated subject coherent.
  const scene = frame < beatOne ? 0 : frame < beatTwo ? 1 : 2;
  return (
    <>
      {scene < 2 ? <svg width="1920" height="1080" viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0 }} aria-hidden>
        {scene === 0 ? <PromptAndPoliceScene frame={frame} opacity={1} cue={cue} start={0} /> : <PortalReceiptScene frame={frame} opacity={1} cue={cue} start={beatOne} />}
      </svg> : <HumanMessageScene frame={frame} start={beatTwo} cue={cue} />}
    </>
  );
};

const StoryText: React.FC = () => {
  const frame = useCurrentFrame();
  const scene = frame < beatOne ? 0 : frame < beatTwo ? 1 : 2;
  const reveal = smooth(frame, cue.attributed, cue.attributed + 12);
  const blocks = [
    { eyebrow: "UM AGENTE SAIU DA TELA", title: <>Uma IA enviou uma <span style={{ color: PALETTE.amber }}>pista falsa.</span></> },
    { eyebrow: "FILADÉLFIA · 18 DE JULHO DE 2026", title: <>Uma pista chega ao <span style={{ color: PALETTE.amber }}>portal.</span></> },
    { eyebrow: "A ORIGEM DA MENSAGEM", title: reveal < 0.5 ? <>Dizia vir de <span style={{ color: PALETTE.amber }}>uma pessoa.</span></> : <>Atribuída a um <span style={{ color: PALETTE.amber }}>modelo de IA.</span></> },
  ];
  const block = blocks[scene];
  return (
    <>
      <div style={{ position: "absolute", left: scene === 2 ? 535 : 80, top: 145, width: 1240, zIndex: 4 }}>
        <Eyebrow>{block.eyebrow}</Eyebrow>
        <div style={{ marginTop: 23, color: PALETTE.ink, fontSize: scene === 2 ? 69 : 76, lineHeight: 1.13, fontWeight: 700, letterSpacing: -3.7 }}>{block.title}</div>
      </div>
      <div style={{ position: "absolute", left: 80, top: 48, zIndex: 4, color: PALETTE.ink, fontSize: 26, fontWeight: 700, letterSpacing: 2.5 }}>PULSO <span style={{ color: PALETTE.mint }}>IA</span></div>
      <div style={{ position: "absolute", right: 80, top: 53, color: PALETTE.muted, fontSize: 16, letterSpacing: 2.8, fontWeight: 700 }}>IA & MUNDO REAL</div>
      <div style={{ position: "absolute", left: 80, bottom: 15, color: "#81978e", fontSize: 12, letterSpacing: 1.6 }}>FONTE: NBC10 PHILADELPHIA · AP · RECONSTITUIÇÃO VISUAL</div>
    </>
  );
};

const KaraokeCaption: React.FC = () => {
  const frame = useCurrentFrame();
  const time = (frame / FPS) * 1000;
  const { group, active } = captionAt(captionPages, time);
  if (!group) return null;
  const move = frame < beatTwo ? 0 : 430;
  return (
    <div style={{ position: "absolute", left: 80 + move, bottom: 45, width: 1250, minHeight: 78, padding: "17px 25px", boxSizing: "border-box", color: "#f7fbf7", textAlign: "center", background: "rgba(3,18,20,.85)", border: "1px solid rgba(91,224,193,.36)", borderRadius: 18, fontSize: 30, fontWeight: 600, lineHeight: 1.2, boxShadow: "0 18px 44px rgba(16,49,44,.18)", zIndex: 8 }}>
      {group.map((word, index) => (
        <span key={`${word.startMs}-${word.text}`} style={{ color: index === active ? PALETTE.mint : "#f7fbf7", textShadow: index === active ? "0 0 14px rgba(91,224,193,.38)" : "none" }}>
          {index ? " " : ""}{word.text}
        </span>
      ))}
    </div>
  );
};

const RobotStage: React.FC<{ accents?: ApprovedRobotAccents }> = ({ accents }) => {
  const frame = useCurrentFrame();
  // Editorial hard cut: the presenter changes sides without sliding through the story.
  const isRight = frame < 552;
  return (
    <ApprovedRobotPresenter
      src={staticFile("pulso-story/approved-robot-rigged.glb")}
      side={isRight ? "right" : "left"}
      accents={accents}
      canvasSize={isRight ? { width: 630, height: 940 } : { width: 500, height: 750 }}
      gestureCues={{ hook: 55, question: 227, timestamp: 328, receipt: 439, attribution: 667, close: 734 }}
      lipSyncEnvelope={envelope.levels}
      lipSyncFps={1000 / envelope.stepMs}
      style={isRight ? { top: 80, left: undefined, right: 0 } : { top: 190, left: 5, right: undefined }}
    />
  );
};

const ProgressRail: React.FC = () => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, DURATION - 1], [0, 100], CLAMP);
  return <div style={{ position: "absolute", left: 0, bottom: 0, width: "100%", height: 5, background: "rgba(10,81,78,.13)", zIndex: 10 }}><div style={{ width: `${progress}%`, height: "100%", background: `linear-gradient(90deg,${PALETTE.teal},${PALETTE.mint},${PALETTE.amber})` }} /></div>;
};

const PulsoStory: React.FC<{ accents?: ApprovedRobotAccents }> = ({ accents }) => (
  <AbsoluteFill style={{ fontFamily: "PulsoSans, sans-serif" }}>
    <style>{`@font-face {font-family: PulsoSans; src: url("${staticFile("NotoSans-Regular.ttf")}"); font-weight: 400;} @font-face {font-family: PulsoSans; src: url("${staticFile("NotoSans-Bold.ttf")}"); font-weight: 600 900;}`}</style>
    <Background />
    <NarrativeField />
    <RobotStage accents={accents} />
    <StoryText />
    <Audio src={staticFile("pulso-story/narration.m4a")} />
    <KaraokeCaption />
    <ProgressRail />
  </AbsoluteFill>
);

export const PulsoStoryComposition: React.FC = () => (
  <Composition id="PulsoStory" component={PulsoStory} defaultProps={{ accents: { primary: PALETTE.cyan, secondary: PALETTE.mint } }} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
);
