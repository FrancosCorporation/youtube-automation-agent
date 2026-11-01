'use strict';

const { themes } = require('../config/themes.json');

const DEFAULT_THEME_ID = 'ia';
const DEFAULT_HASHTAGS = '#ia #inteligenciaartificial #tecnologia';

function findTheme(themeId) {
  const normalizedId = String(themeId || '').trim().toLowerCase();
  return themes.find(theme => theme.id === normalizedId)
    || themes.find(theme => theme.id === DEFAULT_THEME_ID)
    || null;
}

function resolveThemeHashtags(value, themeId) {
  if (typeof value === 'string' && /#[\p{L}\p{N}_]+/u.test(value)) return value.trim();
  return findTheme(themeId)?.hashtags || DEFAULT_HASHTAGS;
}

function tagsFromHashtags(hashtags) {
  return [...new Set((String(hashtags || '').match(/#[\p{L}\p{N}_]+/gu) || [])
    .map(tag => tag.slice(1).replace(/_/g, ' ').trim())
    .filter(Boolean))];
}

function resolveThemeTags(value, themeId) {
  const tags = Array.isArray(value)
    ? value.map(tag => String(tag).trim()).filter(Boolean)
    : [];
  if (tags.length) return [...new Set(tags)];
  return tagsFromHashtags(resolveThemeHashtags(null, themeId));
}

function themeDescription(themeId) {
  const theme = findTheme(themeId);
  if (!theme) return 'Notícias e análises em português.';
  return `${theme.brand || theme.name}: notícias e análises em português sobre ${theme.name}.`;
}

module.exports = {
  DEFAULT_THEME_ID,
  DEFAULT_HASHTAGS,
  findTheme,
  resolveThemeHashtags,
  resolveThemeTags,
  tagsFromHashtags,
  themeDescription
};
