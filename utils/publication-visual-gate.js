'use strict';

const path = require('node:path');

function publicationVisualGate(qaManifest, artifactPath = null, { thumbnailPath = null } = {}) {
  if (qaManifest?.status !== 'verified') {
    return { allowed: false, reason: 'qa_manifest_not_verified' };
  }
  if (qaManifest.visualReview !== 'approved') {
    return { allowed: false, reason: 'visual_review_not_approved' };
  }
  if (qaManifest.visualReviewScopeInvalid === true) {
    return { allowed: false, reason: 'visual_review_scope_invalid' };
  }
  if (artifactPath && !Array.isArray(qaManifest.visualReviewAssets)) {
    return { allowed: false, reason: 'visual_review_scope_missing' };
  }
  if (Array.isArray(qaManifest.visualReviewAssets)) {
    if (!qaManifest.visualReviewAssets.length) {
      return { allowed: false, reason: 'visual_review_has_no_approved_assets' };
    }
    if (artifactPath) {
      const target = path.resolve(artifactPath);
      const approved = qaManifest.visualReviewAssets.some(asset => path.resolve(asset.path) === target);
      if (!approved) return { allowed: false, reason: 'visual_asset_not_approved' };
    }
  }
  const target = artifactPath ? path.resolve(artifactPath) : null;
  const masterPath = qaManifest.masterPath ? path.resolve(qaManifest.masterPath) : null;
  const publishingMaster = Boolean(target && masterPath && target === masterPath);
  if (thumbnailPath || publishingMaster) {
    const thumbnail = qaManifest.thumbnail;
    if (!thumbnail?.path || !/^[a-f0-9]{64}$/i.test(String(thumbnail.sha256 || ''))) {
      return { allowed: false, reason: 'thumbnail_not_hash_bound' };
    }
    const boundPath = path.resolve(thumbnail.path);
    if (thumbnailPath && path.resolve(thumbnailPath) !== boundPath) {
      return { allowed: false, reason: 'thumbnail_path_mismatch' };
    }
    const approved = Array.isArray(qaManifest.visualReviewAssets)
      && qaManifest.visualReviewAssets.some(asset => path.resolve(asset.path) === boundPath
        && asset.sha256 === thumbnail.sha256);
    if (!approved) return { allowed: false, reason: 'thumbnail_not_approved' };
    if (publishingMaster && qaManifest.coverVariants?.requiredFormats?.includes('9:16')) {
      const portraitThumbnail = qaManifest.portraitThumbnail;
      if (!portraitThumbnail?.path || !/^[a-f0-9]{64}$/i.test(String(portraitThumbnail.sha256 || ''))) {
        return { allowed: false, reason: 'portrait_thumbnail_not_hash_bound' };
      }
      const portraitPath = path.resolve(portraitThumbnail.path);
      const portraitApproved = Array.isArray(qaManifest.visualReviewAssets)
        && qaManifest.visualReviewAssets.some(asset => path.resolve(asset.path) === portraitPath
          && asset.sha256 === portraitThumbnail.sha256);
      if (!portraitApproved) return { allowed: false, reason: 'portrait_thumbnail_not_approved' };
    }
  }
  return { allowed: true, reason: null };
}

function assertPublicationVisualGate(qaManifest, artifactPath = null, options = {}) {
  const result = publicationVisualGate(qaManifest, artifactPath, options);
  if (!result.allowed) {
    const error = new Error(result.reason);
    error.code = 'PUBLICATION_VISUAL_REVIEW_REQUIRED';
    throw error;
  }
  return qaManifest;
}

module.exports = { publicationVisualGate, assertPublicationVisualGate };
