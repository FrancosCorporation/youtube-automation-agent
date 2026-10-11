const fs = require('fs').promises;
const path = require('path');
const { Logger } = require('./logger');
const { runFFmpeg, checkFFmpeg, ffmpegInstallHint, getMediaDuration } = require('./ffmpeg');
const { ensurePresenterAtlas, ATLAS_URL } = require('./presenter-avatar');

const KIT_DIR = path.join(__dirname, '..', 'assets', 'scenes');

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

/**
 * Renders script-driven "Linear/Vercel" style animated scenes:
 *   scene JSON -> deterministic HTML frames (Playwright) -> scene mp4 -> concat -> +audio
 * Every shot of every scene is a coded animation (cards, kinetic numbers,
 * highlights, node graphs, captions), not a static screenshot.
 */
class AnimatedSceneRenderer {
  constructor(options = {}) {
    this.logger = options.logger || new Logger('AnimatedScenes');
    this.fps = Math.max(12, Number(options.fps || process.env.ANIMATED_FPS || 24));
    this.width = Number(options.width || process.env.ANIMATED_WIDTH || 1920);
    this.height = Number(options.height || process.env.ANIMATED_HEIGHT || 1080);
    this.presenterAtlasPath = options.presenterAtlasPath ? path.resolve(options.presenterAtlasPath) : null;
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

  buildScenes(script, totalDurationMs, images = {}) {
    // Cada vídeo é único: tudo abaixo vem de um pool embaralhado por seed.
    const rng = mulberry32((Number(script.seed) || Math.floor(Math.random() * 1e9)) >>> 0);
    const shuffle = arr => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    };
    const pick = arr => arr[Math.floor(rng() * arr.length)];
    const layoutPool = shuffle(['hero', 'hero', 'split', 'split', 'splitL', 'splitL', 'split', 'hero']);
    const chartPool = shuffle(['score-chart', 'score-chart', 'line-chart', 'line-chart', 'donut-chart', 'rank-list']);
    const accentPool = shuffle(['#60A5FA', '#7DD3FC', '#4ADE80', '#F472B6', '#A78BFA', '#FBBF24']);

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
    for (const group of groups) {
      const words = group.text.split(/\s+/).filter(Boolean).length;
      const timing = (script.timings || [])[index];
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
        const layout = script.forceLayout || (!hasImage ? 'text' : isLast ? 'hero' : layoutPool[(index + i) % layoutPool.length]);
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
        const showPresenter = Boolean(this.presenterAtlasBuffer) && !script.minimal && (i === 0 || i % 2 === 1);
        if (showPresenter) {
          components.push({
            type: 'presenter-avatar',
            emotion: group.emotion,
            phase: ((Number(script.seed) || 0) + index * 37 + i * 19) % 240,
            revealAtMs: 120
          });
        }
        components.push({ type: 'caption', words: this.captionWords(beat.words, beat.startMs, beat.durationMs, beat.wordTimes) });
        if (script.minimal) components.push({ type: 'clip-progress', durMs: Math.round(beat.durationMs), revealAtMs: 0 });
        const scene = { id: `s${index}_${i}`, durationMs: Math.round(beat.durationMs), presenter: showPresenter, background: { type: 'grid', accent: accentPool[index % accentPool.length] }, components };
        if (layout === 'hero') scene.hero = true;
        if (layout === 'split' || layout === 'splitL') {
          scene.split = true;
          if (layout === 'splitL') scene.splitLeft = true;
        }
        scenes.push(scene);
      });
      index += 1;
    }
    return scenes;
  }

  async _pageHtml(scene) {
    const [css, js] = await Promise.all([
      fs.readFile(path.join(KIT_DIR, 'kit.css'), 'utf8'),
      fs.readFile(path.join(KIT_DIR, 'kit.js'), 'utf8')
    ]);
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><style>${css}</style><style>:root{--w:${this.width}px;--h:${this.height}px}</style></head><body><script>window.PRESENTER_ATLAS_URL=${JSON.stringify(ATLAS_URL)};</script><script>${js}</script><script>window.SCENE=${JSON.stringify(scene)};</script></body></html>`;
  }

  async render({ script, audioPath, outputPath, images = {} }) {
    if (!(await checkFFmpeg())) throw new Error(ffmpegInstallHint());
    outputPath = path.resolve(outputPath);
    audioPath = path.resolve(audioPath);
    let totalMs = this.estimateDuration(script) * 1000;
    try {
      const measured = await getMediaDuration(audioPath);
      if (Number.isFinite(measured) && measured > 0) totalMs = Math.round(measured * 1000);
    } catch (_e) { /* keep estimate */ }

    this.presenterAtlasBuffer = null;
    const presenterAtlasPath = this.presenterAtlasPath || await ensurePresenterAtlas(this.logger);
    if (presenterAtlasPath) this.presenterAtlasBuffer = await fs.readFile(presenterAtlasPath);
    const scenes = this.buildScenes(script, totalMs, images);
    const workDir = await fs.mkdtemp(path.join(path.dirname(outputPath), 'anim_'));
    const { chromium } = require('playwright');
    let browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu-sandbox'] });

    const registerPresenterAtlas = async page => {
      if (!this.presenterAtlasBuffer) return;
      await page.route(ATLAS_URL, route => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: this.presenterAtlasBuffer
      }));
    };

    const captureScene = async (page, scene, sceneDir) => {
      await page.setContent(await this._pageHtml(scene), { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.buildScene(window.SCENE));
      await page.evaluate(() => (window.waitForImages ? window.waitForImages() : 1));
      const frames = Math.max(1, Math.round(scene.durationMs / 1000 * this.fps));
      for (let i = 0; i < frames; i++) {
        await page.evaluate(ms => window.renderAt(ms), Math.round(i * 1000 / this.fps));
        await page.screenshot({ path: path.join(sceneDir, `f_${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 88 });
      }
    };

    // GPU (AMD VCN via VAAPI) assume o H.264 — ~8x menos CPU que libx264.
    // Probe único por processo; falha volta pro libx264 (graceful).
    if (this._vaapiOk === undefined) {
      this._vaapiOk = false;
      try {
        const fsSync = require('fs');
        if (fsSync.existsSync('/dev/dri/renderD128')) {
          await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
            '-i', 'testsrc2=size=320x240:duration=0.2:rate=24',
            '-vaapi_device', '/dev/dri/renderD128', '-vf', 'format=nv12,hwupload',
            '-c:v', 'h264_vaapi', '-f', 'null', '-']);
          this._vaapiOk = true;
          this.logger.info('GPU encode ativo (VAAPI/h264 — AMD VCN)');
        }
      } catch (_e) { this.logger.info('VAAPI indisponível — encode por CPU (libx264)'); }
    }
    const encodeScene = async (scene, sceneDir, sceneMp4, isFirst, isLast) => {
      const fadeOut = Math.max(0.1, scene.durationMs / 1000 - 0.25);
      const fades = [];
      if (isFirst) fades.push('fade=t=in:st=0:d=0.25');
      if (isLast) fades.push(`fade=t=out:st=${fadeOut.toFixed(2)}:d=0.25`);
      if (this._vaapiOk) {
        try {
          const filters = [...fades, 'format=nv12', 'hwupload'].join(',');
          await runFFmpeg(['-y', '-framerate', String(this.fps), '-i', path.join(sceneDir, 'f_%05d.jpg'),
            '-vaapi_device', '/dev/dri/renderD128',
            '-vf', filters,
            '-c:v', 'h264_vaapi', '-qp', '22', '-r', String(this.fps), sceneMp4]);
          return;
        } catch (_e) { this.logger.warn('VAAPI falhou na cena — fallback libx264'); }
      }
      const filters = [...fades, 'format=yuv420p'].join(',');
      await runFFmpeg(['-y', '-framerate', String(this.fps), '-i', path.join(sceneDir, 'f_%05d.jpg'),
        '-vf', filters,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', String(this.fps), sceneMp4]);
    };

    try {
      // WORKER POOL: cenas renderizadas em PARALELO (28 núcleos + GPU encode).
      // Cada worker tem sua página do Chromium — capturas independentes.
      const WORKERS = Math.max(1, Math.min(6, Number(process.env.RENDER_WORKERS || 4)));
      let done = 0;
      const worker = async (workerIdx) => {
        let page = await browser.newPage();
        await registerPresenterAtlas(page);
        await page.setViewportSize({ width: this.width, height: this.height });
        for (let s = workerIdx; s < scenes.length; s += WORKERS) {
          const scene = scenes[s];
          const sceneDir = path.join(workDir, `scene_${String(s).padStart(3, '0')}`);
          await fs.mkdir(sceneDir, { recursive: true });
          // Chromium pode morrer sob pressão de memória — página nova e retry 1x.
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              if (attempt > 0 || (page.isClosed && page.isClosed())) {
                if (!(browser.isConnected && browser.isConnected())) {
                  throw new Error('browser morreu — abortando worker pool');
                }
                page = await browser.newPage();
                await registerPresenterAtlas(page);
                await page.setViewportSize({ width: this.width, height: this.height });
                this.logger.warn(`Scene ${s + 1}: página nova (attempt ${attempt + 1})`);
              }
              await captureScene(page, scene, sceneDir);
              break;
            } catch (error) {
              if (attempt === 1) throw error;
              this.logger.warn(`Scene ${s + 1} failed: ${error.message} — retrying`);
            }
          }
          const sceneMp4 = path.join(workDir, `scene_${String(s).padStart(3, '0')}.mp4`);
          await encodeScene(scene, sceneDir, sceneMp4, s === 0, s === scenes.length - 1);
          done++;
          this.logger.info(`Scene ${s + 1}/${scenes.length} ok (${(scene.durationMs / 1000).toFixed(1)}s) [${done}/${scenes.length}]`);
        }
        await page.close().catch(() => {});
      };
      await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));

      const sceneFiles = scenes.map((_, s) => path.join(workDir, `scene_${String(s).padStart(3, '0')}.mp4`));

      const listPath = path.join(workDir, 'scenes.txt');
      await fs.writeFile(listPath, sceneFiles.map(f => `file '${f}'`).join('\n'));
      const visualPath = path.join(workDir, 'visual.mp4');
      await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', visualPath]);
      // Mixdown profissional: trilha com ducking (se houver) + masterização
      // loudnorm -14 LUFS — mesma pipeline para longo e cortes verticais.
      const { mixdownAudio, deriveMood } = require('./audio-mix');
      const mood = script.mood || deriveMood(script.title || script.hook?.text || '');
      const { path: mixedAudio } = await mixdownAudio({ narrationPath: audioPath, mood, seed: script.seed, workDir });
      await runFFmpeg(['-y', '-i', visualPath, '-i', mixedAudio, '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy', '-c:a', 'copy', '-shortest', outputPath]);
      this.logger.info(`Animated video assembled: ${outputPath} (${scenes.length} scenes)`);
      return outputPath;
    } finally {
      await browser.close().catch(() => {});
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = { AnimatedSceneRenderer };
