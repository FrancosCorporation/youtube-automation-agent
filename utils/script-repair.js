'use strict';

const { compileEvidenceField } = require('./source-evidence-catalog');

/** Apply text edits only to existing editorial fields, never arbitrary JSON paths. */
function applyScriptRepair(script, response) {
  const fail = () => {
    throw Object.assign(new Error('invalid_script_repair'), { code: 'INVALID_SCRIPT_REPAIR' });
  };
  if (!script || !Array.isArray(script.sections) || !Array.isArray(response?.edits)
    || response.edits.length < 1 || response.edits.length > 20) return fail();
  const updated = globalThis.structuredClone(script);
  const seen = new Set();
  let changed = false;
  for (const edit of response.edits) {
    if (typeof edit?.path !== 'string' || seen.has(edit.path)) return fail();
    seen.add(edit.path);
    if (edit.path === 'claimEvidence') {
      if (!Array.isArray(edit.value) || edit.value.length < 1 || edit.value.length > 100
        || edit.value.some(item => !/^(?:title|hook#\d+|sections\.\d+\.(?:title|content#\d+)|conclusion#\d+)$/.test(String(item?.path || ''))
          || (item.sourceIds !== undefined
            ? !Array.isArray(item.sourceIds) || !item.sourceIds.length || item.sourceIds.length > 16
              || item.sourceIds.some(id => typeof id !== 'string' || !/^S\d{3,}$/.test(id))
            : typeof item?.quote !== 'string' || !item.quote.trim() || item.quote.length > 1500))) return fail();
      if (edit.value.some(item => Object.hasOwn(item, 'sourceQuote')
        && (typeof item.sourceQuote !== 'string' || !item.sourceQuote.trim() || item.sourceQuote.length > 1500))) return fail();
      changed ||= JSON.stringify(updated.claimEvidence || []) !== JSON.stringify(edit.value);
      updated.claimEvidence = edit.value.map(item => item.sourceIds !== undefined
        ? { path: item.path, sourceIds: [...new Set(item.sourceIds)],
          ...(Object.hasOwn(item, 'sourceQuote') ? { sourceQuote: item.sourceQuote.trim() } : {}) }
        : { path: item.path, quote: item.quote.trim() });
      continue;
    }
    const match = /^(?:title|hook|conclusion)$/.test(edit.path)
      ? [null, edit.path] : /^sections\.(0|[1-9]\d*)\.(title|content)$/.exec(edit.path);
    if (!match) return fail();
    const target = match.length === 2 ? updated : updated.sections[Number(match[1])];
    const key = match.length === 2 ? match[1] : match[2];
    if (!target || typeof target[key] !== 'string') return fail();
    let text = edit.value;
    if (edit.value && typeof edit.value === 'object') {
      let compiled;
      try { compiled = compileEvidenceField(edit.value, edit.path); } catch { return fail(); }
      text = compiled.text;
      const preserved = (updated.claimEvidence || []).filter(item => item.path !== edit.path && !item.path.startsWith(`${edit.path}#`));
      const evidence = [...preserved, ...compiled.evidence];
      changed ||= JSON.stringify(updated.claimEvidence) !== JSON.stringify(evidence);
      updated.claimEvidence = evidence;
    }
    if (typeof text !== 'string' || !text.trim() || text.length > 20000) return fail();
    changed ||= target[key] !== text;
    target[key] = text;
  }
  if (!changed) return fail();
  return updated;
}

const VALIDATION_FEEDBACK = Object.freeze({
  SCRIPT_JSON_MISSING: 'A resposta anterior não continha JSON. Responda somente o JSON solicitado, sem prefácio nem markdown.',
  SCRIPT_JSON_INVALID: 'O JSON anterior era inválido. Corrija aspas e estrutura, retornando um único JSON válido e completo.',
  INCOMPLETE_SCRIPT_RESPONSE: 'A resposta anterior foi truncada. Retorne JSON completo e mais conciso, removendo repetições, sem acrescentar fatos.',
  INVALID_SCRIPT_RESPONSE: 'A resposta anterior não tinha o objeto JSON solicitado. Retorne somente o objeto completo no formato pedido.',
  SCRIPT_LANGUAGE_MISMATCH: 'A resposta anterior estava em inglês. Todo texto falado, título, gancho e conclusão deve estar em português do Brasil.',
  SCRIPT_EVIDENCE_INVALID: 'Cada texto editorial precisa de {text, sourceIds}. Use listas de frases completas em content/conclusion e apenas IDs S001 etc. existentes na fonte.',
  INVALID_SCRIPT_REPAIR: 'A resposta anterior não aplicou uma edição válida. Retorne somente edits com caminhos existentes, textos alterados e todas as correções do feedback.'
});

/** One informed retry for output validation; outages and budgets never retry here. */
async function withScriptValidationRetry(request, onRetry) {
  let feedback = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await request(feedback); }
    catch (error) {
      if (attempt > 0 || !Object.hasOwn(VALIDATION_FEEDBACK, error?.code || '')) throw error;
      feedback = `\n\nCORREÇÃO OBRIGATÓRIA DA RESPOSTA: ${VALIDATION_FEEDBACK[error.code]}`;
      onRetry?.(error);
    }
  }
}

module.exports = { applyScriptRepair, withScriptValidationRetry };
