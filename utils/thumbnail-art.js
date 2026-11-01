const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');

const THUMBNAIL_ART_STYLE = 'pulso-topic-cover-v5-photorealistic-dual-aspect';

function shortText(value, maxLength = 360) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function buildGroundedThumbnailArtInput({ topic, sourceTitle, sourceContext } = {}) {
  const title = shortText(sourceTitle || topic, 240);
  return {
    topic: shortText(topic || sourceTitle, 240),
    title,
    hook: '',
    context: shortText(sourceContext, 520)
  };
}

function buildThumbnailArtPrompt({ topic, title, hook, context, aspectRatio = '16:9', sceneDirection = '' } = {}) {
  const subject = shortText(topic || title, 240);
  const storyTitle = shortText(title, 240);
  const storyHook = shortText(hook, 360);
  const storyContext = shortText(context, 520);
  const direction = shortText(sceneDirection, 600);
  const portrait = String(aspectRatio) === '9:16';

  return [
    `Create a striking, curiosity-driven ${portrait ? 'vertical 9:16' : 'horizontal 16:9'} cover image about: ${subject || 'the video topic'}.`,
    storyTitle && `Video title: ${storyTitle}.`,
    storyHook && `Opening hook: ${storyHook}.`,
    storyContext && `Story context from the opening script: ${storyContext}.`,
    direction && `Specific scene direction: ${direction}.`,
    'Match this specific story and its audience niche, rather than using a generic technology cover for every topic. When a named model or product is central, illustrate its verified subject or capability from the supplied context; its exact name and topic will be added separately as a readable Portuguese headline.',
    portrait
      ? 'Design for a compelling but honest mobile cover: one large, unmistakable focal object or visual idea, photographed close, with vivid topic-appropriate accents, crisp highlights, deep shadows, strong depth, and a clear silhouette. Keep the subject in the upper two thirds and preserve a darker, visually calm lower third for a separate headline overlay.'
      : 'Design for a compelling but honest mobile thumbnail: one large, unmistakable focal object or visual idea, photographed close, with a dynamic diagonal composition, vivid topic-appropriate accents, crisp highlights, deep shadows, strong depth, and a clear silhouette. Let the subject dominate the right two thirds; keep the left third visually calm for a separate headline overlay.',
    'Create a strong visual curiosity gap from the most specific verified detail in the supplied title and context: use a surprising but plausible symbolic setup, a clear contrast or tension, and expressive scale or framing that makes viewers wonder what or why. Do not invent a visual answer. If the source gives no specific visual evidence, use a striking symbolic editorial metaphor rather than fabricating a scene.',
    'Use photorealistic editorial photography with believable materials, naturalistic light, realistic depth of field, and subtle film texture. The scene is a symbolic cover image, not documentary evidence. Do not invent a result, statistic, quote, person, brand, logo, or real event, and do not add unrelated props. Visual drama may come from composition, lighting, color, and scale only.',
    'One coherent camera view and one focal subject. No split screen, collage, montage, or before-and-after. No text, no letters, no numbers, no logos, and no watermark.',
    'Do not invent pseudo-writing, diagrams, labels, named places, or unrelated scenery. Keep every object visibly connected to the supplied subject and scene direction.',
    'Never show a screen interface, chat bubble, message, app icon grid, contact tile, notification card, badge, or fake UI. If a phone is the clearest object, show its back or a plain blank unlit screen with no markings. No people, faces, human forms, hands, or fingers.',
    `Art direction revision: ${THUMBNAIL_ART_STYLE}.`
  ].filter(Boolean).join(' ');
}

async function generateThumbnailArt({ web, cacheDirectory, topic, title, hook, context, aspectRatio = '16:9', sceneDirection = '' }) {
  if (!web || typeof web.generateImage !== 'function') throw new TypeError('gerador de imagem da thumbnail inválido');
  if (!cacheDirectory) throw new TypeError('diretório de cache da thumbnail ausente');

  const prompt = buildThumbnailArtPrompt({ topic, title, hook, context, aspectRatio, sceneDirection });
  const cacheId = crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
  const imagePath = path.join(cacheDirectory, `thumbnail-art-${cacheId}.png`);
  await fs.mkdir(cacheDirectory, { recursive: true });

  const cached = await fs.stat(imagePath).then(stat => stat.isFile()).catch(() => false);
  if (!cached) await web.generateImage(prompt, imagePath, { aspectRatio });

  const buffer = await sharp(imagePath)
    .resize({ width: 1536, withoutEnlargement: true })
    .jpeg({ quality: 86 })
    .toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

module.exports = { buildGroundedThumbnailArtInput, buildThumbnailArtPrompt, generateThumbnailArt };
