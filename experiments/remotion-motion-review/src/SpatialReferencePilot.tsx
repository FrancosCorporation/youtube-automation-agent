import React from "react";
import { Audio } from "@remotion/media";
import { ThreeCanvas } from "@remotion/three";
import { AbsoluteFill, Composition, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ApprovedRobotPresenter } from "./ApprovedRobotPresenter";
import narrationTiming from "../public/pulso-spatial-pilot/timings.json";
import speechEnvelope from "../public/pulso-spatial-pilot/envelope.json";

// Isolated visual pilot: synthetic terrain and route, not a real geographic claim.
const FPS = 24;
const DURATION = 192;
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const heightAt = (x: number, z: number) => 0.12 + 0.24 * (1 + Math.sin(x * 0.7) * Math.cos(z * 0.8));
const frameAt = (ms: number) => Math.round(ms * FPS / 1000);
const routePhase = frameAt(narrationTiming.events[7].startMs);
const routeStart = frameAt(narrationTiming.events[8].startMs);
const routeEnd = frameAt(narrationTiming.events[13].endMs);
const destinationPhase = frameAt(narrationTiming.events[14].startMs);

const Terrain: React.FC<{ progress: number }> = ({ progress }) => {
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
  const movingX = -3.5 + 7 * progress;
  const movingZ = 1.8 - 3.6 * progress;
  return <>
    <ambientLight intensity={0.8} />
    <directionalLight position={[5, 10, 4]} intensity={1.5} />
    <mesh position={[0, -0.12, 0]}><boxGeometry args={[9.2, 0.24, 7.2]} /><meshStandardMaterial color="#10242c" /></mesh>
    {tiles}
    <mesh position={[-3.5, heightAt(-3.5, 1.8) + 0.48, 1.8]}><boxGeometry args={[0.55, 0.9, 0.18]} /><meshStandardMaterial color="#80cfc4" /></mesh>
    <mesh position={[3.5, heightAt(3.5, -1.8) + 0.48, -1.8]}><boxGeometry args={[0.55, 0.9, 0.18]} /><meshStandardMaterial color="#e8b66a" /></mesh>
    {route}
    <mesh position={[movingX, heightAt(movingX, movingZ) + 0.42, movingZ]}>
      <sphereGeometry args={[0.17, 16, 12]} /><meshStandardMaterial color="#e9fff7" emissive="#4bbba2" />
    </mesh>
  </>;
};

const SpatialReferencePilot: React.FC<{ aspect: "landscape" | "portrait" }> = ({ aspect }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const portrait = aspect === "portrait";
  const progress = interpolate(frame, [routeStart, routeEnd], [0, 1], { ...clamp, easing: Easing.inOut(Easing.ease) });
  const panelWidth = Math.round(width * (portrait ? 0.9 : 0.67));
  const panelHeight = Math.round(height * (portrait ? 0.48 : 0.64));
  const caption = frame < routePhase ? "Uma mensagem sai do aparelho de origem." : frame < destinationPhase
    ? "Ela percorre a rede até o destino." : "O aparelho de destino recebe a mensagem.";
  return <AbsoluteFill style={{ background: "radial-gradient(ellipse at 36% 37%, #183842 0%, #0a1b25 58%, #061118 100%)", color: "#f4f2e9", fontFamily: "Arial, sans-serif" }}>
    <div style={{ position: "absolute", left: "6%", top: portrait ? "5%" : "6%", fontSize: portrait ? 27 : 25, color: "#67e8cf", fontWeight: 700, letterSpacing: 3 }}>PULSO IA / ESTUDO VISUAL</div>
    <div style={{ position: "absolute", left: "6%", top: portrait ? "10%" : "12%", maxWidth: portrait ? "88%" : "66%", fontSize: portrait ? 46 : 58, fontWeight: 750, lineHeight: 1.05 }}>Como uma mensagem chega ao destino</div>
    <div style={{ position: "absolute", left: "7%", top: portrait ? "17%" : "25%", display: "flex", gap: portrait ? 22 : 36, color: "#c8e2df", fontSize: portrait ? 23 : 20, fontWeight: 700, letterSpacing: 1.4 }}>
      <span>01 ORIGEM</span><span style={{ opacity: frame >= routePhase ? 1 : 0.25 }}>02 REDE</span><span style={{ opacity: frame >= destinationPhase ? 1 : 0.25 }}>03 DESTINO</span>
    </div>
    <div style={{ position: "absolute", left: portrait ? "5%" : "2%", top: portrait ? "14%" : "23%", width: panelWidth, height: panelHeight }}>
      <ThreeCanvas width={panelWidth} height={panelHeight} camera={{ position: [10, 12, 14], fov: 35, near: 0.1, far: 100 }} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }} style={{ width: "100%", height: "100%" }}>
        <Terrain progress={progress} />
      </ThreeCanvas>
    </div>
    <div style={{ position: "absolute", left: "6%", bottom: portrait ? "35%" : "12%", maxWidth: portrait ? "88%" : "60%", padding: "16px 20px", borderLeft: "4px solid #67e8cf", background: "rgba(5,19,27,.9)", fontSize: portrait ? 31 : 30, fontWeight: 600 }}>{caption}</div>
    <div style={{ position: "absolute", left: "6%", bottom: portrait ? "30%" : "7%", color: "#a7c0c5", fontSize: portrait ? 20 : 18 }}>REDE E TRAJETO ILUSTRATIVOS</div>
    <ApprovedRobotPresenter src={staticFile("pulso-story/approved-robot-rigged.glb")} side="right" accents={["#22D3EE", "#67E8F9"]} gestureCues={{ explain: routePhase }} lipSyncEnvelope={speechEnvelope.levels} lipSyncFps={1000 / speechEnvelope.stepMs}
      canvasSize={{ width: Math.round(width * (portrait ? 0.53 : 0.34)), height: Math.round(height * (portrait ? 0.29 : 0.84)) }}
      style={portrait ? { top: "auto", bottom: "1%", left: "auto", right: "3%", zIndex: 4 } : { top: "8%", right: "-2%", zIndex: 4 }} />
    <Audio src={staticFile("pulso-spatial-pilot/narration.mp3")} />
  </AbsoluteFill>;
};

export const SpatialReferencePilotCompositions: React.FC = () => <>
  <Composition id="PulsoSpatialPilotLandscape" component={SpatialReferencePilot} width={1920} height={1080} fps={FPS} durationInFrames={DURATION} defaultProps={{ aspect: "landscape" as const }} />
  <Composition id="PulsoSpatialPilotPortrait" component={SpatialReferencePilot} width={1080} height={1920} fps={FPS} durationInFrames={DURATION} defaultProps={{ aspect: "portrait" as const }} />
</>;
