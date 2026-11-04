'use strict';

const { NARRATIVE_SOCIAL_PLATFORMS, configuredNarrativePartDurationLimitSeconds,
  narrativePartDurationRejection } = require('./platform-video-policy');

function requiredSocialPlatforms(env = process.env) {
  const disabled = new Set(String(env.SOCIALS_DISABLED || '').split(',').map(s => s.trim().toLowerCase()));
  return NARRATIVE_SOCIAL_PLATFORMS.filter(platform => !disabled.has(platform));
}

// A successful master is only a render checkpoint. Do not retire the job until
// its cover pair and every requested narrative sequence are ready for QA.
function assertGenerationFinalization({ thumbnailPath, portraitThumbnailPath, clips,
  platforms = requiredSocialPlatforms(), requireCovers = true, requireClips = true }) {
  if (requireCovers && (!thumbnailPath || !portraitThumbnailPath)) {
    throw Object.assign(new Error('par de capas ainda não concluído'), { code: 'GENERATION_COVERS_PENDING' });
  }
  if (!requireClips) return;
  for (const platform of platforms) {
    const parts = (clips || []).filter(clip => clip.platforms?.includes(platform));
    const count = parts[0]?.partCount || 1;
    const indices = new Set(parts.map(clip => clip.partIndex || 1));
    if (!parts.length || !Number.isSafeInteger(count) || count < 1 || count !== parts.length
      || indices.size !== count || Array.from({ length: count }, (_, i) => i + 1).some(i => !indices.has(i))
      || parts.some(clip => !clip.path || (clip.partCount || 1) !== count
        || !['social-narrative', 'social-narrative-part'].includes(clip.kind)
        || narrativePartDurationRejection(platform, clip, clip.durationSeconds,
          configuredNarrativePartDurationLimitSeconds(platform)))) {
      throw Object.assign(new Error(`partes narrativas incompletas: ${platform}`), {
        code: 'GENERATION_SOCIAL_PARTS_PENDING', platform
      });
    }
  }
}

module.exports = { assertGenerationFinalization, requiredSocialPlatforms };
