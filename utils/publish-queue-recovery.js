'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { reconcileInterruptedPublicationAttempts } = require('./social-publication-state');

async function recoverPersistedQueue({
  queuePath,
  ledgerPath,
  root,
  isManagedVideo,
  log = () => {},
  now
}) {
  if (typeof isManagedVideo !== 'function') {
    throw new TypeError('validador de mídia gerenciada obrigatório');
  }

  let saved;
  try {
    saved = JSON.parse(await fs.readFile(queuePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { found: false, ok: true, pending: [] };
    return {
      found: true,
      ok: false,
      message: `⚠️ fila persistida ilegível; execução cancelada para preservar os caminhos pendentes: ${error.message}`
    };
  }

  if (!saved || typeof saved !== 'object' || Array.isArray(saved) || !Array.isArray(saved.pending)) {
    return {
      found: true,
      ok: false,
      message: '⚠️ fila persistida tem formato inválido; execução cancelada para preservar os dados'
    };
  }

  const exists = async item => Boolean(item && typeof item.outPath === 'string'
    && await isManagedVideo(item.outPath));
  const pending = [];
  for (const item of saved.pending) {
    if (await exists(item)) pending.push(item);
    else if (item?.outPath) log(`⚠️ fila persistida ignorada: arquivo ausente (${item.outPath})`);
  }

  if (await exists(saved.inFlight)) {
    const recovery = await reconcileInterruptedPublicationAttempts(ledgerPath, saved.inFlight.outPath, {
      root,
      ...(now !== undefined ? { now } : {})
    });
    if (!recovery.matched) {
      log(`⚠️ vídeo em voo sem entrada correspondente no ledger; arquivo preservado para reconciliação: ${path.basename(saved.inFlight.outPath)}`);
    } else if (recovery.reconciled) {
      log(`⚠️ ${recovery.reconciled} tentativa(s) sem resultado marcadas como desconhecidas; confira as contas antes de reenviar`);
    }
    pending.unshift({ ...saved.inFlight, recoveredAfterInterruptedPublish: true });
    log(`📦 vídeo interrompido recuperado sem reenviar automaticamente destinos ambíguos: ${path.basename(saved.inFlight.outPath)}`);
  }

  return { found: true, ok: true, pending };
}

module.exports = { recoverPersistedQueue };
