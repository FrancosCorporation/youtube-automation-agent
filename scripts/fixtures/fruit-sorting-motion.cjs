'use strict';
// Directed acceptance sample, not an automatic author or a news source.
// Only declarative geometry/tracks: the shared renderer knows no fruit template.
module.exports = function fruitSorting(sentences, fps = 24) {
  const { narrativeLabelCueFrame } = require('../../utils/narrative-word-cue');
  const nodes = [], tracks = [];
  const c = { steel: '#76949a', dark: '#193b48', mint: '#8ed8c0', cream: '#e8ddc6', orange: '#ee861e', wood: '#bb8654' };
  const mesh = (type, color, position, size, rotation = [0, 0, 0], extra = {}) => ({ type, color, position, size, rotation, ...extra });
  const box = (color, position, size, rotation) => mesh('box', color, position, size, rotation);
  function node(id, evidence, sentenceIndex, meshes, position = [0, 0, 0]) {
    const layout = width => ({ x: .5 + position[0] / width, y: .5 - position[1] / 7, scale: 1, rotate: 0 });
    nodes.push({ id, evidence, evidenceSentenceId: sentences[sentenceIndex].id, label: '', meshes, depth: position[2],
      layout: { landscape: layout(12), portrait: layout(9.6) } });
  }
  const word = (index, text) => narrativeLabelCueFrame(text, sentences[index]) / fps;
  const end = sentences.at(-1).endFrame / fps;
  const stop = word(2, 'chega'), push = word(3, 'desvia'), retract = word(3, 'recua'), resume = retract + .45;
  // Pick the nearest spoken boundary for every key; normalization re-resolves it.
  function key(time, value, easing = 'linear') {
    const anchors = sentences.flatMap(s => [{ cueSentenceId: s.id, boundary: 'start', time: s.startFrame / fps }, { cueSentenceId: s.id, boundary: 'end', time: s.endFrame / fps }]);
    const anchor = anchors.sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
    return { cueSentenceId: anchor.cueSentenceId, boundary: anchor.boundary, offsetSeconds: time - anchor.time, value, easing };
  }
  function track(targetId, property, states, meshIndex) {
    tracks.push({ targetId, property, ...(meshIndex == null ? {} : { meshIndex }), keyframes: states.map(([time, value, easing]) => key(time, value, easing)) });
  }
  node('factory-floor', 'linha de triagem', 0, [
    box('#254b56', [-.4, -1.65, .3], [11.4, .18, 5.6]),
    box('#46636a', [-.4, -1.52, -1.75], [10.8, .025, .04]),
    box('#46636a', [-.4, -1.52, 2.65], [10.8, .025, .04]),
    ...[-4, -2, 0, 2, 4].map(x => box('#365963', [x, -1.55, .3], [.025, .015, 5.2])),
  ]);
  node('conveyor-frame', 'esteira', 0, [
    // End the rails before the discharge roller so the falling fruit clears
    // their full volume, including its lateral separation into the crate.
    box(c.dark, [-.75, -.25, -.64], [8.5, .38, .15]),
    box(c.dark, [-.75, -.25, .64], [8.5, .38, .15]),
    ...[-4.45, -1.65, 1.4, 3.4].flatMap(x => [
      box(c.steel, [x, -.9, -.53], [.16, 1.25, .16]), box(c.steel, [x, -.9, .53], [.16, 1.25, .16]),
      box(c.dark, [x, -1.48, 0], [.6, .12, 1.45]),
    ]),
    box(c.mint, [-4.2, -.25, .74], [.8, .12, .06]),
    box(c.cream, [-2.9, -.25, .74], [.32, .12, .06]),
    mesh('cylinder', c.steel, [-4.3, -.5, -.95], [.4, .45, .4], [Math.PI / 2, 0, 0]),
  ]);
  // Each roller is an articulated group, with a visible longitudinal marker.
  for (let i = 0; i < 13; i++) {
    const id = `roller-${i}`;
    node(id, 'roletes', 1, [mesh('cylinder', c.steel, [0, 0, 0], [.58, 1.14, .58], [Math.PI / 2, 0, 0], { metalness: .65 }),
      box(c.cream, [0, .286, 0], [.07, .025, 1.1]),
      mesh('cylinder', c.dark, [0, 0, .64], [.2, .12, .2], [Math.PI / 2, 0, 0]),
    ], [-4.45 + i * .66, -.04, 0]);
    // Rightward top-surface speed. Pause under sensor, resume after the pusher.
    track(id, 'rotation3d', [[0, [0, 0, 0]], [stop, [0, 0, -12]], [resume, [0, 0, -12]], [end, [0, 0, -34]]]);
  }
  node('sensor-arch', 'sensor', 1, [
    box(c.mint, [.65, .8, -.8], [.18, 1.65, .18]), box(c.mint, [.65, .8, .8], [.18, 1.65, .18]),
    box(c.mint, [-.2, 1.58, 0], [.28, .2, 1.8]),
    box(c.dark, [-.2, 1.35, 0], [.5, .3, .42]),
    mesh('sphere', '#70b7e5', [-.2, 1.2, 0], [.18, .12, .18]),
    box(c.dark, [-.2, 1.89, 0], [.16, .4, .16]),
    mesh('sphere', '#535b56', [-.2, 2.1, 0], [.28, .32, .28]),
    // Offset the front support and bridge it above the working volume.
    // The fruit exits at x=-.2; its swept radius must clear the post.
    box(c.mint, [.225, 1.58, .8], [1.05, .2, .18]),
    box(c.mint, [.225, 1.58, -.8], [1.05, .2, .18]),
  ]);
  node('sensor-light', 'acende', 2, [
    mesh('sphere', '#ff563b', [-.2, 2.1, 0], [.31, .35, .31]),
    mesh('sphere', '#ffaf57', [-.2, 2.1, 0], [.47, .5, .47], [0, 0, 0], { opacity: .2 }),
  ]);
  const signal = word(2, 'acende');
  track('sensor-light', 'opacity', [[0, 0], [signal, 0], [signal + .13, 1], [retract, 1], [resume, 0]]);
  node('sensor-beam', 'sensor acende', 2, [mesh('cone', '#f9d37f', [-.2, .82, 0], [.65, .8, .65], [0, 0, 0], { opacity: .18 })]);
  track('sensor-beam', 'opacity', [[0, 0], [signal, 0], [signal + .13, 1], [push + .45, 1], [push + .65, 0]]);
  node('pusher-body', 'empurrador', 3, [
    box(c.dark, [-.2, -.4, -1.4], [.9, .18, .7]),
    box(c.steel, [-.2, -.95, -1.4], [.2, 1.05, .2]),
    box(c.dark, [-.2, -1.45, -1.4], [.9, .12, .7]),
    mesh('cylinder', c.mint, [-.2, .58, -1.35], [.48, .8, .48], [Math.PI / 2, 0, 0]),
    box(c.steel, [-.2, .07, -1.35], [.2, 1, .2]),
  ]);
  node('pusher-moving', 'empurrador desvia', 3, [
    box('#c5dddf', [-.2, .58, -.74], [.1, .1, .45]),
    box(c.cream, [-.2, .58, -.5], [.65, .65, .12]),
  ]);
  // Extend the rod about its rear anchor; pad and fruit contact at z=-.36.
  const contact = push + .18, displaced = push + .85;
  track('pusher-moving', 'position3d', [[0, [0, 0, 0]], [push, [0, 0, 0]], [contact, [0, 0, .08]], [displaced, [0, 0, 1.4], 'ease-out'], [retract, [0, 0, 1.4]], [resume, [0, 0, 0], 'smooth']], 1);
  track('pusher-moving', 'scale3d', [[0, [1, 1, 1]], [push, [1, 1, 1]], [contact, [1, 1, 1.18]], [displaced, [1, 1, 4.1], 'ease-out'], [retract, [1, 1, 4.1]], [resume, [1, 1, 1], 'smooth']], 0);
  track('pusher-moving', 'position3d', [[0, [0, 0, 0]], [push, [0, 0, 0]], [contact, [0, 0, .04]], [displaced, [0, 0, .7], 'ease-out'], [retract, [0, 0, .7]], [resume, [0, 0, 0], 'smooth']], 0);
  node('reject-tray', 'bandeja lateral', 3, [
    box(c.steel, [-.2, -.57, 1.9], [1.65, .12, 1.9]),
    box(c.mint, [-1.02, -.38, 1.9], [.08, .4, 1.9]), box(c.mint, [.62, -.38, 1.9], [.08, .4, 1.9]),
    box(c.mint, [-.2, -.38, 2.83], [1.7, .4, .08]),
    box(c.dark, [-.2, -1.04, 1.9], [.2, .95, .2]), box(c.dark, [-.2, -1.48, 1.9], [1, .12, 1]),
    box(c.cream, [-.2, -.49, 1.9], [1.35, .025, 1.6]),
  ]);
  node('collection-crate', 'caixa', 4, [
    box(c.wood, [4.18, -1.45, 0], [1.65, .14, 1.6]),
    ...[-.7, -.33].flatMap(y => [box(c.wood, [4.18, y - .35, -.76], [1.65, .26, .1]), box(c.wood, [4.18, y - .35, .76], [1.65, .26, .1]),
      box(c.wood, [3.4, y - .35, 0], [.1, .26, 1.6]), box(c.wood, [4.96, y - .35, 0], [.1, .26, 1.6])]),
    ...[3.43, 4.93].flatMap(x => [-.72, .72].map(z => box('#78543b', [x, -1, z], [.14, .85, .14]))),
  ]);
  const fruit = (id, blemished) => node(id, blemished ? 'laranja manchada' : 'laranjas', blemished ? 2 : 0, [
    mesh('sphere', blemished ? '#db8221' : c.orange, [0, 0, 0], [.72, .7, .72], [0, 0, 0], { metalness: 0 }),
    mesh('cylinder', '#5d4c2c', [0, .36, 0], [.07, .16, .07]),
    mesh('sphere', '#548b3c', [.1, .4, 0], [.3, .075, .14], [0, 0, -.25]),
    ...(blemished ? [[.14, .05, .31], [-.12, .16, .29], [.12, -.2, .25]].map(p => mesh('sphere', '#654b32', p, [.22, .18, .07], [0, .25, 0])) : [mesh('sphere', '#f7b03c', [.2, .1, .26], [.11, .08, .03])]),
  ]);
  fruit('orange-front', false); fruit('orange-marked', true); fruit('orange-back', false);
  const speed = 1.2, y = .6;
  for (const [id, from, atStop, landingX, landingZ] of [['orange-front', -2, 1.3, 3.95, -.34], ['orange-back', -4.7, -1.4, 4.55, .34]]) {
    const edge = resume + (3.72 - atStop) / speed;
    track(id, 'position3d', [[0, [from, y, 0]], [stop, [atStop, y, 0]], [resume, [atStop, y, 0]], [edge, [3.72, y, 0]],
      [edge + .23, [(3.72 + landingX) / 2, .24, landingZ / 2], 'ease-in'], [edge + .48, [landingX - .08, -.99, landingZ], 'ease-in'],
      [edge + .62, [landingX - .02, -.78, landingZ], 'ease-out'], [edge + .81, [landingX, -.99, landingZ], 'ease-in']]);
    track(id, 'rotation3d', [[0, [0, 0, 0]], [stop, [0, 0, -3.3 / .35]], [resume, [0, 0, -3.3 / .35]],
      [edge, [0, 0, -(3.72 - from) / .35]], [edge + .81, [.18, .2, -(3.72 - from) / .35 - 1.8], 'ease-out']]);
  }
  track('orange-marked', 'position3d', [[0, [-3.5, y, 0]], [stop, [-.2, y, 0]], [contact, [-.2, y, 0]],
    [displaced, [-.2, .52, 1.32], 'ease-out'], [displaced + .28, [-.2, -.11, 1.78], 'ease-in'],
    [displaced + .44, [-.2, .08, 1.94], 'ease-out'], [displaced + .65, [-.2, -.11, 2.1], 'ease-in'],
    [displaced + .92, [-.2, -.11, 2.18], 'ease-out']]);
  track('orange-marked', 'rotation3d', [[0, [0, 0, 0]], [stop, [0, 0, -3.3 / .35]], [contact, [0, 0, -3.3 / .35]],
    [displaced + .92, [4.9, .25, -3.3 / .35], 'ease-out']]);
  track('camera', 'position3d', [[0, [0, 0, 0]], [6.7, [0, 0, 0]], [8.3, [-.7, -.7, -1.4], 'smooth'],
    [15.4, [-.7, -.7, -1.4]], [16.5, [0, 0, 0], 'smooth'], [end, [0, 0, 0]]]);
  const references = ids => nodes.filter(n => ids.includes(n.id)).flatMap(n => n.meshes.flatMap((m, meshIndex) => m.type === 'box' ? [{ nodeId: n.id, meshIndex }] : []));
  const structural = references(['sensor-arch', 'conveyor-frame', 'reject-tray', 'collection-crate']);
  const spatialChecks = ['orange-front', 'orange-marked', 'orange-back'].map(nodeId => ({
    subject: { nodeId, meshIndex: 0 }, obstacles: [...structural, { nodeId: 'pusher-moving', meshIndex: 1 },
      ...['orange-front', 'orange-marked', 'orange-back'].filter(id => id !== nodeId).map(id => ({ nodeId: id, meshIndex: 0 }))],
  }));
  for (const meshIndex of [0, 1]) spatialChecks.push({ subject: { nodeId: 'pusher-moving', meshIndex }, obstacles: references(['sensor-arch']) });
  return sentences.map(sentence => ({ dimension: '3d', cueSentenceId: sentence.id,
    explanation: 'Linha de triagem ilustrativa: roletes e frutas giram, o sensor sinaliza, o êmbolo toca e desvia a fruta manchada, recua e as demais caem e se acomodam numa caixa.',
    nodes, tracks, spatialChecks, motions: [], camera: {
      landscape: { position: [4.8, 6.5, 11.7], target: [-.2, -.35, .4], fov: 35 },
      portrait: { position: [10.8, 8.5, 10.8], target: [-.2, -.4, .4], fov: 36 },
    } }));
};
