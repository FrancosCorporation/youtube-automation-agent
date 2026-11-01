import React from "react";
import { interpolate } from "remotion";

type Sentence = { startFrame: number; endFrame: number; wordTimings?: Array<{ text: string; startFrame: number }> };
type Mode = "efficiency" | "budget" | "closing";

const Fridge: React.FC<{ accent: string }> = ({ accent }) => <g strokeLinejoin="round"><rect x="-37" y="-72" width="74" height="144" rx="8" fill="#d5e8e3" stroke={accent} strokeWidth="4" /><path d="M-37 -18H37M-23 -58V-33M-23 -6V18" fill="none" stroke="#3c666d" strokeWidth="5" strokeLinecap="round" /></g>;
const Coin: React.FC<{ accent: string }> = ({ accent }) => <g><circle r="36" fill="#315b5b" stroke={accent} strokeWidth="4" /><text y="15" textAnchor="middle" fill="#e8f3e8" fontSize="42" fontWeight="700">$</text></g>;
const Bill: React.FC<{ accent: string }> = ({ accent }) => <g strokeLinejoin="round"><path d="M-37 -65H21L38 -48V65H-37Z" fill="#e1eee9" stroke={accent} strokeWidth="4" /><path d="M21 -65V-48H38M-24 -36H15M-24 -24H5M-24 41H19" fill="none" stroke="#557a7b" strokeWidth="4" /><path d="M5 -12L-8 12H2L-2 31L19 4H7L14 -12Z" fill="#dfac4f" /></g>;
const Wallet: React.FC<{ accent: string }> = ({ accent }) => <g strokeLinejoin="round"><rect x="-50" y="-35" width="100" height="72" rx="10" fill="#315c61" stroke={accent} strokeWidth="4" /><path d="M12 -7H50V17H12Q3 17 3 5Q3 -7 12 -7Z" fill="#709992" stroke={accent} strokeWidth="3" /><circle cx="20" cy="5" r="3" fill="#edf5e9" /></g>;
const Home: React.FC<{ accent: string }> = ({ accent }) => <g strokeLinejoin="round"><path d="M-54 -8L0 -55L54 -8M-43 -9V50H43V-9" fill="#315665" stroke={accent} strokeWidth="4" /><path d="M-10 50V15H10V50M-32 4H-20M20 4H32" fill="none" stroke="#e3eee8" strokeWidth="4" /></g>;
const Family: React.FC<{ accent: string }> = ({ accent }) => <g stroke={accent} strokeWidth="3"><circle cx="-26" cy="-29" r="13" fill="#d7b89c" /><circle cx="27" cy="-29" r="13" fill="#caa687" /><circle cy="-5" r="10" fill="#e0c3a7" /><path d="M-48 38Q-48 -12 -26 -12T-4 38M5 38Q5 -12 27 -12T49 38M-17 45Q-17 8 0 8T17 45Z" fill="#5d8190" /></g>;
const Calendar: React.FC<{ accent: string }> = ({ accent }) => <g strokeLinejoin="round"><rect x="-45" y="-49" width="90" height="94" rx="9" fill="#d8e9e3" stroke={accent} strokeWidth="4" /><path d="M-45 -21H45M-22 -57V-39M22 -57V-39M-27 -7H-13M3 -7H17M-27 12H-13M3 12H17" fill="none" stroke="#4b7376" strokeWidth="4" strokeLinecap="round" /></g>;

export const NarrativeSavingsFlow: React.FC<{ sentence: Sentence; frame: number; portrait: boolean; side: "left" | "right"; accent: string; mode: Mode }> = ({ sentence, frame, portrait, side, accent, mode }) => {
  const cue = (...prefixes: string[]) => sentence.wordTimings?.find(word => prefixes.some(prefix => word.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().startsWith(prefix)))?.startFrame;
  const progress = (start: number | undefined) => start === undefined ? 0 : interpolate(frame, [start, start + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const present = (start: number | undefined) => start === undefined ? 0 : interpolate(frame, [start, start + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const money = cue("dinheiro", "economia"), equipment = cue("equipamento"), efficient = cue("eficiente");
  const family = cue("familias"), energy = cue("energia"), possible = cue("pode"), expenses = cue("despesas"), calm = cue("tranquilidade"), month = cue("mes");
  const first = mode === "efficiency" ? equipment : mode === "budget" ? energy : calm;
  const middle = mode === "efficiency" ? money : mode === "budget" ? money : calm;
  const last = mode === "efficiency" ? family : mode === "budget" ? expenses : month;
  const firstFlow = progress(mode === "efficiency" ? efficient : mode === "budget" ? energy : month);
  const secondFlow = progress(mode === "efficiency" ? family : mode === "budget" ? expenses : undefined);
  const label = (x: number, text: string) => <text x={x} y="277" textAnchor="middle" fill="#e9f2e9" fontSize="16" fontWeight="700" fontFamily="Arial, sans-serif">{text}</text>;
  const wire = (from: number, to: number, amount: number) => <g opacity={amount > 0 ? 1 : 0}><path d={`M${from} 160H${to}`} pathLength="1" stroke={accent} strokeWidth="4" fill="none" strokeDasharray="1" strokeDashoffset={1-amount} /><circle cx={from+(to-from)*amount} cy="160" r="6" fill={accent} /></g>;
  return <div data-qa={`appliance-savings-${mode}`} style={{ position: "absolute", left: portrait ? "5%" : side === "left" ? "38%" : "2%", top: portrait ? "19%" : "23%", width: portrait ? "90%" : "60%", height: portrait ? "37%" : "57%" }}>
    <svg viewBox="0 0 600 340" width="100%" height="100%" role="img" aria-label="Sequência ilustrativa da economia narrada">
      {mode !== "closing" && wire(166, 232, firstFlow)}{mode !== "closing" && wire(368, 434, secondFlow)}
      {mode === "closing" && wire(225, 375, firstFlow)}
      <g transform={`translate(${mode === "closing" ? 170 : 100} 160)`} opacity={present(first)}>{mode === "efficiency" ? <Fridge accent={accent} /> : mode === "budget" ? <Bill accent={accent} /> : <Wallet accent={accent} />}</g>
      {mode !== "closing" && <g transform="translate(300 160)" opacity={present(middle)}>{mode === "efficiency" ? <Coin accent={accent} /> : <Wallet accent={accent} />}</g>}
      <g transform={`translate(${mode === "closing" ? 430 : 500} 160)`} opacity={present(last)}>{mode === "efficiency" ? <Family accent={accent} /> : mode === "budget" ? <Home accent={accent} /> : <Calendar accent={accent} />}</g>
      <g opacity={present(first)}>{label(mode === "closing" ? 170 : 100, mode === "efficiency" ? "EQUIPAMENTO" : mode === "budget" ? "CONTA DE ENERGIA" : "TRANQUILIDADE")}</g>
      {mode !== "closing" && <g opacity={present(middle)}>{label(300, mode === "efficiency" ? "ECONOMIA" : "DINHEIRO")}</g>}
      <g opacity={present(last)}>{label(mode === "closing" ? 430 : 500, mode === "efficiency" ? "FAMÍLIAS" : mode === "budget" ? "DESPESAS DA CASA" : "CONTAS DO MÊS")}</g>
      {mode !== "closing" && <text x="400" y="106" textAnchor="middle" fill="#f2d7a5" fontSize="15" fontWeight="700" fontFamily="Arial, sans-serif" opacity={present(possible)}>PODE AJUDAR</text>}
      {mode === "budget" && <text x="200" y="106" textAnchor="middle" fill="#b7cac9" fontSize="14" fontWeight="700" fontFamily="Arial, sans-serif" opacity={present(energy)}>MENOS GASTO</text>}
      <text x="300" y="325" textAnchor="middle" fill="#b7cac9" fontSize="11" letterSpacing="1.4" fontFamily="Arial, sans-serif">REPRESENTAÇÃO ILUSTRATIVA</text>
    </svg>
  </div>;
};
