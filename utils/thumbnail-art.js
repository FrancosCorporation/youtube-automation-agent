const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');

const NANO_BANANA_PRO_MODEL_ID = 'gemini-3-pro-image';
const THUMBNAIL_ART_STYLE = 'pulso-topic-cover-v6-nano-banana-pro-photorealistic-dual-aspect';

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
    'Create a strong visual curiosity gap from the most specific verified detail in the supplied title and context: use a surprising but plausible symbolic setup, a clear contrast or tension, and expressive scale or framing that makes viewers wonder what or why. Make it compelling enough to invite a click, without sensationalism or a false promise. Do not invent a visual answer. If the source gives no specific visual evidence, use a striking symbolic editorial metaphor rather than fabricating a scene.',
    'Use photorealistic editorial photography with believable materials, naturalistic light, realistic depth of field, and subtle film texture. The scene is a symbolic cover image, not documentary evidence. Do not invent a result, statistic, quote, person, brand, logo, or real event, and do not add unrelated props. Visual drama may come from composition, lighting, color, and scale only.',
    'One coherent camera view and one focal subject. No split screen, collage, montage, or before-and-after. No text, no letters, no numbers, no logos, and no watermark.',
    'Do not invent pseudo-writing, diagrams, labels, named places, or unrelated scenery. Keep every object visibly connected to the supplied subject and scene direction.',
    'Never show a screen interface, chat bubble, message, app icon grid, contact tile, notification card, badge, or fake UI. If a phone is the clearest object, show its back or a plain blank unlit screen with no markings. No people, faces, human forms, hands, or fingers.',
    `Art direction revision: ${THUMBNAIL_ART_STYLE}.`
  ].filter(Boolean).join(' ');
}

async function generateThumbnailArt({ web, cacheDirectory, topic, title, hook, context, aspectRatio = '16:9', sceneDirection = '', returnDetails = false }) {
  if (!web || typeof web.generateImage !== 'function') throw new TypeError('gerador de imagem da thumbnail inválido');
  if (!cacheDirectory) throw new TypeError('diretório de cache da thumbnail ausente');

  const prompt = buildThumbnailArtPrompt({ topic, title, hook, context, aspectRatio, sceneDirection });
  const normalizedAspectRatio = String(aspectRatio) === '9:16' ? '9:16' : '16:9';
  const promptSha256 = crypto.createHash('sha256').update(prompt).digest('hex');
  const cacheId = crypto.createHash('sha256').update(`${NANO_BANANA_PRO_MODEL_ID}\n${normalizedAspectRatio}\n${prompt}`).digest('hex').slice(0, 16);
  const imagePath = path.join(cacheDirectory, `thumbnail-art-${cacheId}.png`);
  const provenancePath = `${imagePath}.provenance.json`;
  await fs.mkdir(cacheDirectory, { recursive: true });

  let cached = await fs.lstat(imagePath).then(stat => stat.isFile() && !stat.isSymbolicLink()).catch(() => false);
  let generation = null;
  if (cached) {
    try {
      const metadata = await sharp(imagePath).metadata();
      const ratio = metadata.width / metadata.height;
      const expectedRatio = normalizedAspectRatio === '9:16' ? 9 / 16 : 16 / 9;
      if (!metadata.width || !metadata.height || Math.abs(ratio - expectedRatio) / expectedRatio > 0.04) cached = false;
      generation = JSON.parse(await fs.readFile(provenancePath, 'utf8'));
      const actualHash = crypto.createHash('sha256').update(await fs.readFile(imagePath)).digest('hex');
      if (generation.modelId !== NANO_BANANA_PRO_MODEL_ID || generation.aspectRatio !== normalizedAspectRatio
        || generation.promptSha256 !== promptSha256 || generation.imageSha256 !== actualHash
        || !['gemini-web', 'gemini-android'].includes(generation.provider)
        || generation.modelVerification !== 'requested-not-verified') cached = false;
    } catch { cached = false; }
  }

  if (!cached) {
    const temporaryPath = path.join(cacheDirectory, `.thumbnail-art-${cacheId}-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp.png`);
    try {
      generation = await web.generateImage(prompt, temporaryPath, {
        aspectRatio: normalizedAspectRatio,
        requiredModel: NANO_BANANA_PRO_MODEL_ID
      });
      if (generation?.modelId !== NANO_BANANA_PRO_MODEL_ID || generation?.aspectRatio !== normalizedAspectRatio
        || !['gemini-web', 'gemini-android'].includes(generation?.provider)
        || generation?.modelVerification !== 'requested-not-verified') {
        throw Object.assign(new Error('Gemini cover request metadata is incomplete'), {
          code: 'GEMINI_NANO_BANANA_PRO_UNVERIFIED'
        });
      }
      const metadata = await sharp(temporaryPath).metadata();
      const expectedRatio = normalizedAspectRatio === '9:16' ? 9 / 16 : 16 / 9;
      if (!metadata.width || !metadata.height
        || Math.abs((metadata.width / metadata.height) - expectedRatio) / expectedRatio > 0.04) {
        throw Object.assign(new Error(`Gemini cover does not match the requested ${normalizedAspectRatio} composition`), {
          code: 'GEMINI_THUMBNAIL_ASPECT_RATIO_MISMATCH'
        });
      }
      await fs.rename(temporaryPath, imagePath);
      const receipt = { modelId: generation.modelId, provider: generation.provider, modelVerification: generation.modelVerification, selectedMode: generation.selectedMode,
        aspectRatio: normalizedAspectRatio, promptSha256,
        imageSha256: crypto.createHash('sha256').update(await fs.readFile(imagePath)).digest('hex') };
      await fs.writeFile(`${provenancePath}.${process.pid}.tmp`, JSON.stringify(receipt), { mode: 0o600 });
      await fs.rename(`${provenancePath}.${process.pid}.tmp`, provenancePath);
      cached = true;
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }

  const source = await fs.readFile(imagePath);
  const metadata = await sharp(source).metadata();
  const imageSha256 = crypto.createHash('sha256').update(source).digest('hex');
  const buffer = await sharp(imagePath)
    .resize({ width: 1536, withoutEnlargement: true })
    .jpeg({ quality: 86 })
    .toBuffer();
  const imageDataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
  if (!returnDetails) return imageDataUrl;
  return {
    imageDataUrl,
    provenance: {
      modelId: NANO_BANANA_PRO_MODEL_ID,
      modelName: 'Nano Banana Pro',
      provider: generation.provider,
      modelVerification: generation.modelVerification,
      selectedMode: generation.selectedMode,
      aspectRatio: normalizedAspectRatio,
      promptSha256,
      imagePath,
      imageSha256,
      width: metadata.width,
      height: metadata.height
    }
  };
}

module.exports = { NANO_BANANA_PRO_MODEL_ID, buildGroundedThumbnailArtInput, buildThumbnailArtPrompt, generateThumbnailArt };
