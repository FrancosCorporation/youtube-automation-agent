import React from "react";
import { Audio } from "@remotion/media";
import { ThreeCanvas } from "@remotion/three";
import { AbsoluteFill, Composition, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ApprovedRobotPresenter } from "./ApprovedRobotPresenter";
import narrationTiming from "../public/pulso-novo-padrao-20261028/timings.json";
import speechEnvelope from "../public/pulso-novo-padrao-20261028/envelope.json";

// Isolated visual pilot: synthetic terrain and route, not a real geographic claim.
const FPS = 24;
const DURATION = 744;
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const heightAt = (x: number, z: number) => 0.12 + 0.24 * (1 + Math.sin(x * 0.7) * Math.cos(z * 0.8));
const frameAt = (ms: number) => Math.round(ms * FPS / 1000);
const routePhase = frameAt(narrationTiming.events[22].startMs);
const routeStart = frameAt(narrationTiming.events[24].startMs);
const routeEnd = frameAt(narrationTiming.events[41].endMs);
const destinationPhase = frameAt(narrationTiming.events[42].startMs);

const Terrain: React.FC<{ progress: number; frame: number }> = ({ progress, frame }) => {
  const split = interpolate(frame, [frameAt(narrationTiming.events[10].startMs), frameAt(narrationTiming.events[13].endMs)], [0, 1], clamp);
  const delivered = interpolate(frame, [frameAt(narrationTiming.events[42].startMs), frameAt(narrationTiming.events[48].endMs)], [0, 1], clamp);
  const tiles = Array.from({ length: 63 }, (_, i) => {
    const x = (i % 9) - 4;
    const z = Math.floor(i / 9) - 3;
    const height = heightAt(x, z);
    return <mesh key={i} position={[x, height / 2, z]}>
      <boxGeometry args={[0.96, height, 0.96]} />
      <meshStandardMaterial color={height > 0.4 ? "#315b60" : "#183a45"} roughness={0.85} />
    </mesh>;
  });
  const route = Array.from({ length: 17 }, (_, i) => {
    const t = i / 16;
    const x = -3.5 + 7 * t;
    const z = 1.8 - 3.6 * t;
    return <mesh key={i} position={[x, heightAt(x, z) + 0.22, z]} visible={t <= progress}>
      <sphereGeometry args={[i === 0 || i === 16 ? 0.14 : 0.06, 10, 8]} />
      <meshStandardMaterial color={i === 16 ? "#f6bf6b" : "#67e8cf"} emissive={i === 16 ? "#7a3d0c" : "#0e5f57"} />
    </mesh>;
  });
  return <>
    <ambientLight intensity={0.8} />
    <directionalLight position={[5, 10, 4]} intensity={1.5} />
    <mesh position={[0, -0.12, 0]}><boxGeometry args={[9.2, 0.24, 7.2]} /><meshStandardMaterial color="#10242c" /></mesh>
    {tiles}
    <mesh position={[-3.5, heightAt(-3.5, 1.8) + 0.48, 1.8]}><boxGeometry args={[0.55, 0.9, 0.18]} /><meshStandardMaterial color="#80cfc4" /></mesh>
    <mesh position={[3.5, heightAt(3.5, -1.8) + 0.48, -1.8]}><boxGeometry args={[0.55, 0.9, 0.18]} /><meshStandardMaterial color="#e8b66a" /></mesh>
    {route}
    {[[-1.8, .9], [0, -.3], [1.8, -.9]].map(([x, z], i) => <mesh key={i} position={[x, heightAt(x, z) + .24, z]}><boxGeometry args={[.5, .35, .45]} /><meshStandardMaterial color="#739aab" emissive="#173644" /></mesh>)}
    {[0, 1, 2].map((lane) => Array.from({ length: 15 }, (_, i) => {
      const t = i / 14, x = -3.5 + 7 * t, z = 1.8 - 3.6 * t + Math.sin(t * Math.PI) * (lane - 1) * 1.4;
      return <mesh key={`${lane}-${i}`} visible={t <= progress} position={[x, heightAt(x,z) + .24, z]}><sphereGeometry args={[.06, 8, 6]} /><meshStandardMaterial color={lane === 0 ? "#f4c86f" : lane === 1 ? "#67e8cf" : "#aeb8ff"} /></mesh>;
    }))}
    {[0, 1, 2].map((lane) => {
      const t = Math.max(0, Math.min(1, progress - lane * .08));
      const x = -3.5 + 7 * t, z = 1.8 - 3.6 * t + Math.sin(t * Math.PI) * (lane - 1) * 1.4;
      return <mesh key={lane} visible={split > .02 && delivered < .95} position={[x, heightAt(x, z) + .4 + lane * .22 * split, z]} scale={.3 + .7 * split}>
        <boxGeometry args={[.28, .28, .28]} /><meshStandardMaterial color={lane === 0 ? "#f4c86f" : lane === 1 ? "#67e8cf" : "#aeb8ff"} emissive="#24514c" />
      </mesh>;
    })}
    <mesh visible={delivered > .02} position={[3.5, heightAt(3.5, -1.8) + 1.2, -1.8]} scale={delivered}>
      <boxGeometry args={[.75, .45, .12]} /><meshStandardMaterial color="#f4f1df" emissive="#3e5037" />
    </mesh>
  </>;
};

const PulsoReferenceEpisode: React.FC<{ aspect: "landscape" | "portrait" }> = ({ aspect }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const portrait = aspect === "portrait";
  const progress = interpolate(frame, [routeStart, routeEnd], [0, 1], { ...clamp, easing: Easing.inOut(Easing.ease) });
  const panelWidth = Math.round(width * (portrait ? 0.9 : 0.67));
  const panelHeight = Math.round(height * (portrait ? 0.48 : 0.64));
  const at = (index: number) => frameAt(narrationTiming.events[index].startMs);
  const captions = [
    [0, "Como uma mensagem atravessa a internet?"], [6, "Os dados são divididos em pequenos pacotes."],
    [14, "Cada pacote carrega informações para encaminhá-lo."], [22, "Roteadores recebem os pacotes e escolhem por onde enviá-los."],
    [33, "Eles podem seguir trajetos diferentes até o destino."], [42, "Os dados são organizados novamente no aparelho."],
    [57, "Tudo acontece nos bastidores enquanto a gente conversa."], [66, "Este mapa é uma ilustração, não uma rota real."]
  ] as const;
  const caption = [...captions].reverse().find(([index]) => frame >= at(index))?.[1] || captions[0][1];
  const scene = frame < at(6) ? 0 : frame < at(22) ? 1 : frame < at(33) ? 2 : frame < at(42) ? 3 : 4;
  const heading = ["Uma mensagem em movimento", "A mensagem vira pacotes", "Roteadores escolhem o caminho", "Trajetos podem ser diferentes", "O destino organiza os dados"][scene];
  return <AbsoluteFill style={{ background: "radial-gradient(ellipse at 36% 37%, #183842 0%, #0a1b25 58%, #061118 100%)", color: "#f4f2e9", fontFamily: "Arial, sans-serif" }}>
    <div style={{ position: "absolute", left: "6%", top: portrait ? "5%" : "6%", fontSize: portrait ? 27 : 25, color: "#67e8cf", fontWeight: 700, letterSpacing: 3 }}>PULSO IA / COMO FUNCIONA</div>
    <div style={{ position: "absolute", left: "6%", top: portrait ? "10%" : "12%", maxWidth: portrait ? "88%" : "66%", fontSize: portrait ? 46 : 58, fontWeight: 750, lineHeight: 1.05 }}>{heading}</div>
    <div style={{ position: "absolute", left: "7%", top: portrait ? "17%" : "25%", display: "flex", gap: portrait ? 22 : 36, color: "#c8e2df", fontSize: portrait ? 23 : 20, fontWeight: 700, letterSpacing: 1.4 }}>
      <span>01 PACOTES</span><span style={{ opacity: frame >= routePhase ? 1 : 0.25 }}>02 CAMINHO</span><span style={{ opacity: frame >= destinationPhase ? 1 : 0.25 }}>03 DESTINO</span>
    </div>
    <div style={{ position: "absolute", left: portrait ? "5%" : "2%", top: portrait ? "14%" : "23%", width: panelWidth, height: panelHeight }}>
      <ThreeCanvas width={panelWidth} height={panelHeight} camera={{ position: [10, 12, 14], fov: 35, near: 0.1, far: 100 }} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }} style={{ width: "100%", height: "100%" }}>
        <Terrain progress={progress} frame={frame} />
      </ThreeCanvas>
    </div>
    <div style={{ position: "absolute", left: "6%", bottom: portrait ? "35%" : "12%", maxWidth: portrait ? "88%" : "60%", padding: "16px 20px", borderLeft: "4px solid #67e8cf", background: "rgba(5,19,27,.9)", fontSize: portrait ? 31 : 30, fontWeight: 600 }}>{caption}</div>
    <div style={{ position: "absolute", left: "6%", bottom: portrait ? "30%" : "7%", color: "#a7c0c5", fontSize: portrait ? 20 : 18 }}>MAPA E TRAJETOS ILUSTRATIVOS</div>
    <ApprovedRobotPresenter src={staticFile("pulso-story/approved-robot-rigged.glb")} side="right" accents={["#22D3EE", "#67E8F9"]} gestureCues={{ explain: at(6), point: routePhase, conclusion: at(57) }} lipSyncEnvelope={speechEnvelope.levels} lipSyncFps={1000 / speechEnvelope.stepMs}
      canvasSize={{ width: Math.round(width * (portrait ? 0.53 : 0.34)), height: Math.round(height * (portrait ? 0.29 : 0.84)) }}
      style={portrait ? { top: "auto", bottom: "1%", left: "auto", right: "3%", zIndex: 4 } : { top: "8%", right: "-2%", zIndex: 4 }} />
    <Audio src={staticFile("pulso-novo-padrao-20261028/narration.mp3")} />
  </AbsoluteFill>;
};

export const ReferenceEpisodeCompositions: React.FC = () => <>
  <Composition id="PulsoReferenceLandscape" component={PulsoReferenceEpisode} width={1920} height={1080} fps={FPS} durationInFrames={DURATION} defaultProps={{ aspect: "landscape" as const }} />
  <Composition id="PulsoReferencePortrait" component={PulsoReferenceEpisode} width={1080} height={1920} fps={FPS} durationInFrames={DURATION} defaultProps={{ aspect: "portrait" as const }} />
</>;
