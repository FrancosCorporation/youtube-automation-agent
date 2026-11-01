import React from "react";
import { Easing, interpolate } from "remotion";
import type { DirectedBeat, DirectedEntity, DirectedSentence, DirectedSource } from "../../../utils/narrative-direction.js";

const paper = "#f3eee0", mint = "#95d7bc", ink = "#163b3e", amber = "#ecb47e";
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const progress = (frame: number, start: number, end: number) => interpolate(frame, [start, Math.max(start + .001, end)], [0, 1], { ...clamp, easing: Easing.bezier(.4, 0, .2, 1) });

const Envelope: React.FC<{ opened?: number }> = ({ opened = 0 }) => <g>
  <rect x="-105" y="-65" width="210" height="138" rx="14" fill="#071b21" opacity=".22" transform="translate(0 12)" />
  <rect x="-105" y="-75" width="210" height="138" rx="12" fill={paper} stroke="#c4c6b5" strokeWidth="2" />
  <path d="M-104-70L0 8L104-70" fill="#d8e6d5" stroke="#8eafa4" strokeWidth="3" />
  <path d="M-102 59L-30-2M102 59L30-2" fill="none" stroke="#b3c6b6" strokeWidth="3" />
  <circle cx="76" cy="48" r={23 * opened} fill={mint} />
  {opened > .8 && <path d="M65 48l8 8 15-17" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" />}
</g>;

const Screen: React.FC<{ fill: number; received?: number; intrusion?: boolean }> = ({ fill, received = 0, intrusion }) => <g>
  <rect x="-146" y="-99" width="292" height="174" rx="7" fill="#e9eddf" />
  <path d="M-146-92q0-7 7-7h278q7 0 7 7v22h-292z" fill="#c5d5c8" />
  {[0, 1, 2].map(i => <circle key={i} cx={-131 + i * 12} cy="-84" r="3.5" fill={i ? "#88aa9a" : "#e7aa80"} />)}
  <rect x="-82" y="-91" width="156" height="12" rx="4" fill="#edf2e8" />
  <rect x="-133" y="-57" width="49" height="116" rx="4" fill="#d7e2d4" />
  {[0, 1, 2, 3].map(i => <rect key={i} x="-126" y={-45 + i * 21} width={i === 0 ? 31 : 24} height="5" rx="2" fill={i === 0 ? "#527b70" : "#9ab5a5"} />)}
  <rect x="-70" y="-56" width="200" height="115" rx="5" fill="#fffdf4" />
  {intrusion ? <g transform="translate(28 2)">
    <path d="M-17-8v-16a17 17 0 0 1 34 0v16" stroke="#567c72" strokeWidth="7" fill="none" />
    <rect x="-29" y="-10" width="58" height="48" rx="9" fill={amber} /><circle cy="9" r="5" fill={ink} /><path d="M0 10v12" stroke={ink} strokeWidth="4" />
    <circle r="48" fill="none" stroke="#9ec7af" strokeWidth="3" strokeDasharray={`${Math.max(.01, fill) * 302} 302`} transform="rotate(-90)" />
  </g> : <g>
    <rect x="-55" y="-42" width="95" height="7" rx="3" fill="#49796b" />
    {[0, 1, 2].map(i => <rect key={i} x="-55" y={-17 + i * 17} width={Math.max(0, Math.min(1, fill * 3 - i)) * (i === 2 ? 98 : 166)} height="5" rx="2" fill="#b1c6b6" />)}
    <rect x="85" y="40" width="34" height="12" rx="4" fill={mint} />
  </g>}
  {received > 0 && <g transform={`translate(27 0) scale(${.5 * received})`}><Envelope opened={received} /></g>}
</g>;

const Laptop: React.FC<{ fill: number; received?: number; intrusion?: boolean; desktop?: boolean }> = ({ fill, received, intrusion, desktop }) => <g>
  <ellipse cy={desktop ? 140 : 117} rx="192" ry="23" fill="#03191e" opacity=".35" />
  <rect x="-161" y="-115" width="322" height="207" rx="14" fill="url(#direct-metal)" stroke="#72978f" strokeWidth="2" />
  <rect x="-153" y="-107" width="306" height="190" rx="8" fill="#183b3d" />
  <circle cy="-111" r="2" fill="#b9d7c5" />
  <Screen fill={fill} received={received} intrusion={intrusion} />
  {desktop ? <g><path d="M-24 92l-6 40h60l-6-40" fill="url(#direct-metal)" /><path d="M-70 140l24-12h92l24 12z" fill="#9fb9b0" /></g>
    : <g><path d="M-161 92h322l33 32q0 8-12 8h-364q-12 0-12-8z" fill="url(#direct-metal)" stroke="#799c95" strokeWidth="2" />
      {Array.from({ length: 3 }, (_, row) => Array.from({ length: 14 }, (_, col) => <rect key={`${row}-${col}`} x={-141 + col * 21 - row * 3} y={97 + row * 7} width="16" height="4" rx="1" fill="#284d4e" opacity=".8" />))}
      <path d="M-29 119h58l7 7h-72z" fill="#aec4b9" /><path d="M-193 124h386" stroke="#c5d6c7" strokeWidth="2" />
    </g>}
</g>;

const Person: React.FC<{ typing?: number; frame: number }> = ({ typing = 0, frame }) => {
  const tap = Math.sin(frame * .95) * 3 * typing;
  return <g>
    <ellipse cx="-12" cy="205" rx="89" ry="15" fill="#03191e" opacity=".25" />
    <path d="M-60 82v103M19 84v101" stroke="#587f78" strokeWidth="10" /><rect x="-80" y="20" width="109" height="88" rx="18" fill="#365e5b" />
    <path d="M-35 95l73 11 14 82M-51 96l25 86" stroke="#253e4b" strokeWidth="27" strokeLinecap="round" fill="none" />
    <path d="M40 188h35M-34 188h32" stroke="#d2d6c3" strokeWidth="16" strokeLinecap="round" />
    <path d="M-65 93q-9-65 9-103l39-15q45 18 48 106z" fill="url(#direct-shirt)" stroke="#75af9c" strokeWidth="2" />
    <path d="M-24-41v27" stroke="#d89b73" strokeWidth="23" />
    <path d="M-51-91q38-28 58 8l-1 26 11 11-15 7q-4 22-23 22-30-6-32-37z" fill="#e8b68f" />
    <path d="M-53-49q-17-41 0-56 36-25 62 12l-36-6-5 40z" fill="#263b3e" /><circle cx="-31" cy="-51" r="8" fill="#d89b73" />
    <path d="M-3-65h7" stroke="#263b3e" strokeWidth="3" strokeLinecap="round" />
    <path d={`M-42 10Q-5 54 43 ${48 + tap}L89 ${42 + tap}`} stroke="#8cc7ae" strokeWidth="23" strokeLinecap="round" fill="none" />
    <path d={`M89 ${42 + tap}l28 3`} stroke="#e8b68f" strokeWidth="12" strokeLinecap="round" />
    <path d={`M10 8Q22 32 60 ${29 - tap}L94 ${27 - tap}`} stroke="#a9d9bd" strokeWidth="16" strokeLinecap="round" fill="none" />
    <path d={`M94 ${27 - tap}l23 4`} stroke="#e8b68f" strokeWidth="10" strokeLinecap="round" />
  </g>;
};

const Prop: React.FC<{ entity: DirectedEntity; fill: number; frame: number; received?: number; desktop?: boolean }> = ({ entity, fill, frame, received, desktop }) => {
  switch (entity.visual) {
    case "computer": return <Laptop fill={fill} received={received} desktop={desktop} />;
    case "person": return <g transform="translate(0 -40)"><Person frame={frame} /></g>;
    case "envelope": return <Envelope opened={received} />;
    case "server": return <g>{[-80, -10, 60].map((y, i) => <g key={y}><rect x="-130" y={y} width="260" height="61" rx="9" fill="url(#direct-dark)" stroke="#76a093" strokeWidth="2" /><circle cx="100" cy={y + 30} r="6" fill={fill > i / 3 ? mint : "#456960"} />{[0, 1, 2, 3, 4, 5].map(k => <path key={k} d={`M${-110 + k * 15} ${y + 17}v26`} stroke="#557d73" strokeWidth="4" />)}</g>)}</g>;
    case "phone": return <g><rect x="-79" y="-151" width="158" height="302" rx="27" fill="url(#direct-metal)" stroke="#94b5a6" strokeWidth="3" /><rect x="-70" y="-142" width="140" height="282" rx="21" fill="#f0f0df" /><rect x="-29" y="-135" width="58" height="11" rx="6" fill={ink} /><rect x="-59" y="-88" width="118" height="74" rx="12" fill="#c2dfc6" /><g transform="translate(0 -48) scale(.38)"><Envelope opened={received} /></g>{[0, 1, 2].map(i => <rect key={i} x="-53" y={10 + i * 28} width={93 * Math.max(0, Math.min(1, fill * 3 - i))} height="9" rx="4" fill="#9abca7" />)}<path d="M-24 127h48" stroke="#668e7e" strokeWidth="4" strokeLinecap="round" /></g>;
    case "fridge": return <g><ellipse cy="171" rx="100" ry="16" fill="#03191e" opacity=".3" /><path d="M-96-156l20-13h171v317l-20 15h-171z" fill="#7f9d99" /><rect x="-96" y="-156" width="171" height="319" rx="14" fill="url(#direct-paper)" stroke="#b9c5b5" strokeWidth="2" /><path d="M-94-53h167" stroke="#74938d" strokeWidth="4" /><path d="M52-120v42M52-20v78" stroke="#698e87" strokeWidth="7" strokeLinecap="round" /><rect x="-72" y="-128" width="52" height="46" rx="3" fill="#d0ddc9" /><path d="M-65-116h35M-65-106h27" stroke="#8baf99" strokeWidth="4" /><path d="M-78 165v10M57 165v10" stroke="#425e58" strokeWidth="8" /></g>;
    case "parcel": return <g><path d="M-115-68l115-37 120 37v159L0 133-115 92z" fill="#c88c5d" /><path d="M-115-68L0-24 120-68 0-105z" fill="#e8bc87" /><path d="M0-24v157l120-42V-68z" fill="#b8784d" /><path d="M-20-99L95-59v43l-30 10v-43L-49-90" fill="#f1d5a7" /><rect x="-94" y="-20" width="67" height="58" rx="3" fill={paper} transform="skewY(19)" /><path d="M-84 8h44M-84 19h29" stroke="#96795d" strokeWidth="4" /></g>;
    case "wallet": return <g><path d="M-109-62q0-16 18-20l174-23v153h-192z" fill="#a07354" /><g transform={`translate(0 ${-22 * fill})`}><rect x="-73" y="-98" width="147" height="98" rx="5" fill="#b4d6ae" stroke="#62896b" strokeWidth="3" /><rect x="-62" y="-87" width="125" height="75" rx="6" fill="none" stroke="#7ea57c" strokeWidth="2" /><ellipse cy="-49" rx="22" ry="27" fill="#83b48a" /></g><rect x="-113" y="-55" width="226" height="140" rx="17" fill="#ad7c57" stroke="#d7a77a" strokeWidth="3" /><path d="M-100-40h198v110h-198z" stroke="#d3a57a" strokeWidth="2" strokeDasharray="4 5" fill="none" /><rect x="53" y="-5" width="74" height="45" rx="9" fill="#ce9b6a" /><circle cx="73" cy="17" r="6" fill="#f0d7a0" /></g>;
    case "building": return <g><path d="M-145-35L0-147 145-35" stroke="#a1baa8" strokeWidth="18" strokeLinejoin="round" fill="#345f58" /><path d="M-119-41v183h238V-41L0-130z" fill="#dfd9c1" /><rect x="-25" y="43" width="54" height="99" rx="4" fill="#48766a" />{[-79, 73].map(x => <g key={x}><rect x={x - 24} y="-13" width="48" height="58" rx="3" fill="#86b8a8" stroke="#eff0dc" strokeWidth="5" /><path d={`M${x}-13v58`} stroke="#eff0dc" strokeWidth="3" /></g>)}<path d="M-139 146h278" stroke="#709c87" strokeWidth="9" /></g>;
    default: return <g><path d="M-105-140H53l53 54v228h-211z" fill="url(#direct-paper)" stroke="#bdccba" strokeWidth="2" /><path d="M53-140v54h53" fill="#c3d7bf" />{[0, 1, 2, 3, 4, 5].map(i => <rect key={i} x="-79" y={-55 + i * 26} width={(i % 3 === 2 ? 100 : 155) * Math.max(0, Math.min(1, fill * 6 - i))} height="7" rx="3" fill={i ? "#a4bba4" : "#4d7969"} />)}</g>;
  }
};

const Label: React.FC<{ x: number; y: number; text?: string }> = ({ x, y, text }) => text ? <text x={x} y={y} textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="23" fontWeight="600" fill={paper}>{text}</text> : null;

const Publication: React.FC<{ source: DirectedSource; sentence: DirectedSentence; p: number; portrait: boolean }> = ({ source, sentence, p, portrait }) => {
  let domain = source.sourceName || "Publicação";
  try { domain = new URL(source.sourceUrl || "").hostname.replace(/^www\./, ""); } catch { /* no fabricated domain */ }
  const x = portrait ? 225 : 420, y = portrait ? 125 : 115;
  return <g>
    <g transform={`translate(${portrait ? 150 : 195} ${portrait ? 320 : 295}) rotate(-9)`}>
      <rect x="-115" y="-168" width="260" height="370" rx="4" fill="#061a20" opacity=".25" transform="translate(10 15)" />
      <path d="M-115-170h251v361h-251z" fill="#ddd8c5" /><path d="M-106-174h251v361h-251z" fill={paper} /><path d="M-106-174h9v361h-9z" fill="#b6bbaa" />
      <foreignObject x="-80" y="-144" width="202" height="110"><div style={{ color: ink, fontSize: 24, fontWeight: 800, overflowWrap: "anywhere" }}>{source.sourceName || domain}</div></foreignObject>
      <path d="M-80-40h194" stroke={ink} strokeWidth="2" />
      <rect x="-80" y="-16" width="194" height="103" fill="#a9c9b4" /><text x="18" y="54" textAnchor="middle" fontSize="58" fontWeight="800" fill={ink}>{(source.sourceName || domain).slice(0, 2).toUpperCase()}</text>
      <foreignObject x="-80" y="107" width="195" height="60"><div style={{ color: ink, fontSize: 15, lineHeight: 1.2 }}>{source.sourceTitle}</div></foreignObject>
    </g>
    <g transform={`translate(${x - (1 - p) * 55} ${y})`}>
      <rect width="600" height="400" rx="14" fill="#04191c" opacity=".3" transform="translate(8 15)" />
      <rect width="600" height="400" rx="14" fill={paper} stroke="#b5cbb9" strokeWidth="2" />
      <path d="M14 0h572q14 0 14 14v32H0V14Q0 0 14 0" fill="#bdd0be" />
      {[0, 1, 2].map(i => <circle key={i} cx={20 + 16 * i} cy="22" r="4" fill={i ? "#8cae98" : amber} />)}
      <rect x="97" y="12" width="430" height="22" rx="5" fill="#edf0e3" /><text x="112" y="28" fill="#3f6658" fontSize="13">{domain}</text>
      <foreignObject x="35" y="72" width="530" height="280"><div style={{ color: ink }}>
        <div style={{ fontSize: 14, letterSpacing: 2, marginBottom: 17 }}>NA PUBLICAÇÃO</div>
        <div style={{ fontSize: 31, fontWeight: 800, lineHeight: 1.12 }}>{source.sourceTitle}</div>
        <div style={{ height: 4, width: 92 + 300 * p, background: "#8fbea0", margin: "22px 0" }} />
        <div style={{ fontSize: 22, lineHeight: 1.38 }}>{sentence.text}</div>
      </div></foreignObject>
      <text x="35" y="377" fill="#647c6e" fontSize="12" letterSpacing="1">RECONSTITUIÇÃO EDITORIAL • FONTE IDENTIFICADA</text>
    </g>
  </g>;
};

export const NarrativeDirectedScene: React.FC<{ beat: DirectedBeat; sentence: DirectedSentence; source?: DirectedSource; frame: number; fps: number; portrait: boolean; side: "left" | "right" }> = ({ beat, sentence, source, frame, fps, portrait, side }) => {
  const p = progress(frame, beat.actionFrame, beat.resultFrame);
  const enter = progress(frame, beat.startFrame, beat.startFrame + fps * .55);
  const width = portrait ? 900 : 1100, height = portrait ? 730 : 650;
  const isTransfer = beat.kind === "transfer";
  const originX = portrait ? 240 : 260, originY = portrait ? 255 : 355;
  const targetX = portrait ? 655 : 840, targetY = portrait ? 485 : 335;
  const fromX = originX + 60, fromY = originY - 38, toX = targetX - 35, toY = targetY - 35;
  const path = `M${fromX} ${fromY}C${fromX + 160} ${fromY - 190},${toX - 170} ${toY - 180},${toX} ${toY}`;
  const u = 1 - p;
  const payloadX = u ** 3 * fromX + 3 * u ** 2 * p * (fromX + 160) + 3 * u * p ** 2 * (toX - 170) + p ** 3 * toX;
  const payloadY = u ** 3 * fromY + 3 * u ** 2 * p * (fromY - 190) + 3 * u * p ** 2 * (toY - 180) + p ** 3 * toY;
  const computerOrigin = beat.origin?.visual === "computer";
  // Camera moves the entire drawing, keeping the causal relationship intact.
  const zoom = beat.kind === "operate" ? 1 + .045 * p : 1;
  return <svg data-qa="directed-narrative-scene" data-direction={beat.kind} data-cue={sentence.id}
    viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", left: portrait ? "4%" : side === "left" ? "35%" : "3%", top: portrait ? "24%" : "25%", width: portrait ? "92%" : "64%", height: portrait ? "36%" : "59%", overflow: "visible" }}>
    <defs>
      <linearGradient id="direct-metal" x2=".8" y2="1"><stop stopColor="#ccddd0" /><stop offset=".5" stopColor="#86aaa0" /><stop offset="1" stopColor="#587e78" /></linearGradient>
      <linearGradient id="direct-paper" x2=".8" y2="1"><stop stopColor="#f9f4e5" /><stop offset="1" stopColor="#c7d4bf" /></linearGradient>
      <linearGradient id="direct-dark" x2="0" y2="1"><stop stopColor="#527a6e" /><stop offset="1" stopColor="#213f3e" /></linearGradient>
      <linearGradient id="direct-shirt" x2="1" y2="1"><stop stopColor="#b2d8b8" /><stop offset="1" stopColor="#6ca894" /></linearGradient>
    </defs>
    <ellipse cx={width * .49} cy={height * .71} rx={width * .44} ry="80" fill="#6aab94" opacity=".06" />
    <g transform={`translate(${width / 2} ${height / 2 + (1 - enter) * 18}) scale(${zoom}) translate(${-width / 2} ${-height / 2})`} opacity={.3 + .7 * enter}>
      {isTransfer && beat.origin && beat.destination && beat.subject && <g>
        <path d={path} fill="none" stroke="#7eb69d" strokeOpacity=".23" strokeWidth="3" strokeDasharray="5 9" />
        <path d={path} fill="none" stroke={mint} strokeWidth="4" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - p} />
        {computerOrigin && <g transform={`translate(${originX - 139} ${originY - 4}) scale(.9)`}><Person frame={frame} typing={p < .15 ? 1 : 0} /></g>}
        {computerOrigin && <g><path d={`M${originX - 210} ${originY + 124}h430`} stroke="#b4c7b1" strokeWidth="12" strokeLinecap="round" /><path d={`M${originX - 172} ${originY + 128}v100M${originX + 180} ${originY + 128}v100`} stroke="#5b8074" strokeWidth="8" /></g>}
        <g transform={`translate(${originX} ${originY}) scale(${portrait ? .83 : .92})`}><Prop entity={beat.origin} fill={1} frame={frame} /></g>
        <g transform={`translate(${targetX} ${targetY}) scale(${portrait ? .83 : .94})`}><Prop entity={beat.destination} fill={p > .98 ? 1 : 0} received={progress(p, .85, 1)} frame={frame} desktop /></g>
        {p < .99 && <g transform={`translate(${payloadX} ${payloadY}) scale(${.34 + Math.sin(p * Math.PI) * .18})`}><Prop entity={beat.subject} fill={1} frame={frame} /></g>}
        <Label x={originX} y={originY + (computerOrigin ? 253 : 210)} text={beat.origin.label} />
        <Label x={targetX} y={targetY + 206} text={beat.destination.label} />
        <Label x={portrait ? 565 : 570} y={portrait ? 105 : 95} text={beat.subject.label} />
      </g>}
      {beat.kind === "operate" && <g>
        <g transform={`translate(${portrait ? 246 : 305} 305) scale(1.28)`}><Person typing={p < .95 ? 1 : 0} frame={frame} /></g>
        <path d={`M${portrait ? 130 : 195} 492h600`} stroke="#bfccb5" strokeWidth="15" strokeLinecap="round" /><path d={`M${portrait ? 175 : 240} 500v120M${portrait ? 681 : 746} 500v120`} stroke="#5d8778" strokeWidth="11" />
        <g transform={`translate(${portrait ? 490 : 550} 345) scale(1.2)`}><Laptop fill={p} intrusion={beat.intrusion} /></g>
        <g transform={`translate(${portrait ? 700 : 805} 105)`}><path d="M-55 0h110M-55 14h72" stroke="#8fc7ab" strokeWidth="5" strokeLinecap="round" opacity={p} /></g>
        <Label x={portrait ? 485 : 550} y={585} text={beat.subject?.label} />
        {beat.intrusion && <text x={portrait ? 485 : 550} y="635" textAnchor="middle" fill={amber} fontSize="20">{beat.resultAffirmed ? "Ação ilustrada" : "Tentativa • resultado não confirmado"}</text>}
      </g>}
      {beat.kind === "publication" && source && <Publication source={source} sentence={sentence} p={p} portrait={portrait} />}
      {(beat.kind === "exchange" || beat.kind === "compare") && <g>
        <path d={`M${width * .5} 120v400`} stroke="#c2d3ba" strokeWidth="2" strokeOpacity=".2" />
        <g transform={`translate(${width * .25 - (beat.kind === "exchange" ? p * 27 : 0)} 335) scale(.95)`} opacity={beat.kind === "exchange" ? 1 - p * .45 : 1}><Prop entity={beat.subject || beat.entities[0]} fill={1} frame={frame} /></g>
        <g transform={`translate(${width * .75 + (1 - p) * 55} 335) scale(${.9 + p * .05})`} opacity={.25 + p * .75}><Prop entity={beat.subject || beat.entities[1]} fill={1} frame={frame} /></g>
        <Label x={width * .25} y={555} text={beat.kind === "exchange" ? "Em uso" : beat.entities[0]?.label} />
        <Label x={width * .75} y={555} text={beat.kind === "exchange" ? "Substituição" : beat.entities[1]?.label} />
        {beat.kind === "exchange" && <g opacity={p}><path d={`M${width * .5 - 40} 335h80l-15-13m15 13l-15 13`} stroke={mint} strokeWidth="4" fill="none" /></g>}
      </g>}
      {beat.kind === "inspect" && beat.subject && <g transform={`translate(${width / 2} 330) scale(1.45)`}><Prop entity={beat.subject} fill={.4 + .6 * p} frame={frame} /><Label x={0} y={220} text={beat.subject.label} /></g>}
    </g>
    <text x="28" y={height - 7} fill="#a2bbb0" fontSize="13" letterSpacing="1.5">{beat.conditional ? "EXEMPLO ILUSTRATIVO" : beat.kind === "publication" ? "LEITURA DA FONTE" : "REPRESENTAÇÃO ILUSTRATIVA"}</text>
  </svg>;
};
export { Prop as NarrativeIllustratedProp };
