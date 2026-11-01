/** Build deterministic timed scene data for the HyperFrames composition. */
const THEME_CONFIG = require('../config/themes.json');
const THEMES = Array.isArray(THEME_CONFIG.themes) ? THEME_CONFIG.themes : [];
const CAPTION_MAX_WORDS = 10;
const CAPTION_NATURAL_PAUSE_LOOKAHEAD_WORDS = 5;
const CAPTION_MAX_WORDS_WITH_NATURAL_PAUSE = CAPTION_MAX_WORDS + CAPTION_NATURAL_PAUSE_LOOKAHEAD_WORDS;
const DANGLING_CAPTION_WORDS = new Set([
  'a', 'an', 'and', 'ao', 'aos', 'as', 'at', 'but', 'by', 'com', 'contra', 'da', 'das', 'de', 'do', 'dos',
  'e', 'em', 'entre', 'for', 'from', 'in', 'into', 'na', 'nas', 'no', 'nos', 'nor', 'of', 'on', 'onto',
  'or', 'para', 'pela', 'pelas', 'pelo', 'pelos', 'per', 'por', 'sem', 'so', 'sob', 'sobre', 'the', 'to',
  'upon', 'via', 'with', 'yet', 'menos'
]);
const MIN_VISUAL_SCENE_DURATION_MS = 9000;
const SOCIAL_IMAGE_TARGET_MS = 8000;
const SOCIAL_IMAGE_MAX_MS = 12000;
const ARTICLE_PRINT_MIN_DWELL_MS = 7200;
const isSourceReference = component => ['article-print', 'news-card'].includes(component.type);

function sourceReferenceDwellMs(component) {
  const count = Number(component.readingWords);
  const words = Number.isFinite(count) && count > 0 ? count
    : component.type === 'news-card' ? String(component.title || '').split(/\s+/).filter(Boolean).length : 0;
  return Math.max(ARTICLE_PRINT_MIN_DWELL_MS, Math.min(24000, Math.ceil(words * 350) + 1000));
}
const {
  extractOrderedChecklist,
  extractRotationCards,
  extractNarratedGpuComparison,
  formatVideoTimestamp,
  normalizeComparisonItems,
  normalizeMetricComparisonItems,
  findNarrationCueOffset
} = require('./scene-visuals');

function resolveVisualTheme(script = {}) {
  const scriptTheme = typeof script.theme === 'string'
    ? script.theme
    : script.theme && typeof script.theme === 'object' ? script.theme.id : null;
  const candidates = [script.themeId, scriptTheme, process.env.THEME, script.channel]
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  for (const candidate of candidates) {
    const match = THEMES.find(theme => [theme.id, theme.name, theme.brand]
      .some(value => String(value || '').trim().toLowerCase() === candidate));
    if (match) return match;
  }
  return THEMES.find(theme => theme.id === 'ia') || THEMES[0] || null;
}

// PRNG semeado (mulberry32) — cada vídeo recebe um seed e sai diferente:
// layouts, gráficos, orientação, cores, ordem de imagens e componentes variam.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds timed editorial scenes used by the deterministic HyperFrames timeline. */
class ScenePlanBuilder {
  constructor() {
    this.shortLeadMs = 120;
  }

  estimateDuration(script) {
    let words = 0;
    const count = text => String(text || '').split(/\s+/).filter(Boolean).length;
    if (script.hook) words += count(script.hook.text || script.hook);
    for (const s of script.mainContent?.sections || []) {
      words += count(s.title);
      words += count(typeof s.content === 'string' ? s.content : JSON.stringify(s.content || ''));
    }
    if (script.conclusion) words += count(script.conclusion.finalThought || script.conclusion);
    return Math.max(20, Math.round((words / 150) * 60));
  }

  // Split a section text into caption-ready beats with evenly distributed timings.
  beats(text, durationMs) {
    const sentences = String(text || '').split(/(?<=[.!?…])\s+/).filter(Boolean);
    const totalWords = sentences.reduce((n, s) => n + s.split(/\s+/).filter(Boolean).length, 0) || 1;
    const out = [];
    let cursor = this.shortLeadMs;
    for (const sentence of sentences) {
      const words = sentence.split(/\s+/).filter(Boolean);
      const dur = Math.max(1800, (words.length / totalWords) * (durationMs - this.shortLeadMs));
      out.push({ text: sentence, words, startMs: cursor, durationMs: dur });
      cursor += dur;
    }
    return out;
  }

  // Turn an overlong sentence into caption beats without changing its screen
  // time or word timing. Prefer nearby punctuation and avoid ending a page on
  // a preposition or conjunction that leaves the phrase hanging.
  splitLongBeats(beats, maxWords = CAPTION_MAX_WORDS) {
    const limit = Math.max(1, Math.floor(Number(maxWords) || CAPTION_MAX_WORDS));
    return (beats || []).flatMap(beat => {
      const words = Array.isArray(beat.words) ? beat.words : String(beat.text || '').split(/\s+/).filter(Boolean);
      if (words.length <= limit) return [beat];

      const durationMs = Math.max(1, Math.round(Number(beat.durationMs) || 1));
      const suppliedTimes = Array.isArray(beat.wordTimes) && beat.wordTimes.length === words.length
        ? beat.wordTimes
        : null;
      const suppliedEndTimes = Array.isArray(beat.wordEndTimes) && beat.wordEndTimes.length === words.length
        ? beat.wordEndTimes
        : null;
      let previousTime = 0;
      const wordStarts = words.map((_, index) => {
        const fallback = (Math.max(0, durationMs - 200) * index) / words.length;
        const raw = suppliedTimes ? Number(suppliedTimes[index]) : fallback;
        const time = Math.max(previousTime, Math.min(Math.max(0, durationMs - 1), Number.isFinite(raw) ? raw : fallback));
        previousTime = time;
        return Math.round(time);
      });

      const pages = [];
      let startIndex = 0;
      let segmentStartMs = 0;
      while (startIndex < words.length) {
        let endIndex = Math.min(words.length, startIndex + limit);
        if (endIndex < words.length) {
          // Prefer a nearby natural pause, but avoid tiny caption fragments.
          let foundPunctuation = false;
          for (let candidate = endIndex; candidate >= startIndex + Math.min(4, limit); candidate -= 1) {
            if (/[,:;.!?…]$/.test(words[candidate - 1])) {
              endIndex = candidate;
              foundPunctuation = true;
              break;
            }
          }
          if (!foundPunctuation) {
            const naturalPauseLimit = Math.min(words.length, endIndex + CAPTION_NATURAL_PAUSE_LOOKAHEAD_WORDS);
            for (let candidate = endIndex + 1; candidate <= naturalPauseLimit; candidate += 1) {
              if (/[,:;.!?…]$/.test(words[candidate - 1])) {
                endIndex = candidate;
                break;
              }
            }
          }
          if (!/[,:;.!?…]$/.test(words[endIndex - 1])) {
            while (endIndex > startIndex + Math.min(4, limit)) {
              const finalWord = words[endIndex - 1].normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');
              if (!DANGLING_CAPTION_WORDS.has(finalWord)) break;
              endIndex -= 1;
            }
          }
        }

        const segmentEndMs = endIndex < words.length
          ? Math.max(segmentStartMs + 1, wordStarts[endIndex])
          : durationMs;
        const pageDurationMs = Math.max(1, segmentEndMs - segmentStartMs);
        const pageWords = words.slice(startIndex, endIndex);
        const pageTimes = wordStarts.slice(startIndex, endIndex).map(time =>
          Math.max(0, Math.min(pageDurationMs - 1, time - segmentStartMs))
        );
        pages.push({
          ...beat,
          text: pageWords.join(' '),
          words: pageWords,
          startMs: Math.round((Number(beat.startMs) || 0) + segmentStartMs),
          durationMs: pageDurationMs,
          wordTimes: pageTimes,
          ...(suppliedEndTimes ? {
            wordEndTimes: suppliedEndTimes.slice(startIndex, endIndex).map(time =>
              Math.max(1, Math.min(pageDurationMs, Math.round(Number(time) - segmentStartMs))))
          } : {})
        });
        startIndex = endIndex;
        segmentStartMs = segmentEndMs;
      }
      return pages;
    });
  }

  captionWords(words, startMs, durationMs, realTimes, realEndTimes) {
    let longest = '';
    for (const w of words) if (w.replace(/[^\wÀ-ÿ]/g, '').length > longest.replace(/[^\wÀ-ÿ]/g, '').length) longest = w;
    const kw = w => w === longest && w.length > 4;
    if (realTimes && realTimes.length === words.length) {
      return words.map((w, i) => {
        const t = Math.max(0, Math.round(realTimes[i] || 0));
        const next = realTimes[i + 1] != null ? Math.round(realTimes[i + 1]) : durationMs;
        const exactEnd = realEndTimes?.length === words.length ? Number(realEndTimes[i]) : null;
        return { w, t, e: Number.isFinite(exactEnd) ? Math.max(t + 1, Math.round(exactEnd)) : Math.max(t + 120, next), kw: kw(w) };
      });
    }
    const span = Math.max(600, durationMs - 260);
    const step = span / Math.max(1, words.length);
    return words.map((w, i) => ({ w, t: Math.round(startMs + i * step), e: Math.round(startMs + (i + 1) * step), kw: kw(w) }));
  }

  coalesceVisualScenes(scenes, minDurationMs = MIN_VISUAL_SCENE_DURATION_MS) {
    const minimum = Math.max(1, Math.floor(Number(minDurationMs) || MIN_VISUAL_SCENE_DURATION_MS));
    if (scenes.length < 2) return scenes;

    const semanticTypes = new Set([
      'article-print', 'news-card', 'score-chart', 'line-chart', 'donut-chart',
      'rank-list', 'compare-table', 'progressive-comparison', 'checklist', 'rotation-cards', 'timestamp-hud',
      'kinetic-number', 'node-graph', 'atlas-story-scene'
    ]);
    const isSemantic = component => semanticTypes.has(component.type) || component.editorialContext === true;
    const windowedTypes = new Set([
      ...semanticTypes, 'bento-card', 'kinetic-number', 'node-graph', 'atlas-story-scene',
      'spec-chips', 'progress-bar', 'highlight'
    ]);
    const chunks = [];
    let pending = [];
    let pendingDurationMs = 0;
    let pendingPrintVisibleUntilMs = 0;
    let pendingProgressiveVisualUntilMs = 0;
    for (const scene of scenes) {
      const beginsProgressiveVisual = (scene.components || []).some(component =>
        component.type === 'progressive-comparison');
      const beginsNodeGraph = (scene.components || []).some(component => component.type === 'node-graph');
      if (pending.length && (beginsProgressiveVisual || beginsNodeGraph)) {
        // A merged preceding scene would retain its chapter header and presenter
        // canvas over a full-screen chart or process graph.
        chunks.push(pending);
        pending = [];
        pendingDurationMs = 0;
        pendingPrintVisibleUntilMs = 0;
        pendingProgressiveVisualUntilMs = 0;
      }
      if (beginsNodeGraph) {
        chunks.push([scene]);
        continue;
      }
      // Social image variants belong to one narrated section. Do not carry a
      // section's hero into the next one while coalescing short caption pages.
      if (pending.length && scene.steadyNarrative
        && pending[0].groupIndex !== scene.groupIndex) {
        chunks.push(pending);
        pending = [];
        pendingDurationMs = 0;
        pendingPrintVisibleUntilMs = 0;
        pendingProgressiveVisualUntilMs = 0;
      }
      const sceneDurationMs = Math.max(0, Number(scene.durationMs) || 0);
      const articlePrint = !scene.minimal
        && (scene.components || []).find(isSourceReference);
      if (articlePrint) {
        // Keep short-form cuts untouched. In a master, schedule source prints
        // one after another so each gets a readable hold even when two source
        // references happen to land close together in the narration.
        const visibleStartMs = Math.max(pendingDurationMs, pendingPrintVisibleUntilMs);
        pendingPrintVisibleUntilMs = Math.max(
          pendingDurationMs + sceneDurationMs,
          visibleStartMs + sourceReferenceDwellMs(articlePrint)
        );
      }
      const progressiveVisual = (scene.components || []).find(component => component.type === 'progressive-comparison');
      if (progressiveVisual) {
        const finalCueOffsetMs = Math.max(0, ...(progressiveVisual.items || [])
          .map(item => Number(item.revealAfterMs) || 0));
        pendingProgressiveVisualUntilMs = Math.max(pendingProgressiveVisualUntilMs,
          pendingDurationMs + (Number(progressiveVisual.revealAtMs) || 0) + finalCueOffsetMs + 1260);
      }
      pending.push(scene);
      pendingDurationMs += sceneDurationMs;
      const pendingHasAtlasStory = pending.some(item => (item.components || [])
        .some(component => component.type === 'atlas-story-scene'));
      if (pendingDurationMs >= minimum && pendingDurationMs >= pendingPrintVisibleUntilMs
        && pendingDurationMs >= pendingProgressiveVisualUntilMs && !pendingHasAtlasStory) {
        chunks.push(pending);
        pending = [];
        pendingDurationMs = 0;
        pendingPrintVisibleUntilMs = 0;
        pendingProgressiveVisualUntilMs = 0;
      }
    }
    if (pending.length) {
      const previousChunkIsStandalone = chunks.at(-1)?.some(scene =>
        (scene.components || []).some(component => component.type === 'node-graph'));
      if (chunks.length && !previousChunkIsStandalone && (!pending[0].steadyNarrative
        || chunks.at(-1)[0].groupIndex === pending[0].groupIndex)) chunks[chunks.length - 1].push(...pending);
      else chunks.push(pending);
    }

    return chunks.map(chunk => {
      if (chunk.length === 1) return chunk[0];
      const durationMs = chunk.reduce((sum, scene) => sum + (Number(scene.durationMs) || 0), 0);
      const first = chunk[0];
      let offsetMs = 0;
      const sceneWindows = chunk.map(scene => {
        const sceneDurationMs = Number(scene.durationMs) || 0;
        const window = { scene, startMs: offsetMs, durationMs: sceneDurationMs, endMs: offsetMs + sceneDurationMs };
        offsetMs += sceneDurationMs;
        return window;
      });
      const groupEndMs = new Map();
      for (const window of sceneWindows) {
        groupEndMs.set(window.scene.groupIndex ?? null, window.endMs);
      }
      const groupKey = window => window.scene.groupIndex ?? null;
      const hasRichVisual = sceneWindows.some(window => (window.scene.components || []).some(component =>
        semanticTypes.has(component.type) && component.type !== 'timestamp-hud'));
      const contextGroups = new Set();
      const keepContext = (component, key) => {
        if (!component.editorialContext) return true;
        if (hasRichVisual || contextGroups.has(key)) return false;
        contextGroups.add(key);
        return true;
      };
      const articlePrintWindows = new Map();
      const articlePrintEntries = sceneWindows.flatMap(window => !window.scene.minimal
        ? (window.scene.components || [])
          .filter(isSourceReference)
          .map(component => ({ window, component, dwellMs: sourceReferenceDwellMs(component) }))
        : []);
      let printVisibleUntilMs = 0;
      for (const [index, { window, component, dwellMs }] of articlePrintEntries.entries()) {
        const remainingDwellMs = articlePrintEntries.slice(index).reduce((sum, entry) => sum + entry.dwellMs, 0);
        const latestStartMs = Math.max(0, durationMs - remainingDwellMs);
        const requestedStartMs = Math.max(window.startMs, printVisibleUntilMs);
        // A print close to the end of the master must begin a little earlier
        // so its readable window is not clipped by the file boundary. If the
        // whole group is too short to fit every print, the last window remains
        // bounded by the available timeline rather than overrunning the MP4.
        const startMs = Math.max(
          printVisibleUntilMs,
          Math.min(requestedStartMs, latestStartMs)
        );
        const endMs = Math.min(durationMs, startMs + dwellMs);
        articlePrintWindows.set(component, { startMs, endMs });
        printVisibleUntilMs = endMs;
      }
      const pages = [];
      const headerEntries = [];
      for (const window of sceneWindows) {
        const { scene } = window;
        const caption = (scene.components || []).find(component => component.type === 'caption');
        if (caption) {
          pages.push({
            startMs: window.startMs,
            endMs: window.endMs,
            words: caption.words.map(word => ({
              ...word,
              t: (Number(word.t) || 0) + window.startMs,
              e: (Number(word.e) || 0) + window.startMs
            }))
          });
        }
        const header = (scene.components || []).find(component => component.type === 'demo-header');
        const lastHeader = headerEntries[headerEntries.length - 1];
        if (header && (!lastHeader || lastHeader.groupIndex !== groupKey(window))) {
          headerEntries.push({
            groupIndex: groupKey(window),
            startMs: window.startMs,
            endMs: groupEndMs.get(groupKey(window)),
            category: header.category || '',
            chapterIndex: Number(header.chapterIndex) || 1,
            chapterTotal: Number(header.chapterTotal) || 1,
            chapterStartMs: Number(header.chapterStartMs) || 0,
            chapterDurationMs: Number(header.chapterDurationMs) || 1
          });
        }
      }

      const components = first.components
        .filter(component => component.type !== 'caption' && component.type !== 'demo-header' && component.type !== 'timestamp-hud')
        .filter(component => keepContext(component, groupKey(sceneWindows[0])))
        .map(component => {
        const cloned = { ...component };
        if (component.type === 'image-panel') cloned.type = 'image-hero';
        if (['image-hero', 'image-panel', 'pulse-glow'].includes(component.type)) {
          cloned.durMs = durationMs;
        }
        if (windowedTypes.has(component.type)) {
          const articlePrintWindow = isSourceReference(component)
            ? articlePrintWindows.get(component)
            : null;
          const sectionVisual = isSemantic(component)
            && !['timestamp-hud', 'article-print', 'news-card'].includes(component.type);
          if (articlePrintWindow) {
            cloned.revealAtMs = (Number(component.revealAtMs) || 0) + articlePrintWindow.startMs;
          }
          cloned.sceneWindow = {
            startMs: articlePrintWindow?.startMs ?? sceneWindows[0].startMs,
            endMs: articlePrintWindow?.endMs
              ?? (sectionVisual ? groupEndMs.get(groupKey(sceneWindows[0])) : sceneWindows[0].endMs)
          };
        }
        return cloned;
      });
      if (headerEntries.length) {
        components.unshift({
          type: 'demo-header',
          category: headerEntries[0].category,
          chapterIndex: headerEntries[0].chapterIndex,
          chapterTotal: headerEntries[0].chapterTotal,
          chapterStartMs: headerEntries[0].chapterStartMs,
          chapterDurationMs: headerEntries[0].chapterDurationMs,
          entries: headerEntries
        });
      }
      for (const window of sceneWindows) {
        const { scene, startMs, endMs } = window;
        const key = groupKey(window);
        for (const component of scene.components || []) {
          if (!isSemantic(component)) continue;
          if (window === sceneWindows[0] && component.type !== 'timestamp-hud') continue;
          if (!keepContext(component, key)) continue;
          const articlePrintWindow = isSourceReference(component)
            ? articlePrintWindows.get(component)
            : null;
          const componentStartMs = articlePrintWindow?.startMs ?? startMs;
          const revealAtMs = (Number(component.revealAtMs) || 0) + componentStartMs;
          const visibleUntilMs = articlePrintWindow
            ? articlePrintWindow.endMs
            : component.type === 'timestamp-hud' || component.type === 'article-print' || component.type === 'news-card'
              ? endMs
            : groupEndMs.get(key);
          components.push({
            ...component,
            revealAtMs,
            sceneWindow: {
              startMs: componentStartMs,
              endMs: visibleUntilMs
            }
          });
        }
      }
      // A readable source can extend beyond its original caption beat. Keep
      // other cards/charts in a free interval of their existing window so the
      // source never covers a second text block. Narration is unchanged.
      const sourceWindows = [...articlePrintWindows.values()];
      for (let index = components.length - 1; index >= 0; index--) {
        const component = components[index];
        if (!component.sceneWindow || isSourceReference(component)
          || component.type === 'timestamp-hud' || !windowedTypes.has(component.type)) continue;
        const originalStart = component.sceneWindow.startMs;
        let free = [{ ...component.sceneWindow }];
        for (const source of sourceWindows) {
          free = free.flatMap(window => {
            if (source.endMs <= window.startMs || source.startMs >= window.endMs) return [window];
            return [
              { startMs: window.startMs, endMs: Math.min(window.endMs, source.startMs) },
              { startMs: Math.max(window.startMs, source.endMs), endMs: window.endMs }
            ].filter(part => part.endMs > part.startMs);
          });
        }
        const available = free.sort((a, b) => (b.endMs - b.startMs) - (a.endMs - a.startMs))[0];
        if (!available || available.endMs - available.startMs < 1500) {
          components.splice(index, 1);
          continue;
        }
        const revealDelay = Math.max(0, (component.revealAtMs || 0) - originalStart);
        component.sceneWindow = available;
        component.revealAtMs = available.startMs + revealDelay;
      }
      if (pages.length) components.push({ type: 'caption-track', pages });

      // Distinct metrics in one narrated section are introduced in order.
      // Keep the earlier callout until the next one arrives, rather than
      // leaving both cards visible over the same phone-sized focal area.
      const kineticNumbers = components
        .filter(component => component.type === 'kinetic-number' && component.sceneWindow)
        .sort((left, right) => left.sceneWindow.startMs - right.sceneWindow.startMs
          || left.revealAtMs - right.revealAtMs);
      for (let index = 0; index < kineticNumbers.length - 1; index += 1) {
        const current = kineticNumbers[index];
        const next = kineticNumbers[index + 1];
        const currentStart = Number(current.sceneWindow.startMs);
        const nextStart = Number(next.sceneWindow.startMs);
        if (nextStart > currentStart && nextStart < Number(current.sceneWindow.endMs)) {
          current.sceneWindow = { ...current.sceneWindow, endMs: nextStart };
        }
      }

      const envelopeStepMs = Number(first.speechEnvelope?.stepMs) || 10;
      const hasEnvelope = chunk.some(scene => Array.isArray(scene.speechEnvelope?.levels) && scene.speechEnvelope.levels.length);
      const speechEnvelope = hasEnvelope
        ? {
            ...first.speechEnvelope,
            stepMs: envelopeStepMs,
            levels: chunk.flatMap(scene => {
              const levels = scene.speechEnvelope?.levels;
              return Array.isArray(levels) && levels.length
                ? levels
                : Array(Math.ceil((Number(scene.durationMs) || 0) / envelopeStepMs)).fill(0);
            })
          }
        : first.speechEnvelope;

      const mergedScene = {
        ...first,
        durationMs,
        speechEnvelope,
        components
      };
      delete mergedScene.split;
      delete mergedScene.splitLeft;
      if (first.split && components.some(component => component.type === 'image-hero')) mergedScene.hero = true;

      return mergedScene;
    });
  }

  paceNarrativeImages(scenes, images) {
    let previousImage = null;
    const nextSource = new Map();
    const groupDurations = new Map();
    for (const scene of scenes) {
      const groupKey = scene.groupIndex ?? scene.id;
      groupDurations.set(groupKey, (groupDurations.get(groupKey) || 0) + (Number(scene.durationMs) || 0));
    }
    return scenes.map(scene => {
      const hero = (scene.components || []).find(component =>
        component.type === 'image-hero' || component.type === 'image-panel');
      if (!hero) return scene;
      const raw = images[scene.groupIndex];
      const sources = [...new Set((typeof raw === 'string' ? [raw]
        : raw?.sources || [raw?.hero, raw?.split]).filter(Boolean))];
      if (!sources.length) return scene;
      const durationMs = Number(scene.durationMs);
      const count = Math.max(1, Math.round(durationMs / SOCIAL_IMAGE_TARGET_MS), Math.ceil(durationMs / SOCIAL_IMAGE_MAX_MS));
      const visuals = [];
      for (let index = 0; index < count; index++) {
        const startMs = Math.round(index * durationMs / count);
        const endMs = Math.round((index + 1) * durationMs / count);
        let sourceIndex = (nextSource.get(scene.groupIndex) || 0) % sources.length;
        if (sources[sourceIndex] === previousImage && sources.length > 1) sourceIndex = (sourceIndex + 1) % sources.length;
        const src = sources[sourceIndex];
        const sceneWindow = { startMs, endMs };
        if (scene.steadyNarrative && src === previousImage
          && (groupDurations.get(scene.groupIndex ?? scene.id) || durationMs) > SOCIAL_IMAGE_MAX_MS) {
          // With only one photo, use an actual narration excerpt as an
          // editorial interlude instead of pretending a crop is a new image.
          // Short spoken sections keep their visual across caption/graph beats.
          visuals.push({ type: 'bento-card', title: scene.groupTitle || '',
            subtitle: scene.contextSentence || '', revealAtMs: startMs,
            sceneWindow, editorialContext: true });
          previousImage = null;
        } else {
          visuals.push({ ...hero, type: 'image-hero', src,
            static: Boolean(scene.steadyNarrative && src === previousImage), strong: false,
            noFade: Boolean(scene.minimal || scene.steadyNarrative),
            durMs: endMs - startMs, revealAtMs: startMs, sceneWindow });
          previousImage = src;
          nextSource.set(scene.groupIndex, sourceIndex + 1);
        }
      }
      const components = [...visuals, ...scene.components.filter(component =>
        component.type !== 'image-hero' && component.type !== 'image-panel')];
      return { ...scene, hero: true, split: false, splitLeft: false, components };
    });
  }

  firstNumber(text) {
    const s = String(text);
    const pct = s.match(/\b\d{1,3}(?:[.,]\d+)?\s*%/);
    if (pct) return pct[0].replace(/\s+/g, '');
    const year = s.match(/\b(?:19|20)\d{2}\b/);
    if (year) return year[0];
    const num = s.match(/\b\d{1,6}\b/);
    return num ? num[0] : null;
  }

  // Numbers+units spoken in the sentence become glowing spec chips
  // (e.g. "32 GB de VRAM" -> chip "32 GB VRAM"), ref-style spec callouts.
  specChips(text) {
    const s = String(text);
    const re = /(\d+(?:[.,]\d+)?)\s*(gbytes?|gb|mb|tb|ghz|mhz|cpu|gpu|t4|rtx|ram|vram|tb\/s|gb\/s|%|x)\b\s*([a-zà-ú]{2,7})?/gi;
    const seen = new Set();
    const chips = [];
    let m;
    while ((m = re.exec(s)) && chips.length < 3) {
      const value = `${m[1]} ${m[2].toUpperCase()}`.replace(/\s+$/, '');
      const raw = (m[3] || '').toLowerCase();
      const label = /^(de|da|do|dos|das|e|com|em|para|a|o|um|uma|por|no|na)$/.test(raw) ? '' : (m[3] || '').slice(0, 8);
      const key = value + ' ' + label;
      if (seen.has(key) || value.length > 10) continue;
      seen.add(key);
      chips.push({ value, label });
    }
    return chips;
  }

  buildScenes(script, totalDurationMs, images = {}, speechEnvelope = null, {
    coalesce = true, includeNarrationSentenceIndex = false
  } = {}) {
    // Cada vídeo é único: tudo abaixo vem de um pool embaralhado por seed.
    const parsedSeed = Number(script.seed);
    const seedText = String(script.seed ?? script.title ?? script.hook?.text ?? script.hook ?? 'pulso');
    let stableSeed = 2166136261;
    for (let i = 0; i < seedText.length; i += 1) {
      stableSeed ^= seedText.charCodeAt(i);
      stableSeed = Math.imul(stableSeed, 16777619);
    }
    const seed = (Number.isFinite(parsedSeed) ? parsedSeed : stableSeed) >>> 0;
    const rng = mulberry32(seed);
    const resolvedTheme = resolveVisualTheme(script);
    const paletteConfig = script.visualPalettes?.variants?.length
      ? script.visualPalettes
      : resolvedTheme?.visualPalettes;
    const paletteVariants = paletteConfig?.variants;
    const themePalette = Array.isArray(paletteVariants) && paletteVariants.length
      ? paletteVariants[seed % paletteVariants.length]
      : null;
    const shuffle = arr => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    };
    // The presenter occupies the right side of the frame; reverse split layouts
    // put text behind the robot layer and fail the full-composition layout check.
    const layoutPool = shuffle(['hero', 'hero', 'split', 'split', 'split', 'hero', 'hero']);
    const accentPool = shuffle(themePalette?.accents?.length
      ? [...themePalette.accents]
      : ['#60A5FA', '#7DD3FC', '#4ADE80', '#F472B6', '#A78BFA', '#FBBF24']);

    const sectionText = s => (typeof s.content === 'string' ? s.content : (s.items || s.steps || []).map(i => `${i.title || ''} ${i.description || ''}`).join(' '));
    // Nem todo campo vem como string (hook/conclusão podem ser objetos) —
    // sem isso, g.text.split() explode e o vídeo inteiro falha.
    const asText = v => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
    const groups = [];
    if (script.hook) groups.push({ kind: 'hook', title: 'Abertura', text: asText(script.hook.text || script.hook), emotion: script.hookEmotion || 'curiosity', visual: script.hook.visual || null, news: (script.news || [])[0] || null, print: (script.prints || [])[0] || null, weight: 0.6 });
    (script.mainContent?.sections || []).forEach(s => groups.push({ kind: 'section', title: s.title || 'Seção', text: asText(sectionText(s)), emotion: s.emotion || 'curiosity', visual: s.visual || null, news: s.news || null, print: s.print || null, weight: 1 }));
    if (script.conclusion) groups.push({ kind: 'conclusion', title: 'Conclusão', text: asText(script.conclusion.finalThought || script.conclusion), emotion: script.conclusion.emotion || 'confidence', visual: script.conclusion.visual || null, weight: 0.7 });

    const totalWeight = groups.reduce((n, g) => n + g.weight * g.text.split(/\s+/).filter(Boolean).length, 0) || 1;

    const scenes = [];
    let index = 0;
    let fallbackGroupAudioOffsetMs = 0;
    let previousLayout = null;
    for (const group of groups) {
      const words = group.text.split(/\s+/).filter(Boolean).length;
      const timing = (script.timings || [])[index];
      const groupAudioOffsetMs = Number.isFinite(Number(timing?.audioOffsetMs))
        ? Number(timing.audioOffsetMs)
        : fallbackGroupAudioOffsetMs;
      let bs;
      if (timing && timing.sentences && timing.sentences.length) {
        // Real speech timings: each sentence becomes a scene spanning exactly
        // its audio segment, with word-level caption times.
        bs = timing.sentences.map((s, narrationSentenceIndex) => ({
          text: s.text, words: s.words, startMs: s.startMs,
          durationMs: s.durationMs, wordTimes: s.wordTimes, wordEndTimes: s.wordEndTimes,
          narrationSentenceIndex
        }));
      } else {
        const sceneMs = Math.max(3500, Math.round(totalDurationMs * (group.weight * words / totalWeight)));
        bs = this.beats(group.text, sceneMs).map((beat, narrationSentenceIndex) => ({ ...beat, narrationSentenceIndex }));
      }
      const cueSentences = bs;
      bs = this.splitLongBeats(bs, script.maxCaptionWords || CAPTION_MAX_WORDS);

      const raw = images[index];
      let sources = [];
      if (raw) {
        if (typeof raw === 'string') sources = [raw];
        else if (Array.isArray(raw.sources)) sources = raw.sources.filter(Boolean);
        else sources = [raw.hero, raw.split].filter(Boolean);
      }
      const hasImage = sources.length > 0;
      const contextSentence = group.text.split(/(?<=[.!?…])\s+/)
        .find(sentence => sentence.length <= 180 && /[.!?…]$/.test(sentence)) || '';
      // Start each section at a different visual variant while keeping the
      // generated shot sequence intentional (presenter, cutaway, reaction).
      const imgOffset = hasImage ? index % sources.length : 0;
      // Rotate images per beat — never repeats back-to-back.
      const srcFor = (beatIndex, offset = 0) => sources[(imgOffset + beatIndex + offset) % sources.length];
      const isLast = index === groups.length - 1;
      const comparisonItems = normalizeComparisonItems(group.visual?.items);
      const cmp = comparisonItems.length >= 2
        ? {
            title: group.visual.title || group.title,
            items: comparisonItems,
            orientation: group.visual.orientation === 'h' ? 'h' : 'v'
          }
        : null;
      const inferredMetricComparison = group.visual?.type === 'metric-compare'
        ? null
        : extractNarratedGpuComparison(group.text);
      const metricItems = group.visual?.type === 'metric-compare'
        ? normalizeMetricComparisonItems(group.visual.items)
        : normalizeMetricComparisonItems(inferredMetricComparison?.items);
      const sourceLabelText = String(group.visual?.sourceLabel || script.sourceLabel || '')
        .trim()
        .replace(/^(?:Fonte:\s*)+/iu, '')
        .trim();
      const metricCmp = metricItems.length >= 2
        ? {
            title: group.visual?.title || inferredMetricComparison?.title || group.title,
            unitLabel: group.visual?.unitLabel || inferredMetricComparison?.unitLabel || `${metricItems[0].unit} · escala linear`,
            sourceLabel: sourceLabelText ? `Fonte: ${sourceLabelText}` : '',
            items: metricItems
          }
        : null;
      // Keep the visual encoding tied to the authored story beat. A score
      // comparison has a stable bar-chart fallback; specialized encodings must
      // be explicitly selected by the script instead of shuffled in.
      const comparisonTypes = ['compare-table', 'score-chart', 'line-chart', 'donut-chart', 'rank-list'];
      const authoredComparisonType = comparisonTypes.includes(group.visual?.type) ? group.visual.type : null;
      const prefersTable = group.visual?.type === 'compare-table';
      const chartType = metricCmp ? 'progressive-comparison'
        : prefersTable ? 'compare-table' : authoredComparisonType || 'score-chart';
      const checklistItems = group.kind === 'section' ? extractOrderedChecklist(group.text) : [];
      const rotationCards = group.kind === 'section' && !checklistItems.length
        ? extractRotationCards(group.text)
        : [];
      const referenceBeatOffset = group.print || group.news ? 1 : 0;
      // A sourced chart enters on the beat that first states one of its values.
      // Showing it at the section start can leave empty axes on screen while the
      // numbers are narrated later, or push the bars beyond the section window.
      let chartBeatIndex = -1;
      if (cmp) {
        for (let i = 0; i < bs.length; i++) {
          if (!(i === 0 && (group.print || group.news))) { chartBeatIndex = i; break; }
        }
      }
      const resetBeatOffsets = bs.length > 1 && bs.every(item => Number(item.startMs) === 0);
      const beatAudioStartMs = beatIndex => resetBeatOffsets
        ? bs.slice(0, beatIndex).reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0)
        : (Number(bs[beatIndex]?.startMs) || 0);
      const cueAtGroupMs = cue => {
        const cueAtMs = findNarrationCueOffset(cue, cueSentences);
        if (cueAtMs == null) return null;
        if (!resetBeatOffsets) return cueAtMs;
        const matchedSentenceIndex = cueSentences.findIndex(sentence =>
          findNarrationCueOffset(cue, [sentence]) != null);
        if (matchedSentenceIndex < 0) return null;
        return cueSentences.slice(0, matchedSentenceIndex)
          .reduce((sum, sentence) => sum + (Number(sentence.durationMs) || 0), 0) + cueAtMs;
      };
      if (metricCmp) {
        const firstCueAtMs = metricCmp.items.map(item => cueAtGroupMs(item.cue))
          .filter(Number.isFinite)
          .sort((left, right) => left - right)[0];
        if (firstCueAtMs != null) {
          chartBeatIndex = bs.findIndex((beat, beatIndex) => {
            const startMs = beatAudioStartMs(beatIndex);
            return firstCueAtMs >= startMs && firstCueAtMs < startMs + (Number(beat.durationMs) || 0);
          });
          if (chartBeatIndex === 0 && (group.print || group.news)) {
            chartBeatIndex = bs.findIndex((beat, beatIndex) => beatIndex > 0
              && beatAudioStartMs(beatIndex) >= firstCueAtMs);
          }
        }
      }
      let progressiveCmp = null;
      if (metricCmp && chartBeatIndex >= 0) {
        const chartStartMs = beatAudioStartMs(chartBeatIndex);
        const timedItems = metricCmp.items.map(item => {
          const cueAtMs = cueAtGroupMs(item.cue);
          return cueAtMs == null ? null : { ...item, revealAfterMs: Math.max(0, cueAtMs - chartStartMs) };
        });
        if (timedItems.length >= 2 && timedItems.every(Boolean)) {
          progressiveCmp = { ...metricCmp, items: timedItems };
        } else {
          // A visual cue must exist in the narration before its sourced value is shown.
          chartBeatIndex = -1;
        }
      }

      const nodeGraphNodes = group.visual?.type === 'node-graph'
        && Array.isArray(group.visual.nodes)
        && group.visual.nodes.length >= 2
        && group.visual.nodes.length <= 4
        && group.visual.nodes.every(node => typeof node === 'string' && node.trim())
        ? group.visual.nodes.map(node => node.trim().slice(0, 42))
        : null;
      const nodeGraphCue = String(group.visual?.cue || '').trim();
      const atlasStoryBeat = group.visual?.type === 'atlas-story-scene'
        && ['hook', 'question-set', 'baseline', 'retrieval', 'result', 'coverage', 'distribution', 'caveat'].includes(group.visual.beat)
        ? group.visual.beat : null;
      const explicitVisualCue = (nodeGraphNodes || atlasStoryBeat) && nodeGraphCue;
      const graphCueAtMs = explicitVisualCue ? cueAtGroupMs(nodeGraphCue) : null;
      const graphBeatIndex = Number.isFinite(graphCueAtMs)
        ? bs.findIndex((beat, beatIndex) => {
            const startMs = beatAudioStartMs(beatIndex);
            return graphCueAtMs >= startMs && graphCueAtMs < startMs + (Number(beat.durationMs) || 0);
          })
        : -1;

      bs.forEach((beat, i) => {
        const audioStartInGroupMs = beatAudioStartMs(i);
        const audioStartMs = Math.max(0, groupAudioOffsetMs + audioStartInGroupMs);
        const envelopeStepMs = Number(speechEnvelope?.stepMs) || 10;
        const envelopeStartIndex = Math.floor(audioStartMs / envelopeStepMs);
        const envelopeOffsetMs = audioStartMs - envelopeStartIndex * envelopeStepMs;
        const envelopeCount = Math.ceil((Number(beat.durationMs) + envelopeOffsetMs) / envelopeStepMs) + 1;
        const localSpeechEnvelope = speechEnvelope?.levels
          ? speechEnvelope.levels.slice(envelopeStartIndex, envelopeStartIndex + envelopeCount)
          : [];
        let layout = atlasStoryBeat ? 'text'
          : script.forceLayout || (!hasImage ? 'text' : isLast ? 'hero' : layoutPool[(index + i) % layoutPool.length]);
        if (!script.forceLayout && hasImage && layout === previousLayout) {
          layout = layout === 'hero' ? 'split' : 'hero';
        }
        previousLayout = layout;
        const components = progressiveCmp || script.explanatorySocial ? [] : [
          {
            type: 'demo-header',
            category: script.minimal ? (script.channel || 'Pulso IA') : group.title,
            ...(!script.minimal ? {
              chapterIndex: index + 1,
              chapterTotal: groups.length,
              chapterStartMs: audioStartInGroupMs,
              chapterDurationMs: bs.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0)
            } : {}),
            revealAtMs: 0
          }
        ];
        const hasAlignedTimestamp = !script.minimal && !script.explanatorySocial
          && Array.isArray(timing?.sentences)
          && Number.isFinite(Number(timing.audioOffsetMs));
        if (hasAlignedTimestamp) {
          components.push({
            type: 'timestamp-hud',
            timeMs: audioStartMs,
            value: formatVideoTimestamp(audioStartMs),
            label: script.channel || 'Pulso IA'
          });
        }
        // Marca do canal sempre visível, discreta, em toda cena (identidade de estúdio).
        // Quando há timing real, o HUD incorpora o canal para não sobrepor a marca.
        // Em cortes minimal (9:16) o demo-header já exibe o canal — watermark seria duplicada.
        if (script.watermark !== false && !hasAlignedTimestamp && !script.minimal) {
          components.push({ type: 'watermark', text: script.channel || 'Pulso IA', revealAtMs: 0 });
        }
        if (layout === 'hero' && srcFor(i) && !atlasStoryBeat) {
          const hero = { type: 'image-hero', src: srcFor(i), durMs: Math.round(beat.durationMs), revealAtMs: 0 };
          if (script.minimal && !script.steadyNarrative) hero.strong = true; // cortes curtos: Ken Burns mais dramático
          if (script.minimal) hero.noFade = true; // imagem já entra visível em cada beat do corte
          if (script.steadyNarrative) hero.static = true; // narrativa do Instagram: não reiniciar zoom em cada frase
          components.push(hero);
        }
        if (script.minimal) {
          // cortes verticais: título cinético grande + brilho pulsante.
          // Título só no1º slide — nos demais a tela fica só com imagem + karaokê.
          if (!script.steadyNarrative) {
            components.push({ type: 'pulse-glow', durMs: Math.round(beat.durationMs), revealAtMs: 0 });
          }
          if (script.clip && script.clip.title && i === 0) {
            components.push({ type: 'clip-title', words: script.clip.title, revealAtMs: 250 });
          }
        }
        if (script.explanatorySocial) {
          components.push({ type: 'pulse-glow', durMs: Math.round(beat.durationMs), revealAtMs: 0 });
        }
        const short = beat.text.length > 90 ? beat.text.slice(0, 87) + '…' : beat.text;
        const explicitGraphOnBeat = Boolean(nodeGraphNodes && i === graphBeatIndex);
        const explicitAtlasStoryOnBeat = Boolean(atlasStoryBeat && i === 0);
        if (explicitAtlasStoryOnBeat) {
          components.push({ type: 'atlas-story-scene', beat: atlasStoryBeat, revealAtMs: 260,
            flowAtMs: Math.max(0, Number(graphCueAtMs) || 0), durationMs: beat.durationMs });
        } else if (group.print && group.print.src && i === 0 && !explicitGraphOnBeat) {
          // First beat: real screenshot of the article (G1 / press).
          components.push({ type: 'article-print', src: group.print.src, source: group.print.source, time: group.print.time, readingWords: group.print.readingWords, revealAtMs: 400 });
        } else if (group.news && group.news.title && i === 0 && !explicitGraphOnBeat) {
          // First beat: real-world reference card (Google News).
          components.push({ type: 'news-card', title: group.news.title, source: group.news.source, time: group.news.time,
            sourceTypeLabel: group.news.sourceTypeLabel, referenceLabel: group.news.referenceLabel, revealAtMs: 400 });
        } else if (script.minimal) {
          // Cortes verticais mantêm a imagem e o karaokê, sem um segundo
          // componente textual concorrendo com a legenda.
        } else if (progressiveCmp && i === chartBeatIndex) {
          components.push({
            type: 'progressive-comparison',
            title: progressiveCmp.title,
            unitLabel: progressiveCmp.unitLabel,
            sourceLabel: progressiveCmp.sourceLabel,
            items: progressiveCmp.items,
            revealAtMs: 260
          });
        } else if (cmp && i === chartBeatIndex && cmp.items.length >= 2) {
          // The ONE chart of this section — type varies per section.
          const chart = { type: chartType, title: cmp.title, items: cmp.items, revealAtMs: 260 };
          if (chartType === 'score-chart') chart.orientation = cmp.orientation;
          components.push(chart);
        } else if (nodeGraphNodes && i === graphBeatIndex) {
          components.push({ type: 'node-graph', nodes: nodeGraphNodes, revealAtMs: 260 });
        } else if (checklistItems.length >= 2 && i === referenceBeatOffset) {
          components.push({ type: 'checklist', title: group.title, items: checklistItems, revealAtMs: 260 });
        } else if (rotationCards.length >= 3 && i === referenceBeatOffset && !script.minimal) {
          components.push({ type: 'rotation-cards', title: group.title, cards: rotationCards, revealAtMs: 260 });
        } else if (!hasImage) {
          // A stable, sourced heading fills text-only scenes without changing
          // with every caption page or inventing diagrams from sentence scraps.
          components.push({
            type: 'bento-card', editorialContext: true,
            title: group.kind === 'section' ? group.title : (script.title || group.title),
            subtitle: sourceLabelText ? `Fonte: ${sourceLabelText}` : '',
            revealAtMs: 220
          });
        } else {
          // Tie the main visual to the spoken beat: process cues become a
          // sequence, metrics become a kinetic callout, otherwise use context.
          const candidates = [];
          const sequentialCue = /\b(?:primeiro|terceiro|então|depois|etapa|passo|fluxo|processo|caminho)\b/i.test(beat.text)
            || /(?:^|[.!?]\s*|\bno\s+)segund[oa](?=\s*[,;:]|\s+(?:passo|etapa|item|ponto|bloco|momento|fase|parte|exemplo|caso)\b)/i.test(beat.text);
          if (sequentialCue) {
            const chunks = beat.text.split(/\s+/).filter(Boolean);
            const nodes = [chunks.slice(0, 2).join(' '), chunks.slice(2, 4).join(' '), chunks.slice(4, 6).join(' ')].map(t => t || '···');
            candidates.push({ type: 'node-graph', nodes, revealAtMs: 300 });
          }
          const number = this.firstNumber(beat.text);
          if (number && !/etapa|passo|fluxo/i.test(beat.text)) {
            candidates.push({ type: 'kinetic-number', value: number, label: group.title.toUpperCase().slice(0, 24), revealAtMs: 220 });
          }
          if (!script.steadyNarrative && short && short.length > 3) {
            candidates.push({ type: 'bento-card', title: group.title, subtitle: short, revealAtMs: 220 });
          }
          const chosen = candidates[0] || null;
          if (chosen) components.push(chosen);
        }
        if (!atlasStoryBeat && (layout === 'split' || layout === 'splitL') && srcFor(i, 1)) {
          components.push({ type: 'image-panel', src: srcFor(i, 1), side: layout === 'splitL' ? 'left' : 'right', durMs: Math.round(beat.durationMs), revealAtMs: 260 });
        }
        // Vertical mini-clips already show timed karaoke captions. A second
        // sentence-sized highlight repeats the same words and can overflow a
        // phone frame, so keep this decorative layer in long-form scenes only.
        const keyPhrase = !script.minimal && /(importante|segredo|atenção|cuidado|nunca|sempre|melhor)/i.test(beat.text)
          ? beat.text.split(/[,.]/)[0].slice(0, 60) : null;
        if (keyPhrase) components.push({ type: 'highlight', text: keyPhrase, color: 'yellow', revealAtMs: 900, durationMs: 420 });
        const chips = script.minimal ? [] : this.specChips(beat.text);
        if (chips.length) components.push({ type: 'spec-chips', items: chips, revealAtMs: 500 });
        const pctMatch = script.minimal ? null : beat.text.match(/\b(\d{1,3}(?:[.,]\d+)?)\s*%/);
        if (pctMatch && !(cmp && layout !== 'hero')) {
          components.push({ type: 'progress-bar', value: Math.min(100, parseFloat((pctMatch[1] || '0').replace(',', '.'))), label: group.title.slice(0, 30), revealAtMs: 600 });
        }
        components.push({ type: 'caption', words: this.captionWords(beat.words, 0, beat.durationMs, beat.wordTimes, beat.wordEndTimes) });
        if (components.some(component => ['node-graph', 'atlas-story-scene'].includes(component.type))) {
          for (let componentIndex = components.length - 1; componentIndex >= 0; componentIndex -= 1) {
            if (components[componentIndex].type === 'demo-header') components.splice(componentIndex, 1);
          }
        }
        const scene = {
          id: `s${index}_${i}`,
          groupIndex: index,
          groupKind: group.kind,
          groupTitle: group.title,
          ...(includeNarrationSentenceIndex ? { narrationSentenceIndex: beat.narrationSentenceIndex } : {}),
          ...(script.steadyNarrative ? { contextSentence } : {}),
          durationMs: Math.round(beat.durationMs),
          // Progressive charts are full-screen explanatory cutaways. Keeping
          // the presenter canvas behind them obscures labels and axis values.
          presenter: !progressiveCmp,
          minimal: Boolean(script.minimal),
          steadyNarrative: Boolean(script.steadyNarrative),
          explanatorySocial: Boolean(script.explanatorySocial),
          speechEnvelope: {
            stepMs: envelopeStepMs,
            offsetMs: envelopeOffsetMs,
            levels: localSpeechEnvelope
          },
          background: { type: 'grid', accent: accentPool[(index + i) % accentPool.length] },
          components
        };
        if (layout === 'hero') scene.hero = true;
        if (layout === 'split' || layout === 'splitL') {
          scene.split = true;
          if (layout === 'splitL') scene.splitLeft = true;
        }
        scenes.push(scene);
      });
      fallbackGroupAudioOffsetMs = groupAudioOffsetMs + (Number(timing?.durationMs)
        || bs.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0));
      index += 1;
    }
    const visualScenes = coalesce ? this.coalesceVisualScenes(scenes, script.minimumVisualSceneMs) : scenes;
    if (script.steadyNarrative && visualScenes.length) {
      // Match the measured audio before scheduling image windows, so the
      // renderer's final duration adjustment cannot leave a blank tail.
      const drift = totalDurationMs - visualScenes.reduce((sum, scene) => sum + scene.durationMs, 0);
      visualScenes.at(-1).durationMs = Math.max(1, visualScenes.at(-1).durationMs + drift);
    }
    return this.paceNarrativeImages(visualScenes, images);
  }

}

module.exports = {
  ScenePlanBuilder,
  resolveVisualTheme,
  CAPTION_MAX_WORDS,
  CAPTION_MAX_WORDS_WITH_NATURAL_PAUSE,
  MIN_VISUAL_SCENE_DURATION_MS,
  SOCIAL_IMAGE_TARGET_MS,
  SOCIAL_IMAGE_MAX_MS,
  ARTICLE_PRINT_MIN_DWELL_MS,
  sourceReferenceDwellMs
};
