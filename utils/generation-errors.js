'use strict';

function generationFailureCodeFromLog(contents) {
  const match = String(contents || '').match(/FALHA:\s*geração interrompida\s+([a-z0-9_]{1,64})/i);
  const code = match?.[1]?.toLowerCase();
  return code || null;
}

function generationRetryAtFromLog(contents) {
  // Only accept the deadline on the generator's final, structured failure
  // line. A provider response or an earlier log message cannot schedule work.
  const match = String(contents || '').match(/^FALHA:\s*geração interrompida\s+[a-z0-9_]{1,64}[^\r\n]*\bretryAt=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s*$/im);
  return match && Number.isFinite(Date.parse(match[1])) ? match[1] : null;
}

module.exports = { generationFailureCodeFromLog, generationRetryAtFromLog };
