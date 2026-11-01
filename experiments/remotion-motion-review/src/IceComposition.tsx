import { Audio } from "@remotion/media";
import {
  CalculateMetadataFunction,
  Composition,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import timeline from "../public/water-ice-neural/timeline.json";

type Props = {};

const FPS = 24;
const DURATION = Math.ceil((timeline.audioDurationSeconds + 1.75) * FPS);
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const ease = Easing.bezier(0.16, 1, 0.3, 1);
const BLUE = "#8AE8F2";
const MINT = "#C6F77B";

const VOICE = timeline.segments.map((segment) => ({
  id: segment.id,
  from: Math.round(segment.startSeconds * FPS),
  duration: Math.ceil(segment.durationSeconds * FPS),
  text: segment.text,
}));
const OLD_TIMELINE_ANCHORS = [0, 65, 250, 404, 671, 962];
const NEW_TIMELINE_ANCHORS = [...VOICE.map(({ from }) => from), DURATION];

const retimeVisualFrame = (frame: number) => {
  const boundedFrame = Math.max(0, Math.min(DURATION, frame));
  for (let index = 0; index < NEW_TIMELINE_ANCHORS.length - 1; index++) {
    const newStart = NEW_TIMELINE_ANCHORS[index];
    const newEnd = NEW_TIMELINE_ANCHORS[index + 1];
    if (boundedFrame <= newEnd) {
      const progress = (boundedFrame - newStart) / Math.max(1, newEnd - newStart);
      const oldStart = OLD_TIMELINE_ANCHORS[index];
      const oldEnd = OLD_TIMELINE_ANCHORS[index + 1];
      return oldStart + progress * (oldEnd - oldStart);
    }
  }
  return OLD_TIMELINE_ANCHORS[OLD_TIMELINE_ANCHORS.length - 1];
};

const metadata: CalculateMetadataFunction<Props> = () => ({
  durationInFrames: DURATION,
  fps: FPS,
  width: 1080,
  height: 1920,
});

const fontFace = `
  @font-face { font-family: PulsoSans; src: url('${staticFile("NotoSans-Regular.ttf")}'); font-weight: 400; }
  @font-face { font-family: PulsoSans; src: url('${staticFile("NotoSans-Bold.ttf")}'); font-weight: 700; }
`;

const SceneTag: React.FC<{ children: React.ReactNode; accent?: string }> = ({
  children,
  accent = BLUE,
}) => (
  <div
    style={{
      color: accent,
      fontSize: 19,
      letterSpacing: 3.6,
      fontWeight: 700,
      textTransform: "uppercase",
      display: "flex",
      alignItems: "center",
      gap: 13,
    }}
  >
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: 99,
        background: accent,
        boxShadow: `0 0 18px ${accent}`,
      }}
    />
    {children}
  </div>
);

const MoleculeField: React.FC<{ frame: number }> = ({ frame }) => {
  const blend = interpolate(frame, [226, 272], [0, 1], { ...clamp, easing: ease });
  const intro = interpolate(frame, [57, 73], [0, 1], { ...clamp, easing: ease });
  const exit = interpolate(frame, [387, 410], [1, 0], { ...clamp, easing: ease });
  const opacity = intro * exit;

  const liquid = [
    [-93, -48], [-31, -47], [34, -50], [94, -45],
    [-88, 4], [-25, 8], [39, 5], [100, 7],
    [-101, 53], [-36, 57], [28, 53], [91, 59],
  ];
  const expanded = [
    [-165, -130], [-55, -130], [55, -130], [165, -130],
    [-145, -10], [-35, -10], [75, -10], [185, -10],
    [-165, 110], [-55, 110], [55, 110], [165, 110],
  ];
  const crystalLinks = [
    [0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7], [8, 9], [9, 10], [10, 11],
    [0, 4], [1, 4], [1, 5], [2, 5], [2, 6], [3, 6], [3, 7],
    [4, 8], [5, 8], [5, 9], [6, 9], [6, 10], [7, 10], [7, 11],
  ];
  const latticeOpacity = interpolate(blend, [0.22, 0.82], [0, 1], clamp);
  const state = frame < 250 ? 0 : 1;
  const stateFade = interpolate(frame, [240, 258], [0, 1], { ...clamp, easing: ease });

  const points = expanded.map(([cx, cy], index) => {
    const [lx, ly] = liquid[index % liquid.length];
    const driftX = Math.sin(frame * 0.055 + index * 1.7) * (1 - blend) * 5;
    const driftY = Math.cos(frame * 0.047 + index * 1.25) * (1 - blend) * 4;
    return {
      x: 540 + interpolate(blend, [0, 1], [lx + driftX, cx], clamp),
      y: 856 + interpolate(blend, [0, 1], [ly + driftY, cy], clamp),
    };
  });

  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      <div style={{ position: "absolute", left: 80, top: 520 }}>
        <SceneTag accent={state ? MINT : BLUE}>
          {state ? "ao congelar" : "na água líquida"}
        </SceneTag>
      </div>
      <div
        style={{
          position: "absolute",
          width: 620,
          height: 620,
          left: 230,
          top: 570,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${state ? "rgba(198,247,123,.10)" : "rgba(138,232,242,.12)"}, transparent 68%)`,
          border: `1px solid ${state ? "rgba(198,247,123,.16)" : "rgba(138,232,242,.15)"}`,
          boxShadow: `inset 0 0 80px ${state ? "rgba(198,247,123,.035)" : "rgba(138,232,242,.04)"}`,
          transform: `scale(${interpolate(blend, [0, 1], [0.8, 1], clamp)})`,
        }}
      />
      <svg
        width="1080"
        height="1920"
        viewBox="0 0 1080 1920"
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
      >
        <g opacity={latticeOpacity}>
          {crystalLinks.map(([a, b]) => (
            <line
              key={`${a}-${b}`}
              x1={points[a].x}
              y1={points[a].y}
              x2={points[b].x}
              y2={points[b].y}
              stroke="rgba(198,247,123,.56)"
              strokeWidth="2"
            />
          ))}
          {points.slice(0, 12).map((point, index) => (
            <circle
              key={`halo-${index}`}
              cx={point.x}
              cy={point.y}
              r={26}
              fill="none"
              stroke="rgba(198,247,123,.20)"
              strokeWidth="1"
            />
          ))}
        </g>
        {points.map((point, index) => (
          <g key={index}>
            <circle
              cx={point.x}
              cy={point.y}
              r="21"
              fill="url(#molecule-fill)"
              stroke={blend > 0.5 ? "#D6FDB0" : "#D1FAFF"}
              strokeWidth="2"
              style={{ filter: `drop-shadow(0 0 12px ${blend > 0.5 ? "#B8EB77" : "#71DDEA"}70)` }}
            />
            <circle cx={point.x - 6} cy={point.y - 7} r="5" fill="rgba(255,255,255,.88)" />
          </g>
        ))}
        <defs>
          <radialGradient id="molecule-fill" cx="34%" cy="27%">
            <stop offset="0%" stopColor="#F2FFFF" />
            <stop offset="48%" stopColor="#75DDE9" />
            <stop offset="100%" stopColor="#26788E" />
          </radialGradient>
        </defs>
      </svg>
      <div
        style={{
          position: "absolute",
          left: 175,
          top: 1235,
          width: 730,
          textAlign: "center",
          fontSize: 21,
          letterSpacing: 2.4,
          fontWeight: 700,
          color: state ? "#D8F3BA" : "#BCECF1",
          opacity: state ? stateFade : 1 - stateFade,
        }}
      >
        {state ? "UMA REDE CRISTALINA MAIS ABERTA" : "MOLÉCULAS PRÓXIMAS E EM MOVIMENTO"}
      </div>
    </div>
  );
};

const OpeningGlass: React.FC<{ frame: number }> = ({ frame }) => {
  const opacity = interpolate(frame, [0, 12, 56, 74], [0, 1, 1, 0], {
    ...clamp,
    easing: ease,
  });
  const rise = interpolate(frame, [0, 38], [32, 0], { ...clamp, easing: ease });
  const bob = Math.sin(frame * 0.09) * 5;
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      <svg
        width="1080"
        height="1920"
        viewBox="0 0 1080 1920"
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          <linearGradient id="glass-water" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#48C9DD" stopOpacity=".30" />
            <stop offset="100%" stopColor="#163A56" stopOpacity=".72" />
          </linearGradient>
          <linearGradient id="ice-top" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#F6FFFF" />
            <stop offset="100%" stopColor="#8EE7F0" />
          </linearGradient>
        </defs>
        <ellipse cx="540" cy="1243" rx="245" ry="21" fill="rgba(80,204,222,.10)" />
        <path d="M344 728 L375 1216 Q540 1263 705 1216 L736 728" fill="rgba(12,30,45,.35)" stroke="rgba(178,236,243,.65)" strokeWidth="5" />
        <path d="M365 899 L385 1190 Q540 1230 695 1190 L715 899 Z" fill="url(#glass-water)" />
        <path d="M365 899 Q540 884 715 899" fill="none" stroke="#7DE8F1" strokeWidth="5" />
        <path d="M405 932 Q540 920 675 932" fill="none" stroke="rgba(214,251,255,.23)" strokeWidth="2" />
        <g transform={`translate(540 ${827 + rise + bob}) rotate(-8)`}>
          <path d="M-104 -73 L-30 -135 L92 -111 L105 18 L33 83 L-92 62 Z" fill="#78D8E8" opacity=".36" stroke="#D5FAFF" strokeWidth="4" />
          <path d="M-104 -73 L-30 -135 L-9 -3 L-92 62 Z" fill="url(#ice-top)" opacity=".91" />
          <path d="M-30 -135 L92 -111 L105 18 L-9 -3 Z" fill="#B8F0F5" opacity=".63" />
          <path d="M-9 -3 L105 18 L33 83 L-92 62 Z" fill="#69C8DB" opacity=".68" />
          <path d="M-30 -135 L-9 -3 L-92 62" fill="none" stroke="rgba(255,255,255,.74)" strokeWidth="3" />
          <path d="M42 -117 L55 -12" fill="none" stroke="rgba(255,255,255,.52)" strokeWidth="3" />
        </g>
        {[0, 1, 2].map((i) => {
          const bobble = (frame * (i + 1) * 0.8) % 90;
          return (
            <circle
              key={i}
              cx={430 + i * 106}
              cy={1100 - bobble}
              r={4 + (i % 2) * 3}
              fill="none"
              stroke="rgba(156,235,242,.65)"
              strokeWidth="2"
              opacity={interpolate(bobble, [0, 20, 90], [0, 0.7, 0], clamp)}
            />
          );
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          top: 1300,
          left: 170,
          width: 740,
          textAlign: "center",
          color: "#9EC6D0",
          fontSize: 20,
          letterSpacing: 2.8,
        }}
      >
        UMA PROPRIEDADE SURPREENDENTE DA ÁGUA
      </div>
    </div>
  );
};

const DensityCompare: React.FC<{ frame: number }> = ({ frame }) => {
  const opacity = interpolate(frame, [390, 410, 651, 677], [0, 1, 1, 0], {
    ...clamp,
    easing: ease,
  });
  const reveal = interpolate(frame, [400, 438], [0, 1], { ...clamp, easing: ease });
  const larger = [
    [0, 0], [1, 0], [2, 0], [3, 0],
    [0, 1], [1, 1], [2, 1], [3, 1],
    [0, 2], [1, 2], [2, 2], [3, 2],
  ];
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      <div style={{ position: "absolute", left: 80, top: 506 }}>
        <SceneTag accent={MINT}>mesma água · outro arranjo</SceneTag>
      </div>
      <div
        style={{
          position: "absolute",
          left: 80,
          top: 597,
          width: 920,
          textAlign: "center",
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: -0.5,
          color: "#F4F7FA",
        }}
      >
        O espaço entre elas muda.
      </div>
      {[0, 1].map((side) => {
        const x = side === 0 ? 80 : 550;
        const accent = side === 0 ? BLUE : MINT;
        const label = side === 0 ? "ÁGUA LÍQUIDA" : "GELO";
        const boxWidth = side === 0 ? 380 : 450;
        const pointSpacing = side === 0 ? 60 : 76;
        const pointRadius = 15;
        const startX = x + boxWidth / 2 - (pointSpacing * 1.5);
        const startY = 845 - pointSpacing;
        return (
          <div
            key={label}
            style={{
              position: "absolute",
              top: 698,
              left: x,
              width: 450,
              height: 360,
              borderRadius: 28,
              border: `1px solid ${accent}55`,
              background: `linear-gradient(145deg, rgba(18,31,44,.95), ${side ? "rgba(24,43,38,.78)" : "rgba(16,35,45,.8)"})`,
              boxShadow: `0 18px 56px ${accent}0C`,
              boxSizing: "border-box",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 24,
                top: 24,
                color: accent,
                fontWeight: 700,
                letterSpacing: 2.3,
                fontSize: 17,
              }}
            >
              {label}
            </div>
            <div
              style={{
                position: "absolute",
                left: 22,
                right: 22,
                top: 80,
                height: 208,
                borderRadius: 20,
                border: `1px solid ${accent}30`,
                background: `radial-gradient(ellipse at center, ${accent}0D, transparent 72%)`,
              }}
            />
            <svg
              width="450"
              height="360"
              viewBox="0 0 450 360"
              style={{ position: "absolute", inset: 0 }}
            >
              {larger.map(([column, row], index) => {
                const targetX = startX - x + column * pointSpacing;
                const offsetX = row % 2 ? pointSpacing / 2 : 0;
                const localX = interpolate(reveal, [0, 1], [225 + (column - 1.5) * 33, targetX + offsetX], clamp);
                const localY = interpolate(reveal, [0, 1], [180 + (row - 1) * 34, startY - 698 + row * pointSpacing], clamp);
                return (
                  <g key={index}>
                    <circle cx={localX} cy={localY} r={pointRadius + 9} fill="none" stroke={`${accent}26`} />
                    <circle cx={localX} cy={localY} r={pointRadius} fill={accent} opacity=".88" />
                    <circle cx={localX - 4} cy={localY - 4} r="4" fill="#F5FFFF" opacity=".85" />
                  </g>
                );
              })}
            </svg>
            <div
              style={{
                position: "absolute",
                bottom: 23,
                left: 24,
                color: "#9BAAB8",
                fontSize: 17,
                letterSpacing: 1,
              }}
            >
              12 MOLÉCULAS
            </div>
            <div
              style={{
                position: "absolute",
                right: 24,
                bottom: 17,
                color: accent,
                fontSize: 29,
                fontWeight: 700,
              }}
            >
              {side ? "+ espaço" : "compacta"}
            </div>
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: 232,
          top: 1127,
          width: 616,
          height: 122,
          borderRadius: 24,
          border: "1px solid rgba(198,247,123,.38)",
          background: "linear-gradient(110deg, rgba(34,57,43,.65), rgba(17,30,38,.82))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          opacity: reveal,
          boxShadow: "0 14px 46px rgba(198,247,123,.08)",
        }}
      >
        <span style={{ color: MINT, fontSize: 64, lineHeight: 1, fontWeight: 700 }}>−9%</span>
        <span style={{ color: "#D2DDE4", fontSize: 19, lineHeight: 1.35, letterSpacing: 1.2 }}>
          DENSIDADE<br />DO GELO
        </span>
      </div>
    </div>
  );
};

const Iceberg: React.FC<{ frame: number }> = ({ frame }) => {
  const opacity = interpolate(frame, [650, 678], [0, 1], { ...clamp, easing: ease });
  const rise = interpolate(frame, [650, 705], [120, 0], { ...clamp, easing: ease });
  const drift = Math.sin(frame * 0.035) * 4;
  const bubblePhase = (frame - 650 + 200) % 160;
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      <div style={{ position: "absolute", left: 80, top: 512 }}>
        <SceneTag accent={BLUE}>menos denso que a água</SceneTag>
      </div>
      <svg
        width="1080"
        height="1920"
        viewBox="0 0 1080 1920"
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          <linearGradient id="ocean" x1="0" x2="0.9" y1="0" y2="1">
            <stop offset="0%" stopColor="#286E84" stopOpacity=".36" />
            <stop offset="100%" stopColor="#11283E" stopOpacity=".92" />
          </linearGradient>
          <linearGradient id="berg" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#F4FFFF" />
            <stop offset="48%" stopColor="#9EEBF1" />
            <stop offset="100%" stopColor="#4E9EBA" />
          </linearGradient>
          <clipPath id="underwater">
            <rect x="0" y="884" width="1080" height="470" />
          </clipPath>
          <filter id="berg-glow" x="-30%" y="-30%" width="160%" height="170%">
            <feGaussianBlur stdDeviation="20" />
          </filter>
        </defs>
        <rect x="0" y="884" width="1080" height="530" fill="url(#ocean)" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <path
            key={i}
            d={`M ${-50 + i * 195} ${972 + (i % 3) * 98} q 90 -25 180 0 t 180 0 t 180 0`}
            fill="none"
            stroke="rgba(117,218,232,.12)"
            strokeWidth="2"
          />
        ))}
        <g transform={`translate(0 ${rise + drift})`}>
          <path
            d="M540 728 L605 785 L580 820 L662 864 L645 884 L844 1005 L792 1158 L678 1214 L410 1214 L288 1152 L236 1000 L435 884 L420 864 L500 820 L475 785 Z"
            fill="rgba(110,215,232,.35)"
            filter="url(#berg-glow)"
          />
          <path
            d="M540 728 L605 785 L580 820 L662 864 L645 884 L844 1005 L792 1158 L678 1214 L410 1214 L288 1152 L236 1000 L435 884 L420 864 L500 820 L475 785 Z"
            fill="url(#berg)"
            stroke="#D9FCFF"
            strokeWidth="4"
          />
          <path d="M540 728 L532 878 L435 884 L420 864 L500 820 L475 785 Z" fill="rgba(255,255,255,.45)" />
          <path d="M532 878 L645 884 L844 1005 L792 1158 L678 1214 L545 1130 Z" fill="rgba(44,122,151,.36)" />
          <path d="M532 878 L410 1214 L288 1152 L236 1000 L435 884 Z" fill="rgba(58,145,172,.28)" />
          <path d="M532 878 L710 975 L665 1114 L545 1130 Z" fill="rgba(218,251,254,.18)" />
          <path d="M540 728 L532 878 L645 884" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="3" />
        </g>
        <path d="M0 884 Q140 874 270 884 T540 884 T810 884 T1080 884" fill="none" stroke="#9BEAF1" strokeWidth="6" />
        <path d="M0 894 Q150 884 300 894 T600 894 T900 894 T1200 894" fill="none" stroke="rgba(222,252,255,.55)" strokeWidth="2" />
        <g clipPath="url(#underwater)">
          {[0, 1, 2, 3].map((i) => (
            <circle
              key={i}
              cx={365 + i * 116}
              cy={1200 - bubblePhase * 2 + i * 17}
              r={5 + i}
              fill="none"
              stroke="rgba(166,235,243,.7)"
              strokeWidth="2"
            />
          ))}
        </g>
      </svg>
      <div
        style={{
          position: "absolute",
          left: 112,
          top: 1270,
          width: 856,
          textAlign: "center",
          color: "#F4FAFC",
          fontSize: 52,
          fontWeight: 700,
          letterSpacing: -1.5,
          textShadow: "0 4px 26px rgba(0,0,0,.42)",
        }}
      >
        ≈ 90% ABAIXO DA SUPERFÍCIE
      </div>
      <div
        style={{
          position: "absolute",
          left: 190,
          top: 1350,
          width: 700,
          textAlign: "center",
          color: "#B6D3DF",
          fontSize: 20,
          letterSpacing: 2.2,
        }}
      >
        DO VOLUME DO ICEBERG
      </div>
    </div>
  );
};

const Caption: React.FC<{ frame: number }> = ({ frame }) => {
  const current = [...VOICE].reverse().find(({ from }) => frame >= from);
  if (!current || frame > current.from + current.duration) return null;
  const opacity = interpolate(frame, [current.from, current.from + 8, current.from + current.duration - 8, current.from + current.duration], [0, 1, 1, 0], clamp);
  return (
    <div
      style={{
        position: "absolute",
        left: 95,
        right: 95,
        top: 1494,
        minHeight: 128,
        padding: "20px 30px",
        boxSizing: "border-box",
        borderRadius: 24,
        border: "1px solid rgba(199,220,231,.14)",
        background: "rgba(14,24,37,.88)",
        boxShadow: "0 18px 50px rgba(0,0,0,.24)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        color: "#F3F7F9",
        fontSize: 25,
        lineHeight: 1.36,
        fontWeight: 700,
        opacity,
      }}
    >
      {current.text}
    </div>
  );
};

const IceVideo: React.FC<Props> = () => {
  const frame = useCurrentFrame();
  const visualFrame = retimeVisualFrame(frame);
  const head = interpolate(frame, [0, 26], [0, 1], { ...clamp, easing: ease });
  return (
    <div
      style={{
        width: 1080,
        height: 1920,
        overflow: "hidden",
        position: "relative",
        background: "#09111D",
        color: "#F5F7FA",
        fontFamily: "PulsoSans, Noto Sans, sans-serif",
      }}
    >
      <style>{fontFace}</style>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at 87% 8%, rgba(44,116,132,.23), transparent 33%), radial-gradient(ellipse at 8% 78%, rgba(46,73,119,.18), transparent 35%), linear-gradient(158deg,#0A1421,#0A111D 54%,#08101A)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.17,
          backgroundImage: "radial-gradient(rgba(212,232,243,.25) .7px, transparent .7px)",
          backgroundSize: "28px 28px",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 100,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          opacity: head,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <span style={{ width: 11, height: 11, borderRadius: 4, transform: "rotate(45deg)", background: BLUE, boxShadow: `0 0 18px ${BLUE}` }} />
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: 3.2 }}>SCIENCE NOTE</span>
        </div>
        <span style={{ color: "#8FA5B3", fontSize: 16, letterSpacing: 2.2 }}>ÁGUA · DENSIDADE</span>
      </div>
      <div
        style={{
          position: "absolute",
          left: 80,
          top: 184,
          width: 920,
          opacity: head,
          transform: `translateY(${interpolate(head, [0, 1], [28, 0])}px)`,
        }}
      >
        <div style={{ fontSize: 78, lineHeight: 1.12, fontWeight: 700, letterSpacing: -4.4 }}>Por que o gelo</div>
        <div style={{ fontSize: 78, lineHeight: 1.12, fontWeight: 700, letterSpacing: -4.4, color: BLUE }}>flutua?</div>
        <div style={{ marginTop: 18, color: "#A4B4C0", fontSize: 19, letterSpacing: 1.4 }}>
          UMA EXPLICAÇÃO EM MOLÉCULAS
        </div>
      </div>

      <OpeningGlass frame={visualFrame} />
      <MoleculeField frame={visualFrame} />
      <DensityCompare frame={visualFrame} />
      <Iceberg frame={visualFrame} />
      <Caption frame={frame} />

      <div style={{ position: "absolute", left: 80, right: 80, top: 1710, height: 1, background: "linear-gradient(90deg, rgba(138,232,242,.46), rgba(198,247,123,.15), transparent)", opacity: head }} />
      <div style={{ position: "absolute", left: 80, right: 80, top: 1745, display: "flex", justifyContent: "space-between", alignItems: "flex-end", opacity: head }}>
        <div>
          <div style={{ color: "#D8E4EA", fontSize: 18, letterSpacing: 1.2, fontWeight: 700 }}>U.S. GEOLOGICAL SURVEY</div>
          <div style={{ color: "#8296A5", fontSize: 16, marginTop: 8 }}>Water Science School · Water Density</div>
        </div>
        <div style={{ color: "#8296A5", fontSize: 15, letterSpacing: 1.8 }}>H₂O · 0°C</div>
      </div>

      <Audio src={staticFile(`water-ice-neural/${timeline.audioFile}`)} />
    </div>
  );
};

export const IceComposition = () => (
  <Composition
    id="IceFloatsReview"
    component={IceVideo}
    durationInFrames={DURATION}
    fps={FPS}
    width={1080}
    height={1920}
    calculateMetadata={metadata}
  />
);
