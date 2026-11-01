import React from "react";

export type PulsoStoryCueFrames = {
  /** Absolute composition frame where the aligned word begins. */
  sent: number;
  false: number;
  discovered: number;
  timeStart: number;
  timeEnd: number;
  received: number;
};

export type PulsoStorySceneProps = {
  /** Absolute composition frame from Remotion's useCurrentFrame(). */
  frame: number;
  /** Parent-controlled scene crossfade. */
  opacity: number;
  /** Absolute composition frames resolved from word-timings.json. */
  cue: PulsoStoryCueFrames;
  /** Absolute frame at which this visual beat begins. */
  start: number;
};

const COLOR = {
  stage: "#0b1f21",
  text: "#f2f0e5",
  mint: "#8bcbb9",
  amber: "#e6aa70",
  cream: "#eeefe2",
  dark: "#10292b",
  dark2: "#17383a",
  muted: "#a9bbb2",
  line: "#52776f",
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => {
  const t = clamp01(value);
  return 1 - (1 - t) ** 3;
};
const between = (frame: number, from: number, to: number) =>
  ease((frame - from) / Math.max(1, to - from));

const cubicPoint = (
  t: number,
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
): [number, number] => {
  const u = 1 - t;
  return [
    u ** 3 * p0[0] + 3 * u ** 2 * t * p1[0] + 3 * u * t ** 2 * p2[0] + t ** 3 * p3[0],
    u ** 3 * p0[1] + 3 * u ** 2 * t * p1[1] + 3 * u * t ** 2 * p2[1] + t ** 3 * p3[1],
  ];
};

const KeyboardKeys: React.FC = () => (
  <g>
    {[0, 1, 2].map((row) =>
      Array.from({ length: 11 }, (_, column) => {
        const x = 218 + column * 30 + row * 4;
        const y = 696 + row * 12;
        const width = column === 10 && row === 2 ? 50 : 24;
        return (
          <path
            key={`${row}-${column}`}
            d={`M${x} ${y} l${width - 4} -2 3 6 -${width - 4} 2 Z`}
            fill={row === 0 ? "#667c78" : "#526965"}
            stroke="#9aaca4"
            strokeOpacity=".35"
            strokeWidth=".8"
          />
        );
      }),
    )}
  </g>
);

export const PromptAndPoliceScene: React.FC<PulsoStorySceneProps> = ({ frame, opacity, cue, start }) => {
  const local = frame - start;
  const sentAt = cue.sent - start;
  const falseAt = cue.false - start;
  const discoveredAt = cue.discovered - start;
  const entrance = between(local, -6, 15);
  const wireProgress = between(local, sentAt, Math.max(sentAt + 8, falseAt + 2));
  const falseFocus = between(local, falseAt - 5, falseAt + 11);
  const discovery = between(local, discoveredAt - 8, discoveredAt + 15);
  const elapsed = between(local, discoveredAt - 48, discoveredAt - 22);
  const inputLine1 = between(local, sentAt - 48, sentAt - 36);
  const inputLine2 = between(local, sentAt - 35, sentAt - 22);
  const inputLine3 = between(local, sentAt - 21, sentAt - 7);
  const outputReveal = between(local, sentAt - 2, sentAt + 10);
  const outputLine1 = between(local, sentAt, sentAt + 8);
  const outputLine2 = between(local, sentAt + 6, sentAt + 15);
  const packetPoint = cubicPoint(wireProgress, [593, 581], [737, 474], [857, 716], [957, 574]);
  const sceneOpacity = clamp01(opacity) * entrance;

  return (
    <g opacity={sceneOpacity} transform={`translate(0 ${12 * (1 - entrance)})`}>
      <defs>
        <linearGradient id="pulso-laptop-shell" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#f7f5e8" />
          <stop offset=".42" stopColor="#bcc9c0" />
          <stop offset="1" stopColor="#718882" />
        </linearGradient>
        <linearGradient id="pulso-laptop-bezel" x1="0" y1="0" x2=".9" y2="1">
          <stop stopColor="#294b4b" />
          <stop offset=".55" stopColor="#132c2e" />
          <stop offset="1" stopColor="#071719" />
        </linearGradient>
        <linearGradient id="pulso-laptop-glass" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#173d3d" />
          <stop offset="1" stopColor="#091d20" />
        </linearGradient>
        <linearGradient id="pulso-laptop-base" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#dce2d8" />
          <stop offset=".38" stopColor="#aebcb2" />
          <stop offset="1" stopColor="#647b75" />
        </linearGradient>
        <linearGradient id="pulso-terminal-frame" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#f7f5e8" />
          <stop offset=".55" stopColor="#becbc1" />
          <stop offset="1" stopColor="#778f88" />
        </linearGradient>
        <linearGradient id="pulso-terminal-page" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#f8f7ed" />
          <stop offset="1" stopColor="#dfe7dc" />
        </linearGradient>
        <linearGradient id="pulso-network-packet" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={COLOR.text} />
          <stop offset="1" stopColor={COLOR.amber} />
        </linearGradient>
        <filter id="pulso-laptop-shadow" x="-.25" y="-.3" width="1.5" height="1.8">
          <feGaussianBlur in="SourceAlpha" stdDeviation="12" />
          <feOffset dy="14" />
          <feComponentTransfer><feFuncA type="linear" slope=".28" /></feComponentTransfer>
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="pulso-soft-glow" x="-.8" y="-.8" width="2.6" height="2.6">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <clipPath id="pulso-laptop-screen-clip"><path d="M239 450 L547 441 L556 642 L231 655 Z" /></clipPath>
      </defs>

      <text x="112" y="385" fill={COLOR.mint} fontSize="14" fontWeight="800" letterSpacing="2.5">
        UMA MENSAGEM SAI DO MODELO E ENTRA NA REDE
      </text>

      <ellipse cx="700" cy="816" rx="554" ry="21" fill="#020b0d" opacity=".34" />

      {/* Laptop: layered screen, metal hinge, keyboard deck and trackpad. */}
      <g filter="url(#pulso-laptop-shadow)">
        <path d="M218 439 Q218 425 235 424 L552 413 Q571 412 573 430 L585 665 L207 681 Z" fill="url(#pulso-laptop-shell)" stroke="#f2f0e5" strokeOpacity=".65" strokeWidth="2" />
        <path d="M229 439 Q229 432 239 431 L549 421 Q557 421 559 431 L570 654 L220 668 Z" fill="url(#pulso-laptop-bezel)" stroke="#75928a" strokeWidth="2" />
        <path d="M239 450 L547 441 L556 642 L231 655 Z" fill="url(#pulso-laptop-glass)" />
        <g clipPath="url(#pulso-laptop-screen-clip)">
          <path d="M175 474 L558 460 L566 668 L187 670 Z" fill="url(#pulso-laptop-glass)" />
          <path d="M188 488 H556" stroke="#86a39a" strokeOpacity=".26" />
          <circle cx="255" cy="484" r="3" fill={COLOR.amber} />
          <circle cx="268" cy="484" r="3" fill={COLOR.mint} />
          <circle cx="281" cy="484" r="3" fill="#708d85" />
          <text x="300" y="489" fill={COLOR.text} fontSize="14" fontWeight="800" letterSpacing="1.3">LLM · MODELO DE IA</text>

          <rect x="249" y="502" width="286" height="62" rx="6" fill="#10292b" stroke="#55776f" strokeOpacity=".75" />
          <text x="263" y="523" fill={COLOR.mint} fontSize="14" fontWeight="800" letterSpacing="1.2">INSTRUÇÃO</text>
          <rect x="263" y="531" width="233" height="4" rx="2" fill="#46635d" />
          <rect x="263" y="541" width="233" height="4" rx="2" fill="#46635d" />
          <rect x="263" y="551" width="185" height="4" rx="2" fill="#46635d" />
          <rect x="263" y="531" width={233 * inputLine1} height="4" rx="2" fill={COLOR.text} />
          <rect x="263" y="541" width={233 * inputLine2} height="4" rx="2" fill={COLOR.text} />
          <rect x="263" y="551" width={185 * inputLine3} height="4" rx="2" fill={COLOR.text} />

          <rect x="249" y="572" width="286" height="67" rx="6" fill="#163436" stroke={COLOR.mint} strokeOpacity={.22 + outputReveal * .45} />
          <text x="263" y="594" fill={COLOR.text} fontSize="14" fontWeight="800" letterSpacing="1.2">MENSAGEM</text>
          <rect x="263" y="604" width="190" height="4" rx="2" fill="#607c73" opacity={.38 + outputLine1 * .55} />
          <rect x="263" y="615" width="142" height="4" rx="2" fill="#607c73" opacity={.38 + outputLine2 * .55} />
          <g transform={`translate(0 ${2 * (1 - outputReveal)})`} opacity={outputReveal}>
            <path d="M494 585 H522 Q525 585 525 588 V607 H494 Q491 607 491 604 V588 Q491 585 494 585 Z" fill="#214a45" stroke={COLOR.mint} strokeWidth="1.4" />
            <path d="M492 588 L508 600 L524 588" fill="none" stroke={COLOR.mint} strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M515 612 H532 M526 606 L532 612 L526 618" fill="none" stroke={COLOR.amber} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <path d="M239 451 L397 445 L254 650 L232 650 Z" fill="white" opacity=".025" />
        </g>
        <circle cx="393" cy="430" r="2" fill="#8a9e97" />
        <path d="M201 677 L583 660 L660 733 Q664 739 651 743 L178 780 Q167 780 169 772 Z" fill="url(#pulso-laptop-base)" stroke="#dbe1d5" strokeWidth="2" />
        <path d="M207 685 L578 669 L632 721 L185 758 Z" fill="#879a91" stroke="#d4ddd2" strokeOpacity=".62" />
        <path d="M210 689 L576 674 L620 713 L194 749 Z" fill="#566d67" />
        <KeyboardKeys />
        <path d="M368 728 L415 726 L434 732 L378 736 Z" fill="#a7b7ad" stroke="#e3e8dc" strokeOpacity=".55" strokeWidth="1.2" />
        <path d="M178 772 L651 735 L640 747 L189 783 Q176 784 178 772 Z" fill="#405a55" />
        <path d="M346 681 L449 677" stroke={COLOR.mint} strokeWidth="3" strokeLinecap="round" opacity=".38" />
      </g>

      {/* The packet is tied to the spoken "enviado" cue and crosses a visible network node. */}
      <path d="M594 581 C737 474 857 716 957 574" fill="none" stroke="#061517" strokeWidth="16" strokeLinecap="round" opacity=".74" />
      <path d="M594 581 C737 474 857 716 957 574" fill="none" stroke={COLOR.mint} strokeWidth="5" strokeLinecap="round" strokeOpacity=".16" />
      <path
        d="M594 581 C737 474 857 716 957 574"
        pathLength="1"
        fill="none"
        stroke={COLOR.mint}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="1"
        strokeDashoffset={1 - wireProgress}
        opacity={wireProgress * .95}
      />
      <g transform="translate(823 595)" opacity={between(local, sentAt - 10, sentAt + 4) * (1 - between(local, falseAt + 4, falseAt + 18))}>
        <circle r="59" fill={COLOR.mint} opacity=".06" />
        <circle r="43" fill="#0d292b" stroke={COLOR.mint} strokeOpacity=".63" strokeWidth="1.5" />
        <ellipse rx="19" ry="43" fill="none" stroke={COLOR.mint} strokeOpacity=".5" />
        <path d="M-40 0 H40 M-34 -19 Q0 -7 34 -19 M-34 19 Q0 7 34 19" fill="none" stroke={COLOR.mint} strokeOpacity=".48" strokeWidth="1.3" />
        {[[0, -43], [38, -17], [30, 30], [-28, 31], [-39, -15]].map(([x, y], index) => (
          <circle key={`network-${index}`} cx={x} cy={y} r="3.2" fill={index === 2 ? COLOR.amber : COLOR.mint} />
        ))}
        <text x="0" y="76" textAnchor="middle" fill={COLOR.muted} fontSize="10" fontWeight="800" letterSpacing="1.6">INTERNET</text>
      </g>
      <g opacity={wireProgress > 0 && wireProgress < .99 ? 1 : 0}>
        <circle cx={packetPoint[0]} cy={packetPoint[1]} r="16" fill={COLOR.amber} opacity=".16" filter="url(#pulso-soft-glow)" />
        <circle cx={packetPoint[0]} cy={packetPoint[1]} r="7" fill="url(#pulso-network-packet)" stroke={COLOR.text} strokeWidth="2" />
      </g>

      {/* Receiving terminal: a real object in the same transmission scene, not a floating card. */}
      <g filter="url(#pulso-laptop-shadow)">
        <path d="M944 443 Q944 430 958 430 H1292 Q1306 430 1306 443 V674 H944 Z" fill="url(#pulso-terminal-frame)" stroke="#faf8ec" strokeWidth="2" />
        <rect x="958" y="444" width="334" height="214" rx="7" fill="#102629" />
        <rect x="965" y="451" width="320" height="200" rx="4" fill="url(#pulso-terminal-page)" />
        <path d="M965 451 H1285 V484 H965 Z" fill="#d7e2d7" />
        <circle cx="980" cy="467" r="4" fill={COLOR.amber} />
        <circle cx="994" cy="467" r="4" fill={COLOR.mint} />
        <circle cx="1008" cy="467" r="4" fill="#80988e" />
        <text x="1025" y="472" fill="#59736c" fontSize="13" fontWeight="800" letterSpacing="1">PORTAL PÚBLICO</text>
        <path d="M980 495 H1268" stroke="#c6d2c8" />
        <g opacity={between(local, sentAt + 4, falseAt + 5)}>
          <rect x="980" y="507" width="288" height="130" rx="7" fill="#e3e9dd" />
          <path d="M996 526 H1019 L1028 535 H996 Z" fill="#4d6b62" />
          <path d="M996 543 H1080" stroke="#7e968d" strokeWidth="4" strokeLinecap="round" />
          <text x="996" y="573" fill="#183437" fontSize="18" fontWeight="800" letterSpacing=".8">NOVA PISTA</text>
          <text x="996" y="596" fill="#61776f" fontSize="14">Homicídio não solucionado</text>
          <rect x="990" y="605" width={falseFocus > .08 ? 151 : 0} height="24" rx="12" fill={COLOR.amber} opacity={.24 + falseFocus * .36} />
          <text x="1001" y="622" fill="#754f35" fontSize="13" fontWeight="900" letterSpacing="1.1" opacity={falseFocus}>PISTA FALSA</text>
        </g>
        <path d="M1094 675 V708 L1072 727 H1178 L1156 708 V675" fill="#97a9a0" stroke="#dce3d8" strokeWidth="2" />
        <path d="M1054 734 Q1054 727 1063 727 H1187 Q1196 727 1196 734 V741 H1054 Z" fill="#617b72" />
        <circle cx="1125" cy="666" r="3" fill={falseFocus ? COLOR.amber : COLOR.mint} opacity={.45 + falseFocus * .55} />
      </g>

      {/* A factual interval, shown as an elapsed-time bridge without inventing a discovery date. */}
      <g opacity={Math.max(elapsed, discovery * .72)}>
        <path d="M228 824 H1208" stroke="#5b756e" strokeWidth="2" />
        <path d={`M228 824 H${228 + 980 * Math.max(elapsed, discovery * .72)}`} stroke={COLOR.mint} strokeWidth="4" strokeLinecap="round" />
        <circle cx="238" cy="824" r="7" fill={COLOR.text} />
        <circle cx="1198" cy="824" r="10" fill={COLOR.amber} opacity={discovery} />
        <circle cx="1198" cy="824" r={18 + discovery * 14} fill="none" stroke={COLOR.amber} strokeOpacity={discovery * .65} strokeWidth="2" />
        <text x="238" y="851" fill={COLOR.muted} fontSize="11" fontWeight="800" letterSpacing="1.6">ENVIO</text>
        <text x="718" y="811" textAnchor="middle" fill={COLOR.text} fontSize="18" fontWeight="800" letterSpacing="1.3" opacity={elapsed}>QUASE 3 MESES</text>
        <text x="1198" y="851" textAnchor="end" fill={COLOR.amber} fontSize="11" fontWeight="800" letterSpacing="1.6" opacity={discovery}>DESCOBERTA</text>
      </g>
    </g>
  );
};

export const PortalReceiptScene: React.FC<PulsoStorySceneProps> = ({ frame, opacity, cue, start }) => {
  const local = frame - start;
  const timeStart = cue.timeStart - start;
  const timeEnd = cue.timeEnd - start;
  const receivedAt = cue.received - start;
  const entrance = between(local, -5, 15);
  const received = between(local, receivedAt - 8, receivedAt + 12);
  const zoomIn = between(local, timeStart - 10, timeStart + 7);
  const zoomOut = between(local, timeEnd + 7, timeEnd + 24);
  const timeFocus = zoomIn * (1 - zoomOut);
  const timeTileScale = 1 + timeFocus * 0.15;
  const sceneOpacity = clamp01(opacity) * entrance;

  return (
    <g opacity={sceneOpacity} transform={`translate(0 ${10 * (1 - entrance)})`}>
      <defs>
        <linearGradient id="pulso-browser-shell" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#fbf9ee" />
          <stop offset=".5" stopColor="#d5dfd4" />
          <stop offset="1" stopColor="#8da198" />
        </linearGradient>
        <linearGradient id="pulso-browser-page" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#f8f7ed" />
          <stop offset="1" stopColor="#e2e9dd" />
        </linearGradient>
        <filter id="pulso-browser-shadow" x="-.2" y="-.25" width="1.4" height="1.6">
          <feGaussianBlur in="SourceAlpha" stdDeviation="10" />
          <feOffset dy="12" />
          <feComponentTransfer><feFuncA type="linear" slope=".28" /></feComponentTransfer>
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="pulso-time-tile-glow" x="-.25" y="-.25" width="1.5" height="1.5">
          <feDropShadow dx="0" dy="2" stdDeviation="7" floodColor={COLOR.amber} floodOpacity=".34" />
        </filter>
        <clipPath id="pulso-portal-viewport"><rect x="123" y="463" width="1128" height="363" rx="2" /></clipPath>
        <clipPath id="pulso-browser-shell-clip"><rect x="101" y="385" width="1168" height="465" rx="18" /></clipPath>
      </defs>

      <text x="108" y="370" fill={COLOR.mint} fontSize="14" fontWeight="800" letterSpacing="2.5">
        O REGISTRO NO PORTAL PÚBLICO
      </text>

      <g filter="url(#pulso-browser-shadow)">
        <rect x="101" y="385" width="1168" height="465" rx="18" fill="url(#pulso-browser-shell)" stroke="#f8f6e9" strokeWidth="2" />
        <g clipPath="url(#pulso-browser-shell-clip)">
        <path d="M102 433 H1268" stroke="#a5b7ac" strokeWidth="1.5" />
        <path d="M102 385 H1268 Q1269 385 1269 402 V433 H102 Z" fill="#d6dfd4" />
        <circle cx="124" cy="407" r="5" fill="#bb7e62" />
        <circle cx="142" cy="407" r="5" fill={COLOR.amber} />
        <circle cx="160" cy="407" r="5" fill={COLOR.mint} />

        {/* Tabs and browser controls, with no fabricated URL. */}
        <path d="M183 391 Q183 387 190 387 H442 Q456 387 456 400 V431 H183 Z" fill="#f3f1e6" stroke="#bdc9bd" />
        <circle cx="202" cy="409" r="4" fill={COLOR.mint} />
        <text x="216" y="413" fill="#314c49" fontSize="11" fontWeight="700">Philly Unsolved Murders</text>
        <path d="M463 397 Q463 391 470 391 H586 Q596 391 596 402 V431 H463 Z" fill="#c5d1c7" opacity=".68" />
        <path d="M614 407 H634 M624 397 V417" stroke="#647c74" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M120 450 L128 443 L136 450 M120 450 L128 457 L136 450" fill="none" stroke="#607871" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M148 444 V456 M142 450 H154" stroke="#607871" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M171 445 C164 445 161 450 163 455 C165 461 174 462 178 457" fill="none" stroke="#607871" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M174 443 L179 457 L165 457" fill="none" stroke="#607871" strokeWidth="1.3" />
        <rect x="194" y="440" width="1053" height="27" rx="13.5" fill="#f7f5e9" stroke="#b2c1b5" />
        <path d="M210 450 V447 Q210 442 215 442 Q220 442 220 447 V450 M208 450 H222 V460 H208 Z" fill="none" stroke="#647c74" strokeWidth="1.3" strokeLinejoin="round" />
        <text x="232" y="458" fill="#445d57" fontSize="11" fontWeight="700" letterSpacing=".6">PORTAL PÚBLICO</text>
        <path d="M393 453 H686" stroke="#c0ccc0" strokeWidth="1.5" strokeLinecap="round" />

        <rect x="123" y="468" width="1128" height="358" fill="url(#pulso-browser-page)" />
        <g clipPath="url(#pulso-portal-viewport)">
          {/* Keep the page intact; only its date/time metadata tile receives emphasis. */}
          <g>
            <rect x="123" y="468" width="1128" height="358" fill="url(#pulso-browser-page)" />
            <path d="M123 527 H1251" stroke="#b7c7ba" strokeWidth="1.2" />

            {/* Site navigation is represented with neutral icons and labels grounded in the story. */}
            <g>
              <rect x="123" y="468" width="76" height="358" fill="#e3e9dd" />
              <circle cx="161" cy="494" r="15" fill="#173d3a" />
              <path d="M153 495 L161 488 L169 495 V502 H164 V497 H158 V502 H153 Z" fill={COLOR.cream} />
              <path d="M145 534 H177 M145 555 H177 M145 576 H177" stroke="#9bad9f" strokeWidth="3" strokeLinecap="round" />
              <path d="M145 612 H177" stroke={COLOR.mint} strokeWidth="4" strokeLinecap="round" />
              <circle cx="161" cy="642" r="6" fill="#7f968c" />
              <circle cx="161" cy="666" r="6" fill="#7f968c" />
            </g>

            <text x="224" y="495" fill="#183b39" fontSize="22" fontWeight="900" letterSpacing="1.6">PHILLY UNSOLVED MURDERS</text>
            <text x="224" y="516" fill="#758880" fontSize="12" fontWeight="700" letterSpacing="1.5">PORTAL PÚBLICO · MENSAGEM RECEBIDA</text>
            <path d="M748 489 H792 M812 489 H850 M870 489 H906" stroke="#bdc9bd" strokeWidth="3" strokeLinecap="round" />
            <circle cx="1198" cy="492" r="13" fill="#d0ddd1" />
            <circle cx="1198" cy="488" r="4" fill="#607a71" />
            <path d="M1190 499 Q1198 491 1206 499" fill="none" stroke="#607a71" strokeWidth="2" />

            <text x="224" y="557" fill="#698077" fontSize="12" fontWeight="800" letterSpacing="1.6">REGISTRO PÚBLICO  /  NOVA PISTA</text>
            <text x="224" y="598" fill="#193536" fontSize="28" fontWeight="800" letterSpacing="-.5">Homicídio não solucionado</text>
            <text x="224" y="623" fill="#70857b" fontSize="15">Uma nova mensagem foi recebida pelo site.</text>

            <rect x="224" y="650" width="744" height="127" rx="10" fill="#f7f6ec" stroke="#c3d0c3" strokeWidth="1.2" />
            <path d="M224 680 H968" stroke="#d4ded3" />
            <path d="M246 670 L260 660 L274 670 V679 H246 Z" fill="none" stroke="#5b786e" strokeWidth="1.8" strokeLinejoin="round" />
            <text x="288" y="674" fill="#42635a" fontSize="14" fontWeight="800" letterSpacing="1.4">MENSAGEM RECEBIDA</text>
            <g opacity={received}>
              <rect x="843" y="655" width="103" height="20" rx="10" fill={COLOR.mint} opacity=".45" />
              <circle cx="858" cy="665" r="3.5" fill="#315e51" />
              <text x="870" y="669" fill="#31564d" fontSize="11" fontWeight="900" letterSpacing="1">NOVA</text>
            </g>
            <path d="M248 705 H680 M248 720 H590 M248 735 H722 M248 750 H510" stroke="#91a69b" strokeWidth="3" strokeLinecap="round" opacity=".68" />
            <path d="M248 762 H410" stroke="#b2c2b6" strokeWidth="2" strokeLinecap="round" />

            {/* The time tile scales around its own center, preserving the surrounding page. */}
            <g
              transform={`translate(1100 665) scale(${timeTileScale}) translate(-1100 -665)`}
              filter={timeFocus > 0.01 ? "url(#pulso-time-tile-glow)" : undefined}
            >
            <rect x="991" y="553" width="218" height="224" rx="10" fill="#17383a" />
            <rect x="992" y="554" width="216" height="222" rx="9" fill="none" stroke={COLOR.amber} strokeWidth={1 + timeFocus * 1.4} strokeOpacity={timeFocus * 0.78} />
            <path d="M991 553 H1209 V588 H991 Z" fill="#234746" />
            <text x="1012" y="575" fill={COLOR.mint} fontSize="12" fontWeight="900" letterSpacing="1.7">DATA DO REGISTRO</text>
            <text x="1012" y="621" fill={COLOR.cream} fontSize="15" fontWeight="800" letterSpacing="1.2">18 JULHO 2026</text>
            <path d="M1012 635 H1187" stroke="#67847b" strokeWidth="1" />
            <text x="1012" y="658" fill="#b8c9be" fontSize="12" fontWeight="800" letterSpacing="1.6">HORÁRIO</text>
            <text x="1009" y="714" fill={COLOR.text} fontSize="56" fontWeight="800" letterSpacing="-1.6">23:27</text>
            <text x="1012" y="744" fill="#9cb1a7" fontSize="12" fontWeight="700" letterSpacing="1.4">FILADÉLFIA</text>
            <path d="M1012 756 H1186" stroke="#55736b" strokeWidth="1" />
            </g>

            <text x="224" y="802" fill="#70857b" fontSize="11" fontWeight="800" letterSpacing="1.7">DETALHES DA PÁGINA PÚBLICA</text>
          </g>
        </g>
        <path d="M101 826 H1269 V832 Q1269 850 1251 850 H119 Q101 850 101 832 Z" fill="#aebeb3" />
        <path d="M122 835 H1248" stroke="#758b81" strokeOpacity=".42" />
        <circle cx="1249" cy="838" r="2" fill="#71867d" />
        </g>
      </g>

      <g opacity={received}>
        <path d="M1235 523 C1283 546 1295 585 1274 621" fill="none" stroke={COLOR.amber} strokeWidth="2" strokeDasharray="4 7" />
        <circle cx="1274" cy="621" r="9" fill={COLOR.amber} opacity=".24" />
        <circle cx="1274" cy="621" r="4" fill={COLOR.amber} />
      </g>
      <text x="1240" y="878" textAnchor="end" fill={COLOR.muted} fontSize="10" fontWeight="800" letterSpacing="1.5" opacity={received}>
        ENTRADA REGISTRADA
      </text>
    </g>
  );
};
