const fs = require('fs').promises;
const { buildPresenterAtlas, OUTPUT, ATLAS_REVISION } = require('../scripts/build-presenter-atlas');

const ATLAS_URL = 'https://pulso-ia-assets.local/presenter-atlas.png';
const ATLAS_PATH = OUTPUT;
const REVISION_PATH = `${ATLAS_PATH}.revision`;
let building = null;

async function ensurePresenterAtlas(logger = console) {
  try {
    const stat = await fs.stat(ATLAS_PATH);
    const revision = await fs.readFile(REVISION_PATH, 'utf8').catch(() => '');
    if (stat.size > 10000 && revision.trim() === ATLAS_REVISION) return ATLAS_PATH;
  } catch (_error) { /* gera o atlas na primeira utilização */ }

  if (!building) building = buildPresenterAtlas(ATLAS_PATH).then(async output => {
    const temporaryRevision = `${REVISION_PATH}.tmp-${process.pid}`;
    await fs.writeFile(temporaryRevision, `${ATLAS_REVISION}\n`);
    await fs.rename(temporaryRevision, REVISION_PATH);
    return output;
  }).finally(() => { building = null; });
  try {
    return await building;
  } catch (error) {
    if (logger && typeof logger.warn === 'function') logger.warn(`Avatar 3D indisponível: ${error.message}`);
    try {
      const stat = await fs.stat(ATLAS_PATH);
      if (stat.size > 10000) return ATLAS_PATH;
    } catch (_fallbackError) { /* no atlas available */ }
    return null;
  }
}

module.exports = { ensurePresenterAtlas, ATLAS_PATH, ATLAS_URL, ATLAS_REVISION };
