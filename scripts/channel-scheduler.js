#!/usr/bin/env node
/**
 * Channel Scheduler — 24h no ar gerando vídeos de IA.
 *
 *   - VIDEOS_PER_DAY vídeos por dia (padrão 5), espaçados ao longo de 24h
 *   - A cada RECAP_EVERY_DAYS dias, gera o RESUMO SEMANAL (vídeo mais curto)
 *   - Dedup de temas via ledger (data/state/topics.json, escrito pelo gerador)
 *   - Nunca morre: falha → espera e tenta de novo
 *
 * Uso: setsid nohup node scripts/channel-scheduler.js > logs/scheduler.log 2>&1 < /dev/null &
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { notifyFailure } = require('../utils/alerts');
const { probeVideoHealth } = require('../utils/ffmpeg');

const ROOT = path.join(__dirname, '..');
const VIDEOS_PER_DAY = Math.max(1, Number(process.env.VIDEOS_PER_DAY || 5));
const RECAP_EVERY_DAYS = Math.max(1, Number(process.env.RECAP_EVERY_DAYS || 7));
// Imagens por seção: limita a cota diária do Gemini (5 vídeos × 9 seções × N).
process.env.IMAGES_PER_GROUP = process.env.IMAGES_PER_GROUP || '4';
const INTERVAL_MS = Math.round((24 * 60 * 60 * 1000) / VIDEOS_PER_DAY);
const RETRY_MS = 30 * 60 * 1000;
// RÉPLICA POR TEMA: cada instância tem estado próprio (STATE_DIR). O default
// mantém a instância original (ia) inalterada.
const STATE_DIR = path.join(ROOT, process.env.STATE_DIR || 'data/state');
const STATE_PATH = path.join(STATE_DIR, 'scheduler.json');
const LEDGER_PATH = path.join(STATE_DIR, 'topics.json');

const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);

// TEMA DA RÉPLICA: esta instância publica com este canal (default: ia).
const THEME = process.env.THEME || 'ia';
// FASE (minutos): deslocamento inicial para ESPALHAR os posts uniformemente
// no dia quando várias réplicas coexistem (conta: total = vídeos/dia × temas;
// intervalo = 24h / total; cada réplica entra defasada pra preencher os slots).
const PHASE_MIN = Number(process.env.SCHEDULER_PHASE_MIN || 0);

async function readState() {
  try { return JSON.parse(await fsp.readFile(STATE_PATH, 'utf8')); } catch (_e) { return {}; }
}
async function writeState(state) {
  await fsp.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fsp.writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

function runGenerator(args, logFile) {
  return new Promise(resolve => {
    const out = fs.createWriteStream(logFile, { flags: 'a' });
    const child = spawn('node', [path.join(ROOT, 'scripts', 'generate-animated-video.js'), ...args], { cwd: ROOT, detached: false });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    child.on('close', code => { out.end(); resolve(code); });
    child.on('error', error => { out.end(); log(`spawn error: ${error.message}`); resolve(-1); });
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Alguns fluxos de publicação (TikTok/X) precisam de Chromium com janela,
// mas a janela deve existir somente no display virtual, nunca no desktop.
async function ensureInvisibleBrowserDisplay() {
  const display = ':99';
  const canConnect = () => {
    try {
      const env = { ...process.env, DISPLAY: display };
      delete env.XAUTHORITY;
      execFileSync('xdpyinfo', ['-display', display], { env, stdio: 'ignore', timeout: 1000 });
      return true;
    } catch (_error) { return false; }
  };

  if (!canConnect()) {
    const xvfb = spawn('Xvfb', [display, '-screen', '0', '1280x900x24', '-nolisten', 'tcp'], {
      detached: true,
      stdio: 'ignore'
    });
    let startupError = null;
    xvfb.on('error', error => { startupError = error; });
    xvfb.unref();

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !canConnect()) await sleep(250);
    if (!canConnect()) {
      const detail = startupError ? `: ${startupError.message}` : '';
      throw new Error(`não foi possível iniciar o display virtual ${display}${detail}; o scheduler não usará o desktop visível`);
    }
  }

  process.env.DISPLAY = display;
  delete process.env.XAUTHORITY;
  log(`display virtual ${display} ativo — browsers de upload ficam invisíveis`);
}

async function readLastLedgerEntry() {
  try {
    const raw = JSON.parse(await fsp.readFile(LEDGER_PATH, 'utf8'));
    const entries = raw.entries || [];
    return entries[entries.length - 1] || null;
  } catch (_e) { return null; }
}

async function uploadToYouTube(videoPath, overrides = {}) {
  try {
    const entry = await readLastLedgerEntry();
    if (!entry || !entry.title) return null;
    const { uploadVideo } = require('./upload-to-youtube');
    const seo = entry.seo || {};
    const { MUSIC_CREDIT, musicCreditUsed } = require('../utils/audio-mix');
    const description = [
      seo.description || entry.title,
      process.env.CHANNEL_DESCRIPTION || 'Notícias de inteligência artificial com análises rápidas e visuais. Novos vídeos toda semana.',
      `Fonte: ${entry.url || entry.originUrl || ''}`,
      seo.hashtags || '#inteligenciaartificial #ia #tecnologia',
      ...(musicCreditUsed() ? [MUSIC_CREDIT] : [])
    ].filter(Boolean).join('\n\n');
    const result = await uploadVideo({
      videoPath: path.isAbsolute(videoPath) ? videoPath : path.join(ROOT, videoPath),
      title: overrides.title || seo.youtubeTitle || entry.title,
      description,
      tags: ['inteligência artificial', 'notícias', 'IA', 'tecnologia'],
      privacyStatus: process.env.YT_PRIVACY || 'public',
      ...(entry.thumbnailPath ? { thumbnailPath: path.join(ROOT, entry.thumbnailPath) } : {})
    });
    log(`⬆️ publicado no YouTube: ${result.url}`);
    return result.url;
  } catch (error) {
    log(`⚠️ upload YouTube falhou: ${error.message}`);
    await notifyFailure('Upload YouTube falhou', error.message);
    return null;
  }
}

// Cota do YouTube: quando estoura ("exceeded the number of videos"),
// pausa uploads YT por 24h pra não quebrar o ciclo inteiro.
const YT_QUOTA_PATH = path.join(STATE_DIR, 'yt-quota.json');
async function ytQuotaBlocked() {
  try {
    const flag = JSON.parse(await fsp.readFile(YT_QUOTA_PATH, 'utf8'));
    return Date.now() - new Date(flag.at).getTime() < 20 * 3600000;
  } catch (_e) { return false; }
}
async function flagYtQuota() {
  await fsp.mkdir(path.dirname(YT_QUOTA_PATH), { recursive: true });
  await fsp.writeFile(YT_QUOTA_PATH, JSON.stringify({ at: new Date().toISOString() }));
}

// Marca no ledger que o vídeo já subiu no YouTube (evita re-upload).
function sameVideoPath(a, b) {
  return Boolean(a && b) && path.resolve(ROOT, a) === path.resolve(ROOT, b);
}

async function markYouTubeDone(videoPath, url) {
  try {
    const ledgerPath = LEDGER_PATH;
    const raw = JSON.parse(await fsp.readFile(ledgerPath, 'utf8'));
    for (const e of (raw.entries || []).reverse()) {
      if (sameVideoPath(e.videoPath, videoPath)) { e.ytUrl = url; break; }
    }
    await fsp.writeFile(ledgerPath, JSON.stringify(raw, null, 2));
  } catch (_e) { /* ledger ilegível — segue */ }
}

// Guarda os resultados da publicação no ledger (pra saber depois se algum
// corte deu ERRO, sem re-analisar — decide a limpeza do pendente).
async function markResults(videoPath, results) {
  try {
    const ledgerPath = LEDGER_PATH;
    const raw = JSON.parse(await fsp.readFile(ledgerPath, 'utf8'));
    for (const e of (raw.entries || []).reverse()) {
      if (sameVideoPath(e.videoPath, videoPath)) { e.results = results; break; }
    }
    await fsp.writeFile(ledgerPath, JSON.stringify(raw, null, 2));
  } catch (_e) { /* ledger ilegível — segue */ }
}

// Fila de pendências: vídeo que não subiu por cota (publish rodou "sem YT")
// é repetido nos ciclos seguintes até subir. Antes ele ficaria para sempre
// sem publicar no YouTube — o publish só roda no momento da geração.
async function retryPendingYouTube() {
  if (await ytQuotaBlocked()) return;
  try {
    const raw = JSON.parse(await fsp.readFile(LEDGER_PATH, 'utf8'));
    // Escaneia TODAS as entradas (o ledger não é estritamente cronológico) e
    // pega a pendência mais recente cujo arquivo ainda existe no disco.
    const pendentes = (raw.entries || [])
      .filter(e => !e.ytUrl && e.videoPath && fs.existsSync(e.videoPath))
      .sort((a, b) => new Date(b.generatedAt || 0) - new Date(a.generatedAt || 0));
    for (const e of pendentes) {
      log(`🔁 vídeo pendente de YouTube (cota anterior): ${path.basename(e.videoPath)}`);
      const url = await uploadToYouTube(e.videoPath);
      if (url) {
        await markYouTubeDone(e.videoPath, url);
        // Agora TUDO desse vídeo publicou (cortes já tinham saído nas redes).
        // Limpeza: longo + capa sempre (master seguro no YouTube); cortes só
        // se nenhum deu ERRO na publicação original (regra all_ok do dono).
        const clipErro = Object.values((e.results || {}).clips || {})
          .some(r => Object.values(r).some(v => /^ERRO:/i.test(String(v))));
        await fsp.unlink(e.videoPath).catch(() => {});
        if (e.thumbnailPath) await fsp.unlink(path.join(ROOT, e.thumbnailPath)).catch(() => {});
        if (!clipErro) {
          for (const c of (e.clips || [])) await fsp.unlink(c.path || c).catch(() => {});
          log('🧹 pendência no YouTube + arquivos locais apagados (tudo sem erro)');
        } else {
          log('🧹 pendência no YouTube — longo/capa apagados; cortes com ERRO ficam no disco');
        }
        break; // 1 por ciclo: poupa cota
      }
    }
  } catch (_e) { /* ledger ilegível — segue */ }
}

async function publishEverywhere(outPath) {
  try {
    const entry = await readLastLedgerEntry();
    if (!entry || !entry.title) { log('⚠️ upload: ledger sem entrada'); return; }

    // QA de sanidade: nunca publicar um mp4 corrompido/sem áudio/duração absurda.
    const health = await probeVideoHealth(path.join(ROOT, outPath));
    if (!health.ok) {
      log(`🚫 vídeo falhou no QA pré-publicação (${health.issues.join('; ')}) — publicação ABORTADA`);
      await notifyFailure('Vídeo reprovado no QA pré-publicação', `${outPath}\n${health.issues.join('\n')}`);
      return;
    }
    log(`✅ QA ok (${health.duration ? health.duration.toFixed(1) + 's' : '?'}, ${(health.sizeBytes / 1e6).toFixed(1)}MB)`);

    const { uploadToAll } = require('./upload-to-socials');
    const clips = (entry.clips || []).map(c => (typeof c === 'string' ? { path: c, title: entry.title } : c));
    const quotaBlocked = await ytQuotaBlocked();
    if (quotaBlocked) log('⏸️ YouTube pausado (cota diária) — segue só com TikTok/Kwai/IG/X');
    const maxShorts = Number(process.env.MAX_SHORTS || 1); // 1 Short por vídeo: poupa cota
    log(`⬆️ publicando: ${quotaBlocked ? '(sem YT) ' : 'YouTube longo + Shorts, '}${clips.length} cortes (TikTok/Kwai/IG/X)`);
    const results = await uploadToAll({
      videoPath: outPath,
      clips,
      title: entry.seo?.youtubeTitle || entry.title,
      hashtags: entry.seo?.hashtags || '#ia #inteligenciaartificial #tecnologia',
      sourceUrl: entry.url || '',
      skipYouTube: quotaBlocked,
      maxShorts,
      ...(entry.seo ? { seo: entry.seo } : {}),
      ...(entry.thumbnailPath ? { thumbnailPath: path.join(ROOT, entry.thumbnailPath) } : {})
    });
    const longOk = /^https/.test(String(results.long.youtube));
    if (longOk) await markYouTubeDone(outPath, results.long.youtube);
    if (/exceeded the number of videos/i.test(String(results.long.youtube))) {
      await flagYtQuota();
      log('⏸️ cota do YouTube atingida — pausando uploads YT por ~20h');
    }
    for (const [clip, r] of Object.entries(results.clips || {})) {
      log(`   corte ${path.basename(clip)}: ${JSON.stringify(r)}`);
    }

    // Limpeza do disco: SÓ apaga quando TUDO publicou sem erro (longo no
    // YouTube + nenhum ERRO em nenhuma plataforma dos cortes). Desativado/
    // pulado/não-logado não bloqueia. CLEANUP_POLICY=long_ok relaxa (apaga
    // quando o longo está no YouTube, mesmo com falhas nas redes).
    const clipErro = Object.values(results.clips || {}).some(r => Object.values(r).some(v => /^ERRO:/i.test(String(v))));
    const cleanup = process.env.CLEANUP_POLICY === 'long_ok' ? longOk : (longOk && !clipErro);
    // Persiste o retorno por plataforma antes da limpeza, inclusive quando
    // tudo deu certo e os arquivos de mídia serão apagados.
    await markResults(outPath, results).catch(() => {});
    if (process.env.DELETE_AFTER_UPLOAD === '1' && cleanup) {
      await fsp.unlink(path.join(ROOT, outPath)).catch(() => {});
      for (const c of clips) await fsp.unlink(c.path).catch(() => {});
      if (entry.thumbnailPath) await fsp.unlink(path.join(ROOT, entry.thumbnailPath)).catch(() => {});
      log('🧹 arquivos locais apagados (tudo publicado sem erro)');
    }
  } catch (error) {
    log(`⚠️ publicação falhou: ${error.message}`);
    await notifyFailure('Publicação falhou', error.message);
  }
}

async function generate({ recap, outPath, theme }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const finalOutPath = outPath || `data/videos/${recap ? 'recap' : 'auto'}_${stamp}.mp4`;
  const logFile = path.join(ROOT, 'logs', `gen_${stamp}.log`);
  const args = recap
    ? ['--recap', '--words', '400', '--out', finalOutPath]
    : ['--auto', '--words', '950', '--out', finalOutPath, '--theme', theme || THEME];
  // Retry com o mesmo outPath + --resume: etapas com cache (roteiro/narração/
  // prints) são reaproveitadas e, se o render já concluiu, pula direto.
  if (outPath) args.push('--resume');
  log(`▶ gerando ${recap ? 'RESUMO SEMANAL' : `vídeo [tema: ${THEME}]`} → ${finalOutPath}`);
  const code = await runGenerator(args, logFile);
  if (code === 0) {
    log(`✅ pronto: ${finalOutPath}`);
    // A publicação acontece no consumer, no slot programado. Publicar aqui
    // apagaria o arquivo antes da fila e faria o consumer receber um path morto.
    return { ok: true, outPath: finalOutPath };
  }
  log(`❌ falhou (code ${code}) — log: ${logFile}`);
  await notifyFailure('Geração de vídeo falhou', `exit code ${code}\nlog: ${logFile}`);
  return { ok: false, outPath: finalOutPath };
}

// Máximo de vídeos PRONTOS no SSD (não enche o disco à toa). Se a geração
// demora 4min e a cadência é 10min, com MAX_QUEUE=1 o producer só gera
// 1 vídeo por vez e depois para — 6min de máquina ociosa (o máximo possível).
const MAX_QUEUE = Number(process.env.MAX_QUEUE || 1);
let queue = [];

/**
 * JUST-IN-TIME: calcula quando começar a geração para o vídeo ficar
 * pronto ANTES do slot de postagem (com margem de segurança).
 *
 * Fórmula: início_geração = slot_postagem - tempo_estimado - margem
 * Exemplo: postagem às 00:10, geração demora 15min, margem 5min
 *          → começa às 23:50, termina às 00:05, posta às 00:10
 *
 * Assim a máquina fica LIVRE o máximo de tempo possível (a geração
 * só acontece quando é necessária pra encher o próximo slot).
 *
 * O tempo estimado vem do histórico: média das últimas gerações
 * (ou default 20 min até ter histórico suficiente).
 */
const GEN_HISTORY_FILE = path.join(STATE_DIR, 'gen-history.json');

async function readGenHistory() {
  try {
    return JSON.parse(await fsp.readFile(GEN_HISTORY_FILE, 'utf8'));
  } catch (_e) { return { durations: [] }; }
}

async function writeGenHistory(history) {
  await fsp.mkdir(path.dirname(GEN_HISTORY_FILE), { recursive: true });
  await fsp.writeFile(GEN_HISTORY_FILE, JSON.stringify(history, null, 2));
}

// Estimativa: média das últimas gerações (mín. 5min, máx. 60min)
async function estimateGenerationMs() {
  const history = await readGenHistory();
  const durations = (history.durations || []).slice(-5); // últimas 5
  if (durations.length === 0) return 20 * 60000; // default 20 min
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  return Math.max(5 * 60000, Math.min(60 * 60000, Math.round(avg)));
}

async function recordGenerationDuration(ms) {
  const history = await readGenHistory();
  history.durations = (history.durations || []).slice(-9); // guarda últimas 10
  history.durations.push(ms);
  await writeGenHistory(history);
}

/**
 * PRODUCER (just-in-time): só gera quando está perto do próximo slot.
 * Se faltam mais de 5 min para o "ponto de corte" (início da geração),
 * dorme e espera. Só acorda na hora certa pra gerar.
 * Cicla entre os temas habilitados (round-robin): cada vídeo é de um tema.
 */
async function producer() {
  // Temas ativos (round-robin): cada vídeo gerado é de um tema diferente
  const THEMES = require('../config/themes.json').themes.filter(t => t.enabled);
  let themeCursor = 0;
  log(`🔄 ${THEMES.length} tema(s) ativo(s) no rodízio`);

  for (;;) {
    // Se o consumer ainda tá postando (fila não vazia), espera
    if (queue.length >= MAX_QUEUE) {
      await sleep(30000);
      continue;
    }

    // Calcula quanto tempo falta pro próximo slot de postagem
    const now = Date.now();
    const genMs = await estimateGenerationMs();
    const safetyMs = 5 * 60000; // margem de segurança (5 min)
    const cutoffMs = genMs + safetyMs; // quanto tempo antes do slot começar

    // Calcula o próximo slot baseado no startedAt + N × intervalo
    const state = await readState();
    const startedAt = state.startedAt ? new Date(state.startedAt).getTime() : now;
    const elapsed = now - startedAt;
    const intervalsPassed = Math.floor(elapsed / INTERVAL_MS);
    const nextSlot = startedAt + (intervalsPassed + 1) * INTERVAL_MS;
    const timeToSlot = nextSlot - now;

    if (timeToSlot > cutoffMs) {
      // Ainda dá tempo: dorme até o "ponto de corte" (o máximo de ociosidade)
      const idleMs = timeToSlot - cutoffMs;
      log(`😴 ocioso por ${(idleMs / 60000).toFixed(1)}min — começo a gerar em ${(cutoffMs / 60000).toFixed(0)}min antes do slot`);
      await sleep(idleMs);
      continue;
    }

    // Pega o próximo tema no rodízio (round-robin entre os ativos)
    const currentTheme = THEMES[themeCursor % THEMES.length];
    themeCursor++;

    // Chegou na hora: gera
    log(`▶ [just-in-time] gerando vídeo do tema: ${currentTheme.name} (${(genMs / 60000).toFixed(1)}min estimados)`);
    const t0 = Date.now();
    const video = await generate({ recap: false, theme: currentTheme.id });
    const durationMs = Date.now() - t0;

    if (video.ok) {
      // Registra o tempo real pra calibrar as próximas estimativas
      await recordGenerationDuration(durationMs);
      queue.push(video);
      log(`📦 pronto em ${(durationMs / 60000).toFixed(1)}min — fila: ${queue.length}/${MAX_QUEUE} vídeo(s) [tema: ${currentTheme.id}]`);
    } else {
      log('⚠️ producer: geração falhou, tentando de novo em 5 min');
      await sleep(300000);
    }
  }
}

/**
 * CONSUMER: postar no slot exato da cadência. O vídeo já vem pronto
 * do producer (zero atraso) — a única coisa que faz é postar e deletar.
 */
async function consumer() {
  for (;;) {
    // Espera até o próximo slot de postagem
    const state = await readState();
    const startedAt = state.startedAt ? new Date(state.startedAt).getTime() : Date.now();
    const now = Date.now();
    const elapsed = now - startedAt;
    const intervalsPassed = Math.floor(elapsed / INTERVAL_MS);
    const nextSlot = startedAt + (intervalsPassed + 1) * INTERVAL_MS;
    const timeToSlot = nextSlot - now;

    if (timeToSlot > 0) {
      log(`⏰ consumer: aguardando ${(timeToSlot / 60000).toFixed(1)}min até o próximo slot`);
      await sleep(timeToSlot);
    }

    // Posta o vídeo da fila (pronto)
    const video = queue.shift();
    if (!video) {
      log('⚠️ consumer: fila vazia no slot! (producer atrasado)');
      continue;
    }

    log(`🎬 [slot] postando: ${path.basename(video.outPath)}`);
    if (process.env.DISABLE_YOUTUBE_UPLOAD !== '1') {
      await publishEverywhere(video.outPath);
    }

    // Atualiza o estado (runs + lastRunAt)
    const st = await readState();
    st.runs = (st.runs || 0) + 1;
    st.lastRunAt = new Date().toISOString();
    await writeState(st);
  }
}

async function main() {
  log(`Channel Scheduler iniciado — tema: ${THEME} · ${VIDEOS_PER_DAY} vídeos/dia · resumo a cada ${RECAP_EVERY_DAYS} dias`);
  log(`intervalo entre vídeos: ${(INTERVAL_MS / 3600000).toFixed(2)}h${PHASE_MIN ? ` · fase +${PHASE_MIN}min (espalhamento uniforme entre réplicas)` : ''}`);

  // Nunca herda o display gráfico do usuário. TikTok/X mantêm o modo headed
  // que já funciona, isolados no Xvfb; as demais automações seguem headless.
  await ensureInvisibleBrowserDisplay();

  let state = await readState();
  if (!state.startedAt) {
    state = { startedAt: new Date().toISOString(), lastRecapAt: null, runs: 0, recaps: 0, lastRunAt: null };
    await writeState(state);
  }

  // Fase da réplica: deslocamento fixo no slot (espalha N réplicas no dia).
  if (PHASE_MIN > 0 && !state.phaseApplied) {
    log(`⏳ fase da réplica: +${PHASE_MIN}min (deslocamento uniforme entre réplicas)`);
    await sleep(PHASE_MIN * 60000);
    state.phaseApplied = true;
    await writeState(state);
  }

  // Modelo fábrica: producer gera em paralelo com consumer que posta.
  // O vídeo N+1 já está sendo gerado enquanto o N é postado (sem atraso).
  log('🚀 Modo fábrica just-in-time: producer (gera só no tempo exato) + consumer (posta no slot)');
  await Promise.all([
    producer(),
    consumer()
  ]);
}

main().catch(error => { log(`FATAL: ${error.message}`); process.exit(1); });
