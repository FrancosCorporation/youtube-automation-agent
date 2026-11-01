import React from "react";
import { transitCueProgress } from "../../../utils/narrative-transit-scene.js";

type Sentence = { text: string; startFrame: number; endFrame: number; wordTimings?: Array<{ text: string; startFrame: number; endFrame: number }> };
type Props = { sentence: Sentence; frame: number; mode: "journey" | "gratitude" | "research"; portrait: boolean; presenter: boolean; side: "left" | "right"; accent: string };

// A reconstructed illustration, not documentary footage: the two people and
// bus give the narrated action a visible subject and recipient.
export const NarrativeTransitScene: React.FC<Props> = ({ sentence, frame, mode, portrait, presenter, side, accent }) => {
  const width = portrait ? 562.5 : 1000, height = portrait ? 1000 : 562.5;
  const left = portrait ? 48 : presenter && side === "left" ? 385 : 70;
  const right = portrait ? 515 : presenter && side === "right" ? 620 : 930;
  const cx = (left + right) / 2, cy = portrait ? 395 : 265;
  // Keep the full illustration between the headline and captions in 16:9.
  const scale = Math.min((right - left) / 510, portrait ? 0.92 : 0.9);
  const progress = transitCueProgress(sentence, frame, mode === "gratitude" ? ["agradec", "obrigad", "gratidao", "gentileza", "empatia", "respeito"] : ["onibus", "passageir", "motorist", "estudo", "pesquisa"]);
  const drift = 0;
  const bubble = Math.max(0, Math.min(1, (progress - .12) * 4));
  const explicitThanks = /\b(?:agradec\w*|obrigad[oa])\b/i.test(sentence.text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  return <svg data-qa="transit-story" data-beat={mode} width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
    <g transform={`translate(${cx} ${cy}) scale(${scale})`}>
      <ellipse cx="0" cy="148" rx="228" ry="17" fill="#020e16" opacity=".6" />
      <g transform={`translate(${mode === "journey" ? drift : 0} 0)`}>
        <rect x="-220" y="-116" width="440" height="225" rx="26" fill="#173e4d" stroke={accent} strokeWidth="5" />
        <rect x="-202" y="-96" width="320" height="122" rx="13" fill="#285b66" />
        <path d="M-93 -96V26M20 -96V26" stroke="#a8d7ce" strokeWidth="5" opacity=".65" />
        <path d="M131 -96H193Q204 -96 204 -84V86H131Z" fill="#0e2d39" stroke="#a8d7ce" strokeWidth="4" />
        <path d="M-204 42H119" stroke="#f2c887" strokeWidth="7" opacity=".8" />
        <circle cx="-144" cy="113" r="27" fill="#081923" stroke="#a8d7ce" strokeWidth="6" /><circle cx="152" cy="113" r="27" fill="#081923" stroke="#a8d7ce" strokeWidth="6" />
        <circle cx="-153" cy="-56" r="19" fill="#eac7a1" /><path d="M-181 5Q-180 -34 -153 -34Q-126 -34 -125 5Z" fill="#8b92d8" />
        <g transform={`translate(${mode === "gratitude" ? progress*20 : 0} 0)`}>
          <circle cx="-44" cy="-53" r="19" fill="#dca988" /><path d="M-72 7Q-69 -32 -44 -32Q-18 -32 -16 7Z" fill="#80c6b5" />
          {mode === "gratitude" && <path d={`M-22 -20Q${-5+progress*10} -23 ${-2+progress*32} ${-8-progress*18}`} fill="none" stroke="#dca988" strokeWidth="9" strokeLinecap="round" />}
        </g>
        <circle cx="149" cy="-53" r="19" fill="#dfb796" /><path d="M121 14Q121 -31 149 -31Q176 -31 177 14Z" fill="#f1c981" />
        {mode === "gratitude" && <path d={`M133 -14Q${125-progress*12} -22 ${121-progress*20} ${-8-progress*20}`} fill="none" stroke="#dfb796" strokeWidth="8" strokeLinecap="round" />}
        <circle cx="179" cy="1" r="18" fill="none" stroke="#e5f1e9" strokeWidth="4" /><path d="M161 1H197M179 -17V19" stroke="#e5f1e9" strokeWidth="3" />
        {mode === "journey" && <g transform={`translate(${-43+progress*5} -6) rotate(${-12+progress*12})`}><rect x="-11" y="-15" width="22" height="31" rx="4" fill="#f2f1e8" /><rect x="-8" y="-11" width="16" height="21" rx="2" fill="#234955" /></g>}
      </g>
      {mode === "gratitude" && explicitThanks && <g opacity={bubble} transform={`translate(${15+progress*15} ${-136-progress*7}) scale(${.85+.15*bubble})`}>
        <path d="M-82 -30Q-82 -45 -67 -45H73Q88 -45 88 -30V4Q88 19 73 19H13L-3 32L-6 19H-67Q-82 19 -82 4Z" fill="#eff6eb" />
        <text x="3" y="-4" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="23" fill="#123b42">obrigado</text>
      </g>}
      {mode === "research" && <g transform={`translate(${40+progress*20} ${-140-progress*8})`} opacity={.4+.6*progress}>
        <rect x="-74" y="-42" width="148" height="82" rx="9" fill="#edf4ec" /><path d="M-53 -20H53M-53 -3H30M-53 14H45" stroke="#365f65" strokeWidth="5" strokeLinecap="round" />
      </g>}
      <text x="0" y="179" fill="#b7cac9" fontSize="13" letterSpacing="2" textAnchor="middle">CENA ILUSTRATIVA</text>
    </g>
  </svg>;
};
