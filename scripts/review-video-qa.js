#!/usr/bin/env node
'use strict';

const { recordVideoVisualReview } = require('../utils/video-qa-review');
const fs = require('node:fs/promises');

function parseArgs(argv) {
  const result = { approvedPaths: [], status: 'approved', note: '' };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--approve') result.approvedPaths.push(argv[++index] || '');
    else if (token === '--reject') result.status = 'rejected';
    else if (token === '--reviewer') result.reviewer = argv[++index] || '';
    else if (token === '--note') result.note = argv[++index] || '';
    else if (token === '--critique') { result.critiquePath = argv[++index] || ''; result.status = 'rejected'; }
    else if (token === '--manifest-sha256') result.expectedManifestSha256 = argv[++index] || '';
    else if (!result.manifestPath && !token.startsWith('--')) result.manifestPath = token;
    else throw new Error(`argumento inesperado: ${token}`);
  }
  if (result.status === 'rejected' && result.approvedPaths.length) {
    throw new Error('--reject não pode ser combinado com --approve');
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifestPath || !args.reviewer || (args.status === 'approved' && !args.approvedPaths.length)
    || (args.critiquePath && (args.approvedPaths.length || !args.expectedManifestSha256))) {
    throw new Error('uso: node scripts/review-video-qa.js <manifest.json> --reviewer "Nome" (--approve <asset> ... | --reject [--note "observação"] | --critique <findings.json> --manifest-sha256 <sha256>)');
  }
  const critique = args.critiquePath ? JSON.parse(await fs.readFile(args.critiquePath, 'utf8')) : null;
  const result = await recordVideoVisualReview({ ...args, critique });
  console.log(`Revisão ${result.status}: ${result.videoId} por ${result.reviewer} (${result.approvedAssets.length} artefato(s))`);
  console.log(`Modo visual declarado no manifesto: ${result.visualMode}`);
  console.log(`Manifesto: ${result.manifestPath} SHA-256 ${result.manifestSha256}`);
  if (result.rebuildRequired) {
    console.log(`Reconstruir cenas: ${[...new Set(result.findings.map(finding => finding.sceneId))].join(', ')}`);
  }
  for (const asset of result.approvedAssets) console.log(`Aprovado: ${asset.path} SHA-256 ${asset.sha256}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Falha na revisão QA: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs };
