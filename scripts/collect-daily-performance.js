#!/usr/bin/env node
'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { collectDailyPerformance } = require('../utils/daily-performance');

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--refresh')) throw new Error('usage');
  const result = await collectDailyPerformance({ refresh: args.includes('--refresh') });
  console.log(JSON.stringify({
    reportDate: result.report.reportDate, cached: result.cached,
    status: result.report.status,
    posts: result.report.posts.length, coverage: result.report.coverage,
    reportPath: result.markdownPath
  }, null, 2));
  // The report itself is durable, but expose complete lack of metrics to the
  // service manager instead of claiming a healthy collection.
  if (result.report.status === 'blocked') process.exitCode = 2;
}

if (require.main === module) main().catch(() => {
  console.error('Coleta diária não concluída; verificar ledger, permissões e lock. Nenhum erro bruto de credencial é exibido.');
  process.exitCode = 1;
});

module.exports = { main };
