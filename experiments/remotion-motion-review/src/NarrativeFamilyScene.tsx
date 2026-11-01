import React from "react";
import { interpolate } from "remotion";

type Details = { first: string; firstAge: string; second: string; secondAge: string; firstFrame: number; firstAgeFrame: number; secondFrame: number; secondAgeFrame: number; benefitFrame: number; exchangeFrame: number };

export const NarrativeFamilyScene: React.FC<{ details: Details; frame: number; portrait: boolean; side: "left" | "right"; accent: string }> = ({ details, frame, portrait, side, accent }) => {
  const show = (start: number) => interpolate(frame, [start, start + 9], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const progress = interpolate(frame, [details.exchangeFrame, details.exchangeFrame + 25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const person = (x: number, color: string) => <g transform={`translate(${x} 146)`} stroke={accent} strokeWidth="3"><circle cy="-41" r="23" fill="#d7b79b" /><path d="M-41 47Q-41 -13 0 -13T41 47Z" fill={color} /></g>;
  const caption = (x: number, name: string, age: string, nameFrame: number, ageFrame: number) => <g opacity={show(nameFrame)}>
    <text x={x} y="238" fill="#eff4ed" fontSize="19" textAnchor="middle" fontWeight="700" fontFamily="Arial, sans-serif">{name}</text>
    <text x={x} y="264" fill="#c6d8d3" fontSize="17" textAnchor="middle" fontFamily="Arial, sans-serif" opacity={show(ageFrame)}>{age} anos</text>
  </g>;
  return <div data-qa="appliance-family-narrative" style={{ position: "absolute", left: portrait ? "5%" : side === "left" ? "38%" : "2%", top: portrait ? "19%" : "23%", width: portrait ? "90%" : "60%", height: portrait ? "37%" : "57%" }}>
    <svg viewBox="0 0 600 340" width="100%" height="100%" role="img" aria-label="Pessoas mencionadas como beneficiárias">
      <g opacity={show(details.firstFrame)}>{person(115, "#6b8ca5")}</g>
      <g opacity={show(details.secondFrame)}>{person(310, "#b78e6c")}</g>
      {caption(115, details.first, details.firstAge, details.firstFrame, details.firstAgeFrame)}
      {caption(310, details.second, details.secondAge, details.secondFrame, details.secondAgeFrame)}
      <text x="213" y="52" fill="#f1d7aa" fontSize="16" textAnchor="middle" fontWeight="700" fontFamily="Arial, sans-serif" opacity={show(details.benefitFrame)}>BENEFICIADOS</text>
      <g transform="translate(500 145)" opacity={show(details.exchangeFrame)}><rect x="-31" y="-67" width="62" height="134" rx="8" fill="#d9eae5" stroke={accent} strokeWidth="4" /><path d="M-31 -17H31M-19 -52V-32M-19 -5V15" fill="none" stroke="#426c70" strokeWidth="4" strokeLinecap="round" /></g>
      <g opacity={progress > 0 ? 1 : 0}><path d="M447 147H365" pathLength="1" stroke={accent} strokeWidth="4" strokeDasharray="1" strokeDashoffset={1-progress} /><circle cx={447-82*progress} cy="147" r="5" fill={accent} /></g>
      <text x="300" y="320" fill="#b7cac9" fontSize="11" textAnchor="middle" letterSpacing="1.4" fontFamily="Arial, sans-serif">REPRESENTAÇÃO ILUSTRATIVA</text>
    </svg>
  </div>;
};
