'use strict';

const MIN_VIDEOS_PER_DAY = 1;
// Technical bound: retain at least one minute between scheduled slots.
const MAX_VIDEOS_PER_DAY = 24 * 60;
const MIN_RECAP_DAYS = 1;
const MAX_RECAP_DAYS = 3650;
const MIN_PHASE_MINUTES = 0;
const MAX_PHASE_MINUTES = 1439;

function integerInRange(name, value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${name} deve ser um inteiro entre ${min} e ${max}; recebido: ${String(value)}`);
  }
  return number;
}

function enabledThemes(themes) {
  if (!Array.isArray(themes)) throw new Error('config/themes.json deve conter uma lista de temas');
  const active = themes.filter(theme => theme && theme.enabled === true);
  if (!active.length) throw new Error('nenhum tema habilitado; o scheduler não iniciará geração');

  const ids = new Set();
  for (const theme of active) {
    if (typeof theme.id !== 'string' || !theme.id.trim() || typeof theme.name !== 'string' || !theme.name.trim()) {
      throw new Error('cada tema habilitado precisa de id e name não vazios');
    }
    if (ids.has(theme.id)) throw new Error(`id de tema habilitado duplicado: ${theme.id}`);
    ids.add(theme.id);
  }
  return active;
}

function validateSchedulerSettings({ videosPerDay, recapEveryDays, phaseMinutes, themes }) {
  const videos = integerInRange('VIDEOS_PER_DAY', videosPerDay, MIN_VIDEOS_PER_DAY, MAX_VIDEOS_PER_DAY);
  const recapDays = integerInRange('RECAP_EVERY_DAYS', recapEveryDays, MIN_RECAP_DAYS, MAX_RECAP_DAYS);
  const phase = integerInRange('SCHEDULER_PHASE_MIN', phaseMinutes, MIN_PHASE_MINUTES, MAX_PHASE_MINUTES);
  const activeThemes = enabledThemes(themes);

  return {
    videosPerDay: videos,
    recapEveryDays: recapDays,
    phaseMinutes: phase,
    intervalMs: Math.round((24 * 60 * 60 * 1000) / videos),
    themes: activeThemes
  };
}

function selectNextTheme(themes, nextThemeId = null) {
  const active = enabledThemes(themes);
  const savedIndex = active.findIndex(theme => theme.id === nextThemeId);
  const index = savedIndex >= 0 ? savedIndex : 0;
  return {
    theme: active[index],
    nextThemeId: active[(index + 1) % active.length].id
  };
}

async function readThemeRotationState(filePath) {
  const fs = require('node:fs/promises');
  try {
    const state = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!state || Array.isArray(state) || state.version !== 1
      || !(state.nextThemeId === null || typeof state.nextThemeId === 'string')) {
      throw new Error('estrutura de rotação inválida');
    }
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, nextThemeId: null };
    throw new Error(`estado de rotação de temas ilegível; execução cancelada para preservar a sequência: ${error.message}`);
  }
}

async function advanceThemeRotation(filePath, themes) {
  const fs = require('node:fs/promises');
  const state = await readThemeRotationState(filePath);
  const selection = selectNextTheme(themes, state.nextThemeId);
  const nextState = {
    version: 1,
    nextThemeId: selection.nextThemeId,
    lastThemeId: selection.theme.id,
    updatedAt: new Date().toISOString()
  };
  await fs.mkdir(require('node:path').dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${require('node:crypto').randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(nextState, null, 2), { flag: 'wx' });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
  return selection;
}

module.exports = {
  advanceThemeRotation,
  MAX_PHASE_MINUTES,
  MAX_RECAP_DAYS,
  MAX_VIDEOS_PER_DAY,
  enabledThemes,
  readThemeRotationState,
  selectNextTheme,
  validateSchedulerSettings
};
