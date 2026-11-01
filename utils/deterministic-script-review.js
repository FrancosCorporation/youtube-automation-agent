'use strict';

const crypto = require('node:crypto');
const { decodeHtmlEntities } = require('./article-context');

const VERIFIER_ID = 'deterministic-source-evidence-v1';
const MIN_QUOTE_WORDS = 4;
const MAX_QUOTE_WORDS = 80;
const PORTUGUESE_MARKERS = new Set(['a', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'na', 'nas', 'no', 'nos', 'o', 'os', 'para', 'por', 'que', 'uma', 'um']);
const ENGLISH_MARKERS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'for', 'from', 'in', 'is', 'of', 'on', 'that', 'the', 'to', 'was', 'were', 'with']);
const SHORT_CONTENT_TOKENS = new Set(['ai', 'ia', 'ml', '3d', '5g']);
const STOP_WORDS = new Set([
  ...PORTUGUESE_MARKERS, ...ENGLISH_MARKERS,
  'ao', 'aos', 'ela', 'ele', 'elas', 'eles', 'isso', 'essa', 'esse', 'esta', 'este', 'foi', 'ser', 'são', 'sua', 'seu', 'suas', 'seus', 'também', 'tem', 'ter', 'themselves', 'their', 'they', 'this', 'these', 'those', 'will', 'would', 'you', 'your'
]);
const PORTUGUESE_NEGATION_PATTERN = /(?<![\p{L}\p{N}])(?:n[aã]o|nunca|sem|nenhum(?:a|as|os)?|nada|zero)(?![\p{L}\p{N}])/iu;
const ENGLISH_NEGATION_PATTERN = /\b(?:not|never|without|neither|nor|no|none|nothing|zero|cannot|unanswered|(?:can|couldn|don|doesn|didn|isn|aren|wasn|weren|hasn|haven|hadn|wouldn|shouldn|mustn)['’]t)\b/i;
const UNCERTAINTY_PATTERN = /(?<![\p{L}\p{N}])(?:pode(?:m)?|podia(?:m)?|poderia(?:m)?|poder[aá]|poder[aã]o|possa(?:m)?|pudesse(?:m)?|consegue(?:m)?|talvez|poss[ií]vel|possibilidade(?:s)?|possivelmente|sugere(?:m)?|sugeriu|sugeriram|indica(?:m)?|indicou|indicaram|aparentemente|can|cannot|can['’]t|could|couldn['’]t|may|might|possibly|possible|suggest(?:s|ed|ing)?|indicat(?:e|es|ed|ing)|appears?)(?![\p{L}\p{N}])/iu;
const CAUSALITY_PATTERN = /\b(?:caus\w*|provoc\w*|levou a|levar a|resultou em|resultar em|devido a|por causa de|porque|impulsion\w*|caused?|led to|resulted in|due to|because|driven by)\b/i;
const QUANTITY_UNITS = Object.freeze([
  ['unit:percent', /%|\bpercent(?:age)?\b|\bpor cento\b|\bpontos? percentuais?\b/giu],
  ['scale:thousand', /\bthousands?\b|\bmilhares?\b|\bmil\b/giu],
  ['scale:million', /\bmillions?\b|\bmilh(?:ao|oes)\b/giu],
  ['scale:billion', /\bbillions?\b|\bbilh(?:ao|oes)\b/giu],
  ['scale:trillion', /\btrillions?\b|\btrilh(?:ao|oes)\b/giu],
  ['currency:usd', /us\$|\busd\b|\bdollars?\b|\bdolares?\b/giu],
  ['currency:brl', /r\$|\bbrl\b|\breais?\b/giu],
  ['currency:eur', /€|\beur\b|\beuros?\b/giu],
  ['currency:gbp', /£|\bgbp\b|\bpounds?\b/giu],
  ['unit:byte', /\bkibibytes?\b|\bmebibytes?\b|\bgibibytes?\b|\btebibytes?\b|\bkilobytes?\b|\bmegabytes?\b|\bgigabytes?\b|\bterabytes?\b|\bbytes?\b|\bkib\b|\bmib\b|\bgib\b|\btib\b|\bkb\b|\bmb\b|\bgb\b|\btb\b/giu],
  ['unit:bit', /\bkilobits?\b|\bmegabits?\b|\bgigabits?\b|\bterabits?\b|\bbits?\b|\bkbit\b|\bmbit\b|\bgbit\b|\btbit\b/giu],
  ['unit:time-second', /\bseconds?\b|\bsegundos?\b/giu],
  ['unit:time-minute', /\bminutes?\b|\bminutos?\b/giu],
  ['unit:time-hour', /\bhours?\b|\bhoras?\b/giu],
  ['unit:time-day', /\bdays?\b|\bdias?\b/giu],
  ['unit:time-week', /\bweeks?\b|\bsemanas?\b/giu],
  ['unit:time-month', /\bmonths?\b|\bmeses?\b/giu],
  ['unit:time-year', /\byears?\b|\banos?\b/giu],
  ['unit:length-mm', /\bmillimeters?\b|\bmilimetros?\b/giu],
  ['unit:length-cm', /\bcentimeters?\b|\bcentimetros?\b/giu],
  ['unit:length-km', /\bkilometers?\b|\bquilometros?\b|\bkm\b/giu],
  ['unit:length-meter', /\bmeters?\b|\bmetros?\b/giu],
  ['unit:length-mile', /\bmiles?\b|\bmilhas?\b/giu],
  ['unit:length-foot', /\bfeet\b|\bfoot\b|\bpes\b/giu],
  ['unit:length-inch', /\binches?\b|\bpolegadas?\b/giu],
  ['unit:mass-kg', /\bkilograms?\b|\bquilos?\b|\bkg\b/giu],
  ['unit:mass-gram', /\bgrams?\b|\bgramas?\b/giu],
  ['unit:mass-pound', /\bpounds?\b|\blibras?\b/giu],
  ['unit:temperature-c', /\bcelsius\b/giu],
  ['unit:temperature-f', /\bfahrenheit\b/giu],
  ['unit:area', /\bsquare (?:kilometers?|meters?)\b|\bquilometros? quadrados?\b|\bmetros? quadrados?\b|\bkm2\b|\bm2\b/giu],
  ['unit:volume-liter', /\bliters?\b|\blitres?\b|\blitros?\b/giu],
  ['unit:volume-gallon', /\bgallons?\b|\bgaloes?\b/giu]
]);
const DIRECTION_GROUPS = Object.freeze([
  /\b(?:aument\w*|cresci\w*|alta|subiu|subiram|maior|largest|larger|increase[ds]?|grew|growth|rose|higher|up)\b/i,
  /\b(?:diminu\w*|redu\w*|queda|caiu|ca[ií]ram|menor|smallest|smaller|decrease[ds]?|declin\w*|fell|lower|down)\b/i
]);

const PORTUGUESE_HTML_ENTITIES = Object.freeze({
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', auml: 'ä',
  ccedil: 'ç', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï', ntilde: 'ñ',
  oacute: 'ó', ograve: 'ò', ocirc: 'ô', otilde: 'õ', ouml: 'ö',
  uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü', yacute: 'ý', yuml: 'ÿ'
});

function decodeEvidenceEntities(value) {
  return decodeHtmlEntities(value).replace(/&([a-z][\da-z]{1,31});/gi,
    (match, entity) => PORTUGUESE_HTML_ENTITIES[entity.toLowerCase()] || match);
}

function normalizeEvidenceText(value) {
  return decodeEvidenceEntities(String(value || '')).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}%$€£]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function splitSentences(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter('pt-BR', { granularity: 'sentence' }).segment(text)]
      .map(item => item.segment.trim()).filter(Boolean);
  }
  return text.split(/(?<=[.!?])\s+/).map(sentence => sentence.trim()).filter(Boolean);
}

function scriptClaims(script) {
  const claims = [];
  const add = (basePath, value, split) => {
    const parts = split ? splitSentences(value) : [String(value || '').trim()].filter(Boolean);
    for (const [index, claim] of parts.entries()) {
      claims.push({ path: split ? `${basePath}#${index + 1}` : basePath, claim });
    }
  };
  add('title', script?.title, false);
  add('hook', script?.hook?.text || script?.hook, true);
  const sections = Array.isArray(script?.sections) ? script.sections : script?.mainContent?.sections || [];
  sections.forEach((section, index) => {
    add(`sections.${index}.title`, section?.title, false);
    add(`sections.${index}.content`, section?.content, true);
  });
  const conclusion = typeof script?.conclusion === 'string'
    ? script.conclusion : script?.conclusion?.finalThought;
  add('conclusion', conclusion, true);
  return claims;
}

function detectLanguage(value) {
  const words = normalizeEvidenceText(value).split(' ');
  const portugueseScore = words.filter(word => PORTUGUESE_MARKERS.has(word)).length;
  const englishScore = words.filter(word => ENGLISH_MARKERS.has(word)).length;
  if (portugueseScore >= englishScore + 2) return 'pt';
  if (englishScore >= portugueseScore + 2) return 'en';
  return 'unknown';
}

function contentTokens(value) {
  return [...new Set(normalizeEvidenceText(value).split(' ').filter(word =>
    (word.length >= 3 || SHORT_CONTENT_TOKENS.has(word))
      && !STOP_WORDS.has(word) && !/^\d+(?:[.,]\d+)*$/.test(word)))];
}

function hashtagIsGrounded(tag, sourceWords) {
  const phrase = normalizeEvidenceText(tag).replace(/\s+/g, '');
  if (!phrase) return false;
  const words = [...new Set(sourceWords.filter(word => word.length > 1))];
  const reachable = new Array(phrase.length + 1).fill(false);
  reachable[0] = true;
  for (let offset = 0; offset < phrase.length; offset++) {
    if (!reachable[offset]) continue;
    for (const word of words) {
      if (phrase.startsWith(word, offset)) reachable[offset + word.length] = true;
    }
  }
  return reachable[phrase.length];
}

function feedbackForEvidenceErrors(errors) {
  const guidance = {
    claim_evidence_missing: 'selecione um sourceId do catálogo da fonte para cada fala sem evidência',
    source_id_unknown: 'use somente sourceIds existentes no catálogo da fonte',
    source_ids_not_contiguous: 'use um único sourceId ou IDs consecutivos do catálogo',
    source_reference_length_invalid: 'use um sourceId do catálogo com 4 a 80 palavras',
    source_id_missing: 'selecione ao menos um sourceId existente para cada fala',
    quote_not_in_source: 'substitua a citação por um trecho copiado literalmente da fonte',
    quote_length_out_of_range: 'use uma citação de 4 a 80 palavras',
    claim_number_not_in_quote: 'corrija/remova o número ou cite o trecho que o sustenta',
    claim_unit_not_in_quote: 'preserve a unidade e a escala da medida exatamente como aparecem na fonte',
    claim_words_not_in_quote: 'reformule a fala usando no mínimo metade (até quatro) das palavras de conteúdo distintas da citação; prefira os termos da fonte a sinônimos',
    source_quote_outside_reference: 'sourceQuote deve copiar 4–80 palavras consecutivas dos sourceIds escolhidos; não invente citação nem use trecho de outro ID',
    source_quote_not_complete_clause: 'sourceQuote deve manter a sentença completa citada ou a oração inicial antes de um propósito explícito (para testar/avaliar/medir/investigar, to test/evaluate/measure/investigate); não recorte negação, condição, incerteza nem escala',
    claim_negation_not_preserved: 'mantenha explícitas na mesma fala a negação e a condição da citação (por exemplo, "não há novidades"); não as retire nem generalize',
    script_language_mismatch: 'reescreva todo o texto editorial em português do Brasil',
    claim_uncertainty_not_preserved: 'mantenha explícita a incerteza indicada pela fonte',
    claim_causality_not_in_quote: 'remova a relação causal que a citação não declara',
    claim_direction_conflicts_with_quote: 'corrija o sentido de alta/queda para corresponder à fonte',
    claim_replacement_attribute_conflict: 'distinga o item antigo do substituto mais eficiente; não atribua ao item antigo a característica do substituto',
    claim_future_quantity_as_completed: 'mantenha o prazo futuro da quantidade citada; não apresente previsão como resultado realizado',
    claim_quote_attribution_missing: 'atribua explicitamente a fala em primeira pessoa à pessoa citada ou parafraseie em terceira pessoa',
    duplicate_claim_evidence_path: 'mantenha uma única citação por caminho',
    unexpected_claim_evidence_path: 'use apenas os caminhos do roteiro pedidos no prompt',
    source_context_too_short: 'remova a alegação ou aguarde uma fonte com contexto suficiente'
  };
  const details = errors.slice(0, 12).map(error =>
    `${error.path}:${guidance[error.code] || error.code}`);
  return `Corrija as falas e o mapa claimEvidence sem acrescentar fatos. ${details.join('; ')}.`;
}

function numberTokens(value) {
  return String(value || '').match(/\d+(?:[.,]\d+)*/g) || [];
}

function equivalentNumber(left, right) {
  const parse = value => {
    const text = String(value);
    if (text.includes('.') && text.includes(',')) {
      const decimal = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ',';
      const integerPart = text.slice(0, text.lastIndexOf(decimal)).replace(/[.,]/g, '');
      const fraction = text.slice(text.lastIndexOf(decimal) + 1);
      return `${integerPart}.${fraction}`;
    }
    if (text.includes(',')) {
      const [integerPart, fraction] = text.split(',');
      return fraction?.length === 3 ? `${integerPart}${fraction}` : `${integerPart}.${fraction || ''}`;
    }
    if (text.includes('.')) {
      const [integerPart, fraction] = text.split('.');
      return fraction?.length === 3 ? `${integerPart}${fraction}` : `${integerPart}.${fraction || ''}`;
    }
    return text;
  };
  return parse(left) === parse(right);
}

function quantityUnitClasses(text, start, end, nextNumberStart = text.length) {
  // Units follow the number in most editorial text. Only currency symbols may
  // precede it; cap the suffix before the next number to keep quantities apart.
  const suffix = normalizeEvidenceText(text.slice(start, Math.min(text.length, end + 52, nextNumberStart)));
  const prefix = normalizeEvidenceText(text.slice(Math.max(0, start - 8), start));
  const units = new Set();
  for (const [unit, pattern] of QUANTITY_UNITS) {
    pattern.lastIndex = 0;
    const inPrefix = unit.startsWith('currency:') && pattern.test(prefix);
    pattern.lastIndex = 0;
    if (inPrefix || pattern.test(suffix)) units.add(unit);
  }
  return units;
}

function numberOccurrences(text) {
  const value = String(text || '');
  const matches = [...value.matchAll(/\d+(?:[.,]\d+)*/g)];
  return matches.map((match, index) => {
    const end = match.index + match[0].length;
    return {
      value: match[0], start: match.index, end,
      units: quantityUnitClasses(value, match.index, end, matches[index + 1]?.index ?? value.length)
    };
  });
}

function hasNumberSupport(claim, quote) {
  const citedNumbers = numberOccurrences(quote);
  return numberOccurrences(claim).every(number => citedNumbers.some(cited => equivalentNumber(number.value, cited.value)));
}

function hasClaimUnitSupport(claim, quote) {
  const citedNumbers = numberOccurrences(quote);
  return numberOccurrences(claim).every(number => {
    if (!number.units.size) return true;
    return citedNumbers.some(cited => equivalentNumber(number.value, cited.value)
      && [...number.units].every(unit => cited.units.has(unit)));
  });
}

function hasNegation(text, language) {
  const decoded = decodeEvidenceEntities(text);
  if (language === 'pt') return PORTUGUESE_NEGATION_PATTERN.test(decoded);
  if (language === 'en') return ENGLISH_NEGATION_PATTERN.test(decoded);
  // In an ambiguous or very short Portuguese phrase, "no" is often the
  // contraction of "em + o" (for example, "no relatório"), not English negation.
  return PORTUGUESE_NEGATION_PATTERN.test(decoded)
    || /\b(?:not|never|without|neither|nor|none|nothing|zero)\b/i.test(decoded);
}

// Catch the specific, high-risk inversion in replacement stories: the
// comparative property belongs to the replacement, not to the old item.
// This is deliberately narrow; it is not a general semantic verifier.
function replacementAttributeConflict(claim, quote) {
  const spoken = normalizeEvidenceText(claim);
  const evidence = normalizeEvidenceText(quote);
  const oldThenEfficient = /\b(?:antig[oa]s?|velh[oa]s?)\s+e\s+eficientes?\b/;
  const replacementMoreEfficient = /\b(?:antig[oa]s?|velh[oa]s?)\s+(?:por|para)\s+(?:(?:\p{L}+\s+){0,4})mais\s+eficientes?\b/u;
  return oldThenEfficient.test(spoken) && replacementMoreEfficient.test(evidence);
}

function futureQuantityAsCompleted(claim, quote) {
  const spoken = normalizeEvidenceText(claim);
  const evidence = normalizeEvidenceText(quote);
  const future = /\b(?:sera|serao|recebera|receberao|chegara|chegarao|atingira|atingirao|preve|previstos?|previstas?|previsto|prevista)\b/;
  const quantityIsFuture = (text, occurrence) => future.test(text.slice(Math.max(0, occurrence.start - 55), occurrence.start));
  return numberOccurrences(spoken).some(number => {
    const cited = numberOccurrences(evidence).filter(item => equivalentNumber(number.value, item.value));
    return cited.length > 0 && cited.every(item => quantityIsFuture(evidence, item)) && !quantityIsFuture(spoken, number);
  });
}

function unattributedFirstPersonQuote(claim, quote) {
  const spoken = normalizeEvidenceText(claim);
  if (!/^[\s“"‘']/.test(String(quote))) return false;
  const firstPerson = /\b(?:minha|minhas|meu|meus|estou|estamos|agradeco|conseguiria|consegui)\b/;
  const attribution = /\b(?:disse|afirmou|relatou|declarou|contou|explicou|segundo)\b/;
  return firstPerson.test(spoken) && !attribution.test(spoken);
}

function quoteCoverageIssues({ claim, quote, source, sourceLanguage }) {
  const issues = [];
  const normalizedQuote = normalizeEvidenceText(quote);
  if (!normalizedQuote || !normalizeEvidenceText(source).includes(normalizedQuote)) {
    issues.push('quote_not_in_source');
    return issues;
  }
  const quoteWordCount = normalizedQuote.split(' ').filter(Boolean).length;
  if (quoteWordCount < MIN_QUOTE_WORDS || quoteWordCount > MAX_QUOTE_WORDS) issues.push('quote_length_out_of_range');
  if (!hasNumberSupport(claim, quote)) issues.push('claim_number_not_in_quote');
  if (!hasClaimUnitSupport(claim, quote)) issues.push('claim_unit_not_in_quote');
  const claimLanguage = detectLanguage(claim);
  const quoteLanguage = sourceLanguage === 'unknown' ? detectLanguage(quote) : sourceLanguage;
  if (hasNegation(claim, claimLanguage) !== hasNegation(quote, quoteLanguage)) {
    issues.push('claim_negation_not_preserved');
  }
  const decodedClaim = decodeEvidenceEntities(claim);
  const decodedQuote = decodeEvidenceEntities(quote);
  if (UNCERTAINTY_PATTERN.test(decodedClaim) !== UNCERTAINTY_PATTERN.test(decodedQuote)) issues.push('claim_uncertainty_not_preserved');
  if (CAUSALITY_PATTERN.test(decodedClaim) && !CAUSALITY_PATTERN.test(decodedQuote)) issues.push('claim_causality_not_in_quote');
  if (replacementAttributeConflict(claim, quote)) issues.push('claim_replacement_attribute_conflict');
  if (futureQuantityAsCompleted(claim, quote)) issues.push('claim_future_quantity_as_completed');
  if (unattributedFirstPersonQuote(claim, quote)) issues.push('claim_quote_attribution_missing');
  const claimDirections = DIRECTION_GROUPS.map(pattern => pattern.test(decodedClaim));
  const quoteDirections = DIRECTION_GROUPS.map(pattern => pattern.test(decodedQuote));
  if ((claimDirections[0] && quoteDirections[1] && !quoteDirections[0])
      || (claimDirections[1] && quoteDirections[0] && !quoteDirections[1])) {
    issues.push('claim_direction_conflicts_with_quote');
  }
  if (sourceLanguage !== 'unknown' && sourceLanguage === claimLanguage) {
    const tokens = contentTokens(claim);
    const quoteTokens = new Set(contentTokens(quote));
    const overlap = tokens.filter(token => quoteTokens.has(token)).length;
    const required = Math.min(4, Math.ceil(tokens.length / 2));
    if (tokens.length >= 2 && overlap < required) issues.push('claim_words_not_in_quote');
  }
  return issues;
}

function verifyScriptEvidence(script, sourceContext, { checkedAt = new Date().toISOString() } = {}) {
  const source = String(sourceContext || '').replace(/\s+/g, ' ').trim();
  const sourceHash = crypto.createHash('sha256').update(source).digest('hex');
  const claims = scriptClaims(script);
  const evidence = Array.isArray(script?.claimEvidence) ? script.claimEvidence : [];
  const expected = new Map(claims.map(item => [item.path, item.claim]));
  const seen = new Set();
  const errors = [];
  const sourceLanguage = detectLanguage(source);

  if (!source || source.length < 300) errors.push({ path: '$source', code: 'source_context_too_short' });
  if (!claims.length) errors.push({ path: '$script', code: 'script_claims_missing' });
  for (const item of evidence) {
    const evidencePath = String(item?.path || '');
    if (!expected.has(evidencePath)) {
      errors.push({ path: evidencePath || '$evidence', code: 'unexpected_claim_evidence_path' });
      continue;
    }
    if (seen.has(evidencePath)) {
      errors.push({ path: evidencePath, code: 'duplicate_claim_evidence_path' });
      continue;
    }
    seen.add(evidencePath);
    const claim = expected.get(evidencePath);
    const quote = String(item?.quote || '').replace(/\s+/g, ' ').trim();
    if (!quote) {
      errors.push({ path: evidencePath, code: 'source_quote_missing' });
      continue;
    }
    for (const code of quoteCoverageIssues({ claim, quote, source, sourceLanguage })) {
      errors.push({ path: evidencePath, code });
    }
  }
  for (const claim of claims) {
    if (!seen.has(claim.path)) errors.push({ path: claim.path, code: 'claim_evidence_missing' });
  }

  const uniqueErrors = [...new Map(errors.map(error => [`${error.path}:${error.code}`, error])).values()];
  const approved = uniqueErrors.length === 0;
  return {
    schemaVersion: 1,
    verifier: VERIFIER_ID,
    status: approved ? 'approved' : 'rejected',
    verdict: approved ? 'aprovado' : 'reprovado',
    reviewer: VERIFIER_ID,
    checkedAt,
    sourceHash,
    claimCount: claims.length,
    evidenceCount: evidence.length,
    errors: uniqueErrors,
    feedback: approved ? '' : feedbackForEvidenceErrors(uniqueErrors)
  };
}

function verifyEditorialMetadata(metadata, script) {
  const errors = [];
  const scriptText = [script?.title, script?.hook,
    ...(script?.sections || script?.mainContent?.sections || []).flatMap(section => [section?.title, section?.content]),
    typeof script?.conclusion === 'string' ? script.conclusion : script?.conclusion?.finalThought
  ].filter(Boolean).join(' ');
  const supportedTokens = new Set(contentTokens(scriptText));
  const supportedWords = normalizeEvidenceText(scriptText).split(' ').filter(Boolean);
  const genericEditorialTokens = new Set([
    'acompanhe', 'aprenda', 'assista', 'canal', 'conteudo', 'descubra', 'entenda', 'episodio',
    'inscreva', 'inscricao', 'saiba', 'video', 'veja'
  ]);
  for (const field of ['youtubeTitle', 'thumbnailHeadline', 'description', 'hashtags']) {
    const value = String(metadata?.[field] || '').trim();
    if (!value) {
      if (field === 'youtubeTitle' || field === 'description') errors.push({ field, code: 'metadata_missing' });
      continue;
    }
    const unsupportedNumbers = numberTokens(value).filter(number => !numberTokens(scriptText).some(candidate => equivalentNumber(number, candidate)));
    if (unsupportedNumbers.length) errors.push({ field, code: 'metadata_number_not_in_script' });
    const terms = contentTokens(value);
    const unsupported = terms.filter(term => !supportedTokens.has(term)
      && (field !== 'description' || !genericEditorialTokens.has(term)));
    if ((field === 'thumbnailHeadline' || field === 'youtubeTitle') && unsupported.length) {
      errors.push({ field, code: field === 'thumbnailHeadline' ? 'thumbnail_term_not_in_script' : 'title_not_grounded_in_script' });
    }
    if (field === 'description' && unsupported.length) {
      errors.push({ field, code: 'description_term_not_in_script' });
    }
    if (field === 'hashtags') {
      const tags = value.match(/#[\p{L}\p{N}_]+/gu) || [];
      if (tags.length !== 3 || tags.some(tag => !hashtagIsGrounded(tag, supportedWords))) {
        errors.push({ field, code: 'hashtag_term_not_in_script' });
      }
    }
    if (field === 'thumbnailHeadline' && terms.length > 5) {
      errors.push({ field, code: 'thumbnail_term_not_in_script' });
    }
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  VERIFIER_ID, contentTokens, detectLanguage, feedbackForEvidenceErrors, normalizeEvidenceText,
  scriptClaims, splitSentences, verifyEditorialMetadata, verifyScriptEvidence
};
