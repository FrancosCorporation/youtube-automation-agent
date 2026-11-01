'use strict';

const EDITORIAL_TIME_ZONE = 'America/Sao_Paulo';
const WEEKDAY_PATTERN = '(?:segunda(?:-feira)?|terça(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sábado|domingo)';
const STALE_RELATIVE_WORDING = new RegExp(
  `\\b(?:hoje|agora|atualmente|neste momento|(?:esta|esse|essa|nesta|nesse|nessa|desta|desse|dessa)\\s+${WEEKDAY_PATTERN})\\b`,
  'i'
);

function localDateKey(date, timeZone = EDITORIAL_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function inspectSourceFreshness(ageHours, now = new Date(), timeZone = EDITORIAL_TIME_ZONE) {
  const age = Number(ageHours);
  const current = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(age) || age < 0 || !Number.isFinite(current.getTime())) return null;

  const publishedAt = new Date(current.getTime() - age * 60 * 60 * 1000);
  const currentLocalDate = localDateKey(current, timeZone);
  const publishedLocalDate = localDateKey(publishedAt, timeZone);
  return {
    ageHours: age,
    currentLocalDate,
    publishedLocalDate,
    sameLocalDate: currentLocalDate === publishedLocalDate,
    stale: age > 24 || currentLocalDate !== publishedLocalDate
  };
}

function buildSourceFreshnessGuidance(ageHours, now = new Date(), timeZone = EDITORIAL_TIME_ZONE) {
  const freshness = inspectSourceFreshness(ageHours, now, timeZone);
  if (!freshness?.stale) return '';
  const sourceDate = freshness.publishedLocalDate.split('-').reverse().join('/');
  return `\nFRESCOR EDITORIAL: a idade do feed é aproximadamente ${Math.round(freshness.ageHours)} horas e sugere publicação em ${sourceDate} (${timeZone}), antes da data local atual. Não chame a pauta de hoje, agora ou atual; não diga "nesta/desta [dia da semana]". Atribua a data passada como data da publicação ou omita a referência temporal.`;
}

function hasStaleRelativeFreshnessWording(script, ageHours, now = new Date(), timeZone = EDITORIAL_TIME_ZONE) {
  if (!inspectSourceFreshness(ageHours, now, timeZone)?.stale) return false;
  const sections = Array.isArray(script?.sections) ? script.sections : [];
  const mainSections = Array.isArray(script?.mainContent?.sections) ? script.mainContent.sections : [];
  const conclusion = typeof script?.conclusion === 'string'
    ? script.conclusion
    : script?.conclusion?.finalThought;
  const publicationMetadata = script?.publicationMetadata && typeof script.publicationMetadata === 'object'
    ? Object.values(script.publicationMetadata).filter(value => typeof value === 'string')
    : [];
  const text = [
    script?.title,
    script?.hook?.text || script?.hook,
    ...sections.map(section => section?.content),
    ...mainSections.map(section => section?.content),
    conclusion,
    ...publicationMetadata
  ].filter(Boolean).join(' ');
  return STALE_RELATIVE_WORDING.test(text);
}

module.exports = {
  EDITORIAL_TIME_ZONE,
  buildSourceFreshnessGuidance,
  hasStaleRelativeFreshnessWording,
  inspectSourceFreshness
};
