/**
 * ClipMaker — gera cortes verticais (9:16) dos momentos mais fortes
 * de um vídeo longo, com fundo blur + legenda grande estilo Shorts/TikTok.
 *
 * makeClips({ videoPath, script, outDir, maxClips }) → [{ path, title, sentence }]
 */
const fs = require('fs').promises;
const path = require('path');
const { runFFmpeg } = require('./ffmpeg');

// Quebra a frase em linhas curtas para a legenda.
function wrapLines(text, max = 30) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max) {
      if (line) lines.push(line.trim());
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) lines.push(line.trim());
  return lines.slice(0, 4);
}

const assTime = sec => {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = (s % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${ss}`;
};

// Legenda .ass estilo TikTok/Shorts: topo, bold, contorno preto grosso.
async function writeAss(filePath, lines, durSec) {
  const text = lines
    .map(l => l.replace(/[{}]/g, '').replace(/\\/g, ''))
    .join('\\N');
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, BorderStyle, Encoding
Style: Big,DejaVu Sans,62,&H00FFFFFF,&H00000000,&HC0000000,-1,5,1,8,50,50,120,1,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Text
Dialogue: 0,${assTime(0)},${assTime(durSec)},Big,,50,50,120,${text}
`;
  await fs.writeFile(filePath, ass, 'utf8');
}

// Escolhe as melhores frases: seções do meio, duração ideal, com números/ganchos.
function pickSentences(script) {
  const groups = (script.timings || []);
  const scored = [];
  groups.forEach((g, gi) => {
    if (gi === 0) return; // pula hook
    (g.sentences || []).forEach((s, si) => {
      const dur = (s.durationMs || 0) / 1000;
      if (dur < 7 || dur > 22) return;
      let score = dur / 22;
      const t = String(s.text || '');
      if (/\d/.test(t)) score += 0.4;
      if (/(nunca|sempre|cuidado|atenção|segredo|importante|polêmica|acusad|proibid|record|históric)/i.test(t)) score += 0.5;
      if (/(mostrou|revelou|afirmou|estudo|pesquisa)/i.test(t)) score += 0.2;
      score += Math.min(0.4, t.length / 400);
      scored.push({ gi, si, text: t, startMs: s.startMs, durMs: s.durationMs, score });
    });
  });
  scored.sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const cand of scored) {
    if (chosen.length >= (arguments[1] || 3)) break;
    if (chosen.some(c => c.gi === cand.gi)) continue; // 1 corte por seção
    chosen.push(cand);
  }
  return chosen;
}

async function makeClips({ videoPath, script, outDir, maxClips = 3 }) {
  const picks = pickSentences(script, maxClips);
  if (!picks.length) return [];
  await fs.mkdir(outDir, { recursive: true });
  const base = path.basename(videoPath, path.extname(videoPath));
  const clips = [];

  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i];
    const outPath = path.join(outDir, `${base}_corte${i + 1}.mp4`);
    const start = Math.max(0, (pick.startMs / 1000) - 0.3).toFixed(2);
    const durSec = (pick.durMs / 1000 + 0.6);
    const dur = durSec.toFixed(2);
    const lines = wrapLines(pick.text);

    // Legenda .ass (libass) — o ffmpeg-static não tem drawtext
    const assPath = path.join(outDir, `${base}_corte${i + 1}.ass`);
    await writeAss(assPath, lines, durSec);

    const assFilter = `ass='${assPath.replace(/\\/g, '/').replace(/'/g, "\\'")}'`;
    const vf = [
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:2,eq=brightness=-0.12[bg]`,
      `[0:v]scale=1080:-2[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,${assFilter},format=yuv420p[v]`
    ].join(';');

    try {
      await runFFmpeg([
        '-y', '-ss', start, '-t', dur, '-i', videoPath,
        '-filter_complex', vf,
        '-map', '[v]', '-map', '0:a?',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k', '-r', '24',
        '-movflags', '+faststart', outPath
      ]);
      await fs.unlink(assPath).catch(() => {});
      clips.push({
        path: outPath,
        title: pick.text.slice(0, 90),
        sentence: pick.text,
        section: pick.gi
      });
      console.log(`      corte ${i + 1}/${picks.length} ok: "${pick.text.slice(0, 60)}…"`);
    } catch (error) {
      console.warn(`      corte ${i + 1}/${picks.length} falhou: ${error.message.slice(0, 200)}`);
    }
  }
  return clips;
}

/**
 * ClipMaker — cortes VERTICAIS NATIVOS (9:16) para TikTok/Reels/Shorts:
 * re-renderiza os melhores momentos no formato de celular, com imagem
 * full-bleed + legenda karaokê animada (preenche a tela de verdade).
 *
 * makeVerticalClips({ script, slug, imagesDir, ttsDir, outDir, maxClips })
 */
const { getMediaDuration } = require('./ffmpeg');
const { AnimatedSceneRenderer } = require('./animated-scene-renderer');

/**
 * Quebra o texto em slides curtos (~7 palavras) — menos texto por tela,
 * mais cenas diferentes no short. Respeita pontuação (vírgulo/ponto)
 * pra cortar em lugares naturais quando o slide já tem folga.
 */
function chunkWords(words, maxWords = 7) {
  const chunks = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const punct = /[.!?:;,.]$/.test(words[i]);
    const isLast = i === words.length - 1;
    if (cur.length >= maxWords || (punct && cur.length >= 4) || isLast) {
      chunks.push(cur);
      cur = [];
    }
  }
  return chunks.filter(c => c.length);
}

function pickSentencesV(script, maxClips = 3) {
  const groups = (script.timings || []);
  const scored = [];
  groups.forEach((g, gi) => {
    if (gi === 0) return; // pula hook (o longo já abre com ele)
    (g.sentences || []).forEach((s, si) => {
      const dur = (s.durationMs || 0) / 1000;
      if (dur < 7 || dur > 22) return;
      let score = dur / 22;
      const t = String(s.text || '');
      if (/\d/.test(t)) score += 0.4;
      if (/(nunca|sempre|cuidado|atenção|segredo|importante|polêmica|acusad|proibid|record|históric)/i.test(t)) score += 0.5;
      if (/(mostrou|revelou|afirmou|estudo|pesquisa)/i.test(t)) score += 0.2;
      score += Math.min(0.4, t.length / 400);
      scored.push({ gi, si, text: t, startMs: s.startMs, durMs: s.durationMs, words: s.words, wordTimes: s.wordTimes, score });
    });
  });
  scored.sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const cand of scored) {
    if (chosen.length >= maxClips) break;
    if (chosen.some(c => c.gi === cand.gi)) continue;
    chosen.push(cand);
  }
  return chosen;
}

async function makeVerticalClips({ script, imagesDir, ttsDir, outDir, maxClips = 3, baseName = 'corte' }) {
  const picks = pickSentencesV(script, maxClips);
  if (!picks.length) return [];
  await fs.mkdir(outDir, { recursive: true });
  const sharp = require('sharp');
  const clips = [];

  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i];
    const outPath = path.join(outDir, `${baseName}_corte${i + 1}.mp4`);
    try {
      // 1) Áudio da frase: recorta do mp3 do grupo correspondente
      const groupAudio = path.join(ttsDir, `g${pick.gi}.mp3`);
      const clipAudio = path.join(outDir, `${baseName}_c${i + 1}.mp3`);
      const start = Math.max(0, pick.startMs / 1000 - 0.25).toFixed(2);
      const durSec = (pick.durMs / 1000 + 0.7).toFixed(2);
      await runFFmpeg(['-y', '-ss', start, '-t', durSec, '-i', groupAudio, '-c', 'copy', clipAudio]);

      // 2) Imagens da seção — até 3 fontes pra cada slide mostrar uma imagem
      //    diferente (rotação no renderer), fallback: qualquer imagem do vídeo
      const images = { sources: [] };
      try {
        const files = await fs.readdir(imagesDir);
        const versioned = files.filter(f => /^g\d+[a-f]-visual-[a-f0-9]{8}\.png$/.test(f));
        let currentStyle = '';
        if (versioned.length) {
          const recent = await Promise.all(versioned.map(async file => ({
            file,
            modified: (await fs.stat(path.join(imagesDir, file))).mtimeMs
          })));
          currentStyle = (recent.sort((a, b) => b.modified - a.modified)[0].file.match(/-visual-([a-f0-9]{8})\.png$/) || [])[1] || '';
        }
        const all = (currentStyle
          ? versioned.filter(f => f.endsWith(`-visual-${currentStyle}.png`))
          : files.filter(f => /^g\d+[a-f]\.png$/.test(f))).sort();
        const own = all.filter(f => new RegExp(`^g${pick.gi}[a-f](?:-visual-[a-f0-9]{8})?\\.png$`).test(f));
        const pool = own.length ? own : all;
        for (const f of pool.slice(0, 3)) {
          const buf = await sharp(path.join(imagesDir, f)).resize({ width: 1080 }).jpeg({ quality: 84 }).toBuffer();
          images.sources.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
        }
      } catch (_e) { /* sem imagem → cena com glow */ }

      // 2b) Título cinético: primeiras palavras fortes da frase, em caixa alta
      const titleWords = String(pick.text)
        .replace(/[""'']/g, '')
        .split(/\s+/).filter(Boolean).slice(0, 5)
        .map(w => w.replace(/[^\wÀ-ú\-]/g, '').toUpperCase()).filter(Boolean).slice(0, 5);

      // 3) Mini-roteiro vertical: a frase vira VÁRIOS slides curtos
      //    (≈7 palavras por tela) — cada slide com sua imagem e o karaokê
      //    rebased nos tempos reais da fala. Antes: 1 tela cheia de texto.
      const durMs = Math.round(pick.durMs + 700);
      const wordsAll = (Array.isArray(pick.words) && pick.words.length)
        ? pick.words
        : String(pick.text).split(/\s+/).filter(Boolean);
      const wt = (Array.isArray(pick.wordTimes) && pick.wordTimes.length === wordsAll.length)
        ? pick.wordTimes
        : null;
      let pieces = chunkWords(wordsAll, 7);
      if (pieces.length > 1 && pieces[pieces.length - 1].length < 4) {
        const last = pieces.pop();
        pieces[pieces.length - 1] = pieces[pieces.length - 1].concat(last);
      }
      const bounds = [];
      let acc = 0;
      for (const p of pieces) { bounds.push([acc, acc + p.length - 1]); acc += p.length; }
      const sentences = pieces.map((chunk, k) => {
        const [a, b] = bounds[k];
        let start;
        let end;
        if (wt && a > 0) start = Number(wt[a]) || 0;
        else start = 0;
        if (wt && b + 1 < wt.length) end = Number(wt[b + 1]) || durMs;
        else if (wt) end = durMs;
        else {
          start = Math.round(durMs * (a / wordsAll.length));
          end = Math.round(durMs * ((b + 1) / wordsAll.length));
        }
        const dur = Math.max(900, end - start);
        let prev = -1;
        const wordTimes = wt
          ? wt.slice(a, b + 1).map((t, i) => {
              let rel = Math.round(Number(t) - start) + (i === 0 ? 80 : 0);
              rel = Math.max(0, Math.min(rel, dur - 120));
              if (rel < prev + 60) rel = Math.min(prev + 60, dur - 120);
              prev = rel;
              return rel;
            })
          : undefined;
        return {
          text: chunk.join(' '),
          words: chunk,
          startMs: 0,
          endMs: dur,
          durationMs: dur,
          wordTimes,
        };
      });
      const mini = {
        hook: sentences[0] ? sentences[0].text : pick.text,
        channel: script.channel || 'Pulso IA',
        seed: script.seed,
        forceLayout: 'hero',
        minimal: true,
        clip: { title: titleWords },
        timings: [{
          durationMs: durMs,
          sentences,
        }]
      };

      // 4) Renderiza NATIVO em 1080x1920 + mux com o áudio recortado
      const renderer = new AnimatedSceneRenderer({ width: 1080, height: 1920, fps: 24 });
      await renderer.render({ script: mini, audioPath: clipAudio, outputPath: outPath, images: images.sources.length ? { 0: images } : {} });

      await fs.unlink(clipAudio).catch(() => {});
      clips.push({ path: outPath, title: pick.text.slice(0, 90), sentence: pick.text, section: pick.gi });
      console.log(`      corte vertical ${i + 1}/${picks.length} ok: "${pick.text.slice(0, 55)}…"`);
    } catch (error) {
      console.warn(`      corte vertical ${i + 1}/${picks.length} falhou: ${error.message.slice(0, 150)}`);
    }
  }
  return clips;
}

module.exports = { makeClips, makeVerticalClips, pickSentences, wrapLines };
