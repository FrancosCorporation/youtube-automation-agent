'use strict';

const { VISUAL_DESIGN_TOKENS, thumbnailCssTokens } = require('./visual-design-tokens');
const { buildThumbnailFallbackArt } = require('./thumbnail-fallback-art');

const THUMBNAIL_CANVAS = Object.freeze({
  width: VISUAL_DESIGN_TOKENS.thumbnail.width,
  height: VISUAL_DESIGN_TOKENS.thumbnail.height
});
const THUMBNAIL_RENDER_POLICY = Object.freeze({
  initialFontSize: VISUAL_DESIGN_TOKENS.typography.coverHeadlineSize,
  minimumFontSize: VISUAL_DESIGN_TOKENS.typography.coverHeadlineMinimumSize,
  maximumTextHeight: VISUAL_DESIGN_TOKENS.typography.coverHeadlineMaximumHeight,
  maximumTextWidth: VISUAL_DESIGN_TOKENS.thumbnail.contentWidth
});
const PORTRAIT_THUMBNAIL_CANVAS = Object.freeze({ width: 1080, height: 1920 });
const PORTRAIT_THUMBNAIL_RENDER_POLICY = Object.freeze({
  initialFontSize: 112,
  minimumFontSize: 72,
  maximumTextHeight: 385,
  maximumTextWidth: 910
});

const HEADLINE_STOP_WORDS = new Set([
  'a', 'as', 'ao', 'aos', 'apos', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'entre',
  'na', 'nas', 'no', 'nos', 'o', 'os', 'para', 'pela', 'pelas', 'pelo', 'pelos', 'por', 'que', 'um', 'uma', 'uns', 'umas', 'mas', 'esta', 'este',
  'seu', 'sua', 'seus', 'suas', 'nesta', 'neste', 'novo', 'nova', 'novos', 'novas'
]);
const HEADLINE_CONNECTORS = new Set([
  'a', 'as', 'ao', 'aos', 'apos', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'entre',
  'na', 'nas', 'no', 'nos', 'o', 'os', 'ou', 'para', 'pela', 'pelas', 'pelo', 'pelos', 'por',
  'que', 'mas', 'um', 'uma', 'uns', 'umas'
]);
const HEADLINE_MODIFIERS = new Set(['novo', 'nova', 'novos', 'novas']);
const WEEKDAY_NAMES = new Set(['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo']);
const DATE_PREFIX_WORDS = new Set(['a', 'ao', 'de', 'em', 'na', 'no', 'nesta', 'neste', 'esta', 'este', 'para', 'proxima', 'proximo']);
const QUALIFICATION_WORDS = new Set([
  'nao', 'nunca', 'nem', 'sem',
  'apenas', 'somente', 'so',
  'pode', 'podem', 'poderia', 'poderiam', 'podera', 'poderao', 'talvez', 'possivel', 'possivelmente',
  'suposto', 'suposta', 'supostamente', 'alegadamente', 'aparentemente',
  'avalia', 'avaliam', 'avaliou', 'avaliaram', 'considera', 'consideram', 'considerou',
  'estuda', 'estudam', 'estudou', 'planeja', 'planejam', 'pretende', 'pretendem',
  'cogita', 'cogitam', 'deve', 'devem', 'deveria', 'deveriam', 'preve', 'preveem'
]);
const LOW_SIGNAL_WORDS = new Set([
  'ciencia', 'comportamento', 'definitivo', 'deixa', 'deixam', 'deixar', 'detalhe',
  'descobriu', 'ensinar', 'entra', 'explica', 'explicam', 'fica', 'ficam', 'fora', 'funciona',
  'funcionar', 'funcionaria', 'guia', 'saiba', 'veja', 'voce', 'pedem', 'cientistas'
]);
const INCOMPLETE_HEADLINE_ENDINGS = new Set([
  'ser', 'estar', 'ter', 'haver', 'dever', 'poder', 'ir',
  'deve', 'devem', 'deveria', 'deveriam', 'pode', 'podem', 'poderia', 'poderiam',
  'vai', 'vao', 'ira', 'irao', 'sera', 'serao', 'esta', 'estao', 'estava', 'estavam', 'apenas', 'realmente',
  'lancamento', 'anuncio'
]);

function normalizedWords(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
}

function thumbnailWordTokens(value) {
  return String(value || '').match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || [];
}

function thumbnailHeadlineError() {
  const error = new Error('thumbnail_headline_constraints_unmet');
  error.code = 'thumbnail_headline_constraints_unmet';
  return error;
}

function headlineWords(value) {
  return normalizedWords(value).filter(word => !HEADLINE_STOP_WORDS.has(word));
}

function requiredHeadlineQualifications(primaryTitle) {
  const required = new Set(normalizedWords(primaryTitle).filter(word => QUALIFICATION_WORDS.has(word)));
  // In a short cover fragment, “não apenas X” retains the source's scope and
  // negation without carrying the auxiliary “deve ser” from a longer clause.
  if (required.has('nao') && required.has('apenas') && required.has('deve')) required.delete('deve');
  return required;
}

function hasIncompleteHeadlineEnding(value) {
  const words = normalizedWords(value);
  const last = words.at(-1);
  return INCOMPLETE_HEADLINE_ENDINGS.has(last) || ['nao', 'nunca', 'nem'].includes(last);
}

function numericQuantities(value) {
  return [...String(value || '').matchAll(/(?:R\$\s*)?\d+(?:[.,]\d+)*(?:\s*(?:milh(?:ão|ões)|bilh(?:ão|ões)|trilh(?:ão|ões)|mil|%)(?!\p{L}))?/giu)]
    .map(match => match[0].toLocaleLowerCase('pt-BR').replace(/\s+/g, ''));
}

function isGroundedThumbnailHeadline(candidate, sourceText, primaryTitle = '') {
  const headline = String(candidate || '').trim();
  const wordCount = thumbnailWordTokens(headline).length;
  const words = headlineWords(headline);
  if (!headline || headline.length > 34 || wordCount < 2 || wordCount > 5) return false;
  if (hasIncompleteHeadlineEnding(headline)) return false;
  // Tokenizing currency as words used to turn “R$ 2,5 milhões” into “R 2”.
  // Preserve the whole decimal, currency and magnitude instead of rewarding a
  // clipped number when the fallback searches for a shorter phrase.
  const titleQuantities = numericQuantities(primaryTitle);
  const sourceQuantities = titleQuantities.length ? titleQuantities : numericQuantities(sourceText);
  if (numericQuantities(headline).some(quantity => !sourceQuantities.includes(quantity))) return false;

  const sourceWords = headlineWords(sourceText);
  let sourceIndex = 0;
  for (const word of words) {
    const nextIndex = sourceWords.indexOf(word, sourceIndex);
    if (nextIndex < 0) return false;
    sourceIndex = nextIndex + 1;
  }

  const sourceQualifications = requiredHeadlineQualifications(primaryTitle);
  const headlineQualifications = new Set(normalizedWords(headline).filter(word => QUALIFICATION_WORDS.has(word)));
  if (![...sourceQualifications].every(word => headlineQualifications.has(word))) return false;
  const questionAt = String(primaryTitle).indexOf('?');
  const clauseAt = String(primaryTitle).lastIndexOf(':', questionAt);
  if (questionAt >= 0 && clauseAt >= 0) {
    const actualQuestion = headlineWords(String(primaryTitle).slice(clauseAt + 1, questionAt));
    if (actualQuestion.length && !actualQuestion.some(word => words.includes(word))) return false;
  }
  return !String(primaryTitle).includes('?') || headline.endsWith('?');
}

function restoreSourceConnectors(candidate, primaryTitle) {
  const headline = String(candidate || '').trim();
  const tokens = headline.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || [];
  const sourceTokens = String(primaryTitle || '').match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || [];
  if (tokens.length < 2 || sourceTokens.length < tokens.length) return headline;

  const positions = [];
  let sourceIndex = 0;
  for (const token of tokens) {
    const normalized = normalizedWords(token)[0];
    const index = sourceTokens.findIndex((word, candidateIndex) => candidateIndex >= sourceIndex
      && normalizedWords(word)[0] === normalized);
    if (index < 0) return headline;
    positions.push(index);
    sourceIndex = index + 1;
  }

  const uppercase = headline === headline.toLocaleUpperCase('pt-BR');
  const restored = [tokens[0]];
  let addedConnector = false;
  for (let index = 1; index < tokens.length; index++) {
    const gap = sourceTokens.slice(positions[index - 1] + 1, positions[index]);
    if (gap.length && gap.every(word => HEADLINE_STOP_WORDS.has(normalizedWords(word)[0]))) {
      restored.push(...gap.map(word => uppercase ? word.toLocaleUpperCase('pt-BR') : word));
      addedConnector = true;
    }
    restored.push(tokens[index]);
  }
  if (!addedConnector) return headline;
  const punctuation = headline.match(/[?!…]+$/u)?.[0] || '';
  return `${restored.join(' ')}${punctuation}`;
}

function fallbackNegatedExclusivityHeadline(source) {
  const tokens = String(source || '').match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || [];
  const negationIndex = tokens.findIndex(token => ['nao', 'nunca', 'nem'].includes(normalizedWords(token)[0]));
  if (negationIndex < 0) return null;

  const exclusivityIndex = tokens.findIndex((token, index) => index > negationIndex
    && ['apenas', 'somente', 'so'].includes(normalizedWords(token)[0]));
  if (exclusivityIndex < 0) return null;

  const connector = tokens[exclusivityIndex + 1];
  const connectorWords = HEADLINE_CONNECTORS.has(normalizedWords(connector)[0]) ? [connector] : [];
  const tail = tokens.slice(exclusivityIndex + 1 + connectorWords.length);
  const subjectWords = [];
  for (const token of tail) {
    const normalized = normalizedWords(token)[0];
    if (HEADLINE_STOP_WORDS.has(normalized) || LOW_SIGNAL_WORDS.has(normalized)) continue;
    const candidate = [tokens[negationIndex], tokens[exclusivityIndex], ...connectorWords, ...subjectWords, token].join(' ');
    if (candidate.length > 34 || headlineWords(candidate).length > 5) break;
    subjectWords.push(token);
    break;
  }

  if (!subjectWords.length) return null;
  const headline = [tokens[negationIndex], tokens[exclusivityIndex], ...connectorWords, ...subjectWords].join(' ');
  return isGroundedThumbnailHeadline(headline, source, source) ? headline : null;
}

function fallbackThumbnailHeadline(title) {
  const source = String(title || '').trim();
  const matches = [...source.matchAll(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)];
  if (!matches.length) return 'Pulso IA';
  const scopedHeadline = fallbackNegatedExclusivityHeadline(source);
  if (scopedHeadline) return scopedHeadline;

  const questionAt = source.indexOf('?');
  const questionClauseAt = source.lastIndexOf(':', questionAt);
  if (questionAt >= 0 && questionClauseAt >= 0) {
    const question = source.slice(questionClauseAt + 1, questionAt + 1).trim();
    if (isGroundedThumbnailHeadline(question, source, source)) return question;
  }
  const questionWords = questionAt < 0
    ? matches.length
    : matches.findIndex(match => match.index > questionAt);
  const lastIndex = questionWords < 0 ? matches.length - 1 : Math.max(0, questionWords - 1);
  const dateSuffixWeekday = matches.findIndex((match, index) => {
    const weekday = normalizedWords(match[0])[0];
    const dayToken = normalizedWords(matches[index + 1]?.[0])[0] || '';
    const day = Number(dayToken);
    return WEEKDAY_NAMES.has(weekday) && /^\d{1,2}$/u.test(dayToken) && day >= 1 && day <= 31
      && matches.length - index <= 3;
  });
  let dateSuffixStart = dateSuffixWeekday;
  while (dateSuffixStart > 0 && DATE_PREFIX_WORDS.has(normalizedWords(matches[dateSuffixStart - 1][0])[0])) {
    dateSuffixStart--;
  }
  const titleContentLimit = dateSuffixWeekday < 0 ? lastIndex : Math.min(lastIndex, dateSuffixStart - 1);
  const qualifications = requiredHeadlineQualifications(source);
  const candidates = new Map();

  // A contrastive second clause can be a poor cover hook when squeezing the
  // whole sentence would leave an unnatural fragment. Prefer a complete first
  // clause when it already contains a subject and a useful predicate.
  const contrastAt = matches.findIndex(match => ['mas', 'porém', 'contudo', 'entretanto']
    .includes(normalizedWords(match[0])[0]));
  const firstClauseHasSignal = contrastAt > 0 && matches.slice(0, contrastAt)
    .filter(match => {
      const word = normalizedWords(match[0])[0];
      return !HEADLINE_STOP_WORDS.has(word) && !LOW_SIGNAL_WORDS.has(word);
    }).length >= 2;
  const clauseLimit = firstClauseHasSignal ? Math.min(titleContentLimit, contrastAt - 1) : titleContentLimit;

  for (let start = 0; start <= clauseLimit; start++) {
    for (let end = start; end <= clauseLimit; end++) {
      const sourceWords = matches.slice(start, end + 1).map(match => match[0]);
      const selected = sourceWords.map((word, index) => ({ word, index }))
        .filter(({ word }) => {
          const normalized = normalizedWords(word)[0];
          return !HEADLINE_STOP_WORDS.has(normalized) && !LOW_SIGNAL_WORDS.has(normalized);
        });
      const keywords = selected.map(({ word }) => word);
      if (keywords.length < 2 || keywords.length > 5) continue;

      const phraseWords = [];
      for (let index = 0; index < selected.length; index++) {
        phraseWords.push(selected[index].word);
        const next = selected[index + 1];
        if (!next) continue;
        const gap = sourceWords.slice(selected[index].index + 1, next.index);
        // Keep grammatical connectors from the title. Low-signal content words
        // such as “deixar” may be omitted, but conjunctions such as “ou” may not.
        const hasFillerBeforeConnector = gap.findIndex(word => LOW_SIGNAL_WORDS.has(normalizedWords(word)[0])) >= 0
          && gap.findIndex(word => HEADLINE_CONNECTORS.has(normalizedWords(word)[0])) > 0;
        if (!hasFillerBeforeConnector) {
          phraseWords.push(...gap.filter(word => HEADLINE_CONNECTORS.has(normalizedWords(word)[0])
            || HEADLINE_MODIFIERS.has(normalizedWords(word)[0])));
        }
      }

      const includesQuestion = questionAt >= 0 && matches[end].index + matches[end][0].length <= questionAt;
      const punctuation = includesQuestion ? '?' : '';
      const headline = `${phraseWords.join(' ')}${punctuation}`;
      // Never remove internal Portuguese connectors to squeeze a phrase into
      // the layout; try a shorter, still grounded phrase instead.
      if (headline.length > 34 || !isGroundedThumbnailHeadline(headline, source, source)) continue;
      if (hasIncompleteHeadlineEnding(headline)) continue;
      const includedQualifications = new Set(normalizedWords(headline).filter(word => QUALIFICATION_WORDS.has(word)));
      if (![...qualifications].every(word => includedQualifications.has(word))) continue;

      let score = keywords.reduce((total, word) => total + Math.min(normalizedWords(word)[0].length, 10) * 0.65, 0);
      score += keywords.length === 3 || keywords.length === 4 ? 4 : keywords.length === 2 ? 1 : 0;
      score += keywords.filter(word => /^\d/u.test(word)).length * 8;
      const firstSalientWord = matches.find(match => {
        const normalized = normalizedWords(match[0])[0];
        return !HEADLINE_STOP_WORDS.has(normalized) && !LOW_SIGNAL_WORDS.has(normalized);
      })?.[0];
      if (firstSalientWord && keywords.some(word => normalizedWords(word)[0] === normalizedWords(firstSalientWord)[0])) score += 8;
      const lastSalientWord = [...matches].reverse().find(match => {
        const normalized = normalizedWords(match[0])[0];
        return !HEADLINE_STOP_WORDS.has(normalized) && !LOW_SIGNAL_WORDS.has(normalized);
      })?.[0];
      if (lastSalientWord && keywords.some(word => normalizedWords(word)[0] === normalizedWords(lastSalientWord)[0])) score += 8;
      score += sourceWords.filter((word, index) => {
        const sourceIndex = start + index;
        return sourceIndex > 0 && /\p{Lu}/u.test(word) && word !== word.toUpperCase();
      }).length * 10;
      score += keywords.filter(word => /^[A-Z0-9]{2,}$/u.test(word)).length * 4;
      score += includesQuestion ? 1 : 0;

      const key = normalizedWords(headline).join(' ');
      const current = candidates.get(key);
      if (!current || score > current.score) candidates.set(key, { headline, score });
    }
  }

  if (candidates.size) {
    return [...candidates.values()].sort((left, right) => right.score - left.score || right.headline.length - left.headline.length)[0].headline;
  }

  // If no concise source phrase can preserve its qualifiers, fail the cover
  // build instead of silently rendering a long or incomplete headline.
  if (isGroundedThumbnailHeadline(source, source, source)) return source;
  throw thumbnailHeadlineError();
}

function chooseThumbnailHeadline({ candidate, seoTitle, title, sourceText = '' }) {
  // SEO/candidate copy is only a proposal. Never add it to the evidence used
  // to validate itself; evidence must come from the original title/article.
  const source = [title, sourceText].filter(Boolean).join(' ');
  for (const [optionIndex, option] of [candidate, seoTitle].entries()) {
    let connectedOption = restoreSourceConnectors(option, title);
    const variants = [connectedOption];
    if (connectedOption.length > 34 && optionIndex === 0
      && !normalizedWords(connectedOption).includes('mas')) {
      const questionMark = connectedOption.match(/[?!…]+$/u)?.[0] || '';
      const contrastiveClauses = connectedOption
        .split(/\s+\b(?:mas|porém|contudo|entretanto|todavia)\b\s+/iu)
        .map(clause => clause.trim())
        .filter(Boolean);
      variants.push(...contrastiveClauses.map(clause => `${clause.replace(/[?!…]+$/u, '')}${questionMark}`));

      // If restoring source connectors makes the supplied hook too long,
      // remove leading words until a complete short phrase remains.
      const tokens = connectedOption.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || [];
      for (let start = 1; start < tokens.length; start++) {
        const firstSpace = connectedOption.search(/\s/u);
        if (firstSpace < 0) break;
        const remainder = connectedOption.slice(firstSpace + 1);
        if (HEADLINE_STOP_WORDS.has(normalizedWords(remainder)[0])
          || LOW_SIGNAL_WORDS.has(normalizedWords(remainder)[0])) {
          connectedOption = remainder;
          continue;
        }
        variants.push(remainder);
        connectedOption = remainder;
      }
    }
    for (const variant of variants) {
      if (variant.length <= 34 && isGroundedThumbnailHeadline(variant, source, title)) return variant;
    }
  }
  return fallbackThumbnailHeadline(title);
}

function chooseLocalizedThumbnailHeadline({ candidate, seoTitle, displayTitle, script, sourceTitle = '' } = {}) {
  const sections = Array.isArray(script?.mainContent?.sections) ? script.mainContent.sections : [];
  const sourceText = [
    displayTitle,
    script?.hook?.text || script?.hook,
    ...sections.flatMap(section => [section?.title, section?.content]),
    script?.conclusion?.finalThought
  ].filter(Boolean).join(' ');
  const headline = chooseThumbnailHeadline({ candidate, seoTitle, title: displayTitle, sourceText });
  const sourceWords = normalizedWords(sourceTitle);
  const portugueseSource = sourceWords.filter(word => HEADLINE_STOP_WORDS.has(word)).length >= 2;
  const salientSource = new Set(sourceWords.filter(word => word.length >= 4
    && !HEADLINE_STOP_WORDS.has(word) && !LOW_SIGNAL_WORDS.has(word)));
  if (!portugueseSource || salientSource.size < 3
    || normalizedWords(headline).some(word => salientSource.has(word))) return headline;

  // A script title can be an opening anecdote rather than the subject. A
  // source-grounded question can name the subject without asserting a result.
  const socialSubject = String(sourceTitle).match(/\bpostar\s+(?:tudo\s+)?(?:nas|em)\s+redes\s+sociais\b/iu)?.[0];
  const question = socialSubject ? `${socialSubject}?` : '';
  if (question && isGroundedThumbnailHeadline(question, sourceTitle)) return question;
  return fallbackThumbnailHeadline(sourceTitle);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function safeThumbnailAccent(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : VISUAL_DESIGN_TOKENS.color.fallbackAccent;
}

function safeThumbnailImage(value) {
  return typeof value === 'string'
    && /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value)
    ? value
    : '';
}

function selectThumbnailHeroImage(openingScene, dedicatedThumbnailImage = '') {
  const dedicated = safeThumbnailImage(dedicatedThumbnailImage);
  if (dedicated) return dedicated;

  const candidates = Array.isArray(openingScene?.thumbnailCandidates) ? openingScene.thumbnailCandidates : [];
  const preferred = candidates.find(candidate => candidate?.variant === 'c');
  const preferredImage = safeThumbnailImage(preferred?.image);
  if (preferredImage) return preferredImage;

  const closeUpCandidate = candidates.find(candidate => candidate?.variant === 'b');
  const closeUpCandidateImage = safeThumbnailImage(closeUpCandidate?.image);
  if (closeUpCandidateImage) return closeUpCandidateImage;

  const closeUp = safeThumbnailImage(openingScene?.thumbnailImage);
  if (closeUp) return closeUp;
  return Array.isArray(openingScene?.sources)
    ? openingScene.sources.find(source => safeThumbnailImage(source)) || ''
    : '';
}

function buildThumbnailHtml({ title, headline: headlineText, accent, brand = 'Pulso IA', heroImage = '', topic = '', hook = '' }) {
  const headlineSource = String(headlineText || title || '').trim();
  const wordCount = thumbnailWordTokens(headlineSource).length;
  if (headlineSource.length > 34 || wordCount < 2 || wordCount > 5 || hasIncompleteHeadlineEnding(headlineSource)) {
    throw thumbnailHeadlineError();
  }
  const words = headlineSource.split(/\s+/);
  const impactIndex = words.reduce((last, word, index) => word === word.toLocaleUpperCase('pt-BR')
    && /\p{L}/u.test(word) ? index : last, words.length - 1);
  const headline = words.map((word, index) => index === impactIndex
    ? `<span class="impact">${escapeHtml(word)}</span>`
    : escapeHtml(word)).join(' ');
  const brandText = escapeHtml(brand || 'Pulso IA');
  const color = safeThumbnailAccent(accent);
  const image = safeThumbnailImage(heroImage);
  const hero = image
    ? `<img class="hero" src="${image}" alt="">`
    : buildThumbnailFallbackArt({ topic, title, hook, accent: color });
  const { width } = THUMBNAIL_CANVAS;

  // This image grade lives only in the thumbnail document; the video renderer keeps the original source.
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=${width},initial-scale=1"><style>
    ${thumbnailCssTokens(color)}
    *{box-sizing:border-box}html,body{margin:0;width:var(--pulso-thumbnail-width);height:var(--pulso-thumbnail-height);overflow:hidden;background:var(--pulso-thumbnail-background);color:var(--pulso-text);font-family:var(--pulso-font-family)}
    .cover{position:relative;width:var(--pulso-thumbnail-width);height:var(--pulso-thumbnail-height);overflow:hidden;background:radial-gradient(ellipse at 80% 42%,${color}88 0,transparent 48%),linear-gradient(125deg,var(--pulso-thumbnail-surface),var(--pulso-video-background) 67%)}
    .hero{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;filter:saturate(1.22) contrast(1.08) brightness(1.02)}
    .fallback-illustration{overflow:visible;filter:saturate(1.28) contrast(1.08) drop-shadow(0 18px 34px rgba(0,0,0,.35))}
    .shade{position:absolute;inset:0;background:linear-gradient(90deg,#070b13 0%,#070b13 32%,rgba(7,11,19,.92) 43%,rgba(7,11,19,.16) 82%,rgba(7,11,19,.08) 100%),linear-gradient(0deg,rgba(3,5,10,.55),transparent 35%)}
    .orbit{position:absolute;width:460px;height:460px;border:2px solid ${color}55;border-radius:50%;right:-92px;top:126px;box-shadow:0 0 0 38px ${color}0e,0 0 0 78px ${color}09;transform:rotate(-18deg)}
    .accent-bar{position:absolute;left:var(--pulso-thumbnail-accent-left);top:var(--pulso-thumbnail-accent-top);width:12px;height:112px;border-radius:8px;background:${color};box-shadow:0 0 32px ${color}bb}
    .content{position:absolute;left:var(--pulso-thumbnail-content-left);top:var(--pulso-thumbnail-content-top);bottom:var(--pulso-thumbnail-content-bottom);width:var(--pulso-thumbnail-content-width);display:flex;flex-direction:column;justify-content:center}
    h1{margin:0;max-width:var(--pulso-thumbnail-content-width);font-size:var(--pulso-thumbnail-headline-size);line-height:.9;letter-spacing:-4px;font-weight:950;text-transform:uppercase;text-wrap:balance;text-shadow:0 5px 30px #000,0 1px 2px #000;overflow-wrap:anywhere}
    .impact{color:var(--pulso-thumbnail-accent);text-shadow:0 2px 24px ${color}66}
    .brand{display:inline-flex;align-items:center;gap:12px;margin-top:34px;font-size:20px;line-height:1;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:var(--pulso-text)}
    .brand-mark{width:16px;height:16px;border-radius:5px;background:${color};box-shadow:0 0 20px ${color}cc;transform:rotate(12deg)}
    .edge{position:absolute;inset:var(--pulso-thumbnail-edge-inset);border:1px solid rgba(255,255,255,.13);border-radius:20px;pointer-events:none}
  </style></head><body><main class="cover">${hero}<div class="orbit"></div><div class="shade"></div><div class="accent-bar"></div><section class="content"><h1>${headline}</h1><div class="brand"><i class="brand-mark"></i>${brandText}</div></section><div class="edge"></div></main></body></html>`;
}

function buildPortraitThumbnailHtml({ title, headline: headlineText, accent, brand = 'Pulso Explica', heroImage = '', topic = '', hook = '' }) {
  const headlineSource = String(headlineText || title || '').trim();
  const wordCount = thumbnailWordTokens(headlineSource).length;
  if (headlineSource.length > 34 || wordCount < 2 || wordCount > 5 || hasIncompleteHeadlineEnding(headlineSource)) {
    throw thumbnailHeadlineError();
  }
  const words = headlineSource.split(/\s+/);
  const impactIndex = words.reduce((last, word, index) => word === word.toLocaleUpperCase('pt-BR')
    && /\p{L}/u.test(word) ? index : last, words.length - 1);
  const headline = words.map((word, index) => index === impactIndex
    ? `<span class="impact">${escapeHtml(word)}</span>`
    : escapeHtml(word)).join(' ');
  const brandText = escapeHtml(brand || 'Pulso Explica');
  const color = safeThumbnailAccent(accent);
  const image = safeThumbnailImage(heroImage);
  const hero = image
    ? `<img class="hero" src="${image}" alt="">`
    : buildThumbnailFallbackArt({ topic, title, hook, accent: color });
  const { typography, color: palette } = VISUAL_DESIGN_TOKENS;
  const fontFamily = `${typography.primaryFamily}, ${typography.sharedFallbacks}`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=1080,initial-scale=1"><style>
    *{box-sizing:border-box}html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:${palette.thumbnailBackground};color:${palette.text};font-family:${fontFamily}}
    .cover{position:relative;width:1080px;height:1920px;overflow:hidden;background:radial-gradient(ellipse at 50% 34%,${color}66 0,transparent 53%),linear-gradient(180deg,${palette.thumbnailSurface},${palette.videoBackground} 68%)}
    .hero{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 38%;filter:saturate(1.12) contrast(1.08) brightness(.94)}
    .fallback-illustration{position:absolute;left:4%;top:4%;width:92%;height:62%;overflow:visible;filter:saturate(1.18) contrast(1.06) drop-shadow(0 20px 34px rgba(0,0,0,.36))}
    .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(7,11,19,.03) 0%,rgba(7,11,19,.08) 32%,rgba(7,11,19,.42) 48%,rgba(7,11,19,.93) 62%,${palette.thumbnailBackground} 74%,${palette.thumbnailBackground} 100%)}
    .orbit{position:absolute;width:820px;height:820px;border:2px solid ${color}45;border-radius:50%;left:130px;top:310px;box-shadow:0 0 0 56px ${color}0e,0 0 0 112px ${color}08;pointer-events:none}
    .accent-bar{position:absolute;left:92px;top:1280px;width:14px;height:128px;border-radius:10px;background:${color};box-shadow:0 0 32px ${color}bb}
    .content{position:absolute;left:92px;right:76px;top:1270px;bottom:185px;display:flex;flex-direction:column;justify-content:center}
    h1{margin:0;max-width:910px;font-size:112px;line-height:.91;letter-spacing:-4px;font-weight:950;text-transform:uppercase;text-wrap:balance;text-shadow:0 5px 30px #000,0 1px 2px #000;overflow-wrap:anywhere}
    .impact{color:${color};text-shadow:0 2px 24px ${color}66}
    .brand{display:inline-flex;align-items:center;gap:16px;margin-top:50px;font-size:27px;line-height:1;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:${palette.text}}
    .brand-mark{width:20px;height:20px;border-radius:6px;background:${color};box-shadow:0 0 20px ${color}cc;transform:rotate(12deg)}
    .edge{position:absolute;inset:28px;border:1px solid rgba(255,255,255,.16);border-radius:28px;pointer-events:none}
  </style></head><body><main class="cover">${hero}<div class="orbit"></div><div class="shade"></div><div class="accent-bar"></div><section class="content"><h1>${headline}</h1><div class="brand"><i class="brand-mark"></i>${brandText}</div></section><div class="edge"></div></main></body></html>`;
}

module.exports = {
  buildThumbnailHtml,
  buildPortraitThumbnailHtml,
  chooseThumbnailHeadline,
  chooseLocalizedThumbnailHeadline,
  fallbackThumbnailHeadline,
  isGroundedThumbnailHeadline,
  restoreSourceConnectors,
  safeThumbnailAccent,
  safeThumbnailImage,
  selectThumbnailHeroImage,
  THUMBNAIL_CANVAS,
  THUMBNAIL_RENDER_POLICY,
  PORTRAIT_THUMBNAIL_CANVAS,
  PORTRAIT_THUMBNAIL_RENDER_POLICY
};
