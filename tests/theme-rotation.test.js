'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  advanceThemeRotation,
  readThemeRotationState,
  selectNextTheme,
  validateSchedulerSettings
} = require('../utils/theme-rotation');

const themes = [
  { id: 'ia', name: 'IA', enabled: true },
  { id: 'economia', name: 'Economia', enabled: true },
  { id: 'arquivado', name: 'Arquivado', enabled: false }
];

test('scheduler config validates finite ranges and preserves high production cadence', () => {
  const result = validateSchedulerSettings({
    videosPerDay: 60,
    recapEveryDays: 7,
    phaseMinutes: 30,
    themes
  });

  assert.equal(result.intervalMs, Math.round(24 * 60 * 60 * 1000 / 60));
  assert.equal(validateSchedulerSettings({ videosPerDay: 1440, recapEveryDays: 7, phaseMinutes: 0, themes }).videosPerDay, 1440);
  assert.deepEqual(result.themes.map(theme => theme.id), ['ia', 'economia']);
});

test('scheduler rejects NaN, fractions and cadence/phase outside documented limits', () => {
  const base = { videosPerDay: 5, recapEveryDays: 7, phaseMinutes: 0, themes };
  for (const [key, value] of [
    ['videosPerDay', NaN], ['videosPerDay', 0], ['videosPerDay', 1441], ['videosPerDay', 1.5],
    ['recapEveryDays', Infinity], ['recapEveryDays', 0], ['recapEveryDays', 3651],
    ['phaseMinutes', NaN], ['phaseMinutes', -1], ['phaseMinutes', 1440], ['phaseMinutes', 1.5]
  ]) {
    assert.throws(() => validateSchedulerSettings({ ...base, [key]: value }), new RegExp(key === 'videosPerDay'
      ? 'VIDEOS_PER_DAY'
      : key === 'recapEveryDays' ? 'RECAP_EVERY_DAYS' : 'SCHEDULER_PHASE_MIN'));
  }
});

test('scheduler rejects empty, malformed or duplicate enabled topic lists', () => {
  const base = { videosPerDay: 5, recapEveryDays: 7, phaseMinutes: 0 };
  assert.throws(() => validateSchedulerSettings({ ...base, themes: [] }), /nenhum tema habilitado/);
  assert.throws(() => validateSchedulerSettings({ ...base, themes: null }), /lista de temas/);
  assert.throws(() => validateSchedulerSettings({ ...base, themes: [{ enabled: true, id: '', name: 'Sem id' }] }), /id e name/);
  assert.throws(() => validateSchedulerSettings({ ...base, themes: [themes[0], themes[0]] }), /duplicado/);
});

test('rotation atomically persists the next id and resumes round-robin after restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-rotation-'));
  const filePath = path.join(directory, 'theme-rotation.json');
  try {
    const first = await advanceThemeRotation(filePath, themes);
    assert.equal(first.theme.id, 'ia');
    const persisted = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    assert.equal(persisted.lastThemeId, 'ia');
    assert.equal(persisted.nextThemeId, 'economia');

    const afterRestart = await advanceThemeRotation(filePath, themes);
    assert.equal(afterRestart.theme.id, 'economia');
    assert.equal(afterRestart.nextThemeId, 'ia');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rotation rejects malformed state and falls back when saved topic was disabled', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-rotation-invalid-'));
  const filePath = path.join(directory, 'theme-rotation.json');
  try {
    await fsp.writeFile(filePath, '{broken');
    await assert.rejects(readThemeRotationState(filePath), /estado de rotação de temas ilegível/);
    assert.equal(selectNextTheme(themes, 'arquivado').theme.id, 'ia');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
