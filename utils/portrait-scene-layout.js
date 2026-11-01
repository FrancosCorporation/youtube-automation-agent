/** Fit one complete photograph above the presenter in a phone composition. */
function sceneForViewport(scene, width, height) {
  if (height <= width) return scene;
  const photos = (scene.components || []).filter(component =>
    component.src && (component.type === 'image-hero' || component.type === 'image-panel'));
  if (!photos.length) return scene;
  const photo = photos[0];
  const components = (scene.components || []).filter(component =>
    component.type !== 'image-hero' && component.type !== 'image-panel');
  // Preserve timed social shots; choosing only the first photo here would
  // undo the planner's image changes in the final portrait composition.
  components.unshift(...(photo.sceneWindow ? photos : [photo]).map(image => ({
    ...image, type: 'image-hero', fit: 'contain', strong: false,
    noFade: Boolean(scene.minimal || image.noFade), revealAtMs: image.sceneWindow?.startMs || 0
  })));
  return { ...scene, split: false, splitLeft: false, hero: true, portraitPhoto: true, components };
}

module.exports = { sceneForViewport };
