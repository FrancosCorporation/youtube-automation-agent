import React, { useEffect, useState } from "react";
import { Audio } from "@remotion/media";
import type { Caption } from "@remotion/captions";
import { AbsoluteFill, Composition, Easing, interpolate, staticFile, useCurrentFrame, useDelayRender, useVideoConfig } from "remotion";
import timeline from "../public/gps-explainer/timeline.json";
import envelope from "../public/gps-explainer/audio-envelope.json";
import captions from "../public/gps-explainer/captions.json";
import { ApprovedRobotPresenter } from "./ApprovedRobotPresenter";
import type { ApprovedRobotGestureCues } from "./approved-robot-arm-motion.mjs";

const C = { bg: "#081922", paper: "#F4F1E8", muted: "#A6BBC6", cyan: "#8AE8F2", mint: "#C6F77B", amber: "#FFBC80", violet: "#BAADFF", line: "#304D60" };
const CLAMP = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const ease = Easing.bezier(0.22, 1, 0.36, 1);
const p = (t: number, a: number, b: number) => interpolate(t, [a, b], [0, 1], CLAMP);
const e = (t: number, a: number, b: number) => interpolate(t, [a, b], [0, 1], { ...CLAMP, easing: ease });
const mix = (a: number, b: number, v: number) => a + (b - a) * v;
type P2 = { x: number; y: number };
type P3 = { x: number; y: number; z: number };
type ShotProps = { t: number; portrait: boolean };
const start = (id: string) => timeline.segments.find((s) => s.id === id)!.startSeconds;
const TIMES = timeline.segments.map((s) => s.startSeconds);

const FontReady: React.FC = () => {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Carregando tipografia GPS"));
  useEffect(() => {
    Promise.all([document.fonts.load("400 32px PulsoGps"), document.fonts.load("700 78px PulsoGps")])
      .then(() => continueRender(handle)).catch(cancelRender);
  }, [handle, continueRender, cancelRender]);
  return null;
};

// Orthographic rotation preserves equal radii in the spherical explanation.
const project = ({ x, y, z }: P3, yaw = 0.42): P2 => {
  const xx = x * Math.cos(yaw) + z * Math.sin(yaw);
  const zz = -x * Math.sin(yaw) + z * Math.cos(yaw);
  return { x: xx, y: y * Math.cos(-0.28) - zz * Math.sin(-0.28) };
};
const pathOf = (pts: P2[]) => pts.map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(" ");

const Defs: React.FC = () => <defs>
  <linearGradient id="gps-v2-metal" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#F2F6ED" /><stop offset=".5" stopColor="#A9C0CB" /><stop offset="1" stopColor="#56788B" /></linearGradient>
  <linearGradient id="gps-v2-screen" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#23465C" /><stop offset="1" stopColor="#102A3B" /></linearGradient>
  <radialGradient id="gps-v2-earth" cx="30%" cy="20%"><stop stopColor="#397D91" /><stop offset=".6" stopColor="#1C4259" /><stop offset="1" stopColor="#0B2438" /></radialGradient>
  <radialGradient id="gps-v2-sphere"><stop stopColor={C.cyan} stopOpacity="0" /><stop offset=".78" stopColor={C.cyan} stopOpacity=".025" /><stop offset="1" stopColor={C.cyan} stopOpacity=".15" /></radialGradient>
  <filter id="gps-v2-glow" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
  <clipPath id="gps-v2-phone-screen"><rect x="-88" y="-158" width="176" height="306" rx="20" /></clipPath>
</defs>;

const Label: React.FC<{ x: number; y: number; children: React.ReactNode; color?: string; size?: number; anchor?: "start" | "middle" | "end" }> = ({ x, y, children, color = C.muted, size = 25, anchor = "middle" }) => <text x={x} y={y} fill={color} fontSize={size} fontWeight="700" textAnchor={anchor} letterSpacing="1.3">{children}</text>;

const Pin: React.FC<{ x: number; y: number; scale?: number; color?: string; reveal?: number }> = ({ x, y, scale = 1, color = C.mint, reveal = 1 }) => <g transform={`translate(${x} ${y - (1 - reveal) * 34}) scale(${scale})`} opacity={reveal}>
  <ellipse cy="18" rx="22" ry="7" fill={color} opacity=".18" />
  <path d="M0 12C-8 1 -26 -14 -26 -31A26 26 0 0 1 26 -31C26 -14 8 1 0 12Z" fill={color} stroke="#F4FFDC" strokeWidth="1.5" />
  <circle cy="-31" r="9" fill="#15312F" />
</g>;

const Phone: React.FC<{ x: number; y: number; scale?: number; solved?: number; scan?: number; angle?: number }> = ({ x, y, scale = 1, solved = 0, scan = 0, angle = 0 }) => <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
  <ellipse cy="211" rx="108" ry="21" fill="#020C15" opacity=".45" />
  <rect x="-109" y="-185" width="218" height="386" rx="36" fill="#061019" stroke="#426074" strokeWidth="3" />
  <rect x="-104" y="-190" width="208" height="386" rx="34" fill="url(#gps-v2-metal)" />
  <rect x="-99" y="-185" width="198" height="376" rx="29" fill="#0A1A27" />
  <rect x="-88" y="-158" width="176" height="306" rx="20" fill="url(#gps-v2-screen)" />
  <g clipPath="url(#gps-v2-phone-screen)">
    <g transform={`translate(${mix(-16, 0, solved)} ${mix(12, 0, solved)})`}>
      <path d="M-120 -70L-20 -20L15 -140M-95 130L-20 -20L115 10M-130 35L-5 75L130 -100M-65 -190L-55 170M80 -190L45 170" fill="none" stroke="#3C6173" strokeWidth="14" />
      <path d="M-120 -70L-20 -20L15 -140M-95 130L-20 -20L115 10M-130 35L-5 75L130 -100" fill="none" stroke="#69919B" strokeWidth="3" opacity=".7" />
      <path d="M5 170C-15 100 85 110 75 55S100 0 125 -20" fill="none" stroke="#2C7991" strokeWidth="35" opacity=".7" />
    </g>
    <circle cy="-8" r={32 + scan * 52} stroke={C.cyan} strokeWidth="2" fill="none" opacity={(1 - scan) * (1 - solved)} />
    <circle cy="-8" r="8" fill={solved > .5 ? C.mint : C.cyan} />
    <g opacity={solved}><circle cy="-8" r="34" stroke={C.mint} strokeWidth="2" fill={C.mint} fillOpacity=".1" /><Pin x={0} y={-8} scale={.9} reveal={solved} /></g>
  </g>
  <rect x="-26" y="-173" width="52" height="8" rx="4" fill="#506C7C" />
  <rect x="-31" y="167" width="62" height="5" rx="2.5" fill="#91ABB7" />
</g>;

const Satellite: React.FC<{ x: number; y: number; scale?: number; angle?: number; color?: string; label?: string }> = ({ x, y, scale = 1, angle = 0, color = C.cyan, label }) => <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
  <path d="M-155 -34H-56V34H-155Z M56 -34H155V34H56Z" fill="#153D59" stroke={color} strokeWidth="2.5" />
  {[-143, -119, -95, -71, 71, 95, 119, 143].map((xx) => <path key={xx} d={`M${xx} -32V32`} stroke={color} opacity=".4" strokeWidth="1.5" />)}
  <path d="M-155 -11H-56 M-155 11H-56 M56 -11H155 M56 11H155" stroke={color} opacity=".4" />
  <path d="M-58 0H58" stroke="#B7D0DA" strokeWidth="8" />
  <path d="M-40 -43L24 -50L42 -30V40L-24 49L-42 30Z" fill="url(#gps-v2-metal)" stroke="#D4EBEE" strokeWidth="2" />
  <path d="M-5 -45L9 -75L25 -70L26 -48" fill="#B5CDD5" />
  <circle r="19" fill="#122D3D" stroke={color} strokeWidth="2" /><circle r="9" fill={color} />
  <path d="M-16 53Q0 74 16 53M-25 64Q0 91 25 64" fill="none" stroke={color} strokeWidth="3" opacity=".8" />
  {label && <Label x={0} y={112} color={color} size={24}>{label}</Label>}
</g>;

const Clock: React.FC<{ x: number; y: number; scale?: number; adjust?: number; simple?: boolean }> = ({ x, y, scale = 1, adjust = 0, simple = false }) => {
  const angle = mix(42, 0, adjust) * Math.PI / 180;
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <circle r="105" fill="#112B3A" stroke={adjust > .98 ? C.mint : C.amber} strokeWidth="4" />
    <circle r="91" fill="none" stroke="#456071" strokeWidth="1.5" />
    {Array.from({ length: 12 }, (_, i) => {
      const a = i * Math.PI / 6;
      return <line key={i} x1={Math.sin(a) * 78} y1={-Math.cos(a) * 78} x2={Math.sin(a) * 86} y2={-Math.cos(a) * 86} stroke={C.paper} strokeWidth="3" opacity=".8" />;
    })}
    {!simple && <line x1="0" y1="0" x2="0" y2="-68" stroke={C.mint} strokeWidth="5" strokeDasharray="5 6" opacity={1 - adjust * .5} />}
    <line x1="0" y1="0" x2={Math.sin(angle) * 67} y2={-Math.cos(angle) * 67} stroke={adjust > .98 ? C.mint : C.amber} strokeWidth="6" strokeLinecap="round" />
    <line x1="0" y1="0" x2="-36" y2="20" stroke={C.paper} strokeWidth="6" strokeLinecap="round" /><circle r="8" fill={C.paper} />
  </g>;
};

const Sphere: React.FC<{ x: number; y: number; radius: number; yaw: number; color?: string; opacity?: number; detailed?: boolean }> = ({ x, y, radius, yaw, color = C.cyan, opacity = 1, detailed = true }) => <g transform={`translate(${x} ${y})`} opacity={opacity}>
  <circle r={radius} fill="url(#gps-v2-sphere)" stroke={color} strokeWidth="2" strokeOpacity=".55" />
  {Array.from({ length: detailed ? 7 : 4 }, (_, i) => {
    const az = i * Math.PI / (detailed ? 7 : 4);
    const points = Array.from({ length: 73 }, (_, j) => {
      const a = j / 72 * Math.PI * 2;
      return project({ x: Math.sin(a) * Math.cos(az) * radius, y: Math.cos(a) * radius, z: Math.sin(a) * Math.sin(az) * radius }, yaw);
    });
    return <path key={i} d={pathOf(points)} fill="none" stroke={color} strokeWidth="1.3" opacity=".29" />;
  })}
  {[-.55, 0, .55].map((lat) => {
    const rr = radius * Math.sqrt(1 - lat * lat);
    const points = Array.from({ length: 73 }, (_, j) => project({ x: Math.cos(j / 72 * Math.PI * 2) * rr, y: lat * radius, z: Math.sin(j / 72 * Math.PI * 2) * rr }, yaw));
    return <path key={lat} d={pathOf(points)} fill="none" stroke={color} strokeWidth="1.4" opacity=".35" />;
  })}
</g>;

const RadioPulse: React.FC<{ a: P2; b: P2; progress: number; color?: string }> = ({ a, b, progress, color = C.cyan }) => {
  const x = mix(a.x, b.x, progress), y = mix(a.y, b.y, progress);
  const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  return <g>
    <path d={`M${a.x} ${a.y}L${x} ${y}`} fill="none" stroke={color} strokeWidth="3" opacity=".42" />
    {progress > 0 && progress < 1 && <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <path d="M-26 -16Q-10 0 -26 16M-13 -23Q10 0 -13 23M0 -29Q29 0 0 29" fill="none" stroke={color} strokeWidth="4" />
      <circle r="7" fill={C.paper} filter="url(#gps-v2-glow)" />
    </g>}
    {progress === 1 && <circle cx={b.x} cy={b.y} r="18" fill={color} opacity=".18" />}
  </g>;
};

const PhoneShot: React.FC<ShotProps & { final?: boolean }> = ({ t, portrait, final = false }) => {
  const local = final ? t - start("resolution") : t;
  const out = e(local, 0, 1.5);
  const zoom = final ? mix(.82, 1.26, out) : mix(1.42, 1.08, out);
  const cx = portrait ? 500 : 560, cy = portrait ? 430 : 350;
  const solved = final ? e(local, 1.35, 2.2) : 0;
  return <g>
    <g opacity={.3 + solved * .4} transform={`translate(${cx} ${cy}) rotate(-13) scale(${mix(1.3, 1.05, out)})`}>
      <path d="M-500 -190L-160 -90L-40 -320M-520 220L-160 -90L310 50L480 -110M-400 55L-25 220L380 -300M-290 -420L-190 400M280 -430L140 390" fill="none" stroke="#22465A" strokeWidth="28" />
      <path d="M-500 -190L-160 -90L-40 -320M-520 220L-160 -90L310 50L480 -110M-400 55L-25 220L380 -300" fill="none" stroke="#406A7A" strokeWidth="3" />
      <path d="M500 -300Q280 -140 360 60T160 400" fill="none" stroke="#1C5F78" strokeWidth="80" />
    </g>
    {!final && <g opacity={out}>
      <circle cx={cx} cy={cy} r="258" fill="none" stroke={C.cyan} strokeOpacity=".18" strokeWidth="2" />
      <circle cx={cx} cy={cy} r="305" fill="none" stroke={C.cyan} strokeOpacity=".07" strokeWidth="2" />
      <Label x={cx - 290} y={cy - 50} color={C.cyan} size={26}>SINAIS</Label>
      <path d={`M${cx - 290} ${cy - 25}Q${cx - 170} ${cy - 25} ${cx - 130} ${cy + 30}`} fill="none" stroke={C.cyan} strokeWidth="2" strokeDasharray="5 7" />
    </g>}
    <Phone x={cx} y={cy} scale={zoom} angle={mix(-9, -3, out)} solved={solved} scan={(local % 1.35) / 1.35} />
    {final && <g opacity={solved}>
      <path d={`M${cx + 145} ${cy - 20}H${cx + 205}`} stroke={C.mint} strokeWidth="2" />
      <Label x={cx + 265} y={cy - 28} color={C.mint} size={29}>VOCÊ</Label>
      <Label x={cx + 265} y={cy + 9} size={20}>ESTÁ AQUI</Label>
    </g>}
    <Label x={cx} y={portrait ? 770 : 650} color={final ? C.mint : C.cyan} size={27}>{final ? "TEMPO → DISTÂNCIAS → POSIÇÃO" : "O CELULAR FAZ O CÁLCULO"}</Label>
  </g>;
};

const TransmissionShot: React.FC<ShotProps> = ({ t, portrait }) => {
  const cx = portrait ? 500 : 560, cy = portrait ? 440 : 370;
  const source = { x: 250, y: portrait ? 220 : 180 };
  const receiver = { x: portrait ? 750 : 865, y: portrait ? 640 : 510 };
  const orbit = p(t, 3, 14.42);
  const sat = { x: source.x - 48 + orbit * 110, y: source.y - Math.sin(orbit * 2.3) * 30 };
  const transmitted = { x: source.x - 48 + p(6.675, 3, 14.42) * 110, y: source.y - Math.sin(p(6.675, 3, 14.42) * 2.3) * 30 + 60 };
  const pull = e(t, 4.7, 6.65);
  const camera = mix(1.52, 1, pull);
  const focusX = mix(380, cx, pull), focusY = mix(portrait ? 360 : 280, cy, pull);
  const travel = p(t, 6.88, 9.15);
  const distance = e(t, 10.1, 11.7);
  const lineLength = Math.hypot(receiver.x - transmitted.x, receiver.y - transmitted.y);
  const angle = Math.atan2(receiver.y - transmitted.y, receiver.x - transmitted.x) * 180 / Math.PI;
  return <g transform={`translate(${cx} ${cy}) scale(${camera}) translate(${-focusX} ${-focusY})`}>
    <g opacity=".36"><circle cx={receiver.x} cy={receiver.y + 235} r="250" fill="url(#gps-v2-earth)" stroke="#47828D" strokeWidth="2" /><ellipse cx={receiver.x} cy={receiver.y + 235} rx="90" ry="250" fill="none" stroke="#59919C" strokeWidth="1.5" /><ellipse cx={receiver.x} cy={receiver.y + 235} rx="250" ry="70" fill="none" stroke="#59919C" strokeWidth="1.5" /></g>
    <path d={`M70 ${source.y + 105}Q290 ${source.y - 150} 580 ${source.y + 80}`} fill="none" stroke={C.cyan} strokeOpacity=".15" strokeWidth="2" strokeDasharray="6 11" />
    <Satellite x={sat.x} y={sat.y} scale={.8} angle={mix(-13, 9, orbit)} />
    <g opacity={e(t, 3.4, 4.05) * (1 - e(t, 6.2, 6.6))}>
      <path d={`M${sat.x + 90} ${sat.y - 18}H${sat.x + 165}`} stroke={C.cyan} strokeWidth="2" />
      <Label x={sat.x + 180} y={sat.y - 28} anchor="start" color={C.paper} size={25}>HORÁRIO DO SINAL</Label>
      <Label x={sat.x + 180} y={sat.y + 14} anchor="start" color={C.cyan} size={25}>POSIÇÃO DO SATÉLITE</Label>
    </g>
    <Phone x={receiver.x} y={receiver.y} scale={.53} scan={(Math.max(0, t - 3) % 1.5) / 1.5} />
    <g opacity={e(t, 6.68, 6.9)}><path d={`M${transmitted.x} ${transmitted.y}L${receiver.x} ${receiver.y}`} stroke={C.cyan} strokeWidth="2" opacity=".2" strokeDasharray="4 11" />
      <RadioPulse a={transmitted} b={receiver} progress={travel} />
      <Label x={transmitted.x - 10} y={transmitted.y + 58} color={C.cyan} size={23}>EMISSÃO</Label>
      <Label x={receiver.x} y={receiver.y + 143} color={travel === 1 ? C.mint : C.muted} size={23}>{travel === 1 ? "RECEBIDO" : "RECEPTOR"}</Label>
    </g>
    <g opacity={e(t, 7.1, 7.4) * (1 - e(t, 9.7, 10.05))}>
      <Clock x={cx - 80} y={cy + 160} scale={.39} adjust={travel} simple />
      <Label x={cx - 80} y={cy + 229} color={C.cyan} size={25}>TEMPO DE VIAGEM</Label>
    </g>
    <g opacity={distance} transform={`translate(${transmitted.x + 25} ${transmitted.y - 45}) rotate(${angle})`}>
      <path d={`M0 -13V13M0 0H${lineLength * distance}M${lineLength * distance} -13V13`} stroke={C.amber} strokeWidth="3.5" />
      {Array.from({ length: 17 }, (_, i) => <path key={i} d={`M${lineLength * i / 16} 0V${i % 4 === 0 ? -13 : -7}`} stroke={C.amber} strokeWidth="2" opacity={p(distance, i / 18, (i + 1) / 18)} />)}
    </g>
    <g opacity={e(t, 10.7, 11.1)}>
      <Label x={cx - 15} y={portrait ? 800 : 700} color={C.amber} size={29}>DISTÂNCIA ≈ VELOCIDADE × TEMPO</Label>
    </g>
  </g>;
};

const OneSphereShot: React.FC<ShotProps> = ({ t, portrait }) => {
  const local = t - start("one_range"), unfold = e(local, .1, 1.2);
  const cx = portrait ? 500 : 560, cy = portrait ? 423 : 350;
  const yaw = .35 + local * .12, r = 255 * unfold;
  const candidates = [0, .88, 1.9, 3.3, 4.4, 5.45].map((a) => project({ x: 255 * Math.cos(a), y: 255 * Math.sin(a) * .7, z: 255 * Math.sin(a) * Math.sqrt(1 - .49) }, yaw));
  return <g>
    <Sphere x={cx} y={cy} radius={r} yaw={yaw} />
    <Satellite x={cx} y={cy} scale={.48} angle={-8 + local * 2.5} />
    {candidates.map((q, i) => <g key={i} opacity={e(local, .7 + i * .12, 1.1 + i * .12)}>
      <line x1={cx} y1={cy} x2={cx + q.x} y2={cy + q.y} stroke={C.cyan} strokeWidth="1.5" strokeDasharray="5 7" opacity={i === 0 ? .75 : .22} />
      <circle cx={cx + q.x} cy={cy + q.y} r={i === 0 ? 12 : 8} fill={i === 0 ? C.amber : C.cyan} />
      <circle cx={cx + q.x} cy={cy + q.y} r="19" fill="none" stroke={i === 0 ? C.amber : C.cyan} strokeWidth="2" opacity=".3" />
    </g>)}
    <g opacity={e(local, 1, 1.7)}><Label x={cx} y={portrait ? 760 : 670} color={C.cyan} size={28}>MESMA DISTÂNCIA · VÁRIAS POSSIBILIDADES</Label></g>
  </g>;
};

const CENTERS: P3[] = [{ x: -205, y: -90, z: 55 }, { x: 165, y: -120, z: -60 }, { x: 25, y: 157, z: 98 }, { x: 95, y: -16, z: -195 }];
const RANGE_COLORS = [C.cyan, C.violet, C.mint, C.amber];
// Actual intersection circle of the first two spheres, projected into the scene.
// Their radii are the distances to the origin; the common plane passes through it.
const sharedRange = (yaw: number) => {
  const a = CENTERS[0], b = CENTERS[1];
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const length = Math.hypot(d.x, d.y, d.z);
  const n = { x: d.x / length, y: d.y / length, z: d.z / length };
  const dot = a.x * n.x + a.y * n.y + a.z * n.z;
  const center = { x: a.x - dot * n.x, y: a.y - dot * n.y, z: a.z - dot * n.z };
  const radius = Math.sqrt(a.x ** 2 + a.y ** 2 + a.z ** 2 - dot ** 2);
  const uLength = Math.hypot(n.z, n.x);
  const u = { x: -n.z / uLength, y: 0, z: n.x / uLength };
  const v = { x: n.y * u.z, y: n.z * u.x - n.x * u.z, z: -n.y * u.x };
  return pathOf(Array.from({ length: 97 }, (_, i) => {
    const theta = i / 96 * Math.PI * 2;
    return project({ x: center.x + radius * (u.x * Math.cos(theta) + v.x * Math.sin(theta)), y: center.y + radius * v.y * Math.sin(theta), z: center.z + radius * (u.z * Math.cos(theta) + v.z * Math.sin(theta)) }, yaw);
  }));
};
const IntersectionShot: React.FC<ShotProps & { complete?: boolean }> = ({ t, portrait, complete = false }) => {
  const local = t - start("intersection"), fourth = t >= start("fourth_signal");
  const cx = portrait ? 500 : 560, cy = portrait ? 440 : 370;
  const yaw = .45 + (t - 19.4) * .025, zoom = portrait ? .96 : 1.04;
  const corrected = complete ? e(t, 29.25, 30.25) : 0;
  return <g>
    <g transform={`translate(${cx} ${cy}) scale(${zoom})`}>
      {CENTERS.slice(0, fourth ? 4 : 3).map((c, i) => {
        const q = project(c, yaw), r = Math.hypot(c.x, c.y, c.z);
        const reveal = complete ? 1 : i === 3 ? e(t, start("fourth_signal") + .08, start("fourth_signal") + .8) : e(local, i * .56, i * .56 + .75);
        const pulse = complete ? 1 : i === 3 ? p(t, start("fourth_signal") + .2, start("fourth_signal") + 1.35) : p(local, i * .56 + .08, i * .56 + .75);
        return <g key={i} opacity={reveal}>
          <Sphere x={q.x} y={q.y} radius={r * reveal} yaw={yaw + i * .6} color={RANGE_COLORS[i]} opacity={complete ? .31 : .54} detailed={false} />
          <RadioPulse a={q} b={{ x: 0, y: 0 }} progress={pulse} color={RANGE_COLORS[i]} />
          <Satellite x={q.x} y={q.y} scale={.31} angle={-10 + i * 10} color={RANGE_COLORS[i]} />
        </g>;
      })}
      <path d={sharedRange(yaw)} fill="none" stroke={complete ? C.mint : C.paper} strokeWidth="2.5" opacity={e(local, 1.05, 1.7) * (complete ? .3 : .65)} pathLength="1" strokeDasharray="1" strokeDashoffset={1 - e(local, 1.05, 2)} />
      <circle r={mix(40, 12, corrected)} fill={complete ? C.mint : C.paper} fillOpacity=".07" stroke={complete ? C.mint : C.paper} strokeWidth="2" strokeDasharray={complete ? undefined : "4 6"} />
      {complete ? <Pin x={0} y={0} scale={1.15} reveal={corrected} /> : <circle r="6" fill={C.paper} />}
    </g>
    <Label x={cx} y={portrait ? 823 : 710} color={complete ? C.mint : C.paper} size={26}>{complete ? "POSIÇÃO + CORREÇÃO DO RELÓGIO" : fourth ? "A QUARTA MEDIDA ENTRA NO CÁLCULO" : "AS MEDIÇÕES SE ENCONTRAM"}</Label>
  </g>;
};

const ClockShot: React.FC<ShotProps> = ({ t, portrait }) => {
  const local = t - 24.858, cx = portrait ? 500 : 560, cy = portrait ? 435 : 355;
  const arrival = p(t, 26.35, 27.9), correction = e(t, 27.7, 29.1);
  const scale = mix(1.4, 1.7, e(local, 0, .8));
  return <g>
    <Phone x={cx + 190} y={cy + 80} scale={.83} angle={-7} />
    <path d={`M${cx + 160} ${cy + 25}L${cx + 50} ${cy - 12}`} stroke={C.amber} strokeWidth="2" opacity=".6" />
    <Clock x={cx - 100} y={cy} scale={scale} adjust={correction} />
    <Satellite x={cx - 330} y={cy - 255} scale={.35} angle={-12} color={C.amber} />
    <RadioPulse a={{ x: cx - 310, y: cy - 224 }} b={{ x: cx - 140, y: cy - 160 }} progress={arrival} color={C.amber} />
    <Label x={cx - 100} y={cy + 235} color={correction > .98 ? C.mint : C.amber} size={28}>{correction > .98 ? "ERRO DE TEMPO CORRIGIDO" : "RELÓGIO DO CELULAR"}</Label>
    <g opacity={1 - correction}><path d={`M${cx - 100} ${cy - 202}V${cy - 229}`} stroke={C.mint} strokeWidth="2" /><Label x={cx - 100} y={cy - 245} color={C.mint} size={21}>TEMPO DE REFERÊNCIA</Label></g>
  </g>;
};

const HEADINGS = [
  ["COMO O GPS ENCONTRA VOCÊ?", "Seu celular", "faz o cálculo."],
  ["01 / O SINAL", "Tudo começa", "com o horário."],
  ["02 / A VIAGEM", "O tempo", "de chegar."],
  ["03 / A MEDIDA", "O atraso", "vira distância."],
  ["04 / AS POSSIBILIDADES", "Uma distância.", "Muitos lugares."],
  ["05 / O CRUZAMENTO", "Mais sinais.", "Menos dúvidas."],
  ["06 / O RELÓGIO", "Por que", "pelo menos quatro?"],
  ["07 / A RESPOSTA", "Sinais invisíveis.", "Você no mapa."],
];
const NOTES = [
  ["RECEPTOR", "O cálculo acontece aqui.", C.cyan],
  ["SATÉLITE", "Tempo e posição no mesmo sinal.", C.cyan],
  ["PROPAGAÇÃO", "Da emissão à chegada.", C.cyan],
  ["DISTÂNCIA", "Velocidade × tempo de viagem.", C.amber],
  ["UMA ESFERA", "Todos os pontos à mesma distância.", C.cyan],
  ["MEDIÇÕES", "As distâncias restringem a posição.", C.violet],
  ["QUARTA MEDIDA", "Posição e ajuste de tempo, juntos.", C.amber],
  ["POSIÇÃO", "Um ponto calculado pelo celular.", C.mint],
];

const GpsV2: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const t = frame / fps, portrait = height > width;
  let beatIndex = 0;
  TIMES.forEach((time, i) => { if (t >= time) beatIndex = i; });
  const robotSide = beatIndex === 4 || beatIndex === 5 ? "left" : "right";
  const bodyLeft = portrait ? 40 : robotSide === "right" ? 70 : 610;
  const bodyTop = portrait ? 375 : 310;
  const bodyWidth = portrait ? 1000 : 1240;
  const bodyHeight = portrait ? 780 : 620;
  const titleLeft = portrait ? 86 : robotSide === "right" ? 100 : 650;
  const heading = HEADINGS[beatIndex];
  const headingIn = beatIndex === 0 ? 1 : e(t, TIMES[beatIndex], TIMES[beatIndex] + .38);
  const cueStart = TIMES[beatIndex];
  const cueFrame = (seconds: number) => Math.round(seconds * fps);
  const gestureCues: ApprovedRobotGestureCues = {
    hook: cueFrame(.45),
    explain: cueFrame(cueStart + .9),
    point: cueFrame(beatIndex === 6 ? (t < 27 ? 25.25 : 28.05) : cueStart + 1.65),
    compare: cueFrame(beatIndex === 5 ? 20.3 : -10),
    emphasize: cueFrame(beatIndex === 4 ? 16.7 : beatIndex === 6 ? 23.45 : -10),
    conclusion: cueFrame(33.1),
  };
  const currentCaption = (captions as Caption[]).find((q) => t * 1000 >= q.startMs && t * 1000 < q.endMs);
  const note = NOTES[beatIndex];
  const title = beatIndex === 6 && t >= 24.858 ? ["O relógio também", "entra na conta."] : [heading[1], heading[2]];
  const bgGlowX = robotSide === "right" ? "78%" : "22%";
  return <AbsoluteFill data-qa="gps-composition" style={{ background: `radial-gradient(ellipse at ${bgGlowX} 55%, #153F47 0%, #0C2330 35%, ${C.bg} 72%)`, color: C.paper, fontFamily: "PulsoGps, sans-serif", overflow: "hidden" }}>
    <style>{`@font-face{font-family:PulsoGps;src:url('${staticFile("NotoSans-Regular.ttf")}');font-weight:400}@font-face{font-family:PulsoGps;src:url('${staticFile("NotoSans-Bold.ttf")}');font-weight:700}`}</style>
    <FontReady />
    <svg width={width} height={height} style={{ position: "absolute", inset: 0 }} aria-hidden>
      {Array.from({ length: 42 }, (_, i) => <circle key={i} cx={(i * 337 + 91) % width} cy={(i * 257 + 45) % height} r={i % 5 === 0 ? 1.7 : 1} fill={C.cyan} opacity={i % 3 === 0 ? .19 : .08} />)}
      <ellipse cx={width * .55} cy={height * .6} rx={width * .7} ry={height * .37} fill="none" stroke={C.cyan} strokeOpacity=".035" strokeWidth="2" transform={`rotate(-15 ${width / 2} ${height / 2})`} />
    </svg>
    <div style={{ position: "absolute", left: portrait ? 86 : 100, top: portrait ? 80 : 48, fontSize: portrait ? 24 : 22, fontWeight: 700, letterSpacing: 4 }}>PULSO <span style={{ color: C.cyan }}>EXPLICA</span></div>
    <div style={{ position: "absolute", right: portrait ? 86 : 100, top: portrait ? 85 : 53, fontSize: portrait ? 18 : 17, color: C.muted, letterSpacing: 2.5 }}>GPS / TECNOLOGIA</div>
    <div data-qa="title" style={{ position: "absolute", left: titleLeft, top: portrait ? 156 : 120, width: portrait ? 908 : 1180, paddingBottom: 20, opacity: .72 + headingIn * .28, translate: `0 ${(1 - headingIn) * 15}px` }}>
      <div style={{ fontSize: portrait ? 21 : 18, letterSpacing: 3, fontWeight: 700, color: C.muted, marginBottom: portrait ? 20 : 14 }}>{heading[0]}</div>
      <div style={{ fontSize: portrait ? 78 : 66, fontWeight: 700, lineHeight: 1.08, letterSpacing: portrait ? -3.6 : -2.5 }}>{title[0]}<br /><span style={{ color: beatIndex === 7 ? C.mint : C.cyan }}>{title[1]}</span></div>
    </div>
    <svg data-qa="scene" width={bodyWidth} height={bodyHeight} viewBox={portrait ? "0 0 1000 880" : "0 0 1120 760"} style={{ position: "absolute", left: bodyLeft, top: bodyTop, overflow: "hidden" }}>
      <Defs />
      {beatIndex === 0 && <PhoneShot t={t} portrait={portrait} />}
      {beatIndex >= 1 && beatIndex <= 3 && <TransmissionShot t={t} portrait={portrait} />}
      {beatIndex === 4 && <OneSphereShot t={t} portrait={portrait} />}
      {(beatIndex === 5 || (beatIndex === 6 && t < 24.858)) && <IntersectionShot t={t} portrait={portrait} />}
      {beatIndex === 6 && t >= 24.858 && t < 29.35 && <ClockShot t={t} portrait={portrait} />}
      {beatIndex === 6 && t >= 29.35 && <IntersectionShot t={t} portrait={portrait} complete />}
      {beatIndex === 7 && <PhoneShot t={t} portrait={portrait} final />}
    </svg>
    <div style={{ position: "absolute", left: portrait ? (robotSide === "right" ? 630 : 70) : (robotSide === "right" ? 1440 : 90), top: portrait ? 1600 : 880, width: portrait ? 350 : 380, height: 38, borderRadius: "50%", background: "radial-gradient(ellipse,rgba(138,232,242,.2),transparent 68%)" }} />
    <ApprovedRobotPresenter src={staticFile("pulso-story/approved-robot-rigged.glb")} side={robotSide} accents={{ primary: C.cyan, secondary: C.mint }} gestureCues={gestureCues} lipSyncEnvelope={envelope.levels} lipSyncFps={1000 / envelope.stepMs}
      canvasSize={portrait ? { width: 500, height: 660 } : { width: 580, height: 850 }}
      style={{ top: portrait ? 1055 : 95, left: robotSide === "left" ? (portrait ? 30 : 0) : undefined, right: robotSide === "right" ? (portrait ? 20 : 0) : undefined, zIndex: 3 }} />
    {portrait && <div data-qa="note" style={{ position: "absolute", left: robotSide === "right" ? 86 : 565, top: 1375, width: 420, paddingBottom: 12 }}>
      <div style={{ width: 42, height: 3, background: note[2], marginBottom: 22 }} />
      <div style={{ color: note[2], fontSize: 22, fontWeight: 700, letterSpacing: 2.2, marginBottom: 12 }}>{note[0]}</div>
      <div style={{ fontSize: 36, lineHeight: 1.25, fontWeight: 700, letterSpacing: -.8 }}>{note[1]}</div>
    </div>}
    {currentCaption && <div data-qa="caption" style={{ position: "absolute", left: portrait ? 86 : 140, right: portrait ? 86 : 140, top: portrait ? 1650 : 937, height: portrait ? 153 : 90, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: portrait ? 33 : 32, lineHeight: 1.3, color: C.paper, zIndex: 4, textShadow: "0 2px 7px #081922" }}>{currentCaption.text}</div>}
    <div style={{ position: "absolute", left: portrait ? 86 : 100, right: portrait ? 86 : 100, bottom: portrait ? 82 : 24, display: "flex", justifyContent: "space-between", color: C.muted, fontSize: portrait ? 17 : 15, letterSpacing: .5 }}>
      <span>FONTES: FAA · USGS · GPS.GOV</span><span>{portrait ? "ESQUEMA FORA DE ESCALA" : "Animação didática · distâncias e tempos fora de escala"}</span>
    </div>
    <div style={{ position: "absolute", bottom: portrait ? 58 : 0, left: portrait ? 86 : 0, right: portrait ? 86 : 0, height: 3, background: "#28404B" }}><div style={{ width: `${frame / (durationInFrames - 1) * 100}%`, height: "100%", background: C.cyan }} /></div>
    <Audio src={staticFile("gps-explainer/mix-v2.m4a")} />
  </AbsoluteFill>;
};

export const GpsExplainerV2Compositions: React.FC = () => <>
  <Composition id="GpsExplainerV2Landscape" component={GpsV2} width={1920} height={1080} fps={24} durationInFrames={Math.ceil((timeline.audioDurationSeconds + 1.8) * 24)} />
  <Composition id="GpsExplainerV2Portrait" component={GpsV2} width={1080} height={1920} fps={24} durationInFrames={Math.ceil((timeline.audioDurationSeconds + 1.8) * 24)} />
</>;
