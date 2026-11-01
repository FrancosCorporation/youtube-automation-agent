'use strict';

// Each narrated beat has its own action and camera references. Do not display
// every object from an entire chapter at once or borrow a future beat's data.
function narrativeActiveObjectIds(scene, sentenceId, activeShot) {
  const ids = new Set();
  if (sentenceId) {
    for (const action of scene.actions || []) if (action.cueSentenceId === sentenceId) ids.add(action.targetObjectId);
    for (const shot of scene.cameraShots || []) if (shot.cueSentenceId === sentenceId) ids.add(shot.focusObjectId);
  }
  if (!ids.size && activeShot?.focusObjectId) ids.add(activeShot.focusObjectId);
  return ids;
}

module.exports = { narrativeActiveObjectIds };
