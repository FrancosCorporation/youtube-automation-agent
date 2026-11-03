#!/usr/bin/env node
'use strict';

// Exercise the real dual-aspect renderer with an isolated, validated plan.
// No generation, topic registration, queue insertion or platform calls.
const fs = require('node:fs/promises');
const path = require('node:path');
const { NarrativeEpisodeRenderer } = require('../utils/narrative-episode-renderer');
const { ROOT } = require('../utils/narrative-episode-plan');

async function checkNarrativeRender({ planPath, audioPath, reportDir }) {
  if (!planPath || !audioPath || !reportDir) throw new Error('Informe --plan, --audio e --report-dir');
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  if (!/^diagnostic-[a-zA-Z0-9_-]{1,60}$/.test(plan.jobId)) {
    throw new Error('O plano de teste precisa de jobId diagnostic-* próprio');
  }
  reportDir = path.resolve(reportDir);
  const reportRoot = path.join(ROOT, 'data', 'reports');
  if (!reportDir.startsWith(`${reportRoot}${path.sep}`)) throw new Error('Relatório deve ficar em data/reports/');
  await fs.mkdir(reportDir, { recursive: true, mode: 0o700 });
  process.env.STATE_DIR = path.join(reportDir, 'state');
  const outputPath = path.join(ROOT, 'data', 'videos', 'diagnostics', `${plan.jobId}.mp4`);
  const startedAt = new Date().toISOString();
  try {
    const result = await new NarrativeEpisodeRenderer().renderEpisode({ plan, audioPath, outputPath });
    const report = { diagnostic: true, publicationEligible: false, startedAt,
      finishedAt: new Date().toISOString(), status: 'completed', result };
    await fs.writeFile(path.join(reportDir, 'render-check.json'), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } catch (error) {
    await fs.writeFile(path.join(reportDir, 'render-check.json'), `${JSON.stringify({ diagnostic: true,
      publicationEligible: false, startedAt, finishedAt: new Date().toISOString(), status: 'failed',
      errorCode: error.code || error.name, message: error.message })}\n`);
    throw error;
  }
}

if (require.main === module) {
  const option = name => process.argv[process.argv.indexOf(name) + 1];
  const required = name => process.argv.includes(name) ? option(name) : null;
  checkNarrativeRender({ planPath: required('--plan'), audioPath: required('--audio'), reportDir: required('--report-dir') })
    .then(() => console.log('Render diagnóstico concluído nos dois formatos; relatório salvo.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { checkNarrativeRender };
