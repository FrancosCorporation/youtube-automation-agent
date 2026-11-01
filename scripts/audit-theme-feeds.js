#!/usr/bin/env node
'use strict';

const { themes } = require('../config/themes.json');
const { auditThemeFeeds } = require('../utils/theme-feed-audit');

auditThemeFeeds({
  themes,
  timeoutMs: process.env.THEME_FEED_AUDIT_TIMEOUT_MS,
  maxSampleBytes: process.env.THEME_FEED_AUDIT_MAX_BYTES,
  concurrency: process.env.THEME_FEED_AUDIT_CONCURRENCY
}).then(report => {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failedCount > 0) process.exitCode = 1;
}).catch(error => {
  process.stderr.write(`Falha ao auditar feeds por tema: ${String(error.message || error)}\n`);
  process.exitCode = 1;
});
