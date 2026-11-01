'use strict';
// Hand-directed renderer reference, intentionally separate from production
// scene authorship. No topic-specific geometry is in the shared compositor.
const mesh = (type, color, position, size, extra = {}) => ({ type, color, position, size, ...extra });
const box = (color, position, size, extra) => mesh('box', color, position, size, extra);
const sphere = (color, position, size, extra) => mesh('sphere', color, position, size, extra);
const tube = (color, points, radius = .035) => mesh('tube', color, [0, 0, 0], [radius, 1, 1], { points });
const pose = (x = .5, y = .5, scale = 1, rotate = 0) => ({ x, y, scale, rotate });
const layout = (landscape = pose(), portrait = landscape) => ({ landscape, portrait });
const node = (id, evidence, meshes, positioning = layout(), label = '') => ({ id, evidence, label, meshes, layout: positioning });

function coast(sentence, second) {
  const land = [box('#d6bb8d', [2, -1.35, 0], [5, .6, 5.3]), box('#b6be8c', [3, -1, 0], [2.7, .08, 5.3]), box('#9ca597', [1.6, -.94, 0], [.7, .08, 5.25])];
  const sea = [box('#367f99', [-2.65, -1.36, 0], [4.4, .56, 5.3]), box('#75baca', [-2.65, -1.05, 0], [4.4, .07, 5.3])];
  for (let i = 0; i < 7; i++) sea.push(tube('#a9d9d4', [[-4.7, -.99, -2.35 + i * .75], [-3.7, -.975, -2.23 + i * .75], [-2.7, -.99, -2.35 + i * .75]], .018));
  for (let i = 0; i < 9; i++) land.push(box('#eae6c9', [1.6, -.88, -2.1 + i * .5], [.055, .01, .22]));
  const buildings = [];
  for (const [x, z, h, w, color] of [[2.65, -1.6, 2.25, .92, '#dcd9c2'], [2.8, .05, 2.8, 1.1, '#adc4b2'], [2.6, 1.65, 1.6, 1, '#e1bc94']]) {
    buildings.push(box(color, [x, -1 + h / 2, z], [w, h, 1.05]));
    buildings.push(box('#405d62', [x, -.97 + h, z], [w + .12, .1, 1.15]));
    for (let floor = 0; floor < Math.floor(h / .5); floor++) for (const side of [-1, 1]) {
      buildings.push(box('#547c89', [x + side * w * .26, -.6 + floor * .43, z + .535], [.18, .23, .035]));
      buildings.push(box('#688f99', [x - w / 2 - .02, -.6 + floor * .43, z + side * .25], [.025, .23, .18]));
    }
  }
  const waveProfile = [[-1.2,-1,0],[-1.18,-.48,0],[-.95,.15,0],[-.72,.6,0],[-.38,.98,0],[0,1.15,0],[.45,1.12,0],[.74,.9,0],[.83,.65,0],[.63,.74,0],[.32,.72,0],[.1,.47,0],[.08,.17,0],[.4,-.4,0],[.9,-1,0]];
  const wave = [mesh('extrude', '#52a4bc', [0, 0, -2.55], [1, 1, 5.1], { points: waveProfile, metalness: .3 }),
    tube('#e2f3e6', [[.44,1.12,-2.55],[.52,1.14,-1.4],[.4,1.12,0],[.52,1.16,1.4],[.44,1.12,2.55]], .10),
    tube('#b0dedb', [[-.9,.14,-2.55],[-.86,.2,-1.3],[-.9,.15,0],[-.86,.19,1.3],[-.9,.14,2.55]], .045)];
  const nodes = [node('sea', second ? 'água' : 'mar', sea), node('coast', second ? 'praia' : 'costa', land), node('buildings', 'prédios', buildings),
    node('wave', second ? 'água' : 'onda', wave, layout(pose(second ? .36 : .23, .5), pose(second ? .32 : .17, .5)))];
  const motions = [{ targetId: 'wave', kind: 'move', cueText: second ? 'alcança' : 'avança', durationSeconds: second ? 2.6 : 3.3,
    to: layout(pose(second ? .62 : .36, .5), pose(second ? .65 : .32, .5)) }];
  return { cueSentenceId: sentence.id, dimension: '3d', explanation: 'Uma maquete costeira mantém mar, praia e prédios no mesmo espaço; a crista de água avança em direção ao litoral, sem localização ou vítimas inventadas.', nodes, motions,
    camera: { landscape: { position: [8, 6.6, 12], target: [0, -.2, 0], fov: 29 }, portrait: { position: [10, 9, 15], target: [0, -.1, 0], fov: 34 } } };
}

function network(color) {
  const meshes = [];
  const positions = [];
  for (let layer = 0; layer < 3; layer++) for (let row = 0; row < 3; row++) positions.push([-.57 + layer * .57, -.48 + row * .48, .1 + (layer === 1 ? .25 : 0)]);
  for (let layer = 0; layer < 2; layer++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) meshes.push(tube('#a7c8bb', [positions[layer * 3 + a], positions[(layer + 1) * 3 + b]], .013));
  for (const p of positions) meshes.push(sphere(color, p, [.18, .18, .18], { metalness: .4 }));
  meshes.push(box('#193e49', [0, 0, -.16], [1.72, 1.55, .2], { metalness: .55 }));
  for (const y of [-.82, .82]) meshes.push(box(color, [0, y, -.04], [1.86, .055, .08]));
  for (const x of [-.91, .91]) meshes.push(box(color, [x, 0, -.04], [.055, 1.68, .08]));
  return meshes;
}

function chip(sentence, flow) {
  const base = [box('#172f39', [0, 0, -.65], [8.9, 3.4, .4], { metalness: .65 }), box('#376665', [0, 0, -.42], [8.5, 3.05, .09], { metalness: .4 })];
  for (let i = 0; i < 18; i++) for (const side of [-1, 1]) base.push(box('#d9b478', [-4 + i * .47, side * 1.95, -.7], [.17, .55, .14], { metalness: .85 }));
  for (const x of [-4.15, 4.15]) for (const y of [-1.28, 1.28]) base.push(mesh('cylinder', '#c8d4c2', [x,y,-.3],[.12,.06,.12],{rotation:[Math.PI/2,0,0],metalness:.7}));
  const centers = [.3, .5, .7], vertical = [.25, .5, .75];
  const nodes = [node('chip', 'chip', base, layout(pose(.5,.5,1),pose(.5,.5,.76,90)))];
  const color = ['#95d7bc', '#75baca', '#ecb47e'];
  for (let i = 0; i < 3; i++) nodes.push(node(`model-${i+1}`, flow ? ['primeiro modelo','segundo','terceiro'][i] : 'três modelos de linguagem', network(color[i]), layout(pose(centers[i],.5,1.12),pose(.5,vertical[i],.9)), flow ? ['primeiro modelo','segundo','terceiro'][i] : ''));
  const wirePoints = [[-2.4,0,.12],[0,0,.12],[2.4,0,.12]];
  nodes.push(node('connection', flow ? 'sinal passa' : 'modelos de linguagem', [tube('#6a9a9b',wirePoints,.035)], layout(pose(.5,.5),pose(.5,.5,.73,90))));
  const motions = [];
  if (flow) {
    nodes.push(node('signal', 'sinal', [sphere('#f3d49a',[0,0,.43],[.30,.30,.30],{metalness:.15}),mesh('torus','#f1c890',[0,0,.43],[.43,.43,.43])],layout(pose(.3,.5),pose(.5,.25))));
    motions.push({targetId:'signal',kind:'reveal',cueText:'sinal',durationSeconds:.25});
    motions.push({targetId:'signal',kind:'move',cueText:'segue',durationSeconds:.8,to:layout(pose(.5,.5),pose(.5,.5))});
    motions.push({targetId:'signal',kind:'move',cueText:'chega',durationSeconds:.85,to:layout(pose(.7,.5),pose(.5,.75))});
  } else {
    for (let i = 0; i < 3; i++) motions.push({targetId:`model-${i+1}`,kind:'reveal',cueText:'três',delaySeconds:i*.22,durationSeconds:.45});
  }
  return {cueSentenceId:sentence.id,dimension:'3d',explanation:'Esquema volumétrico de três modelos matemáticos dentro do mesmo chip; redes de pontos representam modelos, e um sinal percorre a sequência narrada. Não é uma arquitetura física verificada.',nodes,motions,
    camera:{landscape:{position:[1.4,3.6,13],target:[0,0,0],fov:29},portrait:{position:[1,2.2,14],target:[0,0,0],fov:34}}};
}
module.exports = sentences => sentences.map((sentence,index) => index < 2 ? coast(sentence,index===1) : chip(sentence,index===3));
