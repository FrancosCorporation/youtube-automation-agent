'use strict';

const { narrativeLabelCueFrame } = require('./narrative-word-cue');

// Before a spoken transfer, keep the preceding concepts; when the source is
// spoken, switch to source/destination and later concepts in the sentence.
function selectNarrativeFlowPhase({ objects, relation, sentence, frame }) {
  if (relation?.kind !== 'flow' || !Number.isFinite(frame)) return objects;
  const source = objects.find(object => object.id === relation.objectIds[0]);
  const destination = objects.find(object => object.id === relation.objectIds[1]);
  if (!source || !destination) return objects;
  const sourceCue = narrativeLabelCueFrame(source.label, sentence);
  if (sourceCue === null) return objects;
  const others = objects.filter(object => !relation.objectIds.includes(object.id));
  const before = others.filter(object => {
    const cue = narrativeLabelCueFrame(object.label, sentence);
    return cue !== null && cue < sourceCue;
  });
  if (frame < sourceCue) {
    if (!before.length) return [source, destination];
    const reached = before.filter(object => narrativeLabelCueFrame(object.label, sentence) <= frame);
    return reached.length ? reached.slice(-4) : [before[0]];
  }
  const after = others.filter(object => {
    const cue = narrativeLabelCueFrame(object.label, sentence);
    return cue === null || cue >= sourceCue && cue <= frame;
  });
  return [source, destination, ...after].slice(0, 4);
}

module.exports = { selectNarrativeFlowPhase };
