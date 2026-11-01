'use strict';

/** Keep successful screenshots bound to the source item that produced them. */
function alignArticlePrints(shots, renderedPrints, referenceCount) {
  if (!Array.isArray(shots) || !Array.isArray(renderedPrints)
    || !Number.isSafeInteger(referenceCount) || referenceCount < 0) {
    throw new TypeError('entradas inválidas para alinhar prints de artigos');
  }

  const prints = new Array(referenceCount + 1).fill(null);
  for (let index = 0; index < shots.length; index += 1) {
    const target = shots[index]?.referenceIndex;
    const print = renderedPrints[index];
    if (!Number.isSafeInteger(target) || target < -1 || target >= referenceCount || !print?.src) continue;
    prints[target + 1] = print;
  }
  return prints;
}

/** Rotate references across sections while retaining the selected index for its print. */
function getNewsReferenceIndex(sectionIndex, referenceCount) {
  if (!Number.isSafeInteger(sectionIndex) || sectionIndex < 0
    || !Number.isSafeInteger(referenceCount) || referenceCount <= 0) return null;
  return (sectionIndex + 1) % referenceCount;
}

module.exports = { alignArticlePrints, getNewsReferenceIndex };
