'use strict';

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const FLOW_PATTERN = /\b(?:se\s+)?(?:transforma(?:m)?|transformou|converte(?:m)?|converteu)\s+em\b|\b(?:substituid[ao]s?|trocad[ao]s?|convertid[ao]s?|dividid[ao]s?)\s+(?:por|em)\b|\b(?:segue|seguem|viaja|viajam|vai|vao|flui|trafega)\s+(?:para|ao|a)\b|\b(?:envia|enviam|encaminha|encaminham|manda|mandam)\b[^.!?;]{0,70}\b(?:para|ao|a)\b/;
const INFINITIVE_FLOW = /\b(?:transformar|converter|dividir)\b[^.!?;]{0,60}\bem\b/;

function cueHasExplicitFlow(sentence) {
  const text = normalize(sentence);
  if (/\b(?:nao|nunca|sem)\b/.test(text)) return false;
  return FLOW_PATTERN.test(text) || INFINITIVE_FLOW.test(text);
}

// A connection is shown only when both labels and the relation are explicitly
// present in this spoken sentence. It must not invent direction or causality.
function narrativeBeatRelation({ sentence, objects }) {
  const text = normalize(sentence);
  if (/\b(?:nao|nunca|sem)\b/.test(text)) return null;
  let kind = null;
  if (/\b(?:bidirecional|reciproca|reciproco|mutuamente|mutua|mutuo)\b|mao dupla/.test(text)) kind = 'bidirectional';
  else if (/\b(?:versus|comparacao|comparado|comparada)\b|\b(?:mais|menos|maior|menor)\b.{0,80}\b(?:que|do que)\b/.test(text)) kind = 'comparison';
  const supported = (Array.isArray(objects) ? objects : []).filter(object => {
    const label = normalize(object?.label);
    return object?.id && label.length >= 3 && text.includes(label);
  });
  for (let i = 0; i < supported.length; i++) {
    for (let j = i + 1; j < supported.length; j++) {
      const a = normalize(supported[i].label), b = normalize(supported[j].label);
      if (a !== b && !a.includes(b) && !b.includes(a)) {
        if (kind === 'bidirectional') return { kind, objectIds: [supported[i].id, supported[j].id] };
        // Only draw a directional process when the actual words explicitly
        // connect both named objects. Negated sentences are left unlinked.
        const aAt = text.indexOf(a), bAt = text.indexOf(b);
        const from = aAt < bAt ? supported[i] : supported[j];
        const to = aAt < bAt ? supported[j] : supported[i];
        const left = aAt < bAt ? a : b, leftAt = Math.min(aAt, bAt), rightAt = Math.max(aAt, bAt);
        const between = text.slice(leftAt + left.length, rightAt);
        if (/[;.!?]/.test(between)) continue;
        if (kind === 'comparison' && (/\b(?:versus|comparad[ao])\b|\b(?:mais|menos|maior|menor)\b[^.!?;]{0,80}\b(?:que|do que)\b/.test(between)
          || /\bcomparacao\s+entre\s*$/.test(text.slice(Math.max(0, leftAt - 32), leftAt)))) {
          return { kind, objectIds: [supported[i].id, supported[j].id] };
        }
        const prefix = text.slice(Math.max(0, leftAt - 30), leftAt);
        const infinitive = prefix.match(/\b(transformar|converter|dividir)\s*$/);
        if (infinitive && /^\s*em\s+(?:(?:o|a|os|as|um|uma|novas|novos)\s+){0,3}$/.test(between)) {
          return { kind: 'flow', objectIds: [from.id, to.id], trigger: infinitive[1],
            ...(/\b(?:se|caso)\b/.test(text.slice(0, leftAt)) ? { conditional: true } : {}) };
        }
        const match = between.match(FLOW_PATTERN);
        if (match) {
          const intervening = supported.filter(object => object.id !== from.id && object.id !== to.id)
            .map(object => normalize(object.label));
          const beforeVerb = between.slice(0, match.index);
          const afterLink = between.slice(match.index + match[0].length);
          if (!/^\s*(?:(?:e|sao|foi|foram|sera|serao|esta|estao|sendo|ja)\s+){0,3}$/.test(beforeVerb)
            || !/^\s*(?:(?:o|a|os|as|um|uma|ao|aos|da|do|de)\s+){0,3}$/.test(afterLink)) continue;
          if (intervening.some(label => beforeVerb.includes(label) || afterLink.includes(label))) continue;
          const trigger = (match[0].match(/transforma\w*|transformou|converte\w*|substituid\w*|trocad\w*|convertid\w*|dividid\w*|segue\w*|viaja\w*|vai|vao|flui|trafega|envia\w*|encaminha\w*|manda\w*/) || [])[0];
          return { kind: 'flow', objectIds: [from.id, to.id], trigger,
            ...(/\b(?:se|caso)\b/.test(text.slice(0, leftAt)) ? { conditional: true } : {}) };
        }
      }
    }
  }
  return null;
}

// A causal arrow is allowed only when the two named concepts are directly
// joined by an explicit causal verb. Conditional framing stays visible.
function narrativeCauseRelation({ sentence, objects }) {
  const text = normalize(sentence);
  if (/\b(?:nao|nunca|sem|pode|podem|poderia|poderiam)\b/.test(text)) return null;
  const supported = (Array.isArray(objects) ? objects : []).filter(object => object?.id && normalize(object.label).length >= 3 && text.includes(normalize(object.label)));
  for (const from of supported) for (const to of supported) {
    if (from.id === to.id) continue;
    const first = normalize(from.label), second = normalize(to.label);
    if (first === second || first.includes(second) || second.includes(first)) continue;
    const start = text.indexOf(first), end = text.indexOf(second);
    if (start < 0 || end <= start) continue;
    const between = text.slice(start + first.length, end);
    const match = between.match(/^\s*(causa|causam|provoca|provocam|dispara|disparam|gera|geram)\s+(?:(?:o|a|os|as|um|uma)\s+){0,2}$/);
    if (match) return { kind: 'cause', objectIds: [from.id, to.id], trigger: match[1],
      ...(/\b(?:se|caso)\b/.test(text.slice(0, start)) ? { conditional: true } : {}) };
  }
  return null;
}

function narrativeAlternativeRelation({ sentence, objects }) {
  const text = normalize(sentence);
  if (/\b(?:nao|nunca|sem)\b/.test(text)) return null;
  const supported = (Array.isArray(objects) ? objects : []).filter(object => object?.id && normalize(object.label).length >= 3 && text.includes(normalize(object.label)));
  for (const from of supported) for (const to of supported) {
    if (from.id === to.id) continue;
    const first = normalize(from.label), second = normalize(to.label);
    if (first === second || first.includes(second) || second.includes(first)) continue;
    const start = text.indexOf(first), end = text.indexOf(second);
    if (start < 0 || end <= start) continue;
    const between = text.slice(start + first.length, end);
    if (/^\s+ou\s+(?:(?:o|a|os|as|um|uma)\s+)?$/.test(between)) return { objectIds: [from.id, to.id], trigger: 'ou' };
  }
  return null;
}

module.exports = { cueHasExplicitFlow, narrativeBeatRelation, narrativeCauseRelation, narrativeAlternativeRelation };
