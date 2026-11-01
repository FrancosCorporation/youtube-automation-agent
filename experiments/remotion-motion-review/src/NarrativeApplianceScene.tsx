import React from "react";
import { ThreeCanvas } from "@remotion/three";
import { interpolate, useVideoConfig } from "remotion";
import { applianceCriteriaMilestones, applianceCueReached, applianceExchangeLabel, applianceExchangeProgress, applianceFamilyDetails, applianceSavingsSequence } from "../../../utils/narrative-appliance-scene.js";
import { NarrativeCriteriaScene } from "./NarrativeCriteriaScene";
import { NarrativeSavingsFlow } from "./NarrativeSavingsFlow";
import { NarrativeFamilyScene } from "./NarrativeFamilyScene";

type Sentence = { text: string; startFrame: number; endFrame: number; wordTimings?: Array<{ text: string; startFrame: number; endFrame: number }> };

export const NarrativeApplianceScene: React.FC<{ sentence: Sentence; frame: number; portrait: boolean; presenter: boolean; side: "left" | "right"; accent: string; mode?: "exchange" | "savings" | "criteria" | "family" | "forecast" }> = ({ sentence, frame, portrait, presenter, side, accent, mode = "exchange" }) => {
  const video = useVideoConfig();
  const width = portrait ? 562.5 : 1000, height = portrait ? 1000 : 562.5;
  const progress = interpolate(frame, [sentence.startFrame, Math.max(sentence.startFrame + 1, sentence.endFrame - 2)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const centerX = portrait ? 281 : presenter ? (side === "right" ? 310 : 690) : 500;
  const centerY = portrait ? (presenter ? 375 : 400) : 260;
  const scale = portrait ? 1.05 : presenter ? .88 : 1.15;
  const words = sentence.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const spoken = (...prefixes: string[]) => applianceCueReached(sentence, frame, prefixes);
  const leisure = mode === "savings" && spoken("passeio", "lazer", "filhos") && !spoken("tranquilidade", "fechar");
  const savingsSequence = mode === "savings" ? applianceSavingsSequence(sentence, frame) : null;
  const familyDetails = mode === "family" ? applianceFamilyDetails(sentence) : null;
  const oldUnit = mode === "criteria" && /\bunidade antiga\b/.test(words);
  const forecastLabel = mode === "forecast" && spoken("1600") ? "1.600 PREVISTOS" : "";
  const exchangeLabel = mode === "exchange" ? applianceExchangeLabel(sentence, frame) : "";
  const exchangeProgress = mode === "exchange" ? applianceExchangeProgress(sentence, frame, video.fps) : 0;
  const fridge = (x: number, old: boolean) => <g transform={`translate(${x} 4)`}>
    <rect x="-49" y="-88" width="98" height="172" rx="9" fill={old ? "#6c7776" : "#d7e7e3"} stroke={old ? "#a2a6a1" : accent} strokeWidth="4" />
    <path d="M-49 -25H49M-30 -71V-39M-30 -10V24" fill="none" stroke={old ? "#d8c5ad" : "#315665"} strokeWidth="5" strokeLinecap="round" />
    {old && <path d="M10 11l15 8M-9 48l15 5" stroke="#a9684c" strokeWidth="4" />}
    <path d="M-34 85V92M34 85V92" stroke="#b4cdca" strokeWidth="5" />
  </g>;
  const document = (x: number, symbol: string) => <g transform={`translate(${x} 0)`}>
    <path d="M-48 -83H30L49 -64V82H-48Z" fill="#e2efea" stroke={accent} strokeWidth="4" />
    <path d="M30 -83V-64H49M-29 -41H23M-29 -25H10M-29 49H25" fill="none" stroke="#52717a" strokeWidth="4" strokeLinecap="round" />
    <text x="0" y="28" fontFamily="Arial, sans-serif" fontSize="48" fontWeight="700" textAnchor="middle" fill="#28535c">{symbol}</text>
  </g>;
  if (mode === "criteria" && applianceCriteriaMilestones(sentence).length) {
    return <NarrativeCriteriaScene sentence={sentence} frame={frame} portrait={portrait} side={side} accent={accent} />;
  }
  if (familyDetails) return <NarrativeFamilyScene details={familyDetails} frame={frame} portrait={portrait} side={side} accent={accent} />;
  if (savingsSequence && savingsSequence !== "leisure") {
    return <NarrativeSavingsFlow sentence={sentence} frame={frame} portrait={portrait} side={side} accent={accent} mode={savingsSequence} />;
  }
  if (mode === "exchange") {
    const panel = portrait ? { left: .05, top: .19, width: .90, height: .37 }
      : { left: presenter && side === "left" ? .38 : .02, top: .23, width: presenter ? .60 : .94, height: .57 };
    const canvasWidth = Math.round(video.width * panel.width), canvasHeight = Math.round(video.height * panel.height);
    const refrigerator = (x: number, old: boolean) => <group position={[x, 1.45, 0]}>
      <mesh><boxGeometry args={[1.35, 2.9, 1.25]} /><meshStandardMaterial color={old ? "#6d7977" : "#d8eae6"} roughness={.55} metalness={.12} /></mesh>
      <mesh position={[0, .35, .637]}><boxGeometry args={[1.24, 2.1, .055]} /><meshStandardMaterial color={old ? "#7f8982" : "#c4deda"} roughness={.45} /></mesh>
      <mesh position={[0, -.98, .637]}><boxGeometry args={[1.24, .55, .055]} /><meshStandardMaterial color={old ? "#747e78" : "#b3cfcc"} roughness={.48} /></mesh>
      <mesh position={[-.48, .67, .7]}><boxGeometry args={[.07, .62, .09]} /><meshStandardMaterial color={old ? "#ae9d85" : "#4e7378"} metalness={.45} /></mesh>
      <mesh position={[-.48, -.98, .7]}><boxGeometry args={[.07, .3, .09]} /><meshStandardMaterial color={old ? "#ae9d85" : "#4e7378"} metalness={.45} /></mesh>
      {old && <><mesh position={[.28, .1, .68]} rotation={[0, 0, -.3]}><boxGeometry args={[.31, .07, .03]} /><meshStandardMaterial color="#ac765e" /></mesh><mesh position={[.08, -.6, .68]} rotation={[0, 0, .3]}><boxGeometry args={[.24, .06, .03]} /><meshStandardMaterial color="#ac765e" /></mesh></>}
    </group>;
    return <div data-qa="appliance-exchange-3d" style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", left: `${panel.left * 100}%`, top: `${panel.top * 100}%`, width: canvasWidth, height: canvasHeight }}>
        <ThreeCanvas width={canvasWidth} height={canvasHeight} camera={{ position: [6.5, 6, 11], fov: 31, near: .1, far: 100 }} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }} style={{ width: "100%", height: "100%" }}>
          <ambientLight intensity={1.05} /><directionalLight position={[4, 9, 6]} intensity={2} />
          <mesh position={[0, -.12, 0]}><boxGeometry args={[8, .24, 4.3]} /><meshStandardMaterial color="#163943" roughness={.8} /></mesh>
          {refrigerator(-1.45 - exchangeProgress * .9, true)}{refrigerator(2.35 - exchangeProgress * .8, false)}
          {Array.from({ length: 9 }, (_, index) => <mesh key={index} position={[-1.1 + index * .28, .06, .35]} visible={index / 8 <= exchangeProgress}>
            <sphereGeometry args={[.09, 10, 8]} /><meshStandardMaterial color={accent} emissive="#245c55" />
          </mesh>)}
        </ThreeCanvas>
      </div>
      {exchangeLabel && <div style={{ position: "absolute", top: portrait ? "19%" : "24%", left: `${panel.left * 100}%`, width: canvasWidth, textAlign: "center", color: "#f4f4e9", fontSize: portrait ? 25 : 23, fontWeight: 700 }}>{exchangeLabel}</div>}
      <div style={{ position: "absolute", top: portrait ? "55%" : "79%", left: `${panel.left * 100}%`, width: canvasWidth, textAlign: "center", color: "#b7cac9", fontSize: portrait ? 17 : 15, letterSpacing: 1.4 }}>TROCA ILUSTRATIVA</div>
    </div>;
  }
  if (leisure) {
    const panel = portrait ? { left: .05, top: .19, width: .90, height: .37 }
      : { left: presenter && side === "left" ? .38 : .02, top: .23, width: presenter ? .60 : .94, height: .57 };
    const canvasWidth = Math.round(video.width * panel.width), canvasHeight = Math.round(video.height * panel.height);
    const cue = sentence.wordTimings?.find(word => /^(?:passeio|lazer|filhos)/.test(word.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()));
    const elapsed = Math.max(0, frame - (cue?.startFrame ?? sentence.startFrame));
    const journey = interpolate(elapsed, [0, Math.max(24, sentence.endFrame - (cue?.startFrame ?? sentence.startFrame))], [-.9, .9], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const step = Math.sin(elapsed * .18) * .32;
    const walker = (x: number, height: number, color: string, phase: number) => <group position={[x + journey, 0, .1]} scale={height}>
      <mesh position={[0, 1.75, 0]}><sphereGeometry args={[.22, 16, 12]} /><meshStandardMaterial color="#d7b99a" /></mesh>
      <mesh position={[0, 1.12, 0]}><boxGeometry args={[.5, .82, .3]} /><meshStandardMaterial color={color} /></mesh>
      {[-1, 1].map((sideIndex, index) => <group key={index} position={[sideIndex * .14, .7, 0]} rotation={[step * sideIndex * phase, 0, 0]}>
        <mesh position={[0, -.35, 0]}><boxGeometry args={[.16, .7, .18]} /><meshStandardMaterial color="#66838b" /></mesh>
      </group>)}
      {[-1, 1].map((sideIndex, index) => <group key={index} position={[sideIndex * .34, 1.42, 0]} rotation={[-step * sideIndex * phase, 0, 0]}>
        <mesh position={[0, -.3, 0]}><boxGeometry args={[.14, .6, .16]} /><meshStandardMaterial color={color} /></mesh>
      </group>)}
    </group>;
    return <div data-qa="appliance-leisure-3d" style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", left: `${panel.left * 100}%`, top: `${panel.top * 100}%`, width: canvasWidth, height: canvasHeight }}>
        <ThreeCanvas width={canvasWidth} height={canvasHeight} camera={{ position: [6.5, 6, 11], fov: 31, near: .1, far: 100 }} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }} style={{ width: "100%", height: "100%" }}>
          <ambientLight intensity={1.05} /><directionalLight position={[4, 9, 6]} intensity={2} />
          <mesh position={[0, -.12, 0]}><boxGeometry args={[8, .24, 4.3]} /><meshStandardMaterial color="#234c4a" roughness={.9} /></mesh>
          <mesh position={[0, .025, .3]}><boxGeometry args={[7.5, .04, 1.25]} /><meshStandardMaterial color="#6b7770" roughness={1} /></mesh>
          {[-2.8, 2.8].map((x, index) => <group key={index} position={[x, 0, -1.25]}>
            <mesh position={[0, .65, 0]}><cylinderGeometry args={[.15, .2, 1.3, 10]} /><meshStandardMaterial color="#786e57" /></mesh>
            <mesh position={[0, 1.65, 0]}><sphereGeometry args={[.8, 12, 8]} /><meshStandardMaterial color="#528a76" /></mesh>
          </group>)}
          {walker(-.5, 1, "#91abc0", 1)}{walker(.4, .75, "#d4a66e", -1)}
        </ThreeCanvas>
      </div>
      <div style={{ position: "absolute", top: portrait ? "55%" : "79%", left: `${panel.left * 100}%`, width: canvasWidth, textAlign: "center", color: "#b7cac9", fontSize: portrait ? 17 : 15, letterSpacing: 1.4 }}>EXEMPLO ILUSTRATIVO</div>
    </div>;
  }
  if (mode === "savings" && !leisure) {
    const panel = portrait ? { left: .05, top: .19, width: .90, height: .37 }
      : { left: presenter && side === "left" ? .38 : .02, top: .23, width: presenter ? .60 : .94, height: .57 };
    const canvasWidth = Math.round(video.width * panel.width), canvasHeight = Math.round(video.height * panel.height);
    return <div data-qa="appliance-savings-3d" style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", left: `${panel.left * 100}%`, top: `${panel.top * 100}%`, width: canvasWidth, height: canvasHeight }}>
        <ThreeCanvas width={canvasWidth} height={canvasHeight} camera={{ position: [6.5, 6, 11], fov: 31, near: .1, far: 100 }} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }} style={{ width: "100%", height: "100%" }}>
          <ambientLight intensity={1.05} /><directionalLight position={[4, 9, 6]} intensity={2} />
          <mesh position={[0, -.12, 0]}><boxGeometry args={[8, .24, 4.3]} /><meshStandardMaterial color="#163943" roughness={.8} /></mesh>
          <group position={[-2.45, 1.35, 0]}><mesh><boxGeometry args={[1.25, 2.7, 1.15]} /><meshStandardMaterial color="#c4deda" roughness={.5} metalness={.1} /></mesh>
            <mesh position={[0, -.7, .6]}><boxGeometry args={[1.15, .07, .04]} /><meshStandardMaterial color="#527b7b" /></mesh>
            <mesh position={[-.43, .6, .62]}><boxGeometry args={[.07, .62, .07]} /><meshStandardMaterial color="#4e7378" /></mesh></group>
          <group position={[0, 1.15, 0]}><mesh><boxGeometry args={[1.32, 2.25, .14]} /><meshStandardMaterial color="#e2eeea" roughness={.65} /></mesh>
            <mesh position={[0, .35, .09]}><boxGeometry args={[.8, .07, .04]} /><meshStandardMaterial color="#729398" /></mesh>
            <mesh position={[-.09, -.08, .1]} rotation={[0, 0, -.42]}><boxGeometry args={[.13, .7, .05]} /><meshStandardMaterial color="#e6b350" /></mesh>
            <mesh position={[.09, -.44, .1]} rotation={[0, 0, -.42]}><boxGeometry args={[.13, .7, .05]} /><meshStandardMaterial color="#e6b350" /></mesh></group>
          <group position={[2.35 - (1 - progress) * .35, .85, 0]}><mesh><boxGeometry args={[1.65, 1.2, .7]} /><meshStandardMaterial color="#416a6c" roughness={.6} /></mesh>
            <mesh position={[.3, 0, .37]}><boxGeometry args={[.9, .35, .08]} /><meshStandardMaterial color="#76a9a2" /></mesh></group>
          {Array.from({ length: 8 }, (_, index) => <mesh key={index} position={[-1.65 + index * .48, .08, .5]} visible={index / 7 <= progress}>
            <sphereGeometry args={[.07, 8, 6]} /><meshStandardMaterial color={accent} emissive="#245c55" />
          </mesh>)}
        </ThreeCanvas>
      </div>
      <div style={{ position: "absolute", top: portrait ? "55%" : "79%", left: `${panel.left * 100}%`, width: canvasWidth, textAlign: "center", color: "#b7cac9", fontSize: portrait ? 17 : 15, letterSpacing: 1.4 }}>REPRESENTAÇÃO ILUSTRATIVA</div>
    </div>;
  }
  return <svg data-qa="appliance-exchange" width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
    <g transform={`translate(${centerX} ${centerY}) scale(${scale})`}>
      <rect x="-220" y="-127" width="440" height="254" rx="19" fill="#12313c" stroke="#41626a" strokeWidth="2" />
      <path d="M-200 86H200" stroke="#709197" strokeWidth="3" opacity=".6" />
      {mode === "family" || mode === "forecast" || leisure ? <>
        <g transform="translate(-120 0) scale(.86)">{fridge(0, false)}</g>
        <g transform="translate(45 0)"><circle cx="-30" cy="-42" r="17" fill="#e3c9ae" /><path d="M-63 44Q-63 -18 -30 -18Q3 -18 3 44Z" fill="#6d8bb3" stroke={accent} strokeWidth="3" />
          <circle cx="44" cy="-35" r="15" fill="#d1aa87" /><path d="M15 44Q15 -14 44 -14Q73 -14 73 44Z" fill="#b98b5c" stroke={accent} strokeWidth="3" /></g>
      </> : <>
        <g transform={`translate(-128 0) scale(.86)`}>{mode === "savings" ? fridge(0, false) : oldUnit ? fridge(0, true) : document(0, "≡")}</g>
        <g transform={`translate(${15 + progress * 12} 0) scale(.86)`}>{document(0, "⚡")}</g>
        <g transform={`translate(${143 - (1 - progress) * 22} 12)`} opacity={.4 + .6 * progress}>
          {mode === "savings" ? <><rect x="-45" y="-36" width="90" height="70" rx="9" fill="#35616a" stroke={accent} strokeWidth="4" /><path d="M12 -5H47V16H12Z" fill="#527b7c" stroke={accent} strokeWidth="4" /><circle cx="24" cy="5" r="3" fill="#e2efea" /></>
            : <><circle cy="-41" r="17" fill="#d5e4df" /><path d="M-36 36Q-36 -17 0 -17Q36 -17 36 36Z" fill="#4d7d7e" stroke={accent} strokeWidth="4" /></>}
        </g>
      </>}
      {forecastLabel && <text x="0" y="-96" fill="#f4f4e9" fontFamily="Arial, sans-serif" fontSize="17" fontWeight="700" textAnchor="middle">{forecastLabel}</text>}
      <text x="0" y="159" fill="#b7cac9" fontFamily="Arial, sans-serif" fontSize="11" letterSpacing="1.5" textAnchor="middle">REPRESENTAÇÃO ILUSTRATIVA</text>
    </g>
  </svg>;
};
