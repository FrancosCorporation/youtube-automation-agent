'use strict';
const path = require('node:path');

function isApprovedReferenceClip(clip) {
  const expected = path.join(__dirname, '..', 'data', 'videos', 'clips', 'pulso-internet-reference-20261029', 'internet-parte1.mp4');
  return clip?.kind === 'owner-approved-reference-v2'
    && clip.referenceJobId === 'pulso-internet-reference-20261029'
    && clip.partIndex === 1 && clip.partCount === 1
    && typeof clip.path === 'string' && path.resolve(clip.path) === expected;
}

// Keep each narrative segment one second below Instagram's three-minute
// discovery guidance, leaving a strict margin below 180 seconds.
const INSTAGRAM_DISCOVERY_MAX_SECONDS = 179;
const INSTAGRAM_MIN_NARRATIVE_SECONDS = 60;
const TIKTOK_CREATOR_REWARDS_MIN_SECONDS = 60;
// App, Graph API, and discovery rules are different limits. Never treat a
// recommendation target as the platform's hard upload ceiling.
const INSTAGRAM_APP_MAX_SECONDS = 20 * 60;
const INSTAGRAM_GRAPH_API_MAX_SECONDS = 15 * 60;
const INSTAGRAM_NARRATIVE_CLIP_KINDS = new Set(['instagram-narrative', 'instagram-narrative-part']);
const SOCIAL_NARRATIVE_CLIP_KINDS = new Set(['social-narrative', 'social-narrative-part']);
const NARRATIVE_SOCIAL_PLATFORMS = Object.freeze(['instagram', 'tiktok', 'shorts', 'kwai', 'x']);

function instagramPartDurationLimitSeconds(configured = INSTAGRAM_APP_MAX_SECONDS) {
  const requested = Number(configured);
  if (!Number.isFinite(requested) || requested <= 0) throw new TypeError('duração máxima inválida para partes do Instagram');
  return Math.min(requested, INSTAGRAM_DISCOVERY_MAX_SECONDS);
}

function configuredInstagramPartDurationLimitSeconds(env = process.env) {
  return instagramPartDurationLimitSeconds(
    env?.SOCIAL_INSTAGRAM_PART_SECONDS
      || env?.SOCIAL_INSTAGRAM_MAX_SECONDS
      || INSTAGRAM_DISCOVERY_MAX_SECONDS
  );
}

function isNarrativeSocialClip(clip) {
  return INSTAGRAM_NARRATIVE_CLIP_KINDS.has(clip?.kind) || SOCIAL_NARRATIVE_CLIP_KINDS.has(clip?.kind);
}

function configuredNarrativePartDurationLimitSeconds(platform, env = process.env) {
  const configured = (name, fallback) => {
    const value = Number(env?.[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  switch (platform) {
    case 'instagram': return configuredInstagramPartDurationLimitSeconds(env);
    case 'tiktok': return Math.min(INSTAGRAM_DISCOVERY_MAX_SECONDS, configured('SOCIAL_TIKTOK_MAX_SECONDS', 180) - 1);
    case 'shorts': return Math.min(INSTAGRAM_DISCOVERY_MAX_SECONDS, 179);
    case 'kwai': return Math.min(299, configured('SOCIAL_KWAI_MAX_SECONDS', 300) - 1);
    case 'x': return Math.min(599, configured('X_MAX_VIDEO_SECONDS', 140) - 1);
    default: return null;
  }
}

function narrativePartDurationRejection(platform, clip, durationSeconds, configuredMaximumSeconds) {
  if (isApprovedReferenceClip(clip)) {
    const duration = Number(durationSeconds);
    const maximum = Number(configuredMaximumSeconds);
    if (!['instagram', 'shorts', 'kwai'].includes(platform)) return 'destino não permitido para referência aprovada';
    return Number.isFinite(duration) && duration > 0 && Number.isFinite(maximum) && duration <= maximum
      ? null : 'duração da referência fora do limite do destino';
  }
  if (!isNarrativeSocialClip(clip)) {
    if (clip?.kind === 'social-short-clip' || !clip?.kind) {
      return 'corte sem narrativa completa não será publicado automaticamente';
    }
    return null;
  }
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return 'duração narrativa não verificada';
  const editorialMaximum = configuredNarrativePartDurationLimitSeconds(platform);
  if (!Number.isFinite(editorialMaximum) || editorialMaximum <= 0) return 'destino não permitido para parte narrativa';
  const configuredMaximum = Number(configuredMaximumSeconds);
  const maximum = Number.isFinite(configuredMaximum) && configuredMaximum > 0
    ? Math.min(configuredMaximum, editorialMaximum)
    : editorialMaximum;
  if (duration > maximum) return `parte narrativa acima do alvo de ${maximum}s`;
  if (platform === 'instagram' && duration < INSTAGRAM_MIN_NARRATIVE_SECONDS) {
    return `parte narrativa abaixo de ${INSTAGRAM_MIN_NARRATIVE_SECONDS}s; Reel curto não será publicado`;
  }
  if (platform === 'tiktok' && duration <= TIKTOK_CREATOR_REWARDS_MIN_SECONDS) {
    return `parte narrativa não ultrapassa ${TIKTOK_CREATOR_REWARDS_MIN_SECONDS}s exigidos pelo Creator Rewards`;
  }
  if (duration < INSTAGRAM_MIN_NARRATIVE_SECONDS && ['shorts', 'kwai', 'x'].includes(platform)) {
    return `parte narrativa abaixo de ${INSTAGRAM_MIN_NARRATIVE_SECONDS}s; corte curto não será publicado`;
  }
  if (!NARRATIVE_SOCIAL_PLATFORMS.includes(platform)) return 'destino não permitido para parte narrativa';
  return null;
}

/**
 * Split in-order narrative blocks at their existing boundaries. The dynamic
 * program chooses the most balanced partition that stays under each platform
 * target, so parts stay below Instagram's three-minute discovery guidance
 * without cutting a sentence or section.
 */
function splitNarrativeBlocks(blocks, maxDurationSeconds = INSTAGRAM_DISCOVERY_MAX_SECONDS, minimumPartSeconds = 0, { contextBlock = null } = {}) {
  const max = Number(maxDurationSeconds);
  const min = Number(minimumPartSeconds);
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(min) || min < 0) throw new TypeError('duração máxima ou mínima inválida');
  if (min > max) throw new RangeError(`mínimo narrativo de ${min}s excede o teto de ${max}s`);
  if (!Array.isArray(blocks) || !blocks.length) return [];

  const durations = blocks.map(block => Number(block?.durationSeconds));
  if (durations.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new TypeError('cada bloco precisa ter duração positiva e verificável');
  }
  if (durations.some(value => value > max)) {
    throw new RangeError('um bloco narrativo excede o limite da plataforma e precisa ser dividido por frases');
  }

  const total = durations.reduce((sum, value) => sum + value, 0);
  const contextDuration = contextBlock ? Number(contextBlock.durationSeconds) : 0;
  if (!Number.isFinite(contextDuration) || contextDuration < 0 || contextDuration >= max) {
    throw new TypeError('abertura de contexto tem duração inválida');
  }
  if (total < min) throw new RangeError(`narrativa abaixo do mínimo de ${min}s`);
  const minimumPartCount = Math.ceil(total / max);
  const maximumPartCount = min > contextDuration
    ? Math.min(blocks.length, Math.floor((total - contextDuration) / (min - contextDuration)))
    : blocks.length;
  if (minimumPartCount > maximumPartCount) {
    throw new RangeError('não há limites narrativos suficientes para dividir o vídeo com segurança');
  }

  for (let partCount = minimumPartCount; partCount <= maximumPartCount; partCount += 1) {
    if (partCount === 1) {
      return [{ index: 1, count: 1, durationSeconds: total, blocks: [...blocks] }];
    }

    const target = (total + (partCount - 1) * contextDuration) / partCount;
    const memo = new Map();
    function solve(start, partsLeft) {
      const key = `${start}:${partsLeft}`;
      if (memo.has(key)) return memo.get(key);
      if (partsLeft === 1) {
        const durationSeconds = durations.slice(start).reduce((sum, value) => sum + value, 0)
          + (start > 0 ? contextDuration : 0);
        const result = durationSeconds <= max && durationSeconds >= min
          ? { cost: (durationSeconds - target) ** 2, ranges: [[start, blocks.length]] }
          : null;
        memo.set(key, result);
        return result;
      }

      let durationSeconds = start > 0 ? contextDuration : 0;
      let best = null;
      const latestEnd = blocks.length - partsLeft + 1;
      for (let end = start + 1; end <= latestEnd; end += 1) {
        durationSeconds += durations[end - 1];
        if (durationSeconds > max) break;
        if (durationSeconds < min) continue;
        const rest = solve(end, partsLeft - 1);
        if (!rest) continue;
        const cost = (durationSeconds - target) ** 2 + rest.cost;
        if (!best || cost < best.cost) best = { cost, ranges: [[start, end], ...rest.ranges] };
      }
      memo.set(key, best);
      return best;
    }

    const solution = solve(0, partCount);
    if (!solution) continue;
    return solution.ranges.map(([start, end], index) => ({
      index: index + 1,
      count: partCount,
      durationSeconds: durations.slice(start, end).reduce((sum, value) => sum + value, 0)
        + (start > 0 ? contextDuration : 0),
      blocks: start > 0 && contextBlock
        ? [{ ...contextBlock, contextIntro: true }, ...blocks.slice(start, end)]
        : blocks.slice(start, end)
    }));
  }

  throw new RangeError('não foi possível dividir o vídeo respeitando os limites narrativos');
}

function splitLongNarrativeBlock(block, maxDurationSeconds) {
  const maxMs = Math.round(Number(maxDurationSeconds) * 1000);
  const groupDurationMs = Number(block.timing?.durationMs);
  const sentences = block.timing?.sentences;
  if (!Number.isFinite(groupDurationMs) || groupDurationMs <= 0 || !Array.isArray(sentences) || !sentences.length) {
    throw new RangeError('bloco narrativo longo sem tempos de áudio verificáveis por frase');
  }

  const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
  if (normalizeText(sentences.map(sentence => sentence.text).join(' ')) !== normalizeText(block.text)) {
    throw new RangeError('tempos de frase não correspondem ao texto narrativo completo');
  }

  const units = [];
  let audioCursorMs = 0;
  for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex += 1) {
    const sentence = sentences[sentenceIndex];
    const sentenceStartMs = Number(sentence.startMs) || 0;
    const sentenceEndMs = Number(sentence.endMs)
      || sentenceStartMs + (Number(sentence.durationMs) || 0);
    if (!(sentenceEndMs > sentenceStartMs) || sentenceEndMs > groupDurationMs + 100) {
      throw new RangeError('fronteira de frase fora da duração do áudio');
    }

    const words = Array.isArray(sentence.words) && sentence.words.length
      ? sentence.words.map(String)
      : String(sentence.text || '').split(/\s+/).filter(Boolean);
    if (normalizeText(words.join(' ')) !== normalizeText(sentence.text)) {
      throw new RangeError('palavras temporizadas não correspondem à frase');
    }
    const sentenceDurationMs = Math.max(1, Number(sentence.durationMs) || sentenceEndMs - sentenceStartMs);
    const rawWordTimes = Array.isArray(sentence.wordTimes) && sentence.wordTimes.length === words.length
      ? sentence.wordTimes.map(Number)
      : words.map((_, index) => Math.round(Math.max(0, sentenceDurationMs - 200) * index / Math.max(1, words.length)));
    const wordTimes = rawWordTimes.map((value, index) => Number.isFinite(value)
      ? Math.max(index ? rawWordTimes[index - 1] || 0 : 0, Math.min(sentenceDurationMs - 1, value))
      : Math.round(Math.max(0, sentenceDurationMs - 200) * index / Math.max(1, words.length)));

    const sentenceAudioEndMs = sentenceIndex === sentences.length - 1
      ? groupDurationMs
      : Math.min(groupDurationMs, sentenceEndMs);
    const totalSpanMs = sentenceAudioEndMs - audioCursorMs;
    let ranges = [[0, words.length]];
    if (totalSpanMs > maxMs) {
      ranges = [];
      let rangeStart = 0;
      for (let wordIndex = 0; wordIndex < words.length - 1; wordIndex += 1) {
        const hasNaturalPause = /[,;:]$/.test(words[wordIndex]);
        const enoughWords = wordIndex + 1 - rangeStart >= 4;
        if (hasNaturalPause && enoughWords) {
          ranges.push([rangeStart, wordIndex + 1]);
          rangeStart = wordIndex + 1;
        }
      }
      if (rangeStart < words.length) ranges.push([rangeStart, words.length]);
      if (ranges.length > 1 && ranges.at(-1)[1] - ranges.at(-1)[0] < 4) {
        ranges[ranges.length - 2][1] = ranges.at(-1)[1];
        ranges.pop();
      }
      if (ranges.length <= 1) {
        throw new RangeError('uma frase excede o limite e não tem pausa segura para dividi-la');
      }
    }

    for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
      const [wordStart, wordEnd] = ranges[rangeIndex];
      const nextWordStart = rangeIndex + 1 < ranges.length
        ? sentenceStartMs + wordTimes[ranges[rangeIndex + 1][0]]
        : sentenceAudioEndMs;
      const unitEndMs = Math.max(audioCursorMs + 1, Math.min(groupDurationMs, nextWordStart));
      const unitDurationMs = unitEndMs - audioCursorMs;
      if (unitDurationMs > maxMs) {
        throw new RangeError('não há pausas narrativas suficientes para dividir o bloco com segurança');
      }
      const textWords = words.slice(wordStart, wordEnd);
      const localWordTimes = wordTimes.slice(wordStart, wordEnd).map(time =>
        Math.max(0, Math.min(unitDurationMs - 1, sentenceStartMs + time - audioCursorMs))
      );
      units.push({
        text: textWords.join(' '),
        durationMs: unitDurationMs,
        audioStartMs: audioCursorMs,
        audioEndMs: unitEndMs,
        timing: {
          text: textWords.join(' '),
          words: textWords,
          startMs: 0,
          endMs: unitDurationMs,
          durationMs: unitDurationMs,
          wordTimes: localWordTimes
        }
      });
      audioCursorMs = unitEndMs;
    }
  }

  if (audioCursorMs < groupDurationMs) {
    const last = units.at(-1);
    const tailMs = groupDurationMs - audioCursorMs;
    if (!last || last.durationMs + tailMs > maxMs) {
      throw new RangeError('silêncio final não cabe em uma parte narrativa segura');
    }
    last.durationMs += tailMs;
    last.audioEndMs = groupDurationMs;
    last.timing.durationMs += tailMs;
    last.timing.endMs += tailMs;
  }

  if (units.length < 2 || units.some(unit => unit.durationMs > maxMs)) {
    throw new RangeError('não foi possível dividir a seção longa dentro do limite de duração');
  }
  return units.map(unit => {
    const timing = {
      ...block.timing,
      durationMs: unit.durationMs,
      sentences: [{ ...unit.timing, startMs: 0, endMs: unit.durationMs }]
    };
    return {
      ...block,
      text: unit.text,
      timing,
      audioStartMs: unit.audioStartMs,
      audioEndMs: unit.audioEndMs,
      durationSeconds: unit.durationMs / 1000
    };
  }).filter(fragment => fragment.durationSeconds > 0);
}

function narrativeBlocksFromScript(
  script,
  maxDurationSeconds = INSTAGRAM_DISCOVERY_MAX_SECONDS,
  refineSectionsAboveSeconds = Number.POSITIVE_INFINITY
) {
  const blocks = [];
  const add = (kind, title, text, originalIndex, emotion, visual = null) => {
    const timing = script?.timings?.[originalIndex];
    const durationMs = Number(timing?.durationMs)
      || (Array.isArray(timing?.sentences) ? timing.sentences.reduce((sum, sentence) => sum + (Number(sentence.durationMs) || 0), 0) : 0);
    if (!text || !durationMs) return;
    blocks.push({ kind, title, text, originalIndex, emotion, visual, timing, durationSeconds: durationMs / 1000 });
  };

  let originalIndex = 0;
  if (script?.hook) add('hook', 'Abertura', String(script.hook), originalIndex++, script.hookEmotion);
  for (const section of script?.mainContent?.sections || []) {
    add('section', section.title || 'Seção', String(section.content || ''), originalIndex++, section.emotion, section.visual);
  }
  if (script?.conclusion) {
    add('conclusion', 'Conclusão', String(script.conclusion.finalThought || script.conclusion), originalIndex, script.conclusion.emotion);
  }
  return blocks.flatMap(block => block.durationSeconds > maxDurationSeconds
    || (block.durationSeconds > refineSectionsAboveSeconds && (block.timing?.sentences || []).length > 1)
    ? splitLongNarrativeBlock(block, maxDurationSeconds)
    : [block]);
}

function createNarrativePartScript(script, blocks, partIndex, partCount, { visualMode = 'minimal' } = {}) {
  if (!Array.isArray(blocks) || !blocks.length) throw new TypeError('parte narrativa sem blocos');
  let audioOffsetMs = 0;
  const timings = blocks.map(block => {
    const timing = { ...block.timing, audioOffsetMs };
    audioOffsetMs += Number(timing.durationMs) || 0;
    return timing;
  });
  return {
    ...script,
    hook: null,
    conclusion: null,
    mainContent: {
      ...(script.mainContent || {}),
      sections: blocks.map(block => ({
        title: block.title,
        content: block.text,
        emotion: block.emotion,
        ...(block.visual ? { visual: block.visual } : {})
      }))
    },
    timings,
    minimal: visualMode !== 'explanatory',
    explanatorySocial: visualMode === 'explanatory',
    forceLayout: 'hero',
    maxCaptionWords: 12,
    steadyNarrative: true,
    partIndicator: partCount > 1 ? { index: partIndex, count: partCount } : null
  };
}

function isPlatformTargeted(clip, platform) {
  if (isApprovedReferenceClip(clip)) {
    return ['instagram', 'shorts', 'kwai'].includes(platform)
      && Array.isArray(clip.platforms) && clip.platforms.includes(platform);
  }
  if (clip?.kind === 'social-short-clip') return false;
  if (isNarrativeSocialClip(clip)) {
    const allowedPlatforms = INSTAGRAM_NARRATIVE_CLIP_KINDS.has(clip.kind)
      ? ['instagram', 'tiktok'] : NARRATIVE_SOCIAL_PLATFORMS;
    return allowedPlatforms.includes(platform)
      && Array.isArray(clip?.platforms)
      && clip.platforms.length > 0
      && clip.platforms.every(target => allowedPlatforms.includes(target))
      && clip.platforms.includes(platform);
  }
  // Unclassified legacy clips can be 7–22 second sentence cuts. Do not retry
  // them automatically: production must opt into complete narrative parts.
  return false;
}

function isShortsTargeted(clip) {
  if (isApprovedReferenceClip(clip)) return isPlatformTargeted(clip, 'shorts');
  return isNarrativeSocialClip(clip)
    && Array.isArray(clip?.platforms)
    && clip.platforms.includes('shorts')
    && isPlatformTargeted(clip, 'shorts');
}

function socialClipCaption({ clip, title, hashtags = '', sourceUrl = '', platform = '' }) {
  const source = sourceUrl ? `Fonte: ${sourceUrl}` : '';
  if (isApprovedReferenceClip(clip)) return [title || clip.title, source, hashtags].filter(Boolean).join('\n\n');
  if (NARRATIVE_SOCIAL_PLATFORMS.includes(platform)
    && isNarrativeSocialClip(clip)
    && !Number.isInteger(clip?.partIndex)) {
    return [title || clip.title, source, hashtags].filter(Boolean).join('\n\n');
  }
  if (NARRATIVE_SOCIAL_PLATFORMS.includes(platform)
    && isNarrativeSocialClip(clip)
    && Number.isInteger(clip?.partIndex) && Number.isInteger(clip?.partCount)) {
    const part = `Parte ${clip.partIndex}/${clip.partCount}`;
    const continuation = clip.partIndex < clip.partCount ? `A continuação está na Parte ${clip.partIndex + 1}.` : '';
    return [part, title || clip.title, continuation, source, hashtags].filter(Boolean).join('\n\n');
  }
  const headline = [title || clip?.title, hashtags, '#shorts'].filter(Boolean).join(' ').trim();
  return source ? `${headline}\n\n${source}` : headline;
}

module.exports = {
  INSTAGRAM_DISCOVERY_MAX_SECONDS,
  INSTAGRAM_MIN_NARRATIVE_SECONDS,
  INSTAGRAM_APP_MAX_SECONDS,
  INSTAGRAM_GRAPH_API_MAX_SECONDS,
  TIKTOK_CREATOR_REWARDS_MIN_SECONDS,
  configuredInstagramPartDurationLimitSeconds,
  configuredNarrativePartDurationLimitSeconds,
  createNarrativePartScript,
  isNarrativeSocialClip,
  instagramPartDurationLimitSeconds,
  isPlatformTargeted,
  isShortsTargeted,
  narrativePartDurationRejection,
  narrativeBlocksFromScript,
  splitLongNarrativeBlock,
  socialClipCaption,
  splitNarrativeBlocks
};
