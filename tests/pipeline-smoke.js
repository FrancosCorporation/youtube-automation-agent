#!/usr/bin/env node
/**
 * Smoke test do pipeline REAL (notícia → roteiro → render → publicação).
 *
 * Offline e sem API paga: valida as peças críticas do pipeline que roda 24h,
 * que não tinha NENHUM teste (o test.js da raiz cobre só o pipeline legado).
 *
 *   node tests/pipeline-smoke.js
 *
 * Saída: exit 0 = tudo ok; exit 1 = algo quebrou (o scheduler NÃO deve
 * publicar com este repo quebrado).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

(async () => {
  console.log('Smoke test do pipeline real\n');

  // 1. Módulos carregam sem erro
  const { AnimatedSceneRenderer } = require(path.join(ROOT, 'utils', 'animated-scene-renderer'));
  const { probeVideoHealth } = require(path.join(ROOT, 'utils', 'ffmpeg'));
  const { mixdownAudio, deriveMood } = require(path.join(ROOT, 'utils', 'audio-mix'));
  const { notifyFailure } = require(path.join(ROOT, 'utils', 'alerts'));
  const apiUsage = require(path.join(ROOT, 'utils', 'api-usage'));
  check('módulos carregam', true);

  // 2. buildScenes: cenas geradas com watermark em TODAS (identidade de marca)
  const renderer = new AnimatedSceneRenderer();
  const fakeScript = {
    seed: 42,
    hook: { text: 'Uma IA nova acabou de mudar tudo o que você sabia sobre robôs.' },
    mainContent: {
      sections: [
        { title: 'A notícia', content: 'A empresa apresentou o modelo ontem. Ele roda localmente em qualquer PC. E é de graça.' },
        { title: 'O impacto', content: 'Isso pressiona gigantes. O custo cai 40%. O mercado deve reagir rápido.' }
      ]
    },
    conclusion: { finalThought: 'Se você usa IA no dia a dia, isso muda seu jogo.' }
  };
  const scenes = renderer.buildScenes(fakeScript, 20000, {});
  check('buildScenes gera cenas', scenes.length >= 4, `${scenes.length} cenas`);
  check('watermark em todas as cenas', scenes.every(s => s.components.some(c => c.type === 'watermark')));
  check('caption presente em todas as cenas', scenes.every(s => s.components.some(c => c.type === 'caption')));

  // 3. QA pré-publicação: reprova arquivo quebrado/lixo
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso_smoke_'));
  const fakeMp4 = path.join(tmpDir, 'fake.mp4');
  fs.writeFileSync(fakeMp4, Buffer.alloc(1024, 0));
  const badHealth = await probeVideoHealth(fakeMp4);
  check('QA reprova arquivo quebrado', badHealth.ok === false && badHealth.issues.length >= 2);

  // 4. Mood heurístico
  check('mood epic', deriveMood('empresa recordou o recorde histórico') === 'epic');
  check('mood tense', deriveMood('polêmica: dados vazaram') === 'tense');
  check('mood default curious', deriveMood('lançamento de tecnologia') === 'curious');

  // 5. Controle de custo: gate lança quando estoura
  const fakeLimit = 2;
  await apiUsage.recordCall('smoke_test');
  await apiUsage.recordCall('smoke_test');
  let budgetThrew = false;
  try { await apiUsage.assertBudget('smoke_test', fakeLimit); } catch (_e) { budgetThrew = true; }
  check('gate de orçamento bloqueia ao estourar', budgetThrew);
  check('recordCall conta chamadas', (await apiUsage.usedToday('smoke_test')) >= 2);

  // 6. Alerts: sem env configurado = no-op (não lança)
  const sent = await notifyFailure('smoke test — ignore');
  check('alerts no-op sem env', sent === false);

  // 7. Mixdown offline (sem trilha): narração sintética → loudnorm aplicado
  const { execFileSync } = require('child_process');
  const { getFFmpegPath } = require(path.join(ROOT, 'utils', 'ffmpeg'));
  const narration = path.join(tmpDir, 'narration.mp3');
  execFileSync(getFFmpegPath(), ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'libmp3lame', narration], { stdio: 'ignore' });
  const mixed = await mixdownAudio({ narrationPath: narration, mood: 'curious', seed: 1, workDir: tmpDir });
  check('mixdown produz áudio masterizado', fs.existsSync(mixed.path) && fs.statSync(mixed.path).size > 1000);

  // Limpeza
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\nResultado: ${passed} ok, ${failed} falharam`);
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.error(`FALHA no smoke test: ${error.message}`);
  process.exit(1);
});
