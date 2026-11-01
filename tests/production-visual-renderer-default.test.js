'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Database } = require('../database/db');
const { AIVideoGenerator } = require('../utils/ai-video-generator');

function generatorWithSettings(settings = {}) {
  const generator = Object.create(AIVideoGenerator.prototype);
  generator.db = { getAllSettings: async () => settings };
  return generator;
}

test('production slideshow defaults to the Remotion 3D narrative renderer', async () => {
  const previousStyle = process.env.SLIDESHOW_STYLE;
  delete process.env.SLIDESHOW_STYLE;

  try {
    const resolved = await generatorWithSettings().resolveSlideshowSettings();
    assert.equal(resolved.style, 'animated');
    assert.equal(resolved.secondsPerImage, 3.5);

    const invalidStoredValue = await generatorWithSettings({ slideshow_style: 'unknown-style' }).resolveSlideshowSettings();
    assert.equal(invalidStoredValue.style, 'animated');
  } finally {
    if (previousStyle === undefined) delete process.env.SLIDESHOW_STYLE;
    else process.env.SLIDESHOW_STYLE = previousStyle;
  }
});

test('fresh production database resolves the default slideshow to Remotion', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-render-default-'));
  const previousStyle = process.env.SLIDESHOW_STYLE;
  delete process.env.SLIDESHOW_STYLE;
  const db = new Database();
  db.dbPath = path.join(tempDir, 'settings.sqlite');

  try {
    await db.initialize();
    const generator = Object.create(AIVideoGenerator.prototype);
    generator.db = db;

    assert.equal(await db.getSetting('slideshow_style'), 'animated');
    assert.equal((await generator.resolveSlideshowSettings()).style, 'animated');
  } finally {
    await db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
    if (previousStyle === undefined) delete process.env.SLIDESHOW_STYLE;
    else process.env.SLIDESHOW_STYLE = previousStyle;
  }
});

test('legacy dynamic setting migrates once and later explicit overrides persist', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-render-migration-'));
  const dbPath = path.join(tempDir, 'settings.sqlite');
  const migrationId = 'visual-standard-v3-slideshow-default';
  let db = new Database();
  db.dbPath = dbPath;

  try {
    await db.initialize();
    await db.setSetting('slideshow_style', 'dynamic');
    await db.executeQuery('DELETE FROM app_migrations WHERE id = ?', [migrationId]);
    await db.close();

    db = new Database();
    db.dbPath = dbPath;
    await db.initialize();
    assert.equal(await db.getSetting('slideshow_style'), 'animated');
    assert.ok(await db.getRow('SELECT id FROM app_migrations WHERE id = ?', [migrationId]));

    await db.setSetting('slideshow_style', 'dynamic');
    await db.close();

    db = new Database();
    db.dbPath = dbPath;
    await db.initialize();
    assert.equal(await db.getSetting('slideshow_style'), 'dynamic');
  } finally {
    await db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('legacy visual migration preserves the classic setting', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulso-render-migration-classic-'));
  const dbPath = path.join(tempDir, 'settings.sqlite');
  let db = new Database();
  db.dbPath = dbPath;

  try {
    await db.initialize();
    await db.setSetting('slideshow_style', 'classic');
    await db.executeQuery('DELETE FROM app_migrations WHERE id = ?', ['visual-standard-v3-slideshow-default']);
    await db.close();

    db = new Database();
    db.dbPath = dbPath;
    await db.initialize();
    assert.equal(await db.getSetting('slideshow_style'), 'classic');
  } finally {
    await db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('explicit legacy slideshow selection remains an intentional override', async () => {
  const previousStyle = process.env.SLIDESHOW_STYLE;
  delete process.env.SLIDESHOW_STYLE;

  try {
    const storedOverride = await generatorWithSettings({ slideshow_style: 'dynamic' }).resolveSlideshowSettings();
    assert.equal(storedOverride.style, 'dynamic');

    process.env.SLIDESHOW_STYLE = 'classic';
    const envOverride = await generatorWithSettings().resolveSlideshowSettings();
    assert.equal(envOverride.style, 'classic');
  } finally {
    if (previousStyle === undefined) delete process.env.SLIDESHOW_STYLE;
    else process.env.SLIDESHOW_STYLE = previousStyle;
  }
});
