'use strict';
function illustrationViewport(aspect, width, height) {
  return { width: Math.round(width * (aspect === 'portrait' ? .92 : .88)),
    height: Math.round(height * (aspect === 'portrait' ? .42 : .62)) };
}
module.exports = { illustrationViewport };
