'use strict';

function generationFailureCodeFromLog(contents) {
  const match = String(contents || '').match(/FALHA:\s*geração interrompida\s+([a-z0-9_]{1,64})/i);
  const code = match?.[1]?.toLowerCase();
  return code || null;
}

module.exports = { generationFailureCodeFromLog };
