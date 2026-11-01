#!/usr/bin/env node
'use strict';

const { applyDelegatedPublicationReview } = require('../utils/delegated-publication-review');

async function main() {
  const manifests = process.argv.slice(2);
  if (!manifests.length || manifests.some(value => value.startsWith('-'))) {
    console.error('Uso: npm run review:video-auto -- data/reports/qa/<videoId>.json [...]');
    process.exitCode = 2;
    return;
  }
  // Select jobs explicitly. Never scan/release historical media in bulk or
  // change uncertain publication results while applying the review policy.
  for (const manifestPath of manifests) {
    const result = await applyDelegatedPublicationReview({ manifestPath });
    console.log(JSON.stringify(result));
  }
}

if (require.main === module) main().catch(error => {
  console.error('Política não aplicada:', error.code || 'publication_automatic_review_failed');
  process.exitCode = 1;
});
