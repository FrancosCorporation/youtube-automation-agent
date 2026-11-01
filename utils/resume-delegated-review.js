'use strict';

// A completed artifact can survive a transient failure in automatic review.
// Retry only the existing, fully verified review; never create or publish media.
async function resumeDelegatedReview({ entry, verified, apply, reloadEntry, verifyEntry }) {
  if (verified?.status !== 'verified' || verified.visualReview !== 'pending'
    || !verified.masterPath || !verified.thumbnail
    || (verified.coverVariants?.requiredFormats?.includes('9:16') && !verified.portraitThumbnail)) {
    return { entry, verified, status: 'not_ready' };
  }
  const review = await apply(entry);
  if (!['approved', 'unchanged'].includes(review?.status)) {
    return { entry, verified, status: review?.reason || 'held' };
  }
  const current = await reloadEntry(entry.videoPath);
  if (!current || current.jobId !== entry.jobId || current.videoId !== entry.videoId) {
    throw new Error('identidade do job mudou durante recuperação da revisão');
  }
  const refreshed = await verifyEntry(current);
  if (refreshed?.status !== 'verified' || refreshed.visualReview !== 'approved') {
    throw new Error('revisão recuperada não passou nova verificação por hash');
  }
  return { entry: current, verified: refreshed, status: 'approved' };
}

module.exports = { resumeDelegatedReview };
