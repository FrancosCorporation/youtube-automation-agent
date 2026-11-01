'use strict';

// Motion follows the authored path for most of the spoken beat, then holds.
// It is a pure function so forward and backward seeks produce the same image.
function narrativeActionMotion({ action, sentence, frame, aspect, width, height }) {
  if (!action || !sentence || !action.trajectories?.[aspect]) return { progress: 1, dx: 0, dy: 0, scale: 1 };
  const path = action.trajectories[aspect];
  const start = Math.max(sentence.startFrame, action.startFrame);
  const end = Math.max(start + 1, action.endFrame, Math.floor(sentence.startFrame + (sentence.endFrame - sentence.startFrame) * 0.8));
  const linear = Math.max(0, Math.min(1, (frame - start) / (end - start)));
  const progress = linear * linear * (3 - 2 * linear);
  const moves = action.kind === 'travel' || action.kind === 'rearrange';
  const bounded = (value, limit) => Math.max(-limit, Math.min(limit, Number.isFinite(value) ? value : 0));
  return {
    progress,
    dx: moves ? bounded((path.to.x - path.from.x) * width * progress, width * 0.14) : 0,
    dy: moves ? bounded((path.to.y - path.from.y) * height * progress, height * 0.10) : 0,
    scale: Math.max(0.75, Math.min(1.25, 1 + (path.to.scale - path.from.scale) * progress))
  };
}

module.exports = { narrativeActionMotion };
