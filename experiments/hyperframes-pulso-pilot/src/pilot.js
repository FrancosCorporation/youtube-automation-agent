import { gsap } from 'gsap';
import alignment from '../assets/narration-word-timings.json';
import karaokeApi from '../../../utils/pilot-karaoke.js';

const { buildKaraokeTrack, getKaraokeFrame, validateWordEvents } = karaokeApi;
const { events, durationMs } = alignment;
validateWordEvents(events, durationMs);

const DURATION = durationMs / 1000;
const CLOSING_HOLD_SECONDS = 0.35;
const COMPOSITION_DURATION = DURATION + CLOSING_HOLD_SECONDS;
const portrait = document.documentElement.dataset.resolution === 'portrait';
const portalPacketTravel = portrait ? 42 : 80;
const karaoke = buildKaraokeTrack(events, portrait ? 5 : 7);
const sentenceStarts = [0];
for (let index = 0; index < events.length - 1; index += 1) {
  if (/[.!?][”’"')\]]*$/.test(events[index].text)) {
    sentenceStarts.push(events[index + 1].startMs / 1000);
  }
}
if (sentenceStarts.length < 3) throw new Error('O áudio do piloto não contém os três beats de cena esperados');

// The cards enter just before each spoken section, then hold through the words.
const EVENT_START = sentenceStarts[1] - 0.296;
const ATTRIBUTION_START = sentenceStarts[2] - 0.284;
const caption = document.getElementById('karaoke-caption');
let renderedPhrase = -1;
let renderedWord = -2;

function renderKaraokeAt(timeSeconds) {
  const frame = getKaraokeFrame(events, karaoke, timeSeconds * 1000);
  if (!frame) {
    const keepFinalLine = timeSeconds >= DURATION - CLOSING_HOLD_SECONDS && renderedPhrase >= 0;
    caption.style.opacity = keepFinalLine ? '1' : '0';
    return;
  }

  const phrase = karaoke.groups[frame.phraseIndex];
  if (renderedPhrase !== frame.phraseIndex) {
    caption.replaceChildren();
    phrase.words.forEach((word, index) => {
      if (index) caption.appendChild(document.createTextNode(' '));
      const span = document.createElement('span');
      span.className = 'karaoke-word';
      span.dataset.eventIndex = String(word.eventIndex);
      span.textContent = word.text;
      caption.appendChild(span);
    });
    caption.setAttribute('aria-label', phrase.text);
    renderedPhrase = frame.phraseIndex;
    renderedWord = -2;
  }

  if (renderedWord !== frame.activeEventIndex) {
    caption.querySelectorAll('.karaoke-word').forEach((word) => {
      word.classList.toggle('is-active', Number(word.dataset.eventIndex) === frame.activeEventIndex);
    });
    renderedWord = frame.activeEventIndex;
  }
  caption.style.opacity = '1';
}

function renderAt(time) {
  const t = Math.max(0, Math.min(COMPOSITION_DURATION, Number(time) || 0));
  renderKaraokeAt(t);
}

let timeline;
timeline = gsap.timeline({ paused: true, onUpdate: () => renderAt(timeline.time()) });
timeline.to('#robot-reference-frame', { y: -8, duration: COMPOSITION_DURATION / 2, ease: 'sine.inOut' }, 0);
timeline.to('#robot-reference-frame', { y: 0, duration: COMPOSITION_DURATION / 2, ease: 'sine.inOut' }, COMPOSITION_DURATION / 2);

timeline.fromTo('#hook-eyebrow', { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.38, ease: 'power2.out' }, 0.12);
timeline.fromTo('#hook-title', { opacity: 0, y: 42, scale: 0.985 }, { opacity: 1, y: 0, scale: 1, duration: 0.74, ease: 'power3.out' }, 0.2);
timeline.fromTo('#hook-subline', { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.53, ease: 'power2.out' }, 0.72);
timeline.fromTo('#delay-card', { opacity: 0, y: 52, rotateX: 8, rotateY: -11, scale: 0.93 }, { opacity: 1, y: 0, rotateX: 0, rotateY: 0, scale: 1, duration: 0.72, ease: 'back.out(1.3)' }, 3.2);
timeline.fromTo('#delay-progress', { scaleX: 0 }, { scaleX: 1, duration: 4.8, ease: 'none' }, 0.35);
timeline.fromTo('#delay-marker', { left: '0%' }, { left: '100%', duration: 4.8, ease: 'none' }, 0.35);
timeline.to('#delay-card', { rotateY: 4, rotateX: -1.5, duration: 1.1, ease: 'sine.inOut' }, 4.0);
timeline.to('#delay-card', { rotateY: -3, rotateX: 1.2, duration: 1.15, ease: 'sine.inOut' }, 5.1);
timeline.to('#delay-card', { rotateY: 0, rotateX: 0, duration: 0.9, ease: 'sine.inOut' }, 6.25);
timeline.to('#scene-hook', { opacity: 0, duration: 0.34, ease: 'power2.in' }, EVENT_START - 0.354);
timeline.to('#scene-hook .hero-copy', { opacity: 0, y: -28, duration: 0.34, ease: 'power2.in' }, EVENT_START - 0.354);
timeline.to('#delay-card', { opacity: 0, y: 28, scale: 0.97, duration: 0.3, ease: 'power2.in' }, EVENT_START - 0.324);

timeline.fromTo('#scene-event', { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.out', immediateRender: false }, EVENT_START);
timeline.fromTo('#scene-event .hero-copy', { opacity: 0, y: 42 }, { opacity: 1, y: 0, duration: 0.64, ease: 'power3.out', immediateRender: false }, EVENT_START + 0.08);
timeline.fromTo('#portal-card', { opacity: 0, y: 38, rotateX: 3.5, rotateY: 2.5, scale: 0.965 }, { opacity: 1, y: 0, rotateX: 0, rotateY: 0, scale: 1, duration: 0.78, ease: 'power3.out', immediateRender: false }, EVENT_START + 0.54);
timeline.fromTo('#portal-packet', { opacity: 0, x: 0, scale: 0.65 }, { opacity: 1, x: portalPacketTravel, scale: 1, duration: 1.0, ease: 'power1.inOut', immediateRender: false }, EVENT_START + 1.35);
timeline.to('#portal-packet', { opacity: 0, duration: 0.18, ease: 'power1.out' }, EVENT_START + 2.18);
timeline.fromTo('#portal-focus', { opacity: 0, y: 16, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.52, ease: 'power3.out', immediateRender: false }, EVENT_START + 2.15);
timeline.to('#portal-card', { rotateY: 0.75, rotateX: -0.35, duration: 1.5, ease: 'sine.inOut' }, EVENT_START + 2.0);
timeline.to('#portal-card', { rotateY: -0.65, rotateX: 0.25, duration: 1.5, ease: 'sine.inOut' }, EVENT_START + 3.5);
timeline.to('#portal-card', { rotateY: 0, rotateX: 0, duration: 1.0, ease: 'sine.inOut' }, EVENT_START + 5.0);
timeline.to('#scene-event .hero-copy', { opacity: 0, y: -28, duration: 0.34, ease: 'power2.in' }, ATTRIBUTION_START - 0.376);
timeline.to('#scene-event', { opacity: 0, duration: 0.32, ease: 'power2.in' }, ATTRIBUTION_START - 0.366);
timeline.to('#portal-card', { opacity: 0, y: 26, scale: 0.975, duration: 0.3, ease: 'power2.in' }, ATTRIBUTION_START - 0.356);

timeline.fromTo('#scene-attribution', { opacity: 0 }, { opacity: 1, duration: 0.42, ease: 'power2.out', immediateRender: false }, ATTRIBUTION_START);
timeline.fromTo('#scene-attribution .hero-copy', { opacity: 0, y: 42 }, { opacity: 1, y: 0, duration: 0.63, ease: 'power3.out', immediateRender: false }, ATTRIBUTION_START + 0.08);
timeline.fromTo('#record-card', { opacity: 0, y: 64, rotateX: 7, rotateY: -7, scale: 0.92 }, { opacity: 1, y: 0, rotateX: 0, rotateY: 1.5, scale: 1, duration: 0.76, ease: 'back.out(1.2)', immediateRender: false }, ATTRIBUTION_START + 0.5);
timeline.to('#record-card', { rotateY: -2.5, rotateX: 1, duration: 1.2, ease: 'sine.inOut' }, ATTRIBUTION_START + 2.1);
timeline.to('#record-card', { rotateY: 1.5, rotateX: 0, duration: 1.15, ease: 'sine.inOut' }, ATTRIBUTION_START + 3.3);
timeline.fromTo('#progress-fill', { scaleX: 0 }, { scaleX: 1, duration: COMPOSITION_DURATION, ease: 'none' }, 0);

timeline.seek(0, false);
renderAt(0);

export { timeline };
