'use strict';

function narrativeObjectQualifier(label, sentence) {
  const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const object = normalized(label), text = normalized(sentence?.text);
  if (object === 'escolha' && /\bdeixa de ser escolha\b/.test(text)) return { trigger: 'escolha', label: 'DEIXA DE SER' };
  if (/^potes?$/.test(object) && /\bpotes?\s+que\s+nunca\s+vai\s+usar\b/.test(text)) return { trigger: 'usar', label: 'NÃO VAI USAR' };
  return null;
}

module.exports = { narrativeObjectQualifier };
