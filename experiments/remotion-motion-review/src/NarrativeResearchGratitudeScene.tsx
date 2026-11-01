import React from "react";
import { ThreeCanvas } from "@remotion/three";
import { interpolate, useVideoConfig } from "remotion";
import { gratitudeResearchMotion } from "../../../utils/narrative-research-gratitude.js";

export const NarrativeResearchGratitudeScene: React.FC<{ sentence: { startFrame: number; endFrame: number; wordTimings?: Array<{ text: string; startFrame: number }> }; frame: number; portrait: boolean; side: "left" | "right"; accent: string }> = ({ sentence, frame, portrait, side, accent }) => {
  const video = useVideoConfig();
  const panel = portrait ? { left: .05, top: .19, width: .90, height: .37 }
    : { left: side === "left" ? .38 : .02, top: .23, width: .60, height: .57 };
  const width = Math.round(video.width * panel.width), height = Math.round(video.height * panel.height);
  const progress = interpolate(frame, [sentence.startFrame, Math.max(sentence.startFrame + 1, sentence.endFrame - 2)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const motion = gratitudeResearchMotion(sentence, frame);
  return <div data-qa="gratitude-research-3d" style={{ position: "absolute", inset: 0 }}>
    <div style={{ position: "absolute", left: `${panel.left * 100}%`, top: `${panel.top * 100}%`, width, height }}>
      <ThreeCanvas width={width} height={height} camera={{ position: [5.6, 5.2, 9.5], fov: 31, near: .1, far: 100 }} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }} style={{ width: "100%", height: "100%" }}>
        <ambientLight intensity={1.05} /><directionalLight position={[4, 9, 6]} intensity={2} />
        <mesh position={[0, -.12, 0]}><boxGeometry args={[8, .24, 4.3]} /><meshStandardMaterial color="#163943" roughness={.8} /></mesh>
        <group position={[-2.2, 1.25, -.25]} rotation={[0, .18, 0]}>
          <mesh><boxGeometry args={[1.45, 2.5, .15]} /><meshStandardMaterial color="#e0eeea" roughness={.65} /></mesh>
          {[.6, .28, -.04, -.36].map((y, index) => <mesh key={index} position={[-.12, y, .09]}><boxGeometry args={[index === 3 ? .68 : 1, .06, .03]} /><meshStandardMaterial color="#67878b" /></mesh>)}
        </group>
        {[0, 1].map(index => <group key={index} position={[.35 + index * 1.65, 0, 0]} scale={.92 + .08 * Math.min(1, progress * 2)}>
          <mesh position={[0, 1.98, 0]}><sphereGeometry args={[.31, 20, 16]} /><meshStandardMaterial color={index ? "#d1aa87" : "#e2c8ab"} roughness={.8} /></mesh>
          <mesh position={[0, 1.24, 0]}><boxGeometry args={[.72, .95, .45]} /><meshStandardMaterial color={index ? "#b98b5c" : "#6c8eb0"} roughness={.85} /></mesh>
          {[-1, 1].map(leg => <group key={leg} position={[leg * .18, .75, 0]}>
            <mesh position={[0, -.33, 0]}><boxGeometry args={[.25, .66, .27]} /><meshStandardMaterial color={index ? "#566e76" : "#455d6d"} /></mesh>
            <mesh position={[0, -.68, .07]}><boxGeometry args={[.27, .12, .42]} /><meshStandardMaterial color="#344b50" /></mesh>
          </group>)}
          <group position={[index ? -.46 : .46, 1.58, 0]} rotation={[0, 0, (index ? 1 : -1) * (.12 + motion.help * .9)]}>
            <mesh position={[0, -.38, 0]}><boxGeometry args={[.19, .76, .22]} /><meshStandardMaterial color={index ? "#b98b5c" : "#6c8eb0"} /></mesh>
            <mesh position={[0, -.81, 0]}><sphereGeometry args={[.12, 12, 10]} /><meshStandardMaterial color={index ? "#d1aa87" : "#e2c8ab"} /></mesh>
          </group>
          <mesh position={[index ? .46 : -.46, 1.18, 0]}><boxGeometry args={[.18, .8, .2]} /><meshStandardMaterial color={index ? "#b98b5c" : "#6c8eb0"} /></mesh>
        </group>)}
        <group position={[1.18, 2.8, -.08]} scale={Math.max(.001, motion.gratitude)}>
          <mesh><boxGeometry args={[.8, .48, .09]} /><meshStandardMaterial color="#d5eee6" /></mesh>
          <mesh position={[-.14, 0, .055]}><sphereGeometry args={[.055, 8, 6]} /><meshStandardMaterial color="#578b83" /></mesh>
          <mesh position={[.05, 0, .055]}><sphereGeometry args={[.055, 8, 6]} /><meshStandardMaterial color="#578b83" /></mesh>
          <mesh position={[.24, 0, .055]}><sphereGeometry args={[.055, 8, 6]} /><meshStandardMaterial color="#578b83" /></mesh>
        </group>
        {Array.from({ length: 5 }, (_, index) => <mesh key={index} visible={index / 4 <= progress} position={[-1.15 + index * .34, .08, .35]}>
          <sphereGeometry args={[.08, 8, 6]} /><meshStandardMaterial color={accent} emissive="#245c55" />
        </mesh>)}
      </ThreeCanvas>
    </div>
    <div style={{ position: "absolute", top: portrait ? "55%" : "79%", left: `${panel.left * 100}%`, width, textAlign: "center", color: "#b7cac9", fontSize: portrait ? 17 : 15, letterSpacing: 1.4 }}>PESQUISAS · REPRESENTAÇÃO ILUSTRATIVA</div>
  </div>;
};
