'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { SCHEMA_VERSION, sha256, stableJson, validateNarrativeEpisodePlan, verifyNarrativeEpisodeAssets } = require('./narrative-episode-plan');
const { CREATIVE_REFERENCE } = require('./narrative-creative-reference');

// News references can change while the same episode is retried. Pin the
// authored plan to its output, but only reuse it when the approved narration,
// source, timing and job identity still match the freshly prepared episode.
function resumeIdentity(plan) {
  return {
    schemaVersion: plan.schemaVersion, jobId: plan.jobId, themeId: plan.themeId,
    title: plan.title, fps: plan.fps, durationMs: plan.durationMs,
    durationInFrames: plan.durationInFrames, seed: plan.seed,
    narrationSha256: plan.narrationSha256, speechEnvelopeSha256: plan.speechEnvelopeSha256,
    source: plan.source, chapters: plan.chapters, sentences: plan.sentences, claims: plan.claims
  };
}

function resumePlanPath(root, stateDir, outputPath) {
  const projectRoot = path.resolve(root);
  const target = path.resolve(projectRoot, outputPath);
  const relative = path.relative(projectRoot, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !/\.mp4$/i.test(relative)) {
    throw new Error('caminho de retomada fora do projeto');
  }
  // Preserve v1 checkpoints while preventing a v2 render from reusing an old
  // visual plan that predates the owner's newly approved direction.
  const key = sha256(Buffer.from(`${SCHEMA_VERSION}\0${CREATIVE_REFERENCE.id}:${CREATIVE_REFERENCE.revision}\0${relative}`));
  return { relative, file: path.join(stateDir, 'narrative-resume-plans', `${key}.json`) };
}

async function loadPinnedNarrativePlan({ root, stateDir, outputPath, basePlan,
  validate = validateNarrativeEpisodePlan, verifyAssets = verifyNarrativeEpisodeAssets }) {
  const { relative, file } = resumePlanPath(root, stateDir, outputPath);
  let record;
  try { record = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw Object.assign(new Error('plano de retomada ilegível; arquivo preservado'), {
      code: 'NARRATIVE_RESUME_PLAN_MISMATCH'
    });
  }
  const plan = record?.plan;
  if (record?.version !== 1 || record.outputPath !== relative || !plan
    || record.planSha256 !== sha256(Buffer.from(stableJson(plan)))
    || stableJson(resumeIdentity(plan)) !== stableJson(resumeIdentity(basePlan))
    || !validate(plan).valid) {
    throw Object.assign(new Error('plano de retomada não corresponde ao episódio aprovado; arquivo preservado'), {
      code: 'NARRATIVE_RESUME_PLAN_MISMATCH'
    });
  }
  await verifyAssets(plan, { root });
  return plan;
}

async function savePinnedNarrativePlan({ root, stateDir, outputPath, plan,
  validate = validateNarrativeEpisodePlan, verifyAssets = verifyNarrativeEpisodeAssets }) {
  const { relative, file } = resumePlanPath(root, stateDir, outputPath);
  if (!validate(plan).valid) throw new Error('plano visual inválido não pode ser persistido');
  await verifyAssets(plan, { root });
  const record = { version: 1, outputPath: relative, planSha256: sha256(Buffer.from(stableJson(plan))), plan };
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 });
    // Never replace a plan another process may have pinned for this output.
    try { await fs.link(temporary, file); }
    catch (error) {
      if (error.code === 'EEXIST') throw Object.assign(new Error('plano de retomada já existe; arquivo preservado'), {
        code: 'NARRATIVE_RESUME_PLAN_MISMATCH'
      });
      throw error;
    }
  } finally { await fs.unlink(temporary).catch(() => {}); }
  return file;
}

module.exports = { loadPinnedNarrativePlan, resumeIdentity, resumePlanPath, savePinnedNarrativePlan };
