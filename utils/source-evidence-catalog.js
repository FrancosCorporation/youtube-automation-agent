'use strict';

const { countWords, hashSourceContext, normalizeSourceContext } = require('./source-evidence');
const { scriptClaims, splitSentences } = require('./deterministic-script-review');

const MIN_EVIDENCE_WORDS = 5;
const MIN_QUOTE_WORDS = 4;
const MAX_EVIDENCE_WORDS = 60;

function splitLongSentence(sentence, maxWords = MAX_EVIDENCE_WORDS) {
  const words = [...String(sentence).matchAll(/\S+/g)];
  if (words.length <= maxWords) return [{ text: sentence, start: 0, end: sentence.length }];
  const parts = [];
  for (let index = 0; index < words.length; index += maxWords) {
    const start = words[index].index;
    const next = words[index + maxWords];
    const end = next ? next.index : sentence.length;
    parts.push({ text: sentence.slice(start, end).trim(), start, end });
  }
  return parts;
}

function sentenceFragments(source, maxWords) {
  const sentences = splitSentences(source);
  const fragments = [];
  let cursor = 0;
  for (const sentence of sentences) {
    const start = source.indexOf(sentence, cursor);
    if (start < 0) continue;
    const end = start + sentence.length;
    for (const part of splitLongSentence(sentence, maxWords)) {
      fragments.push({
        text: part.text,
        start: start + part.start,
        end: start + part.end,
        words: countWords(part.text)
      });
    }
    cursor = end;
  }
  if (!fragments.length && source) {
    for (const part of splitLongSentence(source, maxWords)) {
      fragments.push({ ...part, words: countWords(part.text) });
    }
  }
  return fragments;
}

function buildSourceEvidenceCatalog(sourceContext, { maxWords = MAX_EVIDENCE_WORDS } = {}) {
  if (!Number.isSafeInteger(maxWords) || maxWords < MIN_EVIDENCE_WORDS || maxWords > 80) {
    throw new RangeError('maxWords deve ficar entre 5 e 80');
  }
  const source = normalizeSourceContext(sourceContext);
  const fragments = sentenceFragments(source, maxWords);
  // Each sentence is independently citable. Packing unrelated sentences made
  // a neighbouring negation/uncertainty contaminate an otherwise valid claim.
  const groups = [];
  for (const fragment of fragments) {
    if (!fragment.words) continue;
    const previous = groups.at(-1);
    if (previous && (previous.words < MIN_EVIDENCE_WORDS || fragment.words < MIN_EVIDENCE_WORDS)
      && previous.words + fragment.words <= maxWords) {
      previous.end = fragment.end;
      previous.words += fragment.words;
    } else groups.push({ ...fragment });
  }

  const entries = groups.map((group, index) => ({
    id: `S${String(index + 1).padStart(3, '0')}`,
    index,
    start: group.start,
    end: group.end,
    words: countWords(source.slice(group.start, group.end)),
    text: source.slice(group.start, group.end).trim()
  }));
  // Keep existing numeric IDs stable while exposing short sentences as
  // supplemental citations. Older cached scripts continue to resolve as-is.
  const shortSentenceEntries = fragments.filter(fragment => fragment.words >= MIN_QUOTE_WORDS
    && fragment.words < MIN_EVIDENCE_WORDS);
  for (const fragment of shortSentenceEntries) {
    const index = entries.length;
    entries.push({
      id: `S${String(index + 1).padStart(3, '0')}`,
      index,
      start: fragment.start,
      end: fragment.end,
      words: fragment.words,
      text: source.slice(fragment.start, fragment.end).trim()
    });
  }
  return { source, sourceHash: hashSourceContext(source), entries };
}

function renderSourceEvidenceCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.entries)) return '';
  return catalog.entries.map(entry => `[${entry.id}] ${entry.text}`).join('\n');
}

function resolveSourceIds(sourceIds, catalog, { sourceQuote } = {}) {
  const ids = Array.isArray(sourceIds) ? sourceIds
    : typeof sourceIds === 'string' ? [sourceIds] : [];
  const uniqueIds = [...new Set(ids.map(value => String(value || '').trim()).filter(Boolean))];
  if (!uniqueIds.length) return { quote: '', ids: uniqueIds, error: null };
  const byId = new Map((catalog?.entries || []).map(entry => [entry.id, entry]));
  const selected = uniqueIds.map(id => byId.get(id));
  if (selected.some(entry => !entry)) return { quote: '', ids: uniqueIds, error: 'source_id_unknown' };
  const ordered = [...selected].sort((left, right) => left.index - right.index);
  if (ordered.some((entry, index) => entry.index !== ordered[0].index + index)) {
    return { quote: '', ids: uniqueIds, error: 'source_ids_not_contiguous' };
  }
  const referencedText = catalog.source.slice(ordered[0].start, ordered.at(-1).end).trim();
  const quote = sourceQuote === undefined ? referencedText
    : typeof sourceQuote === 'string' ? sourceQuote.replace(/\s+/gu, ' ').trim() : '';
  if (sourceQuote !== undefined && (!quote || !referencedText.includes(quote))) {
    return { quote: '', ids: uniqueIds, error: 'source_quote_outside_reference' };
  }
  if (sourceQuote !== undefined) {
    // Do not let an excerpt remove "not", "could", a condition or a scale
    // attached to the assertion. Accept complete cited sentences, or the
    // initial factual clause before an explicit experimental-purpose clause.
    const clauses = ordered.flatMap(entry => {
      const text = entry.text.trim();
      const purpose = /\s+(?:para (?:testar|avaliar|medir|investigar)|to (?:test|evaluate|measure|investigate)|and (?:to )?test)\b/i.exec(text);
      return [text, text.replace(/[.!?]+$/, ''), ...(purpose ? [text.slice(0, purpose.index).trim()] : [])];
    });
    if (quote !== referencedText && !clauses.includes(quote)) {
      return { quote: '', ids: uniqueIds, error: 'source_quote_not_complete_clause' };
    }
  }
  if (countWords(quote) < MIN_QUOTE_WORDS || countWords(quote) > 80) {
    return { quote: '', ids: uniqueIds, error: 'source_reference_length_invalid' };
  }
  return { quote, ids: ordered.map(entry => entry.id), error: null };
}

function resolveScriptEvidenceIds(script, sourceContext) {
  const catalog = buildSourceEvidenceCatalog(sourceContext);
  const errors = [];
  const repairs = [];
  const claims = new Map(scriptClaims(script).map(item => [item.path, item.claim]));
  const literalKey = value => String(value || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
  const exactEntry = claim => {
    const key = literalKey(claim);
    if (!key) return null;
    const matches = catalog.entries.filter(entry => entry.words >= MIN_QUOTE_WORDS && entry.words <= 80
      && literalKey(entry.text) === key);
    const positions = new Set(matches.map(entry => `${entry.start}:${entry.end}`));
    return positions.size === 1 ? matches[0] : null;
  };
  const original = Array.isArray(script?.claimEvidence) ? script.claimEvidence : [];
  const claimEvidence = original.map(item => {
    if (!item || typeof item !== 'object') return item;
    if (item.sourceIds === undefined && String(item.quote || '').trim()) return item;
    let resolution = resolveSourceIds(item.sourceIds, catalog, { sourceQuote: item.sourceQuote });
    if ((resolution.error || !resolution.ids.length) && !Object.hasOwn(item, 'sourceQuote')) {
      const match = exactEntry(claims.get(String(item.path || '')));
      if (match) {
        resolution = resolveSourceIds([match.id], catalog);
        repairs.push({ path: String(item.path), sourceId: match.id });
      }
    }
    if (resolution.error) errors.push({ path: String(item.path || '$evidence'), code: resolution.error });
    else if (!resolution.ids.length) errors.push({ path: String(item.path || '$evidence'), code: 'source_id_missing' });
    return { ...item, sourceIds: resolution.ids, quote: resolution.quote };
  });
  const presentPaths = new Set(claimEvidence.map(item => String(item?.path || '')));
  for (const [claimPath, claim] of claims) {
    if (presentPaths.has(claimPath)) continue;
    const match = exactEntry(claim);
    if (!match) continue;
    const resolution = resolveSourceIds([match.id], catalog);
    claimEvidence.push({ path: claimPath, sourceIds: resolution.ids, quote: resolution.quote });
    repairs.push({ path: claimPath, sourceId: match.id });
  }
  return {
    catalog,
    errors,
    repairs,
    script: script && typeof script === 'object' ? { ...script, claimEvidence } : script
  };
}

function compileEvidenceField(value, basePath) {
  const fail = () => { throw Object.assign(new Error(`invalid evidence blocks: ${basePath}`), { code: 'SCRIPT_EVIDENCE_INVALID' }); };
  const title = basePath === 'title' || /^sections\.\d+\.title$/.test(basePath);
  const blocks = Array.isArray(value) ? value : [value];
  if (!blocks.length || blocks.length > 100 || (title && blocks.length !== 1)) return fail();
  const parts = [];
  const evidence = [];
  for (const block of blocks) {
    if (!block || typeof block.text !== 'string' || !block.text.trim() || block.text.length > 20000
      || !Array.isArray(block.sourceIds) || !block.sourceIds.length || block.sourceIds.length > 16
      || block.sourceIds.some(id => typeof id !== 'string' || !/^S\d{3,}$/.test(id))) return fail();
    if (Object.hasOwn(block, 'sourceQuote')
      && (typeof block.sourceQuote !== 'string' || !block.sourceQuote.trim() || block.sourceQuote.length > 1500)) return fail();
    const sentences = title ? [block.text.trim()] : splitSentences(block.text);
    for (const sentence of sentences) {
      parts.push(sentence);
      evidence.push({ path: title ? basePath : `${basePath}#${parts.length}`, sourceIds: [...new Set(block.sourceIds)],
        ...(Object.hasOwn(block, 'sourceQuote') ? { sourceQuote: block.sourceQuote.trim() } : {}) });
    }
  }
  const text = parts.join(' ');
  // Reject fragments that merge into a different sentence after concatenation.
  if (!title && JSON.stringify(splitSentences(text)) !== JSON.stringify(parts)) return fail();
  return { text, evidence };
}

function compileScriptEvidenceBlocks(script) {
  if (!script || !Array.isArray(script.sections) || !script.sections.length) {
    throw Object.assign(new Error('script sections missing'), { code: 'SCRIPT_EVIDENCE_INVALID' });
  }
  const claimEvidence = [];
  const field = (value, fieldPath) => {
    const compiled = compileEvidenceField(value, fieldPath);
    claimEvidence.push(...compiled.evidence);
    return compiled.text;
  };
  return {
    ...script,
    title: field(script.title, 'title'),
    hook: field(script.hook, 'hook'),
    sections: script.sections.map((section, index) => ({ ...section,
      title: field(section.title, `sections.${index}.title`),
      content: field(section.content, `sections.${index}.content`)
    })),
    conclusion: field(script.conclusion, 'conclusion'),
    claimEvidence
  };
}

module.exports = {
  compileEvidenceField,
  compileScriptEvidenceBlocks,
  MAX_EVIDENCE_WORDS,
  MIN_EVIDENCE_WORDS,
  buildSourceEvidenceCatalog,
  renderSourceEvidenceCatalog,
  resolveScriptEvidenceIds,
  resolveSourceIds
};
