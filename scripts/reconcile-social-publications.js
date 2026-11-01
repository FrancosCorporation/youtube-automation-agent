'use strict';
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
const { reconcileSocialPublications } = require('../utils/social-reconciliation');
const option = (key, fallback) => {
  const index = process.argv.indexOf(`--${key}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
reconcileSocialPublications({ root, platform: option('platform', 'tiktok'), force: process.argv.includes('--force'),
  maxPosts: Math.max(1, Math.min(12, Number(option('max-posts', 3)) || 3)) })
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
