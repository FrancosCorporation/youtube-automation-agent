'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Optional metadata may fall back to the reviewed script. Claim the request
// before invoking a provider, so a crash/timeout cannot spend again on resume.
async function cachedOptionalMetadata({ cacheDir, identity, generate }) {
  const key = digest(identity);
  const filePath = path.join(cacheDir, `${key}.json`);
  await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(filePath, JSON.stringify({ key, status: 'pending' }), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try {
      const entry = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (entry.key === key && entry.status === 'done' && entry.sha256 === digest(entry.value)
        && (entry.value === null || (typeof entry.value === 'object' && !Array.isArray(entry.value)))) return entry.value;
    } catch { /* Incomplete/corrupt optional metadata uses the reviewed fallback. */ }
    return null;
  }
  let value = null;
  try { value = await generate(); }
  finally {
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = null;
    const temporary = `${filePath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ key, status: 'done', value, sha256: digest(value) }), { mode: 0o600 });
      await fs.rename(temporary, filePath);
    } finally { await fs.unlink(temporary).catch(() => {}); }
  }
  return value;
}

module.exports = { cachedOptionalMetadata };
