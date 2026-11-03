'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { validateAttempt } = require('./generation-attempt');

async function loadGenerationTopicReservations({ root, stateDir, jobId }) {
  const read = async name => {
    try { return JSON.parse(await fs.readFile(path.join(stateDir, name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const [active, deferred] = await Promise.all([read('generation-in-flight.json'), read('deferred-generation-attempts.json')]);
  if (deferred && (deferred.version !== 1 || !Array.isArray(deferred.entries) || deferred.entries.length > 100)) {
    throw new Error('fila de recuperações inválida; não selecionar pauta potencialmente reservada');
  }
  return [...(active ? [active] : []), ...(deferred?.entries || [])].map(entry => validateAttempt(entry, root))
    .filter(attempt => attempt.jobId !== jobId && attempt.article)
    .map(attempt => ({ title: attempt.article.title, url: attempt.article.url, jobId: attempt.jobId }));
}

module.exports = { loadGenerationTopicReservations };
