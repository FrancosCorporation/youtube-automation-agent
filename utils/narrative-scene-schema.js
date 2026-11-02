'use strict';

const { ACTOR_CATALOG, MOTIONS } = require('./narrative-human-actors');

const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const string = (maxLength = 200) => ({ type: 'string', maxLength });
const choice = values => ({ enum: values });
const array = (items, minItems, maxItems) => ({ type: 'array', items, minItems, maxItems });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const vector = (min, max) => array(number(min, max), 3, 3);
const id = () => ({ type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,39}$' });
const pose = object({ x: number(.02, .98), y: number(.02, .98), scale: number(.05, 3), rotate: number(-360, 360) });
const layout = object({ landscape: pose, portrait: pose });
const camera = object({ position: vector(-24, 24), target: vector(-12, 12), fov: number(20, 65) });
const ref = object({ nodeId: id(), meshIndex: { anyOf: [{ type: 'null' }, { type: 'integer', minimum: 0, maximum: 59 }] } });
const mesh = object({
  type: choice(['box', 'sphere', 'cylinder', 'cone', 'torus', 'tube', 'extrude']),
  color: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' },
  position: vector(-8, 8), rotation: vector(-6.3, 6.3), size: vector(.01, 12),
  opacity: number(.1, 1), metalness: number(0, 1), points: array(vector(-12, 12), 0, 40)
});
const node = object({
  id: id(), evidence: string(600), evidenceSentenceId: { anyOf: [string(100), { type: 'null' }] },
  label: string(36), layout, depth: number(-4, 4),
  actorId: choice([null, ...ACTOR_CATALOG.actors.map(actor => actor.id)]),
  actorMotion: choice([null, ...MOTIONS]), actorMotionCueText: string(300), meshes: array(mesh, 0, 60)
});

function literalFragments(text, limit = 80) {
  const words = [...String(text || '').matchAll(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu)];
  const fragments = new Set();
  for (let size = 1; size <= 3; size++) for (let index = 0; index + size <= words.length; index++) {
    const last = words[index + size - 1];
    const value = text.slice(words[index].index, last.index + last[0].length);
    if (value.length >= 3 && value.length <= limit) fragments.add(value);
  }
  return [...fragments];
}

function illustrationSchema(sentenceIds, sentence) {
  const fragments = literalFragments(sentence.text || '');
  const drawingNode = sentence.text ? object({ ...node.properties,
    evidence: choice([sentence.text, ...fragments]), evidenceSentenceId: choice([null, sentence.id]),
    label: choice(['', ...fragments.filter(value => value.length <= 36)]) }) : node;
  const motionBase = { targetId: id(), cueText: fragments.length ? choice([sentence.text, ...fragments]) : string(300), durationSeconds: number(.15, 6), delaySeconds: number(0, 2) };
  const motion = { anyOf: [
    object({ ...motionBase, kind: choice(['move']), to: layout }),
    object({ ...motionBase, kind: choice(['draw', 'reveal']) }),
    object({ ...motionBase, kind: choice(['rotate']), amount: number(-360, 360) }),
    object({ ...motionBase, kind: choice(['scale']), amount: number(.05, 3) })
  ] };
  const track = (properties, value) => object({
    targetId: id(), meshIndex: ref.properties.meshIndex, property: choice(properties),
    keyframes: array(object({ cueSentenceId: choice(sentenceIds), boundary: choice(['start', 'end', 'word']),
      cueText: string(300), offsetSeconds: number(-12, 12), value,
      easing: choice(['linear', 'smooth', 'ease-in', 'ease-out']) }), 2, 64)
  });
  return object({
    cueSentenceId: choice([sentence.id]), dimension: choice(['3d']), explanation: { ...string(600), minLength: 12 },
    nodes: array(drawingNode, 2, 32), motions: array(motion, 0, 32),
    tracks: array({ anyOf: [track(['opacity'], number(0, 1)),
      track(['position3d', 'target3d'], vector(-24, 24)), track(['rotation3d'], vector(-1000, 1000)),
      track(['scale3d'], vector(.001, 10))] }, 0, 128),
    camera: object({ landscape: camera, portrait: camera }),
    spatialChecks: array(object({ subject: ref, obstacles: array(ref, 1, 128) }), 0, 64)
  });
}

// The viable NVIDIA 120B endpoint documents json_schema. Constrain syntax and
// numeric types there; grounding, cues, asset integrity and collisions still
// pass through the existing local validator. Other endpoints retain their
// supported format instead of assuming schema support from a catalog entry.
function sceneResponseFormat(model, chapterInputs) {
  if (model !== 'nvidia/nemotron-3.5-super-vl-120b-a12b') return { type: 'json_object' };
  const scenes = chapterInputs.map(input => {
    const sentenceIds = input.narration.map(sentence => sentence.id);
    return object({ id: choice([input.id]), visualThesis: { ...string(200), minLength: 1 },
      illustrations: array({ anyOf: input.narration.map(sentence => illustrationSchema(sentenceIds, sentence)) }, sentenceIds.length, sentenceIds.length) });
  });
  return { type: 'json_schema', json_schema: { name: 'pulso_narrative_scenes', strict: true,
    schema: object({ scenes: array({ anyOf: scenes }, scenes.length, scenes.length) }) } };
}

module.exports = { sceneResponseFormat };
