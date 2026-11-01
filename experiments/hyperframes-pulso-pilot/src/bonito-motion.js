import speech from '../variants/robo-bonito-animado/assets/speech.json';
import envelope from '../variants/robo-bonito-animado/assets/speech-envelope.json';

export const duration = speech.duration;
export const cues = speech.cues;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, t) => { const x = clamp((t - a) / (b - a), 0, 1); return x*x*(3-2*x); };
const windowAt = (t, a, b, c, d) => smooth(a, b, t) * (1-smooth(c, d, t));

export function levelAt(time) {
  const pos = time * 1000 / envelope.stepMs;
  if (pos < 0 || pos >= envelope.levels.length) return 0;
  let sum = 0;
  for (let offset = -2; offset <= 2; offset++) {
    const sample = clamp(pos + offset, 0, envelope.levels.length - 1);
    const left = Math.floor(sample), f = sample-left;
    sum += (envelope.levels[left] || 0)*(1-f) + (envelope.levels[left+1] || 0)*f;
  }
  return sum / 5;
}

export function poseAt(seconds) {
  const t = clamp(Number(seconds) || 0, 0, duration);
  const voice = levelAt(t);
  const greeting = windowAt(t, .35, 1.0, 2.9, 3.7);
  const explainL = windowAt(t, 14.6, 15.5, 17.8, 18.5);
  const explainR = windowAt(t, 17.0, 17.8, 20.0, 20.8);
  const curious = windowAt(t, 23.9, 24.7, 26.6, 27.4);
  const blink = [2.15, 5.25, 8.9, 12.1, 16.4, 21.5, 25.4]
    .reduce((amount, center) => Math.max(amount, Math.exp(-Math.pow((t-center)/.075, 2))), 0);
  const calm = windowAt(t, 19.3, 20.0, 23.6, 24.2);
  return {
    time: t, voice, speaking: voice > .035, blink,
    rootY: 0,
    rootYaw: 0,
    chestZ: Math.sin(t*.7)*.015,
    head: [Math.sin(t*.88)*.025, Math.sin(t*.65)*.12,
      Math.sin(t*.45)*.025 + curious*.07],
    leftArm: [-.06-explainL*.10, -.05+explainL*.12,
      -.17 + greeting*.99 + explainL*.52 + Math.sin(t*.8)*.025],
    leftElbow: [.03+greeting*.28, greeting*.04, greeting*.85 + explainL*.34],
    leftHand: [greeting*.10, greeting*Math.sin(t*7.4)*.20, greeting*Math.sin(t*6.4)*.12],
    rightArm: [-.04-explainR*.12, .035-explainR*.10,
      .17-explainR*.62-Math.sin(t*.73+.8)*.026],
    rightElbow: [.02+explainR*.16, -.025, -explainR*.42],
    rightHand: [.01, .03, -explainR*.08],
    eyeY: (1-blink*.97)*(1-curious*.28-calm*.09),
    mouthX: .80 + voice*.25 + curious*.12,
    mouthY: .10 + voice*.88,
    smileY: 1 + curious*.16,
    expression: curious > .5 ? 'curioso' : calm > .5 ? 'atento' : 'sorridente',
    label: t < 3.7 ? '01 · OLÁ, PULSO' : t < 9.9 ? '02 · OLHAR E EXPRESSÕES' :
      t < 14.8 ? '03 · VOZ E BOCA' : t < 21 ? '04 · GESTOS INDEPENDENTES' : '05 · O QUE VOCÊ ACHOU?'
  };
}
