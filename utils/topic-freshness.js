'use strict';

const DEFAULT_PRIMARY_TOPIC_AGE_HOURS = 36;
// Keep the 36h window as the normal editorial preference; if it is empty,
// allow a week-old article only with its real age carried into the script.
const DEFAULT_FALLBACK_TOPIC_AGE_HOURS = 168;

function selectRecentTopicCandidates(candidates, {
  primaryMaxAgeHours = DEFAULT_PRIMARY_TOPIC_AGE_HOURS,
  fallbackMaxAgeHours = DEFAULT_FALLBACK_TOPIC_AGE_HOURS
} = {}) {
  const primaryLimit = Number.isFinite(Number(primaryMaxAgeHours)) && Number(primaryMaxAgeHours) >= 1
    ? Number(primaryMaxAgeHours)
    : DEFAULT_PRIMARY_TOPIC_AGE_HOURS;
  const fallbackLimit = Math.max(primaryLimit,
    Number.isFinite(Number(fallbackMaxAgeHours)) && Number(fallbackMaxAgeHours) >= 1
      ? Number(fallbackMaxAgeHours)
      : DEFAULT_FALLBACK_TOPIC_AGE_HOURS);
  const valid = (Array.isArray(candidates) ? candidates : []).filter(candidate => {
    const rawAge = candidate?.ageHours;
    if (rawAge === null || rawAge === undefined || rawAge === '') return false;
    const age = Number(rawAge);
    return Number.isFinite(age) && age >= -1 && age <= fallbackLimit;
  });
  const primary = valid.filter(candidate => Number(candidate.ageHours) <= primaryLimit);
  if (primary.length) return { candidates: primary, usedFallback: false, maxAgeHours: primaryLimit };
  const fallback = valid.filter(candidate => Number(candidate.ageHours) <= fallbackLimit);
  return { candidates: fallback, usedFallback: fallback.length > 0, maxAgeHours: fallbackLimit };
}

function formatTopicAgeLabel(ageHours) {
  const age = Number(ageHours);
  if (!Number.isFinite(age) || age < -1) return 'data não confirmada';
  const roundedHours = Math.max(0, Math.round(age));
  return roundedHours === 0 ? 'há menos de 1h' : `há ${roundedHours}h`;
}

module.exports = {
  DEFAULT_PRIMARY_TOPIC_AGE_HOURS,
  DEFAULT_FALLBACK_TOPIC_AGE_HOURS,
  selectRecentTopicCandidates,
  formatTopicAgeLabel
};
