#!/usr/bin/env node
'use strict';

// Isolated, non-scheduler render for the corrected refrigerator script. This
// deliberately reuses the already approved narration cache and never touches
// publish-queue.json, topics.json, or the scheduler pause file.
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
process.env.NVIDIA_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.PULSO_DETERMINISTIC_SCENE_FALLBACK = '1';

const { normalizeScript, synthesizeNarration } = require('./generate-animated-video');
const { createNarrativeEpisodePlan, sha256, stableJson } = require('../utils/narrative-episode-plan');
const { authorNarrativeScenes } = require('../utils/narrative-scene-author');
const { assertNarrativeIllustration, authorWithIllustrationRepair } = require('../utils/narrative-illustration-audit');
const { NarrativeEpisodeRenderer } = require('../utils/narrative-episode-renderer');
const { assessSourceEvidence, createPublicationReview } = require('../utils/source-evidence');

const JOB_ID = 'fridge-corrected-20261101-v215';
const SCRIPT_PATH = path.join(root, 'data', 'scripts', 'economize_revis_o_factual_do_programa_de_geladeiras_em-retention-emotions-v29-inline-source-evidence.json');
const SOURCE_QA_PATH = path.join(root, 'data', 'reports', 'qa', 'vid_bd99f112f57800b4bc86807b.json');
const NARRATION_DIR = path.join(root, 'data', 'videos', 'economize_revis_o_factual_do_programa_de_geladeiras_em-retention-emotions-v29-inline-source-evidence_tts');
const AUDIO_PATH = path.join(NARRATION_DIR, 'narration.mp3');
const OUTPUT_PATH = path.join(root, 'data', 'videos', 'revisao-geladeiras-20261101-v215.mp4');
const PORTRAIT_OUTPUT_PATH = OUTPUT_PATH.replace(/\.mp4$/i, '-portrait.mp4');
const CACHE_DIR = path.join(root, 'data', 'cache', 'narrative-scenes-isolated', JOB_ID);
const EVIDENCE_PATH = path.join(root, 'docs', 'evidencias', `corrected-fridge-isolated-${JOB_ID}.json`);

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function main() {
  const statePath = path.join(root, 'data', 'state', 'narrative-renders', `${JOB_ID}.json`);
  const renderState = await readJson(statePath).catch(() => null);
  for (const [aspect, output] of [['landscape', OUTPUT_PATH], ['portrait', PORTRAIT_OUTPUT_PATH]]) {
    const stat = await fs.stat(output).catch(() => null);
    if (!stat) continue;
    const record = renderState?.completed?.[aspect];
    if (!record || record.path !== output || Number(record.sizeBytes) !== stat.size) {
      throw new Error(`saída existente sem estado compatível; não sobrescrevendo: ${output}`);
    }
  }

  const [rawScript, sourceQa, narrationMetadata] = await Promise.all([
    readJson(SCRIPT_PATH),
    readJson(SOURCE_QA_PATH),
    readJson(`${AUDIO_PATH}.meta.json`)
  ]);
  const sourceContext = sourceQa.sourceReview?.sourceContext || '';
  if (!sourceContext) throw new Error('contexto da fonte ausente no manifesto QA preservado');

  const sourceEvidence = assessSourceEvidence({
    sourceTitle: sourceQa.sourceReview.sourceTitle,
    sourceUrl: sourceQa.sourceReview.sourceUrl,
    context: sourceContext,
    mode: 'article'
  });
  const publicationReview = createPublicationReview({
    verdict: 'aprovado', sourceContext, reviewer: sourceQa.sourceReview.reviewer
  });
  const theme = require('../config/themes.json').themes.find(item => item.id === 'economize');
  if (!theme) throw new Error('tema economize ausente');

  const script = normalizeScript({
    ...rawScript,
    channel: theme.brand,
    seed: 11012026,
    visualPalettes: theme.visualPalettes,
    visualMode: 'narrative-episode-v2',
    formatId: rawScript.formatId || 'context-change-result',
    formatVersion: rawScript.formatVersion || 1
  }, sourceContext);
  const replayNarration = {
    path: AUDIO_PATH,
    inputSha256: narrationMetadata.inputSha256,
    sha256: narrationMetadata.audioSha256
  };
  const narration = await synthesizeNarration(script, JOB_ID, path.dirname(OUTPUT_PATH), replayNarration);
  const sourceHash = sourceEvidence.contextHash;
  if (sourceHash !== sourceQa.sourceReview.sourceHash) throw new Error('hash do contexto não bate com a revisão factual preservada');

  const basePlan = await createNarrativeEpisodePlan({
    jobId: JOB_ID,
    script,
    themeId: theme.id,
    fps: 24,
    durationMs: narration.totalDurationMs,
    timings: narration.timings,
    audioPath: narration.audioPath,
    sourceEvidence,
    publicationReview,
    root
  });
  const episodePlan = await authorWithIllustrationRepair({
    author: authorNarrativeScenes,
    options: {
      plan: basePlan,
      sourceContext,
      cacheDir: CACHE_DIR,
      logger: console,
      model: 'deterministic-isolated-v214',
      geminiEnabled: false,
      geminiFirst: false
    },
    visualCritique: [],
    attempts: 2
  });
  assertNarrativeIllustration(episodePlan);
  const scenePlanSha256 = sha256(Buffer.from(stableJson(episodePlan)));
  const scenesSha256 = sha256(Buffer.from(stableJson(episodePlan.scenes)));
  console.log(`      plano isolado: input ${episodePlan.inputSha256}, scenes ${scenePlanSha256}, scene-list ${scenesSha256}`);

  // Older interrupted runs predate the renderer's plan-compatibility fields.
  // Bind the already verified horizontal to this exact plan before asking the
  // renderer to resume; the media hash is checked, never assumed.
  const existingState = await readJson(statePath).catch(() => null);
  const existingLandscape = existingState?.completed?.landscape;
  if (existingLandscape && existingState.planInputSha256 !== episodePlan.inputSha256) {
    const existingBytes = await fs.readFile(OUTPUT_PATH);
    const existingHash = sha256(existingBytes);
    if (existingHash !== existingLandscape.sha256 || existingBytes.length !== Number(existingLandscape.sizeBytes)) {
      throw new Error('horizontal existente não confere com o estado hash-bound');
    }
    await fs.writeFile(statePath, `${JSON.stringify({
      ...existingState,
      planInputSha256: episodePlan.inputSha256,
      episodePlanSha256: scenePlanSha256,
      rendererVersion: 'remotion-4.0.537+NarrativeEpisode-v2.14'
    }, null, 2)}\n`);
  }

  const renderer = new NarrativeEpisodeRenderer({ logger: console });
  const render = await renderer.renderEpisode({
    plan: episodePlan,
    audioPath: narration.audioPath,
    outputPath: OUTPUT_PATH,
    portraitOutputPath: PORTRAIT_OUTPUT_PATH
  });
  const evidence = {
    schemaVersion: 1,
    status: 'rendered_pending_visual_review',
    jobId: JOB_ID,
    scriptPath: path.relative(root, SCRIPT_PATH),
    sourceQaPath: path.relative(root, SOURCE_QA_PATH),
    narrationPath: path.relative(root, narration.audioPath),
    sourceContextHash: sourceHash,
    publicationReview,
    rendererVersion: render?.rendererVersion || 'remotion-4.0.537+NarrativeEpisode-v2.14',
    episodePlanSha256: scenePlanSha256,
    sceneCount: episodePlan.scenes.length,
    sentenceCount: episodePlan.sentences.length,
    sceneAuthor: episodePlan.author,
    outputs: {
      landscape: path.relative(root, OUTPUT_PATH),
      portrait: path.relative(root, PORTRAIT_OUTPUT_PATH)
    },
    rendererEvidence: render,
    visualReview: {
      status: 'pending',
      note: 'Inspeção humana de contato e frames representativos ainda necessária; não publicar.'
    },
    createdAt: new Date().toISOString()
  };
  await fs.mkdir(path.dirname(EVIDENCE_PATH), { recursive: true });
  await fs.writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ status: evidence.status, evidencePath: path.relative(root, EVIDENCE_PATH), outputs: evidence.outputs }, null, 2));
}

main().catch(error => {
  console.error(`FALHA: ${error.code || error.name || 'render_failed'}: ${error.message}`);
  process.exitCode = 1;
});
