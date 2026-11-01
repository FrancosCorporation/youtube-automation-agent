'use strict';

const PREFIX = 'com.zhiliaoapp.musically:id/';

// Observed on the configured Android app. Only the empty capture screen is
// safe to leave: never dismiss an editor, caption, selected media or a draft.
function emptyTikTokCameraClose(nodes) {
  const visible = (Array.isArray(nodes) ? nodes : []).filter(node => node.visible !== false);
  const has = suffix => visible.some(node => node.resourceId === PREFIX + suffix);
  if (!has('upload_hot_area') || !has('tx8') || !has('tv_top_text')
    || ['h9x', 'tjf', 'q0w', 'y1v'].some(has)) return null;
  const closes = visible.filter(node => node.resourceId === PREFIX + 'l4u' && node.clickable);
  return closes.length === 1 ? closes[0] : null;
}

module.exports = { emptyTikTokCameraClose };
