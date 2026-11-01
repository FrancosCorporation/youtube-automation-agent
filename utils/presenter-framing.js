/** Deterministic cuts; the presenter never competes with a split image panel. */
function choosePresenterShot(scene, _index = 0, seed = 0, { portrait = false, hideOnDataScenes = false } = {}) {
  const dataScene = (scene.components || []).some(component => [
    'node-graph', 'atlas-story-scene', 'progressive-comparison', 'rank-list', 'compare-table', 'checklist'
  ].includes(component.type));
  if (scene.presenter === false || scene.split || (!portrait && hideOnDataScenes && dataScene)) {
    return { side: 'right', framing: 'full', hidden: true };
  }
  const requested = scene.presenterShot;
  const side = portrait ? 'right' : ['left', 'right', 'center'].includes(requested?.side)
    ? requested.side : ((Number(seed) >>> 0) % 2 ? 'left' : 'right');
  const framing = portrait ? 'full' : ['full', 'medium', 'close'].includes(requested?.framing)
    ? requested.framing : 'full';
  return { side, framing, hidden: Boolean(requested?.hidden) };
}

function cameraForPresenter(framing = 'full') {
  if (framing === 'close') return { position: [0.06, 2.8, 4.0], target: [0.06, 2.65, 0] };
  if (framing === 'medium') return { position: [0.06, 2.2, 6.2], target: [0.06, 2.05, 0] };
  return { position: [0.06, 1.86, 7.8], target: [0.06, 1.7, 0] };
}

module.exports = { choosePresenterShot, cameraForPresenter };
