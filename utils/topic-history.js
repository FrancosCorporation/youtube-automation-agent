'use strict';

const DEFAULT_TOPIC_HISTORY_LIMIT = 400;

function collectUsedTopicSignals(entries, limit = DEFAULT_TOPIC_HISTORY_LIMIT) {
  const recent = Array.isArray(entries) ? entries.slice(-Math.max(0, Number(limit) || 0)) : [];
  const unique = values => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
  return {
    titles: unique(recent.flatMap(entry => [
      entry?.title,
      entry?.sourceTitle,
      entry?.originTitle,
      entry?.sourceEvidence?.originTitle,
      entry?.sourceEvidence?.sourceTitle
    ])),
    urls: unique(recent.flatMap(entry => [
      entry?.origUrl,
      entry?.url,
      entry?.originUrl,
      entry?.sourceEvidence?.originUrl,
      entry?.sourceEvidence?.sourceUrl
    ]))
  };
}

module.exports = { DEFAULT_TOPIC_HISTORY_LIMIT, collectUsedTopicSignals };
