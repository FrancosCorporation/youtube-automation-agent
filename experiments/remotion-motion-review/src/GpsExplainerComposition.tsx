import { Audio } from "@remotion/media";
import {
  CalculateMetadataFunction,
  Composition,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import timeline from "../public/gps-explainer/timeline.json";

type Props = {};

const FPS = 24;
const DURATION = Math.ceil((timeline.audioDurationSeconds + 1.8) * FPS);
const CLAMP = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const EASE = Easing.bezier(0.16, 1, 0.3, 1);
const COLORS = {
  sky: "#091321",
  ink: "#F4F7FA",
  muted: "#98AAB9",
  line: "#30465A",
  cyan: "#8AE8F2",
  blue: "#57B8F7",
  mint: "#C6F77B",
  amber: "#FFBA7A",
  violet: "#B6A3FF",
  earth: "#173A58",
};

const VOICE = timeline.segments.map((segment) => ({
  id: segment.id,
  from: Math.round(segment.startSeconds * FPS),
  duration: Math.ceil(segment.durationSeconds * FPS),
  text: segment.text,
}));
const beat = (id: string) => {
  const item = VOICE.find((entry) => entry.id === id);
  if (!item) throw new Error(`GPS timeline is missing beat: ${id}`);
  return item.from;
};

const eased = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, Math.max(start + 1, end)], [0, 1], { ...CLAMP, easing: EASE });
const linear = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, Math.max(start + 1, end)], [0, 1], CLAMP);
const visibility = (frame: number, start: number, end: number, fade = 14) =>
  eased(frame, start, start + fade) * (1 - eased(frame, end - fade, end));

const SATELLITES = [
  { x: 190, y: 590, angle: -22, color: COLORS.cyan, radius: 396, label: "01" },
  { x: 890, y: 590, angle: 22, color: COLORS.mint, radius: 396, label: "02" },
  { x: 340, y: 420, angle: -12, color: COLORS.violet, radius: 390, label: "03" },
  { x: 740, y: 420, angle: 12, color: COLORS.amber, radius: 390, label: "04" },
];
const RECEIVER = { x: 540, y: 755 };
const RANGE_ANGLES = [-166, -145, -122, -100, -80, -58, -35, -14];

const fontFace = `
  @font-face { font-family: PulsoSans; src: url('${staticFile("NotoSans-Regular.ttf")}'); font-weight: 400; }
  @font-face { font-family: PulsoSans; src: url('${staticFile("NotoSans-Bold.ttf")}'); font-weight: 700; }
`;

export const Satellite: React.FC<{
  x: number;
  y: number;
  angle: number;
  color: string;
  progress: number;
  label: string;
}> = ({ x, y, angle, color, progress, label }) => {
  const lift = (1 - progress) * 28;
  return (
    <g opacity={progress} transform={`translate(${x} ${y + lift}) rotate(${angle}) scale(.86)`}>
      <circle r="45" fill={color} opacity=".08" />
      <circle r="31" fill="none" stroke={color} strokeOpacity=".38" strokeWidth="1.5" />
      <rect x="-68" y="-16" width="43" height="32" rx="4" fill="#163452" stroke={color} strokeWidth="2" />
      <path d="M-60 -16V16 M-50 -16V16 M-40 -16V16 M-68 -5H-25 M-68 5H-25" stroke={color} strokeOpacity=".52" strokeWidth="1" />
      <rect x="25" y="-16" width="43" height="32" rx="4" fill="#163452" stroke={color} strokeWidth="2" />
      <path d="M33 -16V16 M43 -16V16 M53 -16V16 M25 -5H68 M25 5H68" stroke={color} strokeOpacity=".52" strokeWidth="1" />
      <rect x="-25" y="-24" width="50" height="48" rx="9" fill="url(#satellite-body)" stroke="#DDF7FF" strokeWidth="2" />
      <path d="M-12 -24L-4 -38H11L17 -24" fill="#B9D2DE" stroke="#F0FBFF" strokeWidth="1.5" />
      <circle cx="0" cy="0" r="7" fill={color} />
      <circle cx="0" cy="0" r="14" fill="none" stroke={color} strokeOpacity=".58" strokeWidth="1.5" />
      <path d="M-4 29 Q0 40 4 29" fill="none" stroke={color} strokeWidth="2" />
      <text x="0" y="61" textAnchor="middle" fill={color} fontSize="16" fontWeight="700" letterSpacing="1.8">SAT {label}</text>
    </g>
  );
};

const Earth: React.FC<{ reveal: number; solution: number }> = ({ reveal, solution }) => (
  <g opacity={reveal}>
    <circle cx="540" cy="1030" r="274" fill="url(#earth-fill)" stroke="#78DDE8" strokeOpacity=".48" strokeWidth="3" />
    <circle cx="540" cy="1030" r="288" fill="none" stroke="#8AE8F2" strokeOpacity=".12" strokeWidth="1.5" />
    <g clipPath="url(#earth-clip)" fill="none" stroke="#9DDCEB" strokeOpacity=".20" strokeWidth="1.7">
      <ellipse cx="540" cy="1030" rx="102" ry="274" />
      <ellipse cx="540" cy="1030" rx="190" ry="274" />
      <path d="M266 1030H814 M285 948Q540 1024 795 948 M285 1114Q540 1038 795 1114" />
      <path d="M310 875Q540 951 770 875 M310 1186Q540 1110 770 1186" />
    </g>
    <path d="M316 1018Q365 919 454 929L491 969L457 1000L473 1035L432 1071L390 1060L354 1108L301 1081Z" fill="#2D6381" opacity=".72" />
    <path d="M574 919L631 902L677 934L718 941L748 982L715 1010L732 1049L691 1070L673 1121L622 1105L605 1063L565 1046L580 1007L550 982Z" fill="#2D6381" opacity=".62" />
    <path d="M438 1100L479 1082L514 1109L501 1157L467 1182L431 1150Z" fill="#2D6381" opacity=".62" />
    {solution > 0 ? (
      <g opacity={solution}>
        <circle cx={RECEIVER.x} cy={RECEIVER.y} r={22 + solution * 20} fill={COLORS.mint} opacity=".11" />
        <circle cx={RECEIVER.x} cy={RECEIVER.y} r="11" fill={COLORS.mint} stroke="#F4FFE3" strokeWidth="3" />
        <circle cx={RECEIVER.x} cy={RECEIVER.y} r="30" fill="none" stroke={COLORS.mint} strokeOpacity=".72" strokeWidth="2" />
      </g>
    ) : null}
  </g>
);

const ReceiverPhone: React.FC<{ reveal: number; solved: number }> = ({ reveal, solved }) => (
  <g opacity={reveal} transform={`translate(${RECEIVER.x} ${RECEIVER.y - 7})`}>
    <circle r="74" fill={COLORS.cyan} opacity=".08" />
    <rect x="-41" y="-74" width="82" height="145" rx="17" fill="#0C1B2A" stroke="#D7F6F9" strokeWidth="3" />
    <rect x="-32" y="-60" width="64" height="111" rx="10" fill="url(#phone-screen)" />
    <path d="M-17 -49H17" stroke="#8DA9B5" strokeWidth="3" strokeLinecap="round" />
    <circle cx="0" cy="39" r="5" fill="#6C8996" />
    <circle cx="0" cy="-7" r="19" fill={solved ? COLORS.mint : COLORS.cyan} opacity=".16" />
    <path d="M0 -24C-13 -24 -22 -14 -22 -1C-22 14 0 31 0 31S22 14 22 -1C22 -14 13 -24 0 -24Z" fill={solved ? COLORS.mint : COLORS.cyan} />
    <circle cy="-2" r="7" fill="#0A1927" />
    <text x="0" y="99" textAnchor="middle" fill={solved ? COLORS.mint : COLORS.cyan} fontSize="15" fontWeight="700" letterSpacing="1.6">RECEPTOR</text>
  </g>
);

const ClockCorrection: React.FC<{ frame: number; reveal: number }> = ({ frame, reveal }) => {
  const adjust = eased(frame, beat("fourth_signal") + 8, beat("fourth_signal") + 44);
  const angle = interpolate(adjust, [0, 1], [-72, 0], CLAMP);
  return (
    <g opacity={reveal}>
      <path d="M646 854C701 834 751 853 777 891" fill="none" stroke={COLORS.amber} strokeOpacity=".5" strokeWidth="2" strokeDasharray="5 9" />
      <circle cx="810" cy="932" r="76" fill="#101C2A" stroke={COLORS.amber} strokeWidth="2" />
      <circle cx="810" cy="932" r="59" fill="none" stroke="#657688" strokeOpacity=".46" strokeWidth="1.5" />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((tick) => {
        const theta = (tick / 12) * Math.PI * 2 - Math.PI / 2;
        const x1 = 810 + Math.cos(theta) * 50;
        const y1 = 932 + Math.sin(theta) * 50;
        const x2 = 810 + Math.cos(theta) * 57;
        const y2 = 932 + Math.sin(theta) * 57;
        return <line key={tick} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#F5D6AA" strokeOpacity=".7" strokeWidth="2" />;
      })}
      <path d={`M810 932L${810 + Math.cos((angle * Math.PI) / 180) * 33} ${932 + Math.sin((angle * Math.PI) / 180) * 33}`} stroke={COLORS.amber} strokeWidth="4" strokeLinecap="round" />
      <path d="M810 932L810 899" stroke="#F5F7FA" strokeWidth="3" strokeLinecap="round" />
      <circle cx="810" cy="932" r="5" fill={COLORS.mint} />
      <text x="810" y="1034" textAnchor="middle" fill={COLORS.amber} fontSize="15" fontWeight="700" letterSpacing="1.4">RELÓGIO DO CELULAR</text>
      <text x="810" y="1060" textAnchor="middle" fill={COLORS.muted} fontSize="14" letterSpacing="1.2" opacity={adjust}>AJUSTADO PELO 4º SINAL</text>
    </g>
  );
};

const SatelliteWorld: React.FC<{ frame: number }> = ({ frame }) => {
  const skyOpacity = 0.56 + 0.44 * eased(frame, 0, 26);
  const earthOpacity = 0.68 + 0.32 * eased(frame, 8, 38);
  const satellitesAppearAt = [beat("satellites"), beat("satellites") + 7, beat("intersection"), beat("fourth_signal")];
  const signalStarts = [beat("travel_time") + 7, beat("intersection") + 2, beat("intersection") + 12, beat("fourth_signal") + 2];
  const ringStarts = [beat("distance"), beat("intersection") + 2, beat("intersection") + 12, beat("fourth_signal") + 2];
  const ringEnds = [beat("intersection") + 18, beat("fourth_signal"), beat("fourth_signal"), beat("resolution") + 16];
  const intersection = eased(frame, beat("intersection") + 10, beat("intersection") + 36);
  const solved = eased(frame, beat("fourth_signal") + 28, beat("fourth_signal") + 64);
  const final = eased(frame, beat("resolution"), beat("resolution") + 18);
  const camera = interpolate(frame, [beat("distance"), beat("resolution")], [1.03, 0.93], CLAMP);
  const cameraY = interpolate(frame, [beat("distance"), beat("resolution")], [18, -5], CLAMP);

  return (
    <svg width="1080" height="1920" viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      <defs>
        <radialGradient id="earth-fill" cx="34%" cy="20%">
          <stop offset="0%" stopColor="#3485A8" />
          <stop offset="58%" stopColor="#19486A" />
          <stop offset="100%" stopColor="#0B233B" />
        </radialGradient>
        <linearGradient id="satellite-body" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#E8F6F6" />
          <stop offset=".56" stopColor="#8CA9B8" />
          <stop offset="1" stopColor="#536F82" />
        </linearGradient>
        <linearGradient id="phone-screen" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#153C55" />
          <stop offset="1" stopColor="#091A2B" />
        </linearGradient>
        <linearGradient id="final-pill" x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#1C3A30" />
          <stop offset="1" stopColor="#0D1F2B" />
        </linearGradient>
        <clipPath id="earth-clip"><circle cx="540" cy="1030" r="274" /></clipPath>
        <clipPath id="signal-range-clip" clipPathUnits="userSpaceOnUse">
          <rect x="20" y="382" width="1040" height="970" />
        </clipPath>
        <filter id="signal-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="11" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <g opacity={skyOpacity}>
        <ellipse cx="540" cy="830" rx="410" ry="260" fill="none" stroke="#88D9EA" strokeOpacity=".08" strokeWidth="1.5" />
        <ellipse cx="540" cy="830" rx="480" ry="320" fill="none" stroke="#88D9EA" strokeOpacity=".045" strokeWidth="1" />
        <path d="M88 786Q540 355 992 786" fill="none" stroke="#7893A8" strokeOpacity=".17" strokeDasharray="3 11" strokeWidth="2" />
        {Array.from({ length: 34 }, (_, index) => {
          const x = ((index * 137) % 1000) + 40;
          const y = 450 + ((index * 89) % 900);
          const radius = index % 7 === 0 ? 2.2 : 1.25;
          return <circle key={index} cx={x} cy={y} r={radius} fill="#D7F5FA" opacity={index % 3 === 0 ? ".42" : ".18"} />;
        })}
      </g>

      <g transform={`translate(${540 * (1 - camera)} ${1030 * (1 - camera) + cameraY}) scale(${camera})`}>
        <g opacity={earthOpacity}>
          <circle cx="540" cy="1030" r="300" fill="none" stroke="#55C7E4" strokeOpacity=".12" strokeWidth="2" />
          <circle cx="540" cy="1030" r="274" fill="url(#earth-fill)" stroke="#78DDE8" strokeOpacity=".48" strokeWidth="3" />
        </g>

        {SATELLITES.map((sat, index) => {
          const appeared = eased(frame, satellitesAppearAt[index], satellitesAppearAt[index] + 18);
          const range = eased(frame, ringStarts[index], ringStarts[index] + (index === 0 ? 36 : 30));
          const rangeOpacity = visibility(frame, ringStarts[index], ringEnds[index], 12);
          const sent = linear(frame, signalStarts[index], signalStarts[index] + 30);
          const px = sat.x + (RECEIVER.x - sat.x) * sent;
          const py = sat.y + (RECEIVER.y - sat.y) * sent;
          return (
            <g key={sat.label}>
              <g clipPath="url(#signal-range-clip)">
                <circle cx={sat.x} cy={sat.y} r={sat.radius * range} fill="none" stroke={sat.color} strokeOpacity={rangeOpacity * .58} strokeWidth="2.5" strokeDasharray="7 11" />
                <circle cx={sat.x} cy={sat.y} r={sat.radius * range} fill="none" stroke={sat.color} strokeOpacity={rangeOpacity * .10} strokeWidth="14" />
              </g>
              <line x1={sat.x} y1={sat.y} x2={RECEIVER.x} y2={RECEIVER.y} stroke={sat.color} strokeOpacity={sent * .22} strokeWidth="2" strokeDasharray="5 12" />
              {sent > 0.01 && sent < 0.99 ? <circle cx={px} cy={py} r="9" fill={sat.color} filter="url(#signal-glow)" /> : null}
              <Satellite {...sat} progress={appeared} />
            </g>
          );
        })}

        <Earth reveal={earthOpacity} solution={solved} />

        <g opacity={visibility(frame, beat("one_range"), beat("intersection") + 7, 12)}>
          {RANGE_ANGLES.map((angle) => {
            const radians = (angle * Math.PI) / 180;
            const x = 540 + Math.cos(radians) * 274;
            const y = 1030 + Math.sin(radians) * 274;
            const remain = Math.abs(angle + 90) < 1 ? 1 : 1 - intersection;
            return <circle key={angle} cx={x} cy={y} r="8" fill={COLORS.cyan} opacity={remain * .82} stroke="#E4FBFF" strokeWidth="2" />;
          })}
        </g>

        <g opacity={intersection}>
          <circle cx={RECEIVER.x} cy={RECEIVER.y} r="33" fill={COLORS.mint} opacity=".13" />
          <circle cx={RECEIVER.x} cy={RECEIVER.y} r="8" fill={COLORS.mint} />
          <circle cx={RECEIVER.x} cy={RECEIVER.y} r="20" fill="none" stroke={COLORS.mint} strokeWidth="2" />
        </g>

        <ReceiverPhone reveal={earthOpacity} solved={solved} />
        <ClockCorrection frame={frame} reveal={visibility(frame, beat("fourth_signal"), beat("resolution") + 12, 10)} />

        <g opacity={visibility(frame, beat("travel_time"), beat("one_range") + 4, 10)}>
          <path d="M267 813C330 853 390 879 453 887" fill="none" stroke={COLORS.cyan} strokeOpacity=".7" strokeWidth="2" strokeDasharray="4 8" />
          <rect x="250" y="826" width="94" height="44" rx="22" fill="#0D2235" stroke={COLORS.cyan} strokeOpacity=".52" />
          <text x="297" y="855" textAnchor="middle" fill={COLORS.cyan} fontSize="20" fontWeight="700">T₀</text>
          <rect x="425" y="880" width="94" height="44" rx="22" fill="#0D2235" stroke={COLORS.mint} strokeOpacity=".62" />
          <text x="472" y="909" textAnchor="middle" fill={COLORS.mint} fontSize="20" fontWeight="700">T₁</text>
        </g>
      </g>

      <g opacity={visibility(frame, beat("distance") + 4, beat("intersection") + 10, 12)}>
        <rect x="214" y="1371" width="652" height="78" rx="39" fill="#101F2D" stroke="#8AE8F2" strokeOpacity=".28" />
        <text x="540" y="1422" textAnchor="middle" fill="#EAFBFC" fontSize="28" fontWeight="700" letterSpacing="1.3">
          <tspan fill={COLORS.cyan}>Δt</tspan><tspan fill="#A5B6C1"> × </tspan><tspan fill={COLORS.mint}>velocidade da luz</tspan><tspan fill="#A5B6C1"> = </tspan><tspan fill={COLORS.amber}>distância</tspan>
        </text>
      </g>

      <g opacity={visibility(frame, beat("one_range"), beat("intersection") + 12, 10)}>
        <text x="540" y="1324" textAnchor="middle" fill="#DDF9FC" fontSize="20" fontWeight="700" letterSpacing="1.7">1 SINAL · MUITAS POSIÇÕES</text>
      </g>
      <g opacity={visibility(frame, beat("intersection"), beat("fourth_signal") + 7, 12)}>
        <text x="540" y="1324" textAnchor="middle" fill="#E8F8DA" fontSize="20" fontWeight="700" letterSpacing="1.7">AS DISTÂNCIAS SE CRUZAM</text>
        <g opacity={eased(frame, beat("intersection") + 20, beat("intersection") + 38)}>
          <circle cx="540" cy="1368" r="27" fill={COLORS.mint} opacity=".12" />
          <text x="540" y="1376" textAnchor="middle" fill={COLORS.mint} fontSize="18" fontWeight="700" letterSpacing="1.2">UM PONTO POSSÍVEL</text>
        </g>
      </g>
      <g opacity={final}>
        <rect x="238" y="1366" width="604" height="77" rx="38" fill="url(#final-pill)" stroke={COLORS.mint} strokeOpacity=".7" />
        <text x="540" y="1415" textAnchor="middle" fill="#E9F8DC" fontSize="24" fontWeight="700" letterSpacing="1.8">TEMPO + GEOMETRIA = POSIÇÃO</text>
      </g>
    </svg>
  );
};

const Caption: React.FC<{ frame: number }> = ({ frame }) => {
  const current = [...VOICE].reverse().find(({ from }) => frame >= from);
  if (!current || frame > current.from + current.duration) return null;
  const opacity = interpolate(
    frame,
    [current.from, current.from + 7, current.from + current.duration - 7, current.from + current.duration],
    [0, 1, 1, 0],
    CLAMP,
  );
  return (
    <div style={{
      position: "absolute", left: 94, right: 94, top: 1500, minHeight: 128,
      padding: "20px 28px", boxSizing: "border-box", borderRadius: 24,
      border: "1px solid rgba(199,220,231,.16)", background: "rgba(12,23,37,.91)",
      boxShadow: "0 18px 50px rgba(0,0,0,.28)", display: "flex", alignItems: "center",
      justifyContent: "center", textAlign: "center", color: COLORS.ink, fontSize: 25,
      lineHeight: 1.36, fontWeight: 700, opacity,
    }}>
      {current.text}
    </div>
  );
};

const GPSExplainer: React.FC<Props> = () => {
  const frame = useCurrentFrame();
  const head = 0.58 + 0.42 * eased(frame, 0, 24);
  return (
    <div style={{
      width: 1080, height: 1920, overflow: "hidden", position: "relative",
      background: COLORS.sky, color: COLORS.ink, fontFamily: "PulsoSans, Noto Sans, sans-serif",
    }}>
      <style>{fontFace}</style>
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at 82% 17%, rgba(42,109,137,.24), transparent 32%), radial-gradient(ellipse at 7% 70%, rgba(47,79,132,.20), transparent 37%), linear-gradient(158deg,#0A1421,#0A111D 54%,#08101A)",
      }} />
      <div style={{
        position: "absolute", inset: 0, opacity: .14,
        backgroundImage: "radial-gradient(rgba(212,232,243,.24) .7px, transparent .7px)", backgroundSize: "28px 28px",
      }} />
      <div style={{
        position: "absolute", left: 80, right: 80, top: 84, display: "flex",
        justifyContent: "space-between", alignItems: "center", opacity: head,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <span style={{ width: 11, height: 11, borderRadius: 4, transform: "rotate(45deg)", background: COLORS.cyan, boxShadow: `0 0 18px ${COLORS.cyan}` }} />
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: 3.2 }}>PULSO EXPLICA</span>
        </div>
        <span style={{ color: COLORS.muted, fontSize: 16, letterSpacing: 2.2 }}>TECNOLOGIA · NAVEGAÇÃO</span>
      </div>
      <div style={{
        position: "absolute", left: 80, top: 160, width: 920, opacity: head,
        translate: `0 ${interpolate(head, [0, 1], [25, 0])}px`,
      }}>
        <div style={{ fontSize: 78, lineHeight: 1.1, fontWeight: 700, letterSpacing: -4.4 }}>Como o GPS</div>
        <div style={{ fontSize: 78, lineHeight: 1.1, fontWeight: 700, letterSpacing: -4.4, color: COLORS.cyan }}>encontra você?</div>
        <div style={{ marginTop: 15, color: "#A4B4C0", fontSize: 18, letterSpacing: 2.1 }}>SINAIS DE TEMPO → UMA POSIÇÃO NO MAPA</div>
      </div>

      <SatelliteWorld frame={frame} />
      <Caption frame={frame} />

      <div style={{ position: "absolute", left: 80, right: 80, top: 1710, height: 1, background: "linear-gradient(90deg, rgba(138,232,242,.46), rgba(198,247,123,.20), transparent)", opacity: head }} />
      <div style={{ position: "absolute", left: 80, right: 80, top: 1745, display: "flex", justifyContent: "space-between", alignItems: "flex-end", opacity: head }}>
        <div>
          <div style={{ color: "#D8E4EA", fontSize: 17, letterSpacing: 1.2, fontWeight: 700 }}>FONTES: GPS.GOV · FAA · USGS</div>
          <div style={{ color: "#8296A5", fontSize: 15, marginTop: 8 }}>Animação didática · distâncias fora de escala</div>
        </div>
        <div style={{ color: "#8296A5", fontSize: 15, letterSpacing: 1.8 }}>GPS · TEMPO · GEOMETRIA</div>
      </div>
      <Audio src={staticFile(`gps-explainer/${timeline.audioFile}`)} />
    </div>
  );
};

const metadata: CalculateMetadataFunction<Props> = () => ({
  durationInFrames: DURATION,
  fps: FPS,
  width: 1080,
  height: 1920,
});

export const GpsExplainerComposition = () => (
  <Composition
    id="GpsExplainerReview"
    component={GPSExplainer}
    durationInFrames={DURATION}
    fps={FPS}
    width={1080}
    height={1920}
    calculateMetadata={metadata}
  />
);
