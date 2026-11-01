'use strict';

const EXPECTED_DIMENSIONS = Object.freeze({
  landscape: Object.freeze({ width: 1920, height: 1080 }),
  portrait: Object.freeze({ width: 1080, height: 1920 })
});
const APPROVED_ROBOT_SRC = 'pulso-story/approved-robot-rigged.glb';

function validateNarrativeEpisodeProps(props, { allowPreview = false } = {}) {
  const errors = [];
  if (!props || typeof props !== 'object' || Array.isArray(props)) return { valid: false, errors: ['props'] };
  if (props.episode == null && allowPreview) return { valid: true, preview: true, errors: [] };
  const dimensions = EXPECTED_DIMENSIONS[props.aspect];
  if (!dimensions) errors.push('aspect');
  if (!Number.isSafeInteger(props.width) || props.width !== dimensions?.width
    || !Number.isSafeInteger(props.height) || props.height !== dimensions?.height) errors.push('dimensions');
  if (!Number.isFinite(props.fps) || props.fps < 12 || props.fps > 60
    || props.fps !== props.episode?.fps) errors.push('fps');
  if (!Number.isSafeInteger(props.durationInFrames) || props.durationInFrames < 1
    || props.durationInFrames !== props.episode?.durationInFrames) errors.push('durationInFrames');
  if (!Number.isFinite(props.episode?.durationMs) || props.episode.durationMs <= 0
    || Number.isFinite(props.fps) && Number.isSafeInteger(props.durationInFrames)
      && Math.abs(props.durationInFrames / props.fps - props.episode.durationMs / 1000) > 1 / props.fps) {
    errors.push('episode:duration');
  }
  if (!props.episode || typeof props.episode !== 'object' || !Array.isArray(props.episode.scenes)
    || !props.episode.scenes.length || !Array.isArray(props.episode.sentences) || !props.episode.sentences.length) {
    errors.push('episode');
  }
  if (typeof props.audioSrc !== 'string' || !/^_runtime\/[A-Za-z0-9_-]+\/episode-audio\.m4a$/.test(props.audioSrc)) {
    errors.push('audioSrc');
  }
  if (props.robotSrc !== APPROVED_ROBOT_SRC) errors.push('robotSrc');
  if (!Array.isArray(props.accents) || props.accents.length < 1 || props.accents.length > 8
    || props.accents.some(color => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) errors.push('accents');
  if (!Array.isArray(props.lipSyncEnvelope) || !props.lipSyncEnvelope.length
    || props.lipSyncEnvelope.some(level => !Number.isFinite(level) || level < 0 || level > 1)) errors.push('lipSyncEnvelope');
  if (!Number.isFinite(props.lipSyncStepMs) || props.lipSyncStepMs <= 0) errors.push('lipSyncStepMs');
  if (props.episode && Number.isFinite(props.episode.durationMs) && Number.isFinite(props.lipSyncStepMs)
    && Array.isArray(props.lipSyncEnvelope)) {
    const expectedLevels = Math.ceil(props.episode.durationMs / props.lipSyncStepMs);
    if (Math.abs(props.lipSyncEnvelope.length - expectedLevels) > 2) errors.push('lipSyncEnvelope:duration');
  }
  if (!props.gestureCues || typeof props.gestureCues !== 'object' || Array.isArray(props.gestureCues)) errors.push('gestureCues');
  return { valid: errors.length === 0, errors };
}

function assertNarrativeEpisodeProps(props, options) {
  const validation = validateNarrativeEpisodeProps(props, options);
  if (!validation.valid) {
    throw Object.assign(new Error(`props narrativas incompatíveis: ${validation.errors.join(', ')}`), {
      code: 'NARRATIVE_EPISODE_PROPS_INVALID', errors: validation.errors
    });
  }
  return validation;
}

module.exports = { APPROVED_ROBOT_SRC, EXPECTED_DIMENSIONS, assertNarrativeEpisodeProps, validateNarrativeEpisodeProps };
