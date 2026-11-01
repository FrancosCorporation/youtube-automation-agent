'use strict';

const { detectAppSession } = require('./android-emulator-control');

// visibleText normalizes Portuguese accents before matching.
const FIRST_USE_BIRTHDATE_TEXT = /\b(?:birthdate|date of birth|birthday|data de nascimento|aniversario)\b/i;

function visibleText(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .filter(node => node && node.visible !== false)
    .map(node => `${node.text || ''} ${node.description || ''}`)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Classify only TikTok UI states already recognized by the shared Android
 * session probe. No upload controls are inferred from browser screenshots or
 * from unobserved app resources; all other screens remain unknown.
 */
function detectTikTokScreen(nodes) {
  const text = visibleText(nodes);
  if (!text) return 'unknown';
  if (FIRST_USE_BIRTHDATE_TEXT.test(text)) return 'first_use';

  const session = detectAppSession('tiktok', nodes);
  if (session === 'login_required') return 'login_required';
  if (session === 'logged_in') return 'own_profile';
  return 'unknown';
}

module.exports = { detectTikTokScreen };
