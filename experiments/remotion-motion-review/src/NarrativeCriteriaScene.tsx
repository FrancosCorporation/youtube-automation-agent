import React from "react";
import { interpolate } from "remotion";
import { applianceCriteriaMilestones } from "../../../utils/narrative-appliance-scene.js";

type Sentence = { text: string; startFrame: number; endFrame: number; wordTimings?: Array<{ text: string; startFrame: number; endFrame: number }> };

const Icon: React.FC<{ type: string; accent: string }> = ({ type, accent }) => <g fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
  {type === "person" ? <><circle cx="0" cy="-11" r="9" /><path d="M-17 20c1-14 7-20 17-20s16 6 17 20z" /></>
    : type === "calendar" ? <><rect x="-19" y="-17" width="38" height="38" rx="4" /><path d="M-19-6h38M-10-22v10M10-22v10M-10 3h5M5 3h5M-10 12h5M5 12h5" /></>
    : type === "fridge" ? <><rect x="-16" y="-24" width="32" height="48" rx="4" /><path d="M-16-4h32M-8-17v7M-8 2v9" /></>
    : <><path d="M-17-22h25l9 9v35h-34zM8-22v9h9" />{type === "energy" ? <path d="M2-8l-9 14h8l-3 11L8 2H0z" /> : <path d="M-9-8h16M-9 0h16M-9 8h12" />}</>}
</g>;

function lines(label: string): string[] {
  const result: string[] = [];
  for (const word of label.split(" ")) {
    const last = result.length - 1;
    if (last < 0 || `${result[last]} ${word}`.length > 18) result.push(word);
    else result[last] += ` ${word}`;
  }
  return result;
}

export const NarrativeCriteriaScene: React.FC<{ sentence: Sentence; frame: number; portrait: boolean; side: "left" | "right"; accent: string }> = ({ sentence, frame, portrait, side, accent }) => {
  const milestones = applianceCriteriaMilestones(sentence).slice(0, 4);
  const left = portrait ? "5%" : side === "left" ? "38%" : "2%";
  const wide = milestones.length === 1;
  return <div data-qa="appliance-criteria-timed" style={{ position: "absolute", left, top: portrait ? "20%" : "24%", width: portrait ? "90%" : "60%", height: portrait ? "36%" : "54%" }}>
    <svg viewBox="0 0 600 340" width="100%" height="100%" role="img" aria-label="Condições mencionadas na narração">
      <rect x="4" y="4" width="592" height="332" rx="22" fill="#102e38" stroke="#3d6066" strokeWidth="2" />
      <text x="28" y="39" fill="#aac5c1" fontSize="15" letterSpacing="2" fontFamily="Arial, sans-serif">CONDIÇÕES MENCIONADAS</text>
      <path d="M28 53H572" stroke="#41656a" strokeWidth="1" />
      <g opacity={1 - interpolate(frame, [milestones[0].startFrame, milestones[0].startFrame + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}>
        {["person", "bill", "calendar"].map((type, index) => <g key={type} transform={`translate(${190 + index * 110} 155)`}>
          <circle r="39" fill="#193e46" stroke="#41656a" strokeWidth="1" /><Icon type={type} accent={accent} />
        </g>)}
        <text x="300" y="235" fill="#aac5c1" fontSize="16" letterSpacing="1" textAnchor="middle" fontFamily="Arial, sans-serif">CONDIÇÕES DO PROGRAMA</text>
      </g>
      {milestones.map((item, index) => {
        const appear = interpolate(frame, [item.startFrame, item.startFrame + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const x = 25 + (wide ? 0 : index % 2 * 280), y = 69 + Math.floor(index / 2) * 117;
        const cardWidth = wide ? 550 : 270;
        const labelLines = lines(item.label);
        return <g key={`${item.startFrame}-${item.label}`} opacity={appear} transform={`translate(${x} ${y + (1 - appear) * 10})`}>
          <rect width={cardWidth} height="104" rx="12" fill="#183d45" stroke="#476e70" strokeWidth="1.5" />
          <circle cx="41" cy="52" r="28" fill="#234d53" />
          <g transform="translate(41 52)"><Icon type={item.icon} accent={accent} /></g>
          <text x="80" y={56 - (labelLines.length - 1) * 11} fill="#edf4ee" fontFamily="Arial, sans-serif" fontSize="19" fontWeight="700">
            {labelLines.map((line, lineIndex) => <tspan x="80" dy={lineIndex ? 22 : 0} key={line}>{line}</tspan>)}
          </text>
        </g>;
      })}
      <text x="300" y="320" fill="#a3bfba" fontSize="11" letterSpacing="1.3" textAnchor="middle" fontFamily="Arial, sans-serif">REPRESENTAÇÃO ILUSTRATIVA</text>
    </svg>
  </div>;
};
