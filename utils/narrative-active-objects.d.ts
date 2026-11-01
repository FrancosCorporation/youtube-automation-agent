export function narrativeActiveObjectIds(scene: {
  actions: Array<{ cueSentenceId: string; targetObjectId: string }>;
  cameraShots: Array<{ cueSentenceId: string; focusObjectId: string }>;
}, sentenceId: string | undefined, activeShot: { focusObjectId: string } | undefined): Set<string>;
