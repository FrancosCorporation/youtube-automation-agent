'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const sqlite3 = require('sqlite3');

const defaultDirectory = () => path.resolve(__dirname, '..', process.env.IMAGE_LIBRARY_DIR || 'data/image-library');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const text = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
const tokens = value => [...new Set(normalize(value).match(/[\p{L}\p{N}]{3,}/gu) || [])]
  .filter(word => !['para', 'com', 'uma', 'que', 'dos', 'das', 'por', 'como', 'mais', 'novo', 'nova', 'sobre'].includes(word));

async function pixels(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return hash(Buffer.concat([Buffer.from(`${info.width}:${info.height}:${info.channels}:`), data]));
}

class ImageLibrary {
  constructor({ directory = defaultDirectory() } = {}) {
    this.directory = path.resolve(directory);
    this.databasePath = path.join(this.directory, 'library.sqlite');
    this.db = null;
  }

  run(sql, values = []) {
    return new Promise((resolve, reject) => this.db.run(sql, values, function (error) {
      if (error) reject(error); else resolve({ changes: this.changes });
    }));
  }

  all(sql, values = []) {
    return new Promise((resolve, reject) => this.db.all(sql, values, (error, rows) => error ? reject(error) : resolve(rows)));
  }

  async initialize() {
    await fs.mkdir(path.join(this.directory, 'objects'), { recursive: true, mode: 0o700 });
    this.db = await new Promise((resolve, reject) => {
      const db = new sqlite3.Database(this.databasePath, error => error ? reject(error) : resolve(db));
    });
    this.db.configure('busyTimeout', 5000);
    await fs.chmod(this.databasePath, 0o600);
    for (const sql of [
      'PRAGMA foreign_keys = ON',
      `CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY, object_path TEXT NOT NULL, object_sha256 TEXT NOT NULL,
        pixel_sha256 TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
        format TEXT NOT NULL, original_bytes INTEGER NOT NULL, stored_bytes INTEGER NOT NULL,
        usage_known INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS contexts (
        image_id TEXT NOT NULL REFERENCES images(id), original_path TEXT NOT NULL,
        theme TEXT NOT NULL, topic TEXT NOT NULL, section_title TEXT NOT NULL,
        source_title TEXT NOT NULL, source_url TEXT NOT NULL, search_text TEXT NOT NULL,
        generator TEXT NOT NULL, job_id TEXT NOT NULL,
        PRIMARY KEY(image_id, original_path, theme, topic, section_title, source_url))`,
      'CREATE INDEX IF NOT EXISTS contexts_theme ON contexts(theme)',
      `CREATE TABLE IF NOT EXISTS representations (
        sha256 TEXT NOT NULL, image_id TEXT NOT NULL REFERENCES images(id), PRIMARY KEY(sha256, image_id))`,
      `CREATE TABLE IF NOT EXISTS uses (
        image_id TEXT NOT NULL REFERENCES images(id), artifact_path TEXT NOT NULL,
        used_at TEXT NOT NULL, PRIMARY KEY(image_id, artifact_path))`
    ]) await this.run(sql);
    return this;
  }

  async archive({ imagePath, theme, topic, sectionTitle = '', sectionText = '', sourceTitle = '',
    sourceUrl = '', generator = 'unknown', jobId = '', renderBytes = null, usageKnown = false } = {}) {
    if (!text(theme) || !text(topic)) throw new TypeError('theme and topic are required for an image');
    const source = await fs.readFile(imagePath);
    const id = hash(source);
    let [record] = await this.all('SELECT * FROM images WHERE id = ?', [id]);
    if (!record) {
      const metadata = await sharp(source).metadata();
      if (!['png', 'jpeg', 'webp'].includes(metadata.format)) throw new TypeError('image format must be PNG, JPEG or WebP');
      const pixelSha256 = await pixels(source);
      let stored = source;
      let format = metadata.format;
      // Never resize or use JPEG quality reduction in the library. Unsupported
      // depth/profile or a larger encoding keeps the exact original bytes.
      if (metadata.depth === 'uchar' && metadata.width <= 16383 && metadata.height <= 16383
        && !(metadata.pages > 1)
        && (!metadata.orientation || metadata.orientation === 1)) {
        try {
          const candidate = await sharp(source).keepMetadata().webp({ lossless: true, effort: 4 }).toBuffer();
          if (candidate.length < source.length && await pixels(candidate) === pixelSha256) {
            stored = candidate;
            format = 'webp';
          }
        } catch { /* Preserve the original when lossless transcoding is unavailable. */ }
      }
      const extension = format === 'jpeg' ? 'jpg' : format;
      const relative = `objects/${id}.${extension}`;
      const destination = path.join(this.directory, relative);
      const temporary = `${destination}.${crypto.randomUUID()}.partial`;
      try {
        await fs.writeFile(temporary, stored, { flag: 'wx', mode: 0o600 });
        await fs.link(temporary, destination).catch(error => { if (error.code !== 'EEXIST') throw error; });
      } finally { await fs.unlink(temporary).catch(() => {}); }
      const storedHash = hash(stored);
      if (hash(await fs.readFile(destination)) !== storedHash) throw new Error('image_library_object_conflict');
      await this.run(`INSERT OR IGNORE INTO images VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, relative, storedHash, pixelSha256, metadata.width, metadata.height, format,
          source.length, stored.length, usageKnown ? 1 : 0, new Date().toISOString()]);
      [record] = await this.all('SELECT * FROM images WHERE id = ?', [id]);
    }
    await this.run(`INSERT OR IGNORE INTO contexts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, path.resolve(imagePath), text(theme), text(topic), text(sectionTitle), text(sourceTitle), text(sourceUrl),
        normalize([topic, sectionTitle, sectionText, sourceTitle].map(text).join(' ')), text(generator), text(jobId)]);
    for (const sha256 of new Set([id, record.object_sha256, ...(renderBytes ? [hash(renderBytes)] : [])])) {
      await this.run('INSERT OR IGNORE INTO representations VALUES (?, ?)', [sha256, id]);
    }
    return record;
  }

  async get(id) {
    const [record] = await this.all('SELECT * FROM images WHERE id = ?', [id]);
    if (!record) return null;
    const filePath = path.join(this.directory, record.object_path);
    const bytes = await fs.readFile(filePath);
    if (hash(bytes) !== record.object_sha256 || await pixels(bytes) !== record.pixel_sha256) {
      throw new Error('image_library_integrity_failed');
    }
    return { ...record, filePath };
  }

  async search({ theme, query = '', limit = 10, unusedOnly = false } = {}) {
    if (!text(theme)) throw new TypeError('theme is required for image search');
    const terms = tokens(query).slice(0, 16);
    const rows = await this.all(`SELECT i.*, c.topic, c.section_title, c.source_title, c.source_url, c.generator,
      c.search_text, (SELECT COUNT(*) FROM uses u WHERE u.image_id = i.id) AS use_count
      FROM images i JOIN contexts c ON c.image_id = i.id WHERE c.theme = ?
      ${unusedOnly ? 'AND i.usage_known = 1 AND NOT EXISTS (SELECT 1 FROM uses u WHERE u.image_id = i.id)' : ''}
      ${terms.length ? `AND (${terms.map(() => 'c.search_text LIKE ?').join(' OR ')})` : ''}
      ORDER BY i.created_at DESC LIMIT 500`, [text(theme), ...terms.map(term => `%${term}%`)]);
    const ranked = rows.map(row => ({ ...row, score: terms.filter(term => row.search_text.includes(term)).length,
      usage_status: row.use_count ? 'used' : row.usage_known ? 'unused' : 'unknown', reviewRequired: true }))
      .sort((a, b) => b.score - a.score || a.use_count - b.use_count);
    const seen = new Set();
    return ranked.filter(row => { if (seen.has(row.id)) return false; seen.add(row.id); return true; })
      .slice(0, Math.max(1, Math.min(50, Number(limit) || 10))).map(({ search_text: _searchText, ...row }) => row);
  }

  async markUsed({ sha256s, artifactPath }) {
    if (!artifactPath) throw new TypeError('artifactPath is required');
    let count = 0;
    for (const sha256 of new Set(sha256s || [])) {
      const result = await this.run(`INSERT OR IGNORE INTO uses
        SELECT image_id, ?, ? FROM representations WHERE sha256 = ?`,
      [path.resolve(artifactPath), new Date().toISOString(), sha256]);
      count += result.changes;
      await this.run('UPDATE images SET usage_known = 1 WHERE id IN (SELECT image_id FROM representations WHERE sha256 = ?)', [sha256]);
    }
    return count;
  }

  async stats() {
    const [row] = await this.all(`SELECT COUNT(*) AS images, COALESCE(SUM(original_bytes),0) AS original_bytes,
      COALESCE(SUM(stored_bytes),0) AS stored_bytes,
      COALESCE(SUM(CASE WHEN usage_known = 1 AND NOT EXISTS (SELECT 1 FROM uses u WHERE u.image_id = images.id) THEN 1 ELSE 0 END),0) AS unused,
      COALESCE(SUM(CASE WHEN usage_known = 0 THEN 1 ELSE 0 END),0) AS usage_unknown FROM images`);
    return row;
  }

  async close() {
    if (this.db) {
      await new Promise((resolve, reject) => this.db.close(error => error ? reject(error) : resolve()));
      this.db = null;
    }
  }
}

function sceneImageHashes(scenes) {
  return [...new Set((scenes || []).flatMap(scene => (scene.components || []).flatMap(component => {
    const match = String(component.src || '').match(/^data:image\/(?:png|jpeg|webp);base64,([a-z0-9+/=]+)$/i);
    return match ? [hash(Buffer.from(match[1], 'base64'))] : [];
  })))];
}

async function recordImageLibraryUsage({ sha256s, artifactPath, directory = defaultDirectory() }) {
  if (!sha256s?.length) return 0;
  if (!await fs.stat(path.join(directory, 'library.sqlite')).catch(() => null)) return 0;
  const library = new ImageLibrary({ directory });
  try { await library.initialize(); return await library.markUsed({ sha256s, artifactPath }); }
  finally { await library.close(); }
}

module.exports = { ImageLibrary, defaultDirectory, sceneImageHashes, recordImageLibraryUsage };
