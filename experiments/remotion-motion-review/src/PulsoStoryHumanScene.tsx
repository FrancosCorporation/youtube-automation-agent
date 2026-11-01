import { AbsoluteFill, Easing, Img, interpolate, staticFile } from "remotion";

const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const reveal = (frame: number, from: number, to: number) => interpolate(frame, [from, to], [0, 1], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) });

type Props = { frame: number; start: number; cue: { human: number; attributed: number; model: number; source: number } };

/** The person is the message's claimed sender, never evidence of a real identified person. */
export const HumanMessageScene: React.FC<Props> = ({ frame, start, cue }) => {
  const entry = reveal(frame, start, start + 14);
  const claim = reveal(frame, cue.human - 4, cue.human + 12);
  const origin = reveal(frame, cue.attributed, cue.attributed + 24);
  const source = reveal(frame, cue.source, cue.source + 10);
  const focus = reveal(frame, cue.model, cue.model + 18);
  const messageLines = [390, 345, 420];
  return (
    <AbsoluteFill style={{ opacity: entry }}>
      <div style={{ position: "absolute", left: 500, top: 365, width: 670, height: 570, borderRadius: "50%", background: "radial-gradient(ellipse,rgba(139,203,185,.14),transparent 65%)" }} />
      <div style={{ position: "absolute", left: 525 - origin * 14, top: 345, width: 650, height: 590, opacity: 1 - origin * 0.35, transform: `scale(${1 - origin * 0.025})`, transformOrigin: "50% 80%" }}>
        <Img src={staticFile("pulso-story/human-sender-v1.png")} style={{ width: "100%", height: "100%", objectFit: "contain", filter: "drop-shadow(0 20px 24px rgba(0,0,0,.28))" }} />
        <svg viewBox="0 0 1280 1280" width="100%" height="100%" style={{ position: "absolute", inset: 0 }} aria-hidden>
          <g opacity={claim}>
            <path d="M859 385L974 406 M849 413L960 434 M838 440L947 460 M827 466L903 480" fill="none" stroke="#729b8d" strokeWidth="5" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - claim} />
            <path d="M900 480L909 482" stroke="#315e51" strokeWidth="6" strokeLinecap="round" />
          </g>
        </svg>
      </div>
      <svg width="1920" height="1080" viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0 }} aria-hidden>
        <defs>
          <linearGradient id="human-email-paper" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f5f4e9" /><stop offset="1" stopColor="#dfe7d9" /></linearGradient>
          <linearGradient id="human-chip-metal" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#477b70" /><stop offset=".45" stopColor="#214e49" /><stop offset="1" stopColor="#102b2b" /></linearGradient>
          <linearGradient id="human-chip-rim" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#b1dfcf" /><stop offset="1" stopColor="#4b8f7d" /></linearGradient>
          <filter id="human-panel-shadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="18" stdDeviation="18" floodColor="#000" floodOpacity=".23" /></filter>
        </defs>
        {/* The message expands out of the laptop's screen into readable evidence. */}
        <path d="M1000 548 C1060 548 1085 490 1160 490" fill="none" stroke="#8bcbb9" strokeWidth="2" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - claim} opacity={claim * (1 - origin * .5)} />
        <circle cx="1000" cy="548" r="5" fill="#8bcbb9" opacity={claim} />
        <g transform={`translate(${(1 - entry) * -40} ${(1 - entry) * 18})`}>
          <g filter="url(#human-panel-shadow)">
            <rect x="1160" y="370" width="650" height="355" rx="20" fill="url(#human-email-paper)" />
            <path d="M1180 370H1790Q1810 370 1810 390V426H1160V390Q1160 370 1180 370" fill="#21433f" />
          </g>
          <path d="M1192 391h24v17h-24z M1192 391l12 9 12-9" fill="none" stroke="#b2d9c9" strokeWidth="2" strokeLinejoin="round" />
          <text x="1235" y="405" fill="#efefe4" fontSize="20" fontWeight="700">A mensagem recebida</text>
          <circle cx="1774" cy="398" r="4" fill="#91cdb9" />
          <text x="1198" y="466" fill="#5e756c" fontSize="14" letterSpacing="1.5" fontWeight="700">O QUE ELA ALEGAVA</text>
          <text x="1198" y="511" fill="#153a35" fontSize="27" fontWeight="700" opacity={claim}>Vir de uma pessoa com</text>
          <text x="1198" y="547" fill="#153a35" fontSize="27" fontWeight="700" opacity={claim}>informações sobre o caso.</text>
          {messageLines.map((width, index) => <rect key={index} x="1198" y={576 + index * 20} width={width * reveal(frame, start + 8 + index * 6, start + 24 + index * 6)} height="5" rx="2.5" fill="#a2b5a7" opacity=".7" />)}
          <path d="M1198 643H1772" stroke="#c7d1c1" />
          <circle cx="1207" cy="678" r="6" fill={origin > .5 ? "#bd8351" : "#5b9e88"} />
          <text x="1224" y="684" fill="#566e61" fontSize="16" fontWeight="700">{origin > .5 ? "AUTORIA ATRIBUÍDA A UM MODELO DE IA" : "REMETENTE DECLARADO · PESSOA"}</text>
        </g>
        {/* A causal reveal: origin feeds the same message, not a disconnected AI icon. */}
        <g opacity={origin}>
          <path d="M1330 819H1435Q1465 819 1465 790V725" fill="none" stroke="#e6aa70" strokeWidth="3" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - origin} />
          <circle cx="1465" cy="725" r="6" fill="#e6aa70" />
          <g transform={`translate(1235 818) scale(${.88 + origin * .12 + focus * .03}) translate(-1235 -818)`}>
            {Array.from({ length: 5 }, (_, index) => <g key={index} stroke="#9dc7b5" strokeWidth="5" strokeLinecap="round"><path d={`M${1174 + index * 28} 752v14 M${1174 + index * 28} 871v14`} /><path d={`M1140 ${777 + index * 20}h17 M1312 ${777 + index * 20}h17`} /></g>)}
            <rect x="1154" y="764" width="160" height="109" rx="18" fill="url(#human-chip-metal)" stroke="url(#human-chip-rim)" strokeWidth="3" />
            <rect x="1168" y="778" width="132" height="82" rx="10" fill="#102f2d" stroke="#47796d" />
            <text x="1234" y="832" textAnchor="middle" fill="#dbeddf" fontSize="35" fontWeight="700" letterSpacing="2">LLM</text>
          </g>
          <text x="1500" y="800" fill="#91cdb9" fontSize="15" letterSpacing="2" fontWeight="700">ORIGEM ATRIBUÍDA</text>
          <text x="1500" y="842" fill="#efefe4" fontSize="30" fontWeight="700">{source > .3 ? "Anthropic" : "Modelo de IA"}</text>
        </g>
        <text x="670" y="919" fill="#91a99e" fontSize="13" letterSpacing="1.7" opacity={claim}>REMETENTE ALEGADO · ILUSTRAÇÃO</text>
      </svg>
    </AbsoluteFill>
  );
};
