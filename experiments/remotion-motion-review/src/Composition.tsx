import { Audio } from "@remotion/media";
import {
  CalculateMetadataFunction,
  Composition,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

type Props = {};

const FPS = 24;
const TOTAL_FRAMES = 519;
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const ease = Easing.bezier(0.16, 1, 0.3, 1);

const MODELS = [
  { name: "Llama 3.1 8B", value: 8, accent: "#B8F36B", soft: "#263D25", start: 128 },
  { name: "Llama 3.1 70B", value: 70, accent: "#65D9E8", soft: "#183842", start: 218 },
  { name: "Llama 3.1 405B", value: 405, accent: "#FFAD78", soft: "#432A27", start: 356 },
];

const CAPTIONS = [
  { from: 132, to: 215, text: "Oito bilhões de parâmetros: Llama 3.1 8B." },
  { from: 222, to: 317, text: "Setenta bilhões de parâmetros: Llama 3.1 70B." },
  { from: 360, to: 467, text: "Quatrocentos e cinco bilhões de parâmetros." },
];

const calculateMetadata: CalculateMetadataFunction<Props> = () => ({
  durationInFrames: TOTAL_FRAMES,
  fps: FPS,
  width: 1080,
  height: 1920,
});

const fontFace = `
  @font-face { font-family: PulsoSans; src: url('${staticFile("NotoSans-Regular.ttf")}'); font-weight: 400; }
  @font-face { font-family: PulsoSans; src: url('${staticFile("NotoSans-Bold.ttf")}'); font-weight: 700; }
`;

const Axis: React.FC<{ y: number }> = ({ y }) => {
  const labels = ["0", "100", "200", "300", "405B"];
  return (
    <svg
      aria-hidden="true"
      width="710"
      height="34"
      viewBox="0 0 710 34"
      style={{ position: "absolute", left: 32, top: y }}
    >
      {labels.map((label, index) => {
        const x = (index / (labels.length - 1)) * 710;
        return (
          <g key={label}>
            <line x1={x} y1="0" x2={x} y2="6" stroke="rgba(231,240,246,.27)" />
            <text
              x={x}
              y="29"
              fill="rgba(231,240,246,.48)"
              fontFamily="PulsoSans, sans-serif"
              fontSize="15"
              textAnchor={index === 0 ? "start" : index === 4 ? "end" : "middle"}
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const ModelCard: React.FC<{
  frame: number;
  index: number;
  top: number;
}> = ({ frame, index, top }) => {
  const model = MODELS[index];
  const entered = interpolate(frame, [model.start, model.start + 18], [0, 1], {
    ...clamp,
    easing: ease,
  });
  const barProgress = interpolate(frame, [model.start + 4, model.start + 40], [0, 1], {
    ...clamp,
    easing: ease,
  });
  const nextStart = MODELS[index + 1]?.start ?? 468;
  const active = frame >= model.start && frame < nextStart;
  const resting = frame > 468;
  const emphasis = active || resting;
  const opacity = entered * (emphasis ? 1 : 0.68);
  const x = interpolate(entered, [0, 1], [46, 0]);
  const barWidth = Math.max(12, 710 * (model.value / 405)) * barProgress;
  return (
    <div
      style={{
        position: "absolute",
        left: 80,
        top,
        width: 920,
        height: 252,
        boxSizing: "border-box",
        padding: "29px 32px 22px",
        borderRadius: 28,
        overflow: "hidden",
        opacity,
        transform: `translateX(${x}px)`,
        background: `linear-gradient(116deg, rgba(20,29,43,.97), rgba(14,20,32,.96) 74%, ${model.soft}88)`,
        border: `1px solid ${emphasis ? `${model.accent}78` : "rgba(226,237,247,.12)"}`,
        boxShadow: emphasis
          ? `0 22px 70px ${model.accent}12, inset 0 1px rgba(255,255,255,.08)`
          : "inset 0 1px rgba(255,255,255,.035)",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 250,
          height: 250,
          borderRadius: "50%",
          right: -128,
          top: -130,
          background: `radial-gradient(circle, ${model.accent}18 0%, transparent 70%)`,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 99,
              background: model.accent,
              boxShadow: `0 0 18px ${model.accent}A0`,
            }}
          />
          <span
            style={{
              color: "#D3DBE6",
              fontSize: 20,
              letterSpacing: 2.5,
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            Llama 3.1
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
          <span
            style={{
              color: "#F4F7FA",
              fontSize: 60,
              fontWeight: 700,
              letterSpacing: -3,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {model.value}
          </span>
          <span style={{ color: model.accent, fontSize: 28, fontWeight: 700 }}>B</span>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 32,
          width: 710,
          bottom: 52,
          height: 8,
          borderRadius: 8,
          background: "rgba(240,246,252,.10)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: barWidth,
            height: "100%",
            borderRadius: 8,
            background: `linear-gradient(90deg, ${model.accent}9A, ${model.accent})`,
            boxShadow: `0 0 22px ${model.accent}75`,
          }}
        />
      </div>
      <Axis y={201} />
    </div>
  );
};

const IntroOrb: React.FC<{ frame: number }> = ({ frame }) => {
  const leave = interpolate(frame, [112, 132], [1, 0], { ...clamp, easing: ease });
  const enter = interpolate(frame, [0, 18], [0, 1], { ...clamp, easing: ease });
  const spin = interpolate(frame, [0, 132], [-8, 8], clamp);

  return (
    <div
      style={{
        position: "absolute",
        left: 150,
        top: 670,
        width: 780,
        height: 500,
        opacity: leave * enter,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 460,
          height: 460,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(184,243,107,.17), rgba(101,217,232,.055) 43%, transparent 72%)",
          filter: "blur(2px)",
        }}
      />
      {[360, 460].map((size, index) => (
        <div
          key={size}
          style={{
            position: "absolute",
            width: size,
            height: size,
            borderRadius: "50%",
            border: `1px solid rgba(184,243,107,${index ? 0.14 : 0.24})`,
            transform: `rotate(${spin * (index ? -0.65 : 1)}deg) scale(${1 + index * 0.06})`,
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          width: 510,
          height: 1,
          background: "linear-gradient(90deg, transparent, rgba(184,243,107,.5), transparent)",
          transform: `rotate(${spin}deg)`,
        }}
      />
      <div style={{ position: "relative", textAlign: "center" }}>
        <div style={{ color: "#B8F36B", fontSize: 18, letterSpacing: 7, fontWeight: 700 }}>
          MODELOS DE LINGUAGEM
        </div>
        <div
          style={{
            color: "#F4F7FA",
            fontSize: 174,
            lineHeight: 1,
            fontWeight: 700,
            letterSpacing: -14,
            textShadow: "0 8px 50px rgba(184,243,107,.14)",
          }}
        >
          3.1
        </div>
        <div style={{ color: "#A6B2C0", fontSize: 21, letterSpacing: 3, marginTop: 8 }}>
          LLAMA
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          width: 13,
          height: 13,
          borderRadius: "50%",
          background: "#B8F36B",
          top: 41,
          right: 188,
          boxShadow: "0 0 28px #B8F36B",
          transform: `rotate(${spin}deg) translateX(206px)`,
        }}
      />
    </div>
  );
};

const Captions: React.FC<{ frame: number }> = ({ frame }) => {
  const caption = CAPTIONS.find(({ from, to }) => frame >= from && frame <= to);
  if (!caption) return null;
  const fadeIn = interpolate(frame, [caption.from, caption.from + 8], [0, 1], {
    ...clamp,
    easing: ease,
  });
  const fadeOut = interpolate(frame, [caption.to - 8, caption.to], [1, 0], clamp);
  return (
    <div
      style={{
        position: "absolute",
        left: 95,
        right: 95,
        top: 1468,
        minHeight: 112,
        padding: "20px 28px",
        boxSizing: "border-box",
        borderRadius: 22,
        border: "1px solid rgba(207,220,234,.12)",
        background: "rgba(18,26,39,.78)",
        color: "#F2F5F7",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        fontSize: 27,
        lineHeight: 1.32,
        fontWeight: 700,
        opacity: fadeIn * fadeOut,
        boxShadow: "0 15px 45px rgba(0,0,0,.18)",
      }}
    >
      {caption.text}
    </div>
  );
};

export const MyComposition = () => (
  <Composition
    id="LlamaScaleReview"
    component={MyComponent}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1080}
    height={1920}
    calculateMetadata={calculateMetadata}
  />
);

export const MyComponent: React.FC<Props> = () => {
  const frame = useCurrentFrame();
  const titleIn = interpolate(frame, [0, 28], [0, 1], { ...clamp, easing: ease });
  const titleY = interpolate(titleIn, [0, 1], [30, 0]);

  const modelTop = (index: number) => {
    if (index === 0) {
      const twoModels = interpolate(frame, [218, 242], [810, 640], { ...clamp, easing: ease });
      return frame < 356
        ? twoModels
        : interpolate(frame, [356, 380], [640, 468], { ...clamp, easing: ease });
    }
    if (index === 1) {
      return frame < 356
        ? 926
        : interpolate(frame, [356, 380], [926, 754], { ...clamp, easing: ease });
    }
    return 1040;
  };

  return (
    <div
      style={{
        width: 1080,
        height: 1920,
        overflow: "hidden",
        position: "relative",
        color: "#F5F7FA",
        background: "#090E18",
        fontFamily: "PulsoSans, Noto Sans, sans-serif",
      }}
    >
      <style>{fontFace}</style>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 87% 7%, rgba(45,91,84,.24), transparent 32%), radial-gradient(ellipse at 7% 85%, rgba(38,56,100,.2), transparent 33%), linear-gradient(160deg, #0A101B, #0C1220 53%, #080D16)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.22,
          backgroundImage: "radial-gradient(rgba(216,231,245,.23) .7px, transparent .7px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 108,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          opacity: titleIn,
          transform: `translateY(${titleY}px)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 4,
              background: "#B8F36B",
              transform: "rotate(45deg)",
              boxShadow: "0 0 18px rgba(184,243,107,.6)",
            }}
          />
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: 3.5, color: "#D7E1EA" }}>
            MODEL FILE
          </span>
        </div>
        <div style={{ color: "#8998A8", fontSize: 16, letterSpacing: 2 }}>
          VISUAL EXPLAINER
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 80,
          top: 182,
          width: 920,
          opacity: titleIn,
          transform: `translateY(${titleY}px)`,
        }}
      >
        <div style={{ fontSize: 77, lineHeight: 1.12, fontWeight: 700, letterSpacing: -4 }}>
          Uma família.
        </div>
        <div style={{ fontSize: 77, lineHeight: 1.12, fontWeight: 700, letterSpacing: -4 }}>
          <span style={{ color: "#B8F36B" }}>Três escalas.</span>
        </div>
        <div
          style={{
            marginTop: 19,
            color: "#A8B5C3",
            fontSize: 20,
            letterSpacing: 1.5,
          }}
        >
          PARÂMETROS · COMPARAÇÃO VISUAL
        </div>
      </div>

      <IntroOrb frame={frame} />

      {MODELS.map((model, index) => (
        <ModelCard
          key={model.name}
          frame={frame}
          index={index}
          top={modelTop(index)}
        />
      ))}

      <Captions frame={frame} />

      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 1696,
          height: 1,
          background: "linear-gradient(90deg, rgba(184,243,107,.42), rgba(207,220,234,.14) 55%, transparent)",
          opacity: titleIn,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 1733,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          opacity: titleIn,
        }}
      >
        <div>
          <div style={{ color: "#E2E8EE", fontSize: 19, fontWeight: 700, letterSpacing: 1.5 }}>
            META · LLAMA 3.1
          </div>
          <div style={{ color: "#7F8D9E", fontSize: 16, marginTop: 8 }}>Model Card</div>
        </div>
        <div style={{ color: "#7F8D9E", fontSize: 15, letterSpacing: 1.8 }}>
          ESCALA · B
        </div>
      </div>

      <Audio src={staticFile("narration.m4a")} />
    </div>
  );
};
