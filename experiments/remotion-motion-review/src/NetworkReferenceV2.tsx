import React from "react";
import { Audio } from "@remotion/media";
import { ThreeCanvas } from "@remotion/three";
import { AbsoluteFill, Composition, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ApprovedRobotPresenter } from "./ApprovedRobotPresenter";
import timing from "../public/pulso-novo-padrao-20261028/timings.json";
import envelope from "../public/pulso-novo-padrao-20261028/envelope.json";

const FPS = 24;
const DURATION = 744;
const C = { bg: "#081923", ink: "#f5f3e9", muted: "#adc5c9", cyan: "#7ce9dc", violet: "#bcb2ff", amber: "#ffbe7e", green: "#c9ef8c", panel: "#102e3d", line: "#47737c" };
const CLAMP = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const at = (index: number) => timing.events[index].startMs * FPS / 1000;
const ease = (frame: number, start: number, end: number) => interpolate(frame, [start, Math.max(start + 1, end)], [0, 1], { ...CLAMP, easing: Easing.bezier(.22, 1, .36, 1) });
const mix = (a: number, b: number, p: number) => a + (b - a) * p;
const starts = [0, at(6), at(22), at(33), at(42), at(57), at(66)];
const captions = [
  [0, "Como uma mensagem atravessa a internet?"],
  [6, "Primeiro, os dados são divididos em pequenos pacotes."],
  [14, "Cada pacote carrega informações que ajudam a encaminhá-lo."],
  [22, "No caminho, roteadores recebem esses pacotes e escolhem por onde enviá-los."],
  [33, "Eles podem seguir trajetos diferentes até alcançar o destino."],
  [42, "Ao chegar, os dados são organizados novamente para que o aparelho possa mostrar a mensagem."],
  [57, "Tudo isso acontece nos bastidores enquanto a gente conversa."],
  [66, "Este mapa é uma ilustração, não uma rota real."]
] as const;
const headings = [
  ["A PERGUNTA", "O que acontece quando você envia?"],
  ["01 / DIVIDIR", "Uma mensagem. Vários pacotes."],
  ["02 / ENCAMINHAR", "O roteador aponta o caminho."],
  ["03 / ATRAVESSAR", "Pacotes podem seguir rotas diferentes."],
  ["04 / REUNIR", "O destino organiza os dados."],
  ["O CAMINHO COMPLETO", "Da origem até a mensagem na tela."],
  ["VISUAL ILUSTRATIVO", "Um esquema para entender a ideia."]
] as const;
const COLORS = [C.cyan, C.violet, C.amber] as const;
const draw = (progress: number) => ({ strokeDasharray: 1000, strokeDashoffset: 1000 * (1 - progress) });
const label = (x: number, y: number, text: string, color = C.muted, size = 24) => <text x={x} y={y} fill={color} fontSize={size} fontWeight="700" letterSpacing="2.2">{text}</text>;

const Phone: React.FC<{ x: number; y: number; scale?: number; done?: number }> = ({ x, y, scale = 1, done = 0 }) => <g transform={`translate(${x} ${y}) scale(${scale})`}>
  <ellipse cx="0" cy="216" rx="128" ry="22" fill="#020b12" opacity=".55" />
  <rect x="-116" y="-196" width="232" height="406" rx="40" fill="#b8d1d4" />
  <rect x="-109" y="-189" width="218" height="392" rx="35" fill="#081923" />
  <rect x="-94" y="-159" width="188" height="317" rx="19" fill="#173b4c" stroke="#527884" strokeWidth="2" />
  <rect x="-31" y="-178" width="62" height="7" rx="4" fill="#78979d" />
  <rect x="-76" y="-110" width="152" height="44" rx="12" fill="#294f5b" />
  <path d="M-59 -88H42" stroke="#78a3a4" strokeWidth="7" strokeLinecap="round" />
  <g opacity={done}><rect x="-75" y="-29" width="150" height="88" rx="18" fill={C.cyan} /><path d="M-54 3H52M-54 22H20" stroke="#153a41" strokeWidth="8" strokeLinecap="round" /></g>
  <rect x="-30" y="176" width="60" height="5" rx="3" fill="#a4c4c4" />
</g>;
const Packet: React.FC<{ x: number; y: number; color: string; scale?: number; opacity?: number }> = ({ x, y, color, scale = 1, opacity = 1 }) => <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>
  <rect x="-70" y="-47" width="140" height="94" rx="13" fill="#0c2633" stroke={color} strokeWidth="3" />
  <rect x="-58" y="-35" width="28" height="70" rx="6" fill={color} />
  <path d="M-17 -20H49M-17 -1H42M-17 18H25" stroke="#d5e9e5" strokeWidth="6" strokeLinecap="round" />
</g>;

const Intro: React.FC<{ frame: number }> = ({ frame }) => {
  const p = ease(frame, 5, 38), send = ease(frame, 27, 58);
  return <svg viewBox="0 0 1200 700" width="100%" height="100%" aria-label="Mensagem saindo de um telefone">
    <defs><linearGradient id="introGlow" x1="0" x2="1"><stop stopColor={C.cyan} stopOpacity=".25" /><stop offset="1" stopColor={C.cyan} stopOpacity="0" /></linearGradient></defs>
    <circle cx="365" cy="350" r="270" fill="none" stroke={C.cyan} strokeOpacity=".08" strokeWidth="3" />
    <circle cx="365" cy="350" r="210" fill="none" stroke={C.cyan} strokeOpacity=".15" strokeWidth="2" />
    <g opacity={p} transform={`translate(${mix(-40, 0, p)} 0)`}><Phone x={270} y={335} scale={1.05} done={1} /></g>
    <path d="M430 350H920" fill="none" stroke={C.cyan} strokeWidth="4" strokeDasharray="11 12" opacity=".45" />
    <g transform={`translate(${mix(430, 830, send)} 350)`} opacity={send}><rect x="-67" y="-43" width="134" height="86" rx="16" fill={C.cyan} /><path d="M-48 -20L0 12L48 -20" fill="none" stroke="#173945" strokeWidth="7" strokeLinecap="round" /></g>
    {label(530, 275, "MENSAGEM", C.cyan, 27)}{label(530, 430, "O QUE ACONTECE NO CAMINHO?", C.muted, 22)}
  </svg>;
};
const Split: React.FC<{ frame: number }> = ({ frame }) => {
  const split = ease(frame, at(9), at(13)), info = ease(frame, at(14), at(18));
  return <svg viewBox="0 0 1200 700" width="100%" height="100%" aria-label="Dados divididos em pacotes">
    <rect x="70" y="180" width="350" height="255" rx="24" fill="#e8eee6" />
    <rect x="100" y="212" width="290" height="36" rx="8" fill="#b8d2cc" /><path d="M110 282H375M110 315H348M110 348H365M110 381H285" stroke="#708f8d" strokeWidth="11" strokeLinecap="round" />
    {label(90, 480, "MENSAGEM ORIGINAL", C.ink, 25)}
    <path d="M455 310H565" fill="none" stroke={C.cyan} strokeWidth="4" strokeDasharray="8 9" /><path d="M553 297L568 310L553 323" fill="none" stroke={C.cyan} strokeWidth="4" />
    {[0, 1, 2].map(i => <g key={i}><Packet x={mix(680, 715 + i * 155, split)} y={mix(310, 255, split)} color={COLORS[i]} scale={mix(.65, .9, split)} />
      <text x={715 + i * 155} y="366" fill={COLORS[i]} fontSize="22" fontWeight="700" textAnchor="middle" opacity={split}>PACOTE {i + 1}</text></g>)}
    <g opacity={info}><path d="M655 385V460H1010" fill="none" stroke={C.muted} strokeWidth="2" />{label(655, 515, "CABEÇALHO", C.cyan, 26)}{label(655, 553, "ENCAMINHAMENTO", C.muted, 21)}
      <path d="M915 386V460" fill="none" stroke={C.muted} strokeWidth="2" />{label(915, 515, "DADOS", C.amber, 26)}{label(915, 553, "CONTEÚDO", C.muted, 21)}</g>
  </svg>;
};
const Router: React.FC<{ frame: number }> = ({ frame }) => {
  const travel = ease(frame, at(24), at(31)), route = ease(frame, at(29), at(32));
  const x = mix(130, 1030, travel);
  return <svg viewBox="0 0 1200 700" width="100%" height="100%" aria-label="Roteador encaminhando um pacote">
    <defs><linearGradient id="routerTop" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#447682" /><stop offset="1" stopColor="#214754" /></linearGradient></defs>
    <path d="M100 330H430" stroke={C.cyan} strokeWidth="5" fill="none" style={draw(ease(frame, at(22), at(26)))} />
    <path d="M770 330H1090" stroke={C.cyan} strokeWidth="5" fill="none" style={draw(route)} />
    <path d="M770 330Q910 330 1040 180M770 330Q910 330 1040 490" stroke={C.line} strokeWidth="3" fill="none" strokeDasharray="9 10" opacity={route * .7} />
    <ellipse cx="600" cy="455" rx="255" ry="44" fill="#020b12" opacity=".5" />
    <path d="M400 290L570 220L800 270L635 344Z" fill="url(#routerTop)" stroke="#8ab7b8" strokeWidth="3" />
    <path d="M400 290V390L635 450V344Z" fill="#173a48" stroke="#537983" strokeWidth="3" />
    <path d="M635 344L800 270V375L635 450Z" fill="#102e3a" stroke="#537983" strokeWidth="3" />
    {[0,1,2,3].map(i => <circle key={i} cx={455 + i * 35} cy={364 + i * 9} r="6" fill={i < Math.floor(route * 4) ? C.cyan : "#42626a"} />)}
    <Packet x={x} y={300} color={C.amber} scale={.58} opacity={1} />
    {label(80, 405, "ENTRADA", C.muted, 22)}{label(475, 520, "ROTEADOR", C.ink, 30)}{label(870, 405, "ENCAMINHAMENTO", C.cyan, 22)}
    <text x="600" y="562" textAnchor="middle" fill={C.muted} fontSize="23">A rede decide a próxima etapa do percurso.</text>
  </svg>;
};
const h = (x: number, z: number) => .08 + .24 * (1 + Math.sin(x * .6) * Math.cos(z * .7));
const ROUTES = [[[-4,2],[-2,1],[0,-.2],[2,-.5],[4,-2]],[[-4,2],[-2,1],[0,2],[2,1],[4,-2]],[[-4,2],[-2,-1],[0,-2],[2,-.5],[4,-2]]] as const;
const point = (route: readonly (readonly number[])[], progress: number) => {
  const t = Math.max(0, Math.min(.999999, progress)) * (route.length - 1), i = Math.floor(t), f = t - i;
  return [mix(route[i][0], route[i+1][0], f), mix(route[i][1], route[i+1][1], f)];
};
const NetworkMap: React.FC<{ progress: number }> = ({ progress }) => <>
  <ambientLight intensity={1.1} /><directionalLight position={[3, 12, 7]} intensity={1.7} />
  <mesh position={[0,-.12,0]}><boxGeometry args={[10.6,.28,7.5]} /><meshStandardMaterial color="#112b37" /></mesh>
  {Array.from({length: 77}, (_, i) => { const x=i%11-5, z=Math.floor(i/11)-3, ht=h(x,z); return <mesh key={i} position={[x,ht/2,z]}><boxGeometry args={[.95,ht,.95]} /><meshStandardMaterial color={ht>.42?"#34616b":"#1a414a"} roughness={.85} /></mesh>; })}
  {[[-4,2],[4,-2]].map(([x,z],i)=><group key={i} position={[x,h(x,z)+.57,z]}><mesh><boxGeometry args={[.6,1.1,.18]} /><meshStandardMaterial color={i?C.amber:C.cyan} /></mesh><mesh position={[0,0,.1]}><boxGeometry args={[.4,.7,.02]} /><meshStandardMaterial color="#143645" /></mesh></group>)}
  {[[-2,1],[0,-.2],[0,2],[0,-2],[2,-.5],[2,1]].map(([x,z],i)=><mesh key={i} position={[x,h(x,z)+.25,z]}><boxGeometry args={[.55,.35,.55]} /><meshStandardMaterial color="#a1c1bd" emissive="#163e40" /></mesh>)}
  {ROUTES.map((route, ri) => <group key={ri}>
    {Array.from({length: 36},(_,i)=>{const t=i/35,[x,z]=point(route,t);return <mesh key={i} visible={t<=progress} position={[x,h(x,z)+.23,z]}><sphereGeometry args={[.065,8,6]} /><meshStandardMaterial color={COLORS[ri]} emissive="#28544a" /></mesh>;})}
    {(()=>{const p=Math.max(0,progress-ri*.10),[x,z]=point(route,p);return <mesh position={[x,h(x,z)+.5,z]}><boxGeometry args={[.35,.35,.35]} /><meshStandardMaterial color={COLORS[ri]} emissive="#345b50" /></mesh>})()}
  </group>)}
</>;
const RoutingMap: React.FC<{ frame: number; width: number; height: number }> = ({ frame, width, height }) => {
  const progress = ease(frame, at(33), at(41));
  return <ThreeCanvas width={width} height={height} camera={{ position: [10, 13, 15], fov: 26, near: .1, far: 100 }} gl={{alpha:true,antialias:true,preserveDrawingBuffer:true}} style={{width:"100%",height:"100%"}}><NetworkMap progress={progress} /></ThreeCanvas>;
};
const Assemble: React.FC<{ frame: number }> = ({ frame }) => {
  const assemble = ease(frame, at(43), at(53)), reveal = ease(frame, at(53), at(56));
  return <svg viewBox="0 0 1200 700" width="100%" height="100%" aria-label="Pacotes reunidos no aparelho de destino">
    <path d="M140 315H780" stroke={C.cyan} strokeWidth="4" fill="none" strokeDasharray="10 12" opacity=".5" />
    {[0,1,2].map(i => <Packet key={i} x={mix(160+i*155, 770, Math.max(0, assemble-i*.12))} y={315} color={COLORS[i]} scale={.72} opacity={Math.max(.12, 1-reveal)} />)}
    <Phone x={895} y={320} scale={1.15} done={reveal} />
    {label(90, 430, "PACOTES RECEBIDOS", C.muted, 22)}
    <g opacity={reveal}><path d="M920 70H1070" stroke={C.green} strokeWidth="3" />{label(945, 48, "REORGANIZADO", C.green, 22)}
      <circle cx="1110" cy="72" r="26" fill={C.green}/><path d="M1098 72L1107 81L1123 62" fill="none" stroke="#163b35" strokeWidth="6" strokeLinecap="round" /></g>
  </svg>;
};
const Closing: React.FC<{ frame: number }> = ({ frame }) => <svg viewBox="0 0 1200 700" width="100%" height="100%" aria-label="Resumo das três etapas">
  {["DIVIDIR", "ENCAMINHAR", "REUNIR"].map((text,i)=>{const p=ease(frame,at(57)+i*8,at(57)+i*8+15),x=180+i*310;return <g key={text} opacity={p} transform={`translate(0 ${(1-p)*18})`}>
    <circle cx={x} cy="300" r="72" fill="#123642" stroke={COLORS[i]} strokeWidth="4" /><text x={x} y="315" textAnchor="middle" fill={COLORS[i]} fontSize="48" fontWeight="700">{i+1}</text>
    <text x={x} y="435" textAnchor="middle" fill={C.ink} fontSize="28" fontWeight="700" letterSpacing="2">{text}</text>
    {i<2 && <path d={`M${x+96} 300H${x+212}`} stroke={C.line} strokeWidth="4" strokeDasharray="8 8" />}
  </g>})}
</svg>;
const Illustration: React.FC<{ frame: number }> = ({ frame }) => {
  const reveal = ease(frame, at(66), at(70));
  return <svg viewBox="0 0 1200 700" width="100%" height="100%" aria-label="Esquema ilustrativo, sem rota geográfica real">
    <g transform={`translate(${mix(-30,0,reveal)} 0)`} opacity={reveal}>
      <path d="M160 235L570 135L970 265L565 380Z" fill="#1c4952" stroke="#80aaab" strokeWidth="4" />
      <path d="M160 235V355L565 505V380ZM565 380L970 265V385L565 505Z" fill="#153541" stroke="#668b90" strokeWidth="4" />
      <path d="M280 274Q380 175 550 265T840 285" fill="none" stroke={C.cyan} strokeWidth="8" strokeDasharray="12 12" />
      <circle cx="280" cy="274" r="18" fill={C.cyan} /><circle cx="840" cy="285" r="18" fill={C.amber} />
      <rect x="335" y="420" width="355" height="67" rx="14" fill="#0b2631" stroke={C.amber} strokeWidth="2" />
      <text x="512" y="463" textAnchor="middle" fontSize="27" fontWeight="700" fill={C.amber} letterSpacing="2">NÃO É ROTA REAL</text>
    </g>
  </svg>;
};

export const NetworkReference: React.FC = () => {
  const frame=useCurrentFrame();const {width,height}=useVideoConfig();const portrait=height>width;
  let scene=0;starts.forEach((start,i)=>{if(frame>=start)scene=i;});
  const p=ease(frame,starts[scene],starts[scene]+11);
  const caption=[...captions].reverse().find(([i])=>frame>=at(i))?.[1]||captions[0][1];
  const presenter=scene===0||scene>=5;
  const area = portrait ? {left:width*.04,top:height*.27,width:width*.92,height:height*(presenter ? .31 : .40)} : {left:width*.035,top:height*.24,width:width*(presenter ? .67 : .91),height:height*.58};
  const gestureCues={hook:at(0),explain:at(6),point:at(22),conclusion:at(57)};
  return <AbsoluteFill style={{background:`radial-gradient(ellipse at ${scene===3?"45% 60%":"75% 45%"}, ${scene===3?"#214a4a":"#163c46"} 0%, #0c2632 42%, ${C.bg} 80%)`,color:C.ink,fontFamily:"Arial, sans-serif",overflow:"hidden"}}>
    <svg width={width} height={height} style={{position:"absolute",inset:0}} aria-hidden><path d={`M0 ${height*.8}H${width} M${width*.75} 0V${height}`} stroke={C.cyan} strokeOpacity=".05" strokeWidth="2"/></svg>
    <div style={{position:"absolute",top:portrait?height*.05:height*.052,left:width*.06,fontSize:portrait?24:23,fontWeight:700,letterSpacing:3,color:C.cyan}}>PULSO IA / COMO FUNCIONA</div>
    <div style={{position:"absolute",top:portrait?height*.105:height*.105,left:width*.06,maxWidth:portrait?width*.88:width*.84,opacity:.55+.45*p,transform:`translateY(${(1-p)*14}px)`}}>
      <div style={{fontSize:portrait?21:19,letterSpacing:2.6,color:C.muted,fontWeight:700,marginBottom:portrait?13:12}}>{headings[scene][0]}</div>
      <div style={{fontSize:portrait?48:60,fontWeight:750,lineHeight:1.1,letterSpacing:-1}}>{headings[scene][1]}</div>
    </div>
    <div style={{position:"absolute",left:area.left,top:area.top,width:area.width,height:area.height,opacity:p}}>
      {scene===0&&<Intro frame={frame}/>} {scene===1&&<Split frame={frame}/>} {scene===2&&<Router frame={frame}/>} {scene===3&&<RoutingMap frame={frame} width={Math.round(area.width)} height={Math.round(area.height)}/>} {scene===4&&<Assemble frame={frame}/>} {scene===5&&<Closing frame={frame}/>} {scene===6&&<Illustration frame={frame}/>}
    </div>
    {scene===3&&<div style={{position:"absolute",left:width*.06,top:portrait?height*.68:height*.78,color:C.muted,fontSize:portrait?19:20,letterSpacing:1}}>MAPA E TRAJETOS ILUSTRATIVOS</div>}
    {presenter&&<ApprovedRobotPresenter src={staticFile("pulso-story/approved-robot-rigged.glb")} side="right" accents={[C.cyan,C.violet]} gestureCues={gestureCues} lipSyncEnvelope={envelope.levels} lipSyncFps={1000/envelope.stepMs}
      canvasSize={{width:Math.round(width*(portrait ? .47 : .34)),height:Math.round(height*(portrait ? .29 : .82))}} style={portrait?{top:"auto",bottom:"1%",left:"auto",right:"3%",zIndex:4}:{top:"10%",right:"-1%",zIndex:4}}/>}
    <div style={{position:"absolute",bottom:portrait?height*(presenter ? .35 : .225):height*.075,left:width*.06,maxWidth:portrait?width*.88:width*.8,fontSize:portrait?30:30,lineHeight:1.25,fontWeight:650,padding:"16px 22px",background:"rgba(4,17,24,.93)",borderLeft:`4px solid ${C.cyan}`,borderRadius:"0 8px 8px 0"}}>{caption}</div>
    <div style={{position:"absolute",bottom:portrait?height*.13:height*.025,left:width*.06,width:width*.88,height:3,background:"rgba(160,201,197,.2)"}}><div style={{width:`${frame/(DURATION-1)*100}%`,height:"100%",background:C.cyan}}/></div>
    <Audio src={staticFile("pulso-novo-padrao-20261028/narration.mp3")}/>
  </AbsoluteFill>;
};
export const NetworkReferenceV2Compositions: React.FC = () => <>
  <Composition id="PulsoNetworkV2Landscape" component={NetworkReference} width={1920} height={1080} fps={FPS} durationInFrames={DURATION}/>
  <Composition id="PulsoNetworkV2Portrait" component={NetworkReference} width={1080} height={1920} fps={FPS} durationInFrames={DURATION}/>
</>;
