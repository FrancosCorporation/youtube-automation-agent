/** Build deterministic timed scene data for the HyperFrames composition. */
const THEME_CONFIG = require('../config/themes.json');
const THEMES = Array.isArray(THEME_CONFIG.themes) ? THEME_CONFIG.themes : [];

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

  captionWords(words, startMs, durationMs, realTimes) {
    let longest = '';
    for (const w of words) if (w.replace(/[^\wÀ-ÿ]/g, '').length > longest.replace(/[^\wÀ-ÿ]/g, '').length) longest = w;
    const kw = w => w === longest && w.length > 4;
    if (realTimes && realTimes.length === words.length) {
      return words.map((w, i) => {
        const t = Math.max(0, Math.round(realTimes[i] || 0));
        const next = realTimes[i + 1] != null ? Math.round(realTimes[i + 1]) : durationMs;
        return { w, t, e: Math.max(t + 120, next), kw: kw(w) };
      });
    }
    const span = Math.max(600, durationMs - 260);
    const step = span / Math.max(1, words.length);
    return words.map((w, i) => ({ w, t: Math.round(startMs + i * step), e: Math.round(startMs + (i + 1) * step), kw: kw(w) }));
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

  buildScenes(script, totalDurationMs, images = {}, speechEnvelope = null) {
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
    const pick = arr => arr[Math.floor(rng() * arr.length)];
    // The presenter occupies the right side of the frame; reverse split layouts
    // put text behind the robot layer and fail the full-composition layout check.
    const layoutPool = shuffle(['hero', 'hero', 'split', 'split', 'split', 'hero', 'hero']);
    const chartPool = shuffle(['score-chart', 'score-chart', 'line-chart', 'line-chart', 'donut-chart', 'rank-list']);
    const accentPool = shuffle(themePalette?.accents?.length
      ? [...themePalette.accents]
      : ['#60A5FA', '#7DD3FC', '#4ADE80', '#F472B6', '#A78BFA', '#FBBF24']);

    const sectionText = s => (typeof s.content === 'string' ? s.content : (s.items || s.steps || []).map(i => `${i.title || ''} ${i.description || ''}`).join(' '));
    // Nem todo campo vem como string (hook/conclusão podem ser objetos) —
    // sem isso, g.text.split() explode e o vídeo inteiro falha.
    const asText = v => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
    const groups = [];
    if (script.hook) groups.push({ title: 'Abertura', text: asText(script.hook.text || script.hook), emotion: script.hookEmotion || 'curiosity', news: (script.news || [])[0] || null, print: (script.prints || [])[0] || null, weight: 0.6 });
    (script.mainContent?.sections || []).forEach(s => groups.push({ title: s.title || 'Seção', text: asText(sectionText(s)), emotion: s.emotion || 'curiosity', visual: s.visual || null, news: s.news || null, print: s.print || null, weight: 1 }));
    if (script.conclusion) groups.push({ title: 'Conclusão', text: asText(script.conclusion.finalThought || script.conclusion), emotion: script.conclusion.emotion || 'confidence', weight: 0.7 });

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
        bs = timing.sentences.map(s => ({
          text: s.text, words: s.words, startMs: s.startMs,
          durationMs: s.durationMs, wordTimes: s.wordTimes
        }));
      } else {
        const sceneMs = Math.max(3500, Math.round(totalDurationMs * (group.weight * words / totalWeight)));
        bs = this.beats(group.text, sceneMs);
      }

      const raw = images[index];
      let sources = [];
      if (raw) {
        if (typeof raw === 'string') sources = [raw];
        else if (Array.isArray(raw.sources)) sources = raw.sources.filter(Boolean);
        else sources = [raw.hero, raw.split].filter(Boolean);
      }
      const hasImage = sources.length > 0;
      // Start each section at a different visual variant while keeping the
      // generated shot sequence intentional (presenter, cutaway, reaction).
      const imgOffset = hasImage ? index % sources.length : 0;
      // Rotate images per beat — never repeats back-to-back.
      const srcFor = (beatIndex, offset = 0) => sources[(imgOffset + beatIndex + offset) % sources.length];
      const isLast = index === groups.length - 1;
      const cmp = group.visual && Array.isArray(group.visual.items) && group.visual.items.length >= 2
        ? {
            title: group.visual.title || group.title,
            items: group.visual.items.slice(0, 4).map((it, i) => ({
              label: (String(it.label || '').trim() || `Item ${i + 1}`).slice(0, 18),
              score: Number(it.score) || 5
            })),
            orientation: rng() < 0.5 ? 'v' : 'h'
          }
        : null;
      // Chart type comes from a shuffled pool — each video a different order.
      const chartType = chartPool[index % chartPool.length];
      // The chart shows ONCE per section — on the first non-reference beat.
      let chartBeatIndex = -1;
      if (cmp) {
        for (let i = 0; i < bs.length; i++) {
          if (!(i === 0 && (group.print || group.news))) { chartBeatIndex = i; break; }
        }
      }

      bs.forEach((beat, i) => {
        const resetBeatOffsets = bs.length > 1 && bs.every(item => Number(item.startMs) === 0);
        const audioStartInGroupMs = resetBeatOffsets
          ? bs.slice(0, i).reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0)
          : (Number(beat.startMs) || 0);
        const audioStartMs = Math.max(0, groupAudioOffsetMs + audioStartInGroupMs);
        const envelopeStepMs = Number(speechEnvelope?.stepMs) || 10;
        const envelopeStartIndex = Math.floor(audioStartMs / envelopeStepMs);
        const envelopeOffsetMs = audioStartMs - envelopeStartIndex * envelopeStepMs;
        const envelopeCount = Math.ceil((Number(beat.durationMs) + envelopeOffsetMs) / envelopeStepMs) + 1;
        const localSpeechEnvelope = speechEnvelope?.levels
          ? speechEnvelope.levels.slice(envelopeStartIndex, envelopeStartIndex + envelopeCount)
          : [];
        let layout = script.forceLayout || (!hasImage ? 'text' : isLast ? 'hero' : layoutPool[(index + i) % layoutPool.length]);
        if (!script.forceLayout && hasImage && layout === previousLayout) {
          layout = layout === 'hero' ? 'split' : 'hero';
        }
        previousLayout = layout;
        const components = [
          { type: 'demo-header', category: script.minimal ? (script.channel || 'Pulso IA') : group.title, revealAtMs: 0 }
        ];
        // Marca do canal sempre visível, discreta, em toda cena (identidade de estúdio).
        if (script.watermark !== false) {
          components.push({ type: 'watermark', text: script.channel || 'Pulso IA', revealAtMs: 0 });
        }
        if (layout === 'hero' && srcFor(i)) {
          const hero = { type: 'image-hero', src: srcFor(i), durMs: Math.round(beat.durationMs), revealAtMs: 0 };
          if (script.minimal) hero.strong = true; // cortes: Ken Burns mais dramático
          components.push(hero);
        }
        if (script.minimal) {
          // cortes verticais: título cinético grande + brilho pulsante.
          // Título só no1º slide — nos demais a tela fica só com imagem + karaokê.
          components.push({ type: 'pulse-glow', durMs: Math.round(beat.durationMs), revealAtMs: 0 });
          if (script.clip && script.clip.title && i === 0) {
            components.push({ type: 'clip-title', words: script.clip.title, revealAtMs: 250 });
          }
        }
        const short = beat.text.length > 90 ? beat.text.slice(0, 87) + '…' : beat.text;
        if (group.print && group.print.src && i === 0) {
          // First beat: real screenshot of the article (G1 / press).
          components.push({ type: 'article-print', src: group.print.src, source: group.print.source, time: group.print.time, revealAtMs: 400 });
        } else if (group.news && group.news.title && i === 0) {
          // First beat: real-world reference card (Google News).
          components.push({ type: 'news-card', title: group.news.title, source: group.news.source, time: group.news.time, revealAtMs: 400 });
        } else if (script.minimal) {
          // Cortes verticais: cena limpa — só imagem + karaokê (+ chips se houver)
        } else if (cmp && i === chartBeatIndex && cmp.items.length >= 2) {
          // The ONE chart of this section — type varies per section.
          const chart = { type: chartType, title: cmp.title, items: cmp.items, revealAtMs: 260 };
          if (chartType === 'score-chart') chart.orientation = cmp.orientation;
          components.push(chart);
        } else {
          // Among everything that fits this beat, pick randomly → mais variedade.
          const candidates = [];
          if (this.firstNumber(beat.text) && !/etapa|passo|fluxo/i.test(beat.text)) {
            candidates.push({ type: 'kinetic-number', value: this.firstNumber(beat.text), label: group.title.toUpperCase().slice(0, 24), revealAtMs: 220 });
          }
          if (/(primeiro|segundo|terceiro|então|depois|etapa|passo|fluxo|processo|caminho)/i.test(beat.text)) {
            const chunks = beat.text.split(/\s+/).filter(Boolean);
            const nodes = [chunks.slice(0, 2).join(' '), chunks.slice(2, 4).join(' '), chunks.slice(4, 6).join(' ')].map(t => t || '···');
            candidates.push({ type: 'node-graph', nodes, revealAtMs: 300 });
          }
          if (short && short.length > 3) {
            candidates.push({ type: 'bento-card', title: group.title, subtitle: short, revealAtMs: 220 });
          }
          const chosen = candidates.length ? pick(candidates) : null;
          if (chosen) components.push(chosen);
        }
        if ((layout === 'split' || layout === 'splitL') && srcFor(i, 1)) {
          components.push({ type: 'image-panel', src: srcFor(i, 1), side: layout === 'splitL' ? 'left' : 'right', durMs: Math.round(beat.durationMs), revealAtMs: 260 });
        }
        const keyPhrase = /(importante|segredo|atenção|cuidado|nunca|sempre|melhor)/i.test(beat.text)
          ? beat.text.split(/[,.]/)[0].slice(0, 60) : null;
        if (keyPhrase) components.push({ type: 'highlight', text: keyPhrase, color: 'yellow', revealAtMs: 900, durationMs: 420 });
        const chips = this.specChips(beat.text);
        if (chips.length) components.push({ type: 'spec-chips', items: chips, revealAtMs: 500 });
        const pctMatch = beat.text.match(/\b(\d{1,3}(?:[.,]\d+)?)\s*%/);
        if (pctMatch && !(cmp && layout !== 'hero')) {
          components.push({ type: 'progress-bar', value: Math.min(100, parseFloat((pctMatch[1] || '0').replace(',', '.'))), label: group.title.slice(0, 30), revealAtMs: 600 });
        }
        components.push({ type: 'caption', words: this.captionWords(beat.words, beat.startMs, beat.durationMs, beat.wordTimes) });
        if (script.minimal) components.push({ type: 'clip-progress', durMs: Math.round(beat.durationMs), revealAtMs: 0 });
        const scene = {
          id: `s${index}_${i}`,
          durationMs: Math.round(beat.durationMs),
          presenter: true,
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
    return scenes;
  }

}

module.exports = { ScenePlanBuilder, resolveVisualTheme };
