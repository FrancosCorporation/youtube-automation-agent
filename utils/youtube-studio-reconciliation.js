'use strict';

// Reconcile only an already-clicked public submission. This helper never
// submits media and never treats a missing/draft/private row as confirmation.
async function reconcileClickedStudioPublication({ publishClicked, privacyStatus, readId, waitForRow }) {
  if (!publishClicked || privacyStatus !== 'public') return null;
  const videoId = await readId();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(String(videoId || ''))) return null;
  const proof = await waitForRow(videoId);
  return proof?.videoId === videoId ? proof : null;
}

module.exports = { reconcileClickedStudioPublication };
