import React, { useEffect, useState } from "react";
import { Audio } from "@remotion/media";
import { AbsoluteFill, Composition, Easing, interpolate, staticFile, useCurrentFrame, useDelayRender, useVideoConfig } from "remotion";
import timeline from "../public/ia-answer-20261023/timeline.json";
import envelope from "../public/ia-answer-20261023/audio-envelope.json";
import captions from "../public/ia-answer-20261023/captions.json";
import { ApprovedRobotPresenter } from "./ApprovedRobotPresenter";
import type { ApprovedRobotGestureCues } from "./approved-robot-arm-motion.mjs";

const C = { bg: "#0B1825", paper: "#F4F1E8", muted: "#ACC0CB", cyan: "#8AE8F2", violet: "#C3AEFF", mint: "#C6F77B", amber: "#FFBC80", red: "#FF9FA5", line: "#385265" };
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const p = (t: number, a: number, b: number) => interpolate(t, [a, Math.max(a + .001, b)], [0, 1], clamp);
const e = (t: number, a: number, b: number) => interpolate(t, [a, Math.max(a + .001, b)], [0, 1], { ...clamp, easing: Easing.bezier(.22, 1, .36, 1) });
const mix = (a: number, b: number, v: number) => a + (b - a) * v;
type Chapter = typeof timeline.chapters[number];
type SceneProps = { t: number; chapter: Chapter; beat: number };
const cue = (chapter: Chapter, sentence: number) => chapter.sentences[sentence].startSeconds;
const reveal = (t: number, chapter: Chapter, sentence: number, delay = 0) => e(t, cue(chapter, sentence) + delay, cue(chapter, sentence) + delay + .8);

const FontReady: React.FC = () => {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Carregando fontes do episódio"));
  useEffect(() => {
    Promise.all([document.fonts.load("400 36px PulsoEpisode"), document.fonts.load("700 80px PulsoEpisode")]).then(() => continueRender(handle)).catch(cancelRender);
  }, [continueRender, cancelRender, handle]);
  return null;
};

const Defs: React.FC = () => <defs>
  <linearGradient id="ai-metal" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#DFE7E7" /><stop offset=".55" stopColor="#8EA9B9" /><stop offset="1" stopColor="#456174" /></linearGradient>
  <linearGradient id="ai-screen" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#18354A" /><stop offset="1" stopColor="#0E2035" /></linearGradient>
  <linearGradient id="ai-chip" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#35436D" /><stop offset="1" stopColor="#192641" /></linearGradient>
  <marker id="ai-arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto"><path d="M1 1L10 6L1 11" fill="none" stroke={C.cyan} strokeWidth="2" /></marker>
</defs>;
const Label: React.FC<{ x: number; y: number; children: React.ReactNode; color?: string; size?: number; anchor?: "start" | "middle" | "end" }> = ({ x, y, children, color = C.muted, size = 29, anchor = "middle" }) => <text x={x} y={y} fill={color} fontSize={size} fontWeight="700" textAnchor={anchor}>{children}</text>;
const Wire: React.FC<{ d: string; progress?: number; color?: string; dashed?: boolean }> = ({ d, progress = 1, color = C.cyan, dashed = false }) => <path d={d} pathLength="1" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={dashed ? ".025 .025" : 1} strokeDashoffset={dashed ? 0 : 1 - progress} opacity={dashed ? progress : 1} />;
const Tick: React.FC<{ x: number; y: number; progress?: number }> = ({ x, y, progress = 1 }) => <g transform={`translate(${x} ${y})`} opacity={progress}><circle r="32" fill={C.mint} fillOpacity=".15" stroke={C.mint} strokeWidth="2" /><path d="M-15 0L-4 11L17 -13" fill="none" stroke={C.mint} strokeWidth="5" strokeLinecap="round" /></g>;
const Token: React.FC<{ x: number; y: number; text: string; width?: number; color?: string; scale?: number; opacity?: number }> = ({ x, y, text, width = 130, color = C.cyan, scale = 1, opacity = 1 }) => <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}><rect x={-width / 2} y="-34" width={width} height="68" rx="15" fill="#142C40" stroke={color} strokeWidth="2.5" /><Label x={0} y={11} color={color} size={34}>{text}</Label></g>;
const Paper: React.FC<{ x: number; y: number; scale?: number; title?: string; lines?: string[]; accent?: string; angle?: number; highlight?: number }> = ({ x, y, scale = 1, title = "DOCUMENTO", lines = [], accent = C.cyan, angle = 0, highlight = -1 }) => <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
  <path d="M-132 -175H88L132 -130V175H-132Z" fill="#DCE6E1" stroke="#8CA5AC" strokeWidth="3" />
  <path d="M88 -175V-130H132" fill="#AFC4C6" />
  <rect x="-108" y="-145" width="150" height="7" rx="3" fill="#34717C" />
  <Label x={-108} y={-109} color="#183D48" size={23} anchor="start">{title}</Label>
  {Array.from({ length: 7 }, (_, i) => <g key={i}>
    {highlight === i && <rect x="-115" y={-70 + i * 29} width="230" height="32" rx="4" fill={accent} fillOpacity=".8" />}
    {lines[i] ? <Label x={-106} y={-47 + i * 29} color="#183D48" size={23} anchor="start">{lines[i]}</Label> : <rect x="-106" y={-61 + i * 29} width={i % 3 === 0 ? 168 : 210} height="7" rx="3" fill="#62828B" opacity=".6" />}
  </g>)}
</g>;
const Laptop: React.FC<{ x: number; y: number; scale?: number; children?: React.ReactNode }> = ({ x, y, scale = 1, children }) => <g transform={`translate(${x} ${y}) scale(${scale})`}>
  <ellipse cy="224" rx="295" ry="28" fill="#030D18" opacity=".5" />
  <rect x="-254" y="-180" width="508" height="352" rx="27" fill="url(#ai-metal)" /><rect x="-245" y="-172" width="490" height="334" rx="22" fill="#07141F" /><rect x="-229" y="-150" width="458" height="290" rx="9" fill="url(#ai-screen)" />
  <circle cy="-160" r="3" fill="#8CA6B4" />
  <path d="M-254 172H254L322 218Q326 230 308 232H-308Q-326 230 -322 218Z" fill="url(#ai-metal)" /><path d="M-214 182H214L247 207H-247Z" fill="#233F51" /><path d="M-45 212H45L56 225H-56Z" fill="#5F7D8D" />
  {children}
</g>;
const Processor: React.FC<{ x: number; y: number; scale?: number; active?: number; training?: number }> = ({ x, y, scale = 1, active = 1, training = 0 }) => <g transform={`translate(${x} ${y}) scale(${scale})`}>
  {Array.from({ length: 9 }, (_, i) => <g key={i}><path d={`M${-86 + i * 21.5} -145V-117M${-86 + i * 21.5} 117V145M-145 ${-86 + i * 21.5}H-117M117 ${-86 + i * 21.5}H145`} stroke="#7890AE" strokeWidth="8" /></g>)}
  <rect x="-120" y="-120" width="240" height="240" rx="25" fill="url(#ai-chip)" stroke={C.violet} strokeWidth="3" /><rect x="-99" y="-99" width="198" height="198" rx="15" fill="#0C2033" stroke="#62739D" />
  {[0, 1, 2, 3].map(i => <g key={i}><path d={`M-64 ${-56 + i * 38}H64`} stroke="#3E5573" strokeWidth="5" /><circle cx={mix(-48 + i * 23, 45 - i * 20, training)} cy={-56 + i * 38} r="10" fill={active > .2 ? C.violet : C.muted} /></g>)}
  <Label x={0} y={184} color={C.violet} size={29}>MODELO</Label>
</g>;

const AnswerScene: React.FC<SceneProps> = ({ t, chapter, beat }) => {
  const travel = reveal(t, chapter, 2), append = reveal(t, chapter, 3);
  const phase = beat < 5 ? 0 : beat < 8 ? 1 : 2;
  const opening = e(t, cue(chapter, 1) + .4, cue(chapter, 2) - .4);
  const cameraScale = mix(1.5, 1, opening);
  const words = ["O", "gato", "dorme", "no", "sofá"];
  const count = Math.floor(p(t, cue(chapter, 5) + .8, cue(chapter, 6)) * words.length);
  return <>
    {phase === 0 && <g transform={`translate(${560 - mix(300, 560, opening) * cameraScale} ${380 - 340 * cameraScale}) scale(${cameraScale})`}>
      <Laptop x={300} y={340} scale={.85}><Label x={0} y={-82} size={26}>UMA PERGUNTA</Label><rect x="-187" y="-48" width="374" height="58" rx="14" fill="#224C60" /><Label x={0} y={-10} size={32} color={C.paper}>Como isso funciona?</Label><g opacity={append}><path d="M-184 55H167M-184 89H80" stroke={C.mint} strokeWidth="11" strokeLinecap="round" /></g></Laptop>
      <g opacity={opening}><Processor x={825} y={330} scale={.82} /></g>
      <Wire d="M510 282C620 180 690 180 738 250" progress={travel} />
      <Token x={mix(510, 738, travel)} y={mix(282, 250, travel) - Math.sin(travel * Math.PI) * 90} text="?" width={65} opacity={beat >= 2 ? 1 - append : 0} />
      <Wire d="M728 400C640 490 585 490 490 427" progress={append} color={C.mint} />
      <g opacity={opening}><Label x={560} y={620} color={C.cyan}>PERGUNTA → CONTEXTO → RESPOSTA</Label></g>
    </g>}
    {phase === 1 && <>
      <Processor x={560} y={215} scale={.76} />
      <Wire d="M560 348V400" />
      {words.map((word, i) => <Token key={word} x={230 + i * 165} y={480} text={word} opacity={i <= count ? 1 : .18} color={i === count ? C.mint : C.cyan} />)}
      <Wire d="M960 520C1010 650 130 650 130 465C130 295 280 215 425 215" progress={reveal(t, chapter, 6)} dashed />
      <Label x={560} y={710} color={C.muted}>EXEMPLO ILUSTRATIVO · UMA CONTINUAÇÃO DE CADA VEZ</Label>
    </>}
    {phase === 2 && <>
      <Laptop x={270} y={365} scale={.72}><Label x={0} y={-50} color={C.paper}>APLICATIVO</Label><Label x={0} y={15} color={C.cyan}>pergunta + contexto</Label></Laptop>
      <Processor x={825} y={370} scale={.7} />
      <Paper x={630} y={125} scale={.43} title="FONTES" />
      <Wire d="M470 365H714" progress={reveal(t, chapter, 8)} />
      <Wire d="M620 212C620 275 750 230 810 262" progress={reveal(t, chapter, 8, 1.2)} color={C.mint} />
      <Label x={560} y={660} color={beat === 9 ? C.amber : C.cyan}>{beat === 9 ? "FLUÊNCIA NÃO COMPROVA VERIFICAÇÃO" : "FERRAMENTAS SÃO ETAPAS ADICIONAIS"}</Label>
    </>}
  </>;
};

const TokenScene: React.FC<SceneProps> = ({ t, chapter, beat }) => {
  const split = e(t, cue(chapter, 1) + .15, cue(chapter, 1) + 1.7), numeric = reveal(t, chapter, 5), join = reveal(t, chapter, 9);
  const pieces = ["O", " gato", " dorme", "."];
  const xs = [270, 445, 655, 850], widths = [100, 180, 210, 90];
  return <>
    <Paper x={560} y={mix(275, 175, split)} scale={mix(1.25, .46, split)} title="TEXTO" lines={["O gato dorme."]} highlight={0} />
    <Wire d="M560 330V400" progress={reveal(t, chapter, 1, 1.65)} />
    <g transform={`translate(0 ${-join * 70})`}>
      {pieces.map((word, i) => <Token key={i} x={mix(500 + i * 35, xs[i], split)} y={440} text={numeric > .7 && beat < 9 ? "ID" : word} width={widths[i]} color={i === 3 ? C.amber : C.cyan} opacity={reveal(t, chapter, 1, 1.7 + i * .1)} />)}
    </g>
    {beat >= 5 && beat < 9 && <>
      <Wire d="M270 485L400 595M445 485L490 595M655 485L620 595M850 485L710 595" progress={numeric} color={C.violet} />
      <rect x="335" y="580" width="445" height="110" rx="23" fill="url(#ai-chip)" stroke={C.violet} strokeWidth="2" />
      <Label x={557} y={628} color={C.violet}>SEQUÊNCIA NUMÉRICA</Label><Label x={557} y={665} size={23}>representação do texto</Label>
    </>}
    {beat >= 9 && <g opacity={join}><Label x={560} y={580} color={C.mint} size={43}>O gato dorme.</Label><Wire d="M425 500H710" progress={join} color={C.mint} /><Label x={560} y={650}>O TEXTO VOLTA A SER LEGÍVEL</Label></g>}
    {beat < 5 && <Label x={560} y={650} color={C.amber}>{beat < 3 ? "PALAVRA ≠ TOKEN" : "DIVISÃO ILUSTRATIVA · VARIA POR TOKENIZADOR"}</Label>}
  </>;
};

const Bench: React.FC<{ x: number; y: number; opacity?: number }> = ({ x, y, opacity = 1 }) => <g transform={`translate(${x} ${y})`} opacity={opacity}><path d="M-115 -58H115M-115 -20H115" stroke="#C7996C" strokeWidth="25" strokeLinecap="round" /><path d="M-130 30H130" stroke="#D9B182" strokeWidth="30" /><path d="M-90 30V110M90 30V110M-90 -65V30M90 -65V30" stroke="#829CA2" strokeWidth="12" /><path d="M-155 113H155" stroke="#526E66" strokeWidth="3" /></g>;
const Bank: React.FC<{ x: number; y: number; opacity?: number }> = ({ x, y, opacity = 1 }) => <g transform={`translate(${x} ${y})`} opacity={opacity}><path d="M-155 -75L0 -155L155 -75Z" fill="#ABC3CF" stroke={C.cyan} strokeWidth="3" /><rect x="-140" y="-66" width="280" height="18" fill="#DCE5E4" />{[-98, -35, 35, 98].map(xp => <rect key={xp} x={xp - 15} y="-47" width="30" height="145" rx="3" fill="url(#ai-metal)" />)}<path d="M-150 110H150M-163 130H163" stroke="#9CB8C5" strokeWidth="17" /><Label x={0} y={-88} size={25} color="#183D48">BANCO</Label></g>;
const ContextScene: React.FC<SceneProps> = ({ t, chapter, beat }) => {
  const connections = reveal(t, chapter, 2), window = reveal(t, chapter, 7);
  if (beat < 6) return <>
    <Bench x={275} y={365} opacity={beat < 2 ? 1 : .7} /><Bank x={840} y={360} opacity={reveal(t, chapter, 1, .9)} />
    <Token x={560} y={165} text="banco" width={220} color={C.violet} />
    <Wire d="M460 180C345 180 280 220 275 275" progress={connections} /><Wire d="M660 180C775 180 835 220 840 225" progress={connections} color={C.mint} />
    <Token x={275} y={560} text="praça" width={200} /><Token x={840} y={560} text="dinheiro" width={220} color={C.mint} opacity={reveal(t, chapter, 1, .9)} />
    <Label x={560} y={685} color={C.violet}>{beat < 3 ? "O CONTEXTO MUDA A INTERPRETAÇÃO" : "RELAÇÕES ESQUEMÁTICAS · SEM PESOS REAIS"}</Label>
  </>;
  return <>
    <rect x="115" y="100" width="630" height="510" rx="30" fill="#10273B" stroke={C.cyan} strokeWidth="3" />
    <Label x={430} y={157} color={C.cyan}>CONTEXTO ENVIADO AO MODELO</Label>
    {["Instruções", "Trechos anteriores", "Sua pergunta"].map((label, i) => <g key={label} opacity={e(t, cue(chapter, 6) + i * .45, cue(chapter, 6) + i * .45 + .7)}><rect x="170" y={215 + i * 105} width="520" height="76" rx="15" fill="#20445B" /><Label x={430} y={262 + i * 105} color={i === 2 ? C.mint : C.paper} size={35}>{label}</Label></g>)}
    <g opacity={window}><path d="M800 165V580" stroke={C.amber} strokeWidth="4" strokeDasharray="10 9" /><Label x={940} y={285} color={C.amber}>LIMITE</Label><Label x={940} y={330} color={C.amber}>DE</Label><Label x={940} y={375} color={C.amber}>CONTEXTO</Label></g>
    <Label x={560} y={700}>HISTÓRICO NA TELA E ENTRADA ENVIADA PODEM DIFERIR</Label>
  </>;
};

const TrainingScene: React.FC<SceneProps> = ({ t, chapter, beat }) => {
  const learning = p(t, cue(chapter, 1), cue(chapter, 4));
  if (beat < 4) return <>
    {[0, 1, 2].map(i => <Paper key={i} x={230 + i * 18} y={320 - i * 15} scale={.65} angle={-10 + i * 8} title="EXEMPLOS" />)}
    <Processor x={805} y={340} scale={1.1} training={learning} />
    <Wire d="M380 330H630" progress={reveal(t, chapter, 1)} />
    <Token x={mix(405, 640, p(t, cue(chapter, 2), cue(chapter, 3)))} y={330} text="padrões" width={170} scale={.85} opacity={beat >= 2 ? 1 : 0} />
    <Label x={560} y={650} color={C.violet}>TREINAMENTO: AJUSTE DOS PARÂMETROS</Label>
  </>;
  return <>
    <Processor x={585} y={340} scale={.84} training={1} />
    <Token x={215} y={345} text="pergunta" width={220} /><Wire d="M335 345H455" progress={reveal(t, chapter, 4)} />
    <Token x={940} y={345} text="resposta" width={220} color={C.mint} opacity={reveal(t, chapter, 4, 1.3)} /><Wire d="M712 345H820" progress={reveal(t, chapter, 4, .7)} color={C.mint} />
    {beat >= 5 && <g opacity={reveal(t, chapter, 5)}><Paper x={285} y={610} scale={.32} title="HISTÓRICO" /><Paper x={465} y={610} scale={.32} title="ARQUIVOS" /><Wire d="M300 545C300 470 430 495 480 420" progress={reveal(t, chapter, 5, .8)} dashed /><Label x={785} y={610} color={C.amber} size={27}>RECURSOS DO APLICATIVO</Label></g>}
    <Label x={560} y={105} color={C.cyan}>EXECUÇÃO: USAR O MODELO PREPARADO</Label>
    <Label x={560} y={735} size={25}>{beat >= 8 ? "ESQUEMA · NÃO REPRESENTA CAMADAS OU TAMANHO REAIS" : "CONTEXTO NOVO NÃO É RETREINAMENTO AUTOMÁTICO"}</Label>
  </>;
};

const GroundingScene: React.FC<SceneProps> = ({ t, chapter, beat }) => {
  if (beat < 3) return <>
    <Laptop x={360} y={350} scale={1.02}><Label x={0} y={-65} color={C.paper}>Uma afirmação...</Label><path d="M-185 -20H170M-185 22H145M-185 64H78" stroke={C.muted} strokeWidth="10" strokeLinecap="round" /><Label x={0} y={115} color={C.amber} size={25}>APOIO NÃO VERIFICADO</Label></Laptop>
    <Wire d="M635 330H765" progress={reveal(t, chapter, 1)} color={C.amber} dashed /><circle cx="885" cy="330" r="89" fill="#312A36" stroke={C.amber} strokeWidth="3" /><Label x={885} y={360} size={88} color={C.amber}>?</Label>
    <Label x={560} y={680} color={C.amber}>TEXTO FLUENTE PODE ESTAR ERRADO</Label>
  </>;
  const retrieval = reveal(t, chapter, 5), gap = reveal(t, chapter, 7);
  return <>
    {[0, 1, 2].map(i => <Paper key={i} x={200 + i * 45} y={205 + i * 28} scale={.5} angle={-8 + i * 8} title="FONTE" highlight={i === 2 && beat < 7 ? 2 : -1} />)}
    <Processor x={835} y={405} scale={.75} />
    <Wire d="M367 280C500 220 650 230 745 300" progress={retrieval} color={C.mint} />
    <g transform={`translate(${mix(345, 585, retrieval)} ${mix(285, 220, retrieval)})`} opacity={reveal(t, chapter, 3)}>
      <rect x="-105" y="-55" width="210" height="110" rx="10" fill={gap > .5 ? "#563D3A" : "#C9DFBC"} stroke={gap > .5 ? C.amber : C.mint} strokeWidth="3" /><Label x={0} y={-7} color={gap > .5 ? C.amber : "#244632"} size={29}>TRECHO</Label><Label x={0} y={30} color={gap > .5 ? C.amber : "#244632"} size={25}>{gap > .5 ? "SEM CONTEXTO?" : "RELEVANTE"}</Label>
    </g>
    <Token x={280} y={490} text="pergunta" width={245} /><Wire d="M418 490H690" progress={reveal(t, chapter, 5, 1)} />
    <Label x={560} y={655} color={beat < 7 ? C.mint : C.amber}>{beat < 7 ? "BUSCAR → RECUPERAR → INCLUIR NO CONTEXTO" : "ENCONTRAR UM TRECHO NÃO GARANTE A CONCLUSÃO"}</Label>
    <Label x={560} y={715} size={24}>DOCUMENTOS ILUSTRATIVOS</Label>
  </>;
};

const VerifyScene: React.FC<SceneProps> = ({ t, chapter, beat }) => {
  const check = reveal(t, chapter, 3), correct = reveal(t, chapter, 7);
  if (beat >= 9) return <>
    <Laptop x={560} y={340} scale={1.15}><Label x={0} y={-57} size={37} color={C.paper}>Pergunte.</Label><Label x={0} y={4} size={37} color={C.cyan}>Confira.</Label><Label x={0} y={65} size={37} color={C.mint}>Use com critério.</Label></Laptop><Tick x={855} y={265} progress={reveal(t, chapter, 9, .6)} /><Label x={560} y={700} color={C.mint}>CONTEXTO + FONTES + VERIFICAÇÃO</Label>
  </>;
  return <>
    <Paper x={795} y={325} scale={1.1} title="HUGGING FACE" lines={["Tokenizers", "Tokens podem ser", "partes de palavras."]} highlight={beat >= 3 ? 2 : -1} accent={C.mint} />
    <Label x={795} y={565} size={25}>RESUMO DA FONTE</Label>
    <g transform={`translate(280 ${mix(330, 280, correct)})`}>
      <rect x="-195" y="-135" width="390" height="280" rx="24" fill="#172B3E" stroke={correct > .7 ? C.mint : C.amber} strokeWidth="3" />
      <Label x={0} y={-83} color={correct > .7 ? C.mint : C.red} size={25}>{correct > .7 ? "EXEMPLO CORRIGIDO" : "EXEMPLO INCORRETO"}</Label>
      <Label x={0} y={-18} color={C.paper} size={33}>{correct > .7 ? "Um token pode ser" : "Cada token é sempre"}</Label><Label x={0} y={30} color={C.paper} size={33}>{correct > .7 ? "parte de uma palavra." : "uma palavra."}</Label>
      <path d="M-160 52H160" stroke={C.red} strokeWidth="4" opacity={beat >= 4 && correct < .7 ? 1 : 0} />
      <Label x={0} y={107} color={C.muted} size={23}>DEMONSTRAÇÃO DIDÁTICA</Label>
    </g>
    <Wire d="M488 330H632" progress={check} color={correct > .7 ? C.mint : C.amber} dashed={correct < .7} />
    <g transform={`translate(${mix(635, 807, check)} ${mix(200, 338, check)})`} opacity={beat >= 3 && beat < 7 ? 1 : 0}><circle r="60" fill={C.cyan} fillOpacity=".12" stroke={C.cyan} strokeWidth="7" /><path d="M43 43L88 88" stroke={C.cyan} strokeWidth="16" strokeLinecap="round" /></g>
    <Tick x={490} y={505} progress={correct} />
    <Label x={560} y={685} color={beat >= 8 ? C.amber : C.cyan}>{beat >= 8 ? "REDUZIR ERROS NÃO SIGNIFICA ELIMINÁ-LOS" : "ABRA A FONTE E CONFIRA O QUE ELA SUSTENTA"}</Label>
  </>;
};

const SCENES = [AnswerScene, TokenScene, ContextScene, TrainingScene, GroundingScene, VerifyScene];
const NOTES = [
  ["GERAÇÃO", "A resposta é construída em sequência."],
  ["REPRESENTAÇÃO", "Palavras e tokens têm unidades diferentes."],
  ["ATENÇÃO", "O sentido depende das relações no contexto."],
  ["DUAS ETAPAS", "Treinamento e execução têm funções diferentes."],
  ["APOIO", "Recuperar informação ajuda, mas também pode falhar."],
  ["VERIFICAÇÃO", "Uma afirmação precisa de apoio na fonte."],
];
const SOURCE_NAMES = ["GOOGLE · MICROSOFT", "HUGGING FACE", "GOOGLE · MICROSOFT", "MICROSOFT · GOOGLE", "ANTHROPIC · GOOGLE", "ANTHROPIC · HUGGING FACE"];

const AiAnswerEpisode: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const portrait = height > width;
  const chapterIndex = timeline.chapters.reduce((found, c, index) => frame >= c.startFrame ? index : found, 0);
  const chapter = timeline.chapters[chapterIndex];
  const headline = chapterIndex === 3 ? ["Treino: parâmetros.", "Conversa: contexto."] : chapter.headline;
  const t = (frame - chapter.startFrame) / fps;
  const beat = chapter.sentences.reduce((found, sentence, index) => t >= sentence.startSeconds ? index : found, 0);
  const side = chapterIndex === 1 || chapterIndex === 3 ? "left" : "right";
  const Scene = SCENES[chapterIndex];
  const current = captions.find(c => frame / fps * 1000 >= c.startMs && frame / fps * 1000 < c.endMs);
  const currentCue = chapter.startFrame + Math.round(chapter.sentences[beat].startSeconds * fps);
  const gestures: ApprovedRobotGestureCues = { hook: chapter.startFrame + 9, explain: currentCue + 18, point: currentCue + 52, compare: beat === 5 ? currentCue + 80 : -1000, emphasize: beat === 7 ? currentCue + 15 : -1000, conclusion: chapterIndex === 5 ? chapter.startFrame + Math.round(cue(chapter, 9) * fps) : -1000 };
  const entrance = e(t, 0, .5);
  // Small camera reframing follows sentence groups; the objects perform the explanation.
  const zoom = beat >= 3 && beat < 6 ? 1.025 : 1;
  return <AbsoluteFill data-qa="ai-composition" style={{ background: `radial-gradient(ellipse at ${side === "right" ? "80%" : "20%"} 55%, #293353 0%, #14273A 32%, ${C.bg} 72%)`, color: C.paper, fontFamily: "PulsoEpisode, sans-serif", overflow: "hidden" }}>
    <style>{`@font-face{font-family:PulsoEpisode;src:url('${staticFile("NotoSans-Regular.ttf")}');font-weight:400}@font-face{font-family:PulsoEpisode;src:url('${staticFile("NotoSans-Bold.ttf")}');font-weight:700}`}</style><FontReady />
    <svg width={width} height={height} style={{ position: "absolute", inset: 0 }} aria-hidden><path d={`M-200 ${height * .8}Q${width * .5} ${height * .2} ${width + 200} ${height * .3}`} stroke={C.violet} strokeOpacity=".05" strokeWidth="2" fill="none" />{Array.from({ length: 36 }, (_, i) => <circle key={i} cx={(i * 337 + 91) % width} cy={(i * 257 + 45) % height} r={i % 5 === 0 ? 1.6 : 1} fill={C.violet} opacity=".13" />)}</svg>
    <div style={{ position: "absolute", left: portrait ? 86 : 100, top: portrait ? 80 : 48, fontSize: portrait ? 24 : 22, fontWeight: 700, letterSpacing: 4 }}>PULSO <span style={{ color: C.violet }}>EXPLICA</span></div>
    <div style={{ position: "absolute", right: portrait ? 86 : 100, top: portrait ? 85 : 53, fontSize: portrait ? 18 : 17, color: C.muted, letterSpacing: 2 }}>IA · {String(chapterIndex + 1).padStart(2, "0")} / 06</div>
    <div data-qa="title" style={{ position: "absolute", left: portrait ? 86 : side === "right" ? 100 : 650, top: portrait ? 156 : 120, width: portrait ? 908 : 1170, paddingBottom: 20, opacity: .75 + entrance * .25, translate: `0 ${(1 - entrance) * 12}px` }}>
      <div style={{ fontSize: portrait ? 21 : 18, fontWeight: 700, color: C.muted, letterSpacing: 2.2, marginBottom: portrait ? 20 : 14 }}>{chapter.title.toLocaleUpperCase("pt-BR")}</div>
      <div style={{ fontSize: portrait ? 78 : 64, lineHeight: 1.09, fontWeight: 700, letterSpacing: portrait ? -3.2 : -2.5 }}>{headline[0]}<br /><span style={{ color: chapterIndex === 5 ? C.mint : C.violet }}>{headline[1]}</span></div>
    </div>
    <svg data-qa="scene" width={portrait ? 1000 : 1240} height={portrait ? 780 : 620} viewBox={portrait ? "0 -15 1120 875" : "0 0 1120 760"} style={{ position: "absolute", top: portrait ? 385 : 310, left: portrait ? 40 : side === "right" ? 70 : 610, overflow: "hidden" }}><Defs /><g transform={`translate(${560 * (1 - zoom)} ${380 * (1 - zoom)}) scale(${zoom})`}><Scene t={t} chapter={chapter} beat={beat} /></g></svg>
    <div style={{ position: "absolute", left: portrait ? side === "right" ? 630 : 70 : side === "right" ? 1440 : 90, top: portrait ? 1600 : 880, width: 350, height: 38, borderRadius: "50%", background: "radial-gradient(ellipse,rgba(195,174,255,.19),transparent 68%)" }} />
    <ApprovedRobotPresenter src={staticFile("pulso-story/approved-robot-rigged.glb")} side={side} accents={{ primary: C.violet, secondary: C.cyan }} gestureCues={gestures} lipSyncEnvelope={envelope.levels} lipSyncFps={50} canvasSize={portrait ? { width: 500, height: 660 } : { width: 580, height: 850 }} style={{ top: portrait ? 1055 : 95, left: side === "left" ? portrait ? 30 : 0 : undefined, right: side === "right" ? portrait ? 20 : 0 : undefined, zIndex: 3 }} />
    {portrait && <div data-qa="note" style={{ position: "absolute", left: side === "right" ? 86 : 565, top: 1370, width: 420, paddingBottom: 15 }}><div style={{ width: 42, height: 3, background: C.violet, marginBottom: 20 }} /><div style={{ color: C.violet, fontSize: 22, fontWeight: 700, marginBottom: 12, letterSpacing: 2 }}>{NOTES[chapterIndex][0]}</div><div style={{ fontSize: 36, lineHeight: 1.25, fontWeight: 700, letterSpacing: -.8 }}>{NOTES[chapterIndex][1]}</div></div>}
    {current && <div data-qa="caption" style={{ position: "absolute", left: portrait ? 86 : 140, right: portrait ? 86 : 140, top: portrait ? 1660 : 937, height: portrait ? 145 : 90, display: "flex", justifyContent: "center", alignItems: "center", textAlign: "center", fontSize: portrait ? 35 : 33, lineHeight: 1.3, color: C.paper, textShadow: "0 2px 7px #0B1825", zIndex: 4 }}>{current.text}</div>}
    <div style={{ position: "absolute", left: portrait ? 86 : 100, right: portrait ? 86 : 100, bottom: portrait ? 82 : 24, display: "flex", justifyContent: "space-between", color: C.muted, fontSize: portrait ? 16 : 15 }}><span>FONTES: {SOURCE_NAMES[chapterIndex]}</span><span>ANIMAÇÃO DIDÁTICA</span></div>
    <div style={{ position: "absolute", bottom: portrait ? 58 : 0, left: portrait ? 86 : 0, right: portrait ? 86 : 0, height: 3, background: "#304258" }}><div style={{ width: `${frame / (durationInFrames - 1) * 100}%`, height: "100%", background: C.violet }} /></div>
    <Audio src={staticFile("ia-answer-20261023/mix.m4a")} />
  </AbsoluteFill>;
};

export const AiAnswerExplainerCompositions: React.FC = () => <>
  <Composition id="AiAnswerExplainerLandscape" component={AiAnswerEpisode} width={1920} height={1080} fps={24} durationInFrames={timeline.durationFrames} />
  <Composition id="AiAnswerExplainerPortrait" component={AiAnswerEpisode} width={1080} height={1920} fps={24} durationInFrames={timeline.durationFrames} />
</>;
