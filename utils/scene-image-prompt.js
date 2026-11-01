'use strict';

const crypto = require('node:crypto');

function cleanPromptPart(value, name) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${name} is required`);
  return text.replace(/\s+/g, ' ');
}

function optionalGrounding(value, maxLength = 300) {
  const text = String(value || '')
    // Scraped source text must not carry control characters into the prompt.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.slice(0, maxLength).trim();
}

function selectNarrativeBeat(sentences, imageIndex, imageCount) {
  const beats = (Array.isArray(sentences) ? sentences : [])
    .map(sentence => optionalGrounding(typeof sentence === 'string' ? sentence : sentence?.text, 360))
    .filter(Boolean);
  if (!beats.length) return '';
  const count = Math.max(1, Math.floor(Number(imageCount) || 1));
  const index = Math.max(0, Math.min(count - 1, Math.floor(Number(imageIndex) || 0)));
  const beatIndex = count <= 1 || beats.length <= 1
    ? 0
    : Math.round(index * (beats.length - 1) / (count - 1));
  return beats[beatIndex];
}

// The same bounded, normalized text goes into the image prompt and its
// binding. Empty beats never receive a binding.
function narrativeBeatSha256(value) {
  const beat = optionalGrounding(value, 360);
  return beat ? crypto.createHash('sha256').update(beat).digest('hex') : '';
}

function buildSceneImageBase({ topic, sourceTitle, sectionTitle, sectionText, visualBeatText, visualDirection } = {}) {
  const subject = cleanPromptPart(topic, 'topic');
  const section = cleanPromptPart(sectionTitle, 'sectionTitle');
  const title = optionalGrounding(sourceTitle, 180);
  const narration = optionalGrounding(sectionText);
  const beat = optionalGrounding(visualBeatText, 360);
  const direction = optionalGrounding(visualDirection, 300);
  const grounding = [
    title ? `verified source title ${JSON.stringify(title)}` : '',
    narration ? `reviewed narration for this section ${JSON.stringify(narration)}` : ''
  ].filter(Boolean).join(' and ');
  const groundedBy = grounding ? ` grounded in ${grounding}` : '';
  if (beat) {
    const directionText = direction
      ? ` visual direction ${JSON.stringify(direction)} is subordinate to the narrated beat and must not add unsupported facts.`
      : '';
    return `Narrative editorial scene about the source topic ${JSON.stringify(subject)}, representing the specific section ${JSON.stringify(section)} through the exact narrated beat ${JSON.stringify(beat)}${groundedBy}.${directionText}`;
  }
  return `Unoccupied editorial still about the source topic ${JSON.stringify(subject)}, representing the specific section ${JSON.stringify(section)} through relevant tangible objects in a quiet, coherent setting${groundedBy}`;
}

function buildSceneImagePrompt({ base, subject, shot, narrative = false } = {}) {
  const scene = cleanPromptPart(base, 'base');
  const focus = cleanPromptPart(subject, 'subject');
  const camera = cleanPromptPart(shot, 'shot');

  const humanPolicy = narrative
    ? 'Show a person only when the exact narrated beat explicitly supports a human actor or action; keep any person anonymous and use only the stated action. Screens, email or computer interfaces must be abstract and unreadable, with no fabricated message content. Do not imply an unspoken identity, event or causal link.'
    : 'No people or human forms: no humans, faces, portraits, silhouettes, hands, statues or mannequins. Show an unoccupied environment with inanimate story objects only.';
  const surfacePolicy = narrative
    ? 'No readable text, letters, numbers, symbols, logos, brands, watermarks, institutional or company names, signage, labels, tags or printed documents. Charts, diagrams, packaging and interface elements are allowed only when the exact narrated beat calls for them; keep all text unreadable and labels absent.'
    : 'Absolutely no text, letters, numbers, symbols, logos, brands, watermarks, institutional or company names, signage, labels, tags, printed documents, charts, diagrams, packaging, interface elements or screens. All visible surfaces, objects and backgrounds must be blank and unmarked.';

  return `${scene}. ${focus} Premium dimensional 3D editorial scene with believable materials, tactile surfaces, grounded scale, soft cinematic lighting, contact shadows, atmospheric depth and a strong foreground-to-background composition. Shot: ${camera}. Follow only the actual topic, exact narrated beat and source context; do not add generic sci-fi, holograms, unrelated props, landscapes, activities or settings. Composition requirement overrides any conflicting brief: one continuous camera view of one coherent scene, one focal subject, no split screen, no side-by-side panels, no diptych, no collage, no before-and-after montage, no central divider. Show comparisons through objects within the same physical scene. Keep the complete focal object visible with space around it. ${humanPolicy} ${surfacePolicy} Do not invent a named institution, place, product or organization.`;
}

module.exports = { buildSceneImageBase, buildSceneImagePrompt, selectNarrativeBeat, narrativeBeatSha256 };
