'use strict';

function splitSentences(text) {
  return String(text || '').split(/(?<=[.!?…])\s+/).map(sentence => sentence.trim()).filter(Boolean);
}

function orderedMarker(sentence) {
  const normalized = String(sentence || '').trim().toLowerCase();
  const numbered = normalized.match(/^(?:passo|etapa)\s*(\d+)[.:)-]?\s*|^(\d+)[.)]\s*/);
  if (numbered) return Number(numbered[1] || numbered[2]);
  if (/^(?:em\s+)?primeir[oa]mente?\b|^primeir[oa]\b/.test(normalized)) return 1;
  if (/^(?:em\s+)?segund[oa]mente?\b|^segund[oa]\b/.test(normalized)) return 2;
  if (/^(?:em\s+)?terceir[oa]mente?\b|^terceir[oa]\b/.test(normalized)) return 3;
  if (/^(?:em\s+)?quart[oa]mente?\b|^quart[oa]\b/.test(normalized)) return 4;
  return null;
}

function extractOrderedChecklist(text, { maxItems = 4, maxChars = 120 } = {}) {
  const marked = splitSentences(text)
    .map(sentence => ({ sentence, order: orderedMarker(sentence) }))
    .filter(item => item.order !== null);
  if (marked.length < 2) return [];

  const selected = [];
  let previous = 0;
  for (const item of marked) {
    if (item.order <= previous || item.sentence.length > maxChars) return [];
    selected.push(item.sentence);
    previous = item.order;
    if (selected.length >= maxItems) break;
  }
  return selected.length >= 2 ? selected : [];
}

function extractRotationCards(text, { maxItems = 3, minChars = 18, maxChars = 110 } = {}) {
  const sentences = splitSentences(text);
  if (sentences.length < 3) return [];
  const cards = sentences
    .filter(sentence => sentence.length >= minChars && sentence.length <= maxChars)
    .slice(0, maxItems);
  return cards.length >= 3 ? cards : [];
}

function formatVideoTimestamp(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value < 0) return null;
  const totalSeconds = Math.floor(value / 1000);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${String(totalMinutes).padStart(2, '0')}:${seconds}`;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}:${seconds}`;
}

function normalizeComparisonItems(items, { maxItems = 4, maxLabelChars = 18 } = {}) {
  if (!Array.isArray(items) || items.length < 2) return [];
  const bounded = items.slice(0, maxItems);
  const normalized = bounded.map(item => {
    if (!item || typeof item !== 'object' || item.score == null || String(item.score).trim() === '') return null;
    const score = Number(item.score);
    const label = String(item.label || '').trim();
    if (!label || !Number.isFinite(score) || score < 0 || score > 10) return null;
    return { label: label.slice(0, maxLabelChars), score };
  });
  return normalized.length >= 2 && normalized.every(Boolean) ? normalized : [];
}

function normalizeMetricComparisonItems(items, { maxItems = 4, maxLabelChars = 30 } = {}) {
  if (!Array.isArray(items) || items.length < 2) return [];
  const bounded = items.slice(0, maxItems);
  const normalized = bounded.map(item => {
    if (!item || typeof item !== 'object' || item.value == null || String(item.value).trim() === '') return null;
    const value = Number(item.value);
    const label = String(item.label || '').trim();
    const unit = String(item.unit || '').trim().slice(0, 8);
    const cue = String(item.cue || '').trim();
    if (!label || !Number.isFinite(value) || value < 0 || !unit || !cue) return null;
    return { label: label.slice(0, maxLabelChars), value, unit, cue };
  });
  const units = new Set(normalized.filter(Boolean).map(item => item.unit.toLocaleLowerCase('pt-BR')));
  return normalized.length >= 2 && normalized.every(Boolean) && units.size === 1 ? normalized : [];
}

function extractNarratedGpuComparison(text) {
  const unitPattern = '(?:GPUs?)';
  const pattern = new RegExp(
    `\\b(?<leftValue>\\d+(?:[.,]\\d+)?)\\s+(?:(?<leftQualifier>SM\\d+)\\s+)?(?<unit>${unitPattern})\\s+(?:para|em)\\s+(?<leftLabel>[\\p{L}\\p{N}-]+)\\s+(?<join>e|versus|vs\\.?)\\s+(?<rightValue>\\d+(?:[.,]\\d+)?)\\s+(?:(?<rightQualifier>SM\\d+)\\s+)?(?:(?<rightUnit>${unitPattern})\\s+)?(?:para|em)\\s+(?<rightLabel>[\\p{L}\\p{N}-]+)\\b`,
    'iu'
  );
  const sentences = splitSentences(text);
  for (const sentence of sentences) {
    const match = pattern.exec(sentence);
    if (!match) continue;
    const leftQualifier = String(match.groups.leftQualifier || '').toUpperCase();
    const rightQualifier = String(match.groups.rightQualifier || '').toUpperCase();
    const leftUnit = String(match.groups.unit).toLocaleLowerCase('pt-BR');
    const rightUnit = String(match.groups.rightUnit || match.groups.unit).toLocaleLowerCase('pt-BR');
    if (leftUnit !== rightUnit || (leftQualifier && rightQualifier && leftQualifier !== rightQualifier)) continue;

    const join = /\s+(?:e|versus|vs\.?)\s+/iu.exec(match[0]);
    if (!join) continue;
    const rightStart = join.index + join[0].length;
    const label = value => value.charAt(0).toLocaleUpperCase('pt-BR') + value.slice(1);
    const unit = String(match.groups.unit);
    const leftSuffix = leftQualifier ? ` ${leftQualifier}` : '';
    const rightSuffix = rightQualifier ? ` ${rightQualifier}` : '';
    return {
      title: 'Comparação do benchmark',
      unitLabel: unit,
      items: [
        {
          label: `${label(match.groups.leftLabel)}${leftSuffix}`,
          value: Number(match.groups.leftValue.replace(',', '.')),
          unit,
          cue: match[0].slice(0, join.index).trim()
        },
        {
          label: `${label(match.groups.rightLabel)}${rightSuffix}`,
          value: Number(match.groups.rightValue.replace(',', '.')),
          unit,
          cue: match[0].slice(rightStart).trim()
        }
      ]
    };
  }
  return null;
}

function cueWords(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').match(/[\p{L}\p{N}]+/gu) || [];
}

function findNarrationCueOffset(cue, sentences) {
  const target = cueWords(cue);
  if (!target.length) return null;
  for (const sentence of Array.isArray(sentences) ? sentences : []) {
    const words = Array.isArray(sentence?.words) && sentence.words.length
      ? sentence.words : String(sentence?.text || '').split(/\s+/).filter(Boolean);
    const normalized = words.map(word => cueWords(word).join(''));
    for (let start = 0; start <= normalized.length - target.length; start += 1) {
      if (!target.every((word, index) => normalized[start + index] === word)) continue;
      const wordOffset = Array.isArray(sentence.wordTimes) && Number.isFinite(Number(sentence.wordTimes[start]))
        ? Number(sentence.wordTimes[start]) : 0;
      return Math.max(0, (Number(sentence.startMs) || 0) + wordOffset);
    }
  }
  return null;
}

module.exports = {
  extractOrderedChecklist,
  extractRotationCards,
  extractNarratedGpuComparison,
  formatVideoTimestamp,
  normalizeComparisonItems,
  normalizeMetricComparisonItems,
  findNarrationCueOffset
};
