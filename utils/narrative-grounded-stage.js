'use strict';
const { bodyAt, auditSpatialChecks } = require('./narrative-spatial-audit');
const { actorSupportState, supportSurfaces } = require('./narrative-actor-support');
const { solidRole } = require('./narrative-solid-role');
const aspects = ['landscape', 'portrait'];
const moving = (drawing, id) => (drawing.tracks || []).some(track => track.targetId === id && track.property !== 'opacity'
  && track.keyframes.some(key => JSON.stringify(key.value) !== JSON.stringify(track.keyframes[0].value)));
const levelPath = (drawing, id) => !(drawing.motions || []).some(m => m.targetId === id && !['draw', 'reveal'].includes(m.kind))
  && !(drawing.tracks || []).some(t => t.targetId === id && (t.property === 'scale3d'
    || t.property === 'rotation3d' && t.keyframes.some(k => k.value[0] !== 0 || k.value[2] !== 0)
    || t.property === 'position3d' && t.keyframes.some(k => k.value[1] !== t.keyframes[0].value[1])));
const keyFrames = (drawing, sentence) => [...new Set([sentence.startFrame, sentence.endFrame,
  ...drawing.tracks.flatMap(t => t.keyframes.map(k => k.frame))])].filter(f => f >= sentence.startFrame && f <= sentence.endFrame);
const extent = body => [0, 1, 2].map(axis => body.half.reduce((s, v, i) => s + v * Math.abs(body.axes[i][axis]), 0));
function sweptBounds(drawing, ref, aspect, frames) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const frame of frames) {
    const body = bodyAt(drawing, ref, aspect, frame), half = extent(body);
    for (let axis = 0; axis < 3; axis++) { lo[axis] = Math.min(lo[axis], body.center[axis] - half[axis]); hi[axis] = Math.max(hi[axis], body.center[axis] + half[axis]); }
  }
  return { lo, hi };
}

// Reconstruct a physical floor/support relationship, then translate an
// initially intersecting actor's entire path to the nearest free side. The
// caller still runs every ordinary swept, foot support and framing check.
function repairGroundedStage(drawing, sentence) {
  if (drawing.dimension !== '3d' || !drawing.nodes.some(n => n.actorId)) return drawing;
  const solids = drawing.nodes.flatMap(node => node.actorId ? [{ nodeId: node.id }] : node.meshes.map((_, meshIndex) => ({ nodeId: node.id, meshIndex })));
  if (solids.length > 128 || drawing.nodes.some(node => node.meshes.some(m => !['box', 'sphere', 'cylinder'].includes(m.type)))) return drawing;
  const floors = solids.filter(ref => {
    const node = drawing.nodes.find(n => n.id === ref.nodeId), mesh = node.meshes[ref.meshIndex];
    return mesh?.type === 'box' && mesh.size[1] <= .3 && mesh.size[0] >= 4 && mesh.size[2] >= 4
      && mesh.rotation.every(v => v === 0) && aspects.every(a => node.layout[a].rotate === 0) && !moving(drawing, node.id);
  });
  if (floors.length !== 1) return drawing;
  const floorRef = floors[0], frames = keyFrames(drawing, sentence), candidate = globalThis.structuredClone(drawing);
  // The uniquely identified ground is the reference surface, not furniture
  // resting on itself. A writer may have supplied the table role for a slab;
  // leaving it there also makes the renderer replace the slab with table legs.
  delete candidate.nodes.find(node => node.id === floorRef.nodeId).solidRole;
  const shifted = new Set();
  // The catalog contains grounded clips, not root-pivot tilting/somersaults.
  // Small whole-body pitch/roll used as a gesture is replaced by the authored
  // skeletal clip; heading, timing and clip selection remain unchanged.
  for (const node of candidate.nodes.filter(n => n.actorId)) for (const track of candidate.tracks.filter(t => t.targetId === node.id && t.property === 'rotation3d')) {
    if (track.keyframes.every(k => Math.abs(k.value[0]) <= .35 && Math.abs(k.value[2]) <= .35)) {
      for (const key of track.keyframes) { key.value[0] = 0; key.value[2] = 0; }
    }
  }
  function align(node, aspect, top, refs) {
    if (!levelPath(candidate, node.id) || node.layout[aspect].rotate !== 0) return false;
    const bottom = Math.min(...refs.map(ref => { const b = bodyAt(candidate, ref, aspect, sentence.startFrame); return b.center[1] - extent(b)[1]; }));
    const y = node.layout[aspect].y - (top - bottom) / 7;
    if (y < .02 || y > .98) return false;
    if (Math.abs(y - node.layout[aspect].y) > 1e-8) { node.layout[aspect].y = y; shifted.add(node.id); }
    return true;
  }
  for (const aspect of aspects) {
    const floor = bodyAt(candidate, floorRef, aspect, sentence.startFrame), top = floor.center[1] + floor.half[1];
    // Preserve objects that already rested on a table before its Y repair.
    const children = [];
    for (const parent of drawing.nodes.filter(n => solidRole(n) === 'table' && !moving(drawing, n.id))) {
      const parentRefs = solids.filter(ref => ref.nodeId === parent.id);
      for (const node of drawing.nodes.filter(n => !n.actorId && n.id !== parent.id && n.id !== floorRef.nodeId && !solidRole(n))) {
        const refs = solids.filter(ref => ref.nodeId === node.id);
        if (refs.length === 1 && parentRefs.some(ref => actorSupportState(bodyAt(drawing, refs[0], aspect, sentence.startFrame), bodyAt(drawing, ref, aspect, sentence.startFrame)).supported)) {
          children.push({ nodeId: node.id, parentId: parent.id, beforeY: parent.layout[aspect].y });
        }
      }
    }
    for (const node of candidate.nodes) {
      if (node.id === floorRef.nodeId || !node.actorId && !['table', 'chair', 'wall'].includes(solidRole(node))) continue;
      align(node, aspect, top, solids.filter(ref => ref.nodeId === node.id));
    }
    for (const child of children) {
      const node = candidate.nodes.find(n => n.id === child.nodeId), parent = candidate.nodes.find(n => n.id === child.parentId);
      const y = node.layout[aspect].y + parent.layout[aspect].y - child.beforeY;
      if (y >= .02 && y <= .98 && Math.abs(y - node.layout[aspect].y) > 1e-8) { node.layout[aspect].y = y; shifted.add(node.id); }
    }
    for (const bag of candidate.nodes.filter(n => solidRole(n) === 'bag')) {
      if (!candidate.nodes.some(n => n.actorMotion === 'Use / press') || candidate.nodes.some(n => /^Carry/.test(n.actorMotion || ''))) continue;
      const tables = candidate.nodes.filter(n => solidRole(n) === 'table' && n.meshes.length === 1 && !moving(candidate, n.id));
      if (tables.length !== 1 || bag.meshes.length !== 1 || !levelPath(candidate, bag.id)) continue;
      const table = bodyAt(candidate, { nodeId: tables[0].id, meshIndex: 0 }, aspect, sentence.startFrame);
      const ref = { nodeId: bag.id, meshIndex: 0 }, bounds = sweptBounds(candidate, ref, aspect, frames);
      const dz = Math.max(table.center[2] - table.half[2] + .02 - bounds.lo[2], Math.min(0, table.center[2] + table.half[2] - .02 - bounds.hi[2]));
      if (Math.abs(dz) > 2.5 || bag.depth + dz < -4 || bag.depth + dz > 4 || bounds.lo[0] < table.center[0] - table.half[0] || bounds.hi[0] > table.center[0] + table.half[0]) continue;
      if (Math.abs(dz) > 1e-8) { bag.depth += dz; shifted.add(bag.id); }
      align(bag, aspect, table.center[1] + table.half[1], [ref]);
    }
  }
  const actors = candidate.nodes.filter(n => n.actorId && levelPath(candidate, n.id));
  // Audit all solids around shifted props/actors, preserving original pairs.
  const covered = new Set([...shifted, ...actors.map(n => n.id)]);
  for (const nodeId of covered) for (const subject of solids.filter(ref => ref.nodeId === nodeId)) {
    const obstacles = solids.filter(ref => ref.nodeId !== nodeId);
    if (!candidate.spatialChecks.some(check => check.subject.nodeId === subject.nodeId && check.subject.meshIndex === subject.meshIndex
      && obstacles.every(ref => check.obstacles.some(other => other.nodeId === ref.nodeId && other.meshIndex === ref.meshIndex)))) {
      candidate.spatialChecks.push({ subject, obstacles });
    }
  }
  if (candidate.spatialChecks.length > 64) return drawing;
  let audit = auditSpatialChecks(candidate, sentence);
  const score = a => a.collisions.length * 1000 + a.collisions.reduce((s, hit) => s + hit.penetrationMeters, 0);
  for (let round = 0; round < actors.length * 2 && audit.collisions.length; round++) {
    let best, bestScore = score(audit);
    for (const actor of actors) {
      const suggestions = [];
      for (const hit of audit.collisions) {
        const other = hit.subject.nodeId === actor.id ? hit.obstacle : hit.obstacle.nodeId === actor.id ? hit.subject : null;
        if (!other) continue;
        const actorBounds = sweptBounds(candidate, { nodeId: actor.id }, hit.aspect, frames), otherBounds = sweptBounds(candidate, other, hit.aspect, frames);
        for (const axis of [0, 2]) for (const delta of [otherBounds.lo[axis] - actorBounds.hi[axis] - .03, otherBounds.hi[axis] - actorBounds.lo[axis] + .03]) {
          if (Math.abs(delta) > 1.5) continue;
          suggestions.push({ aspect: hit.aspect, axis, delta });
        }
      }
      suggestions.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
      for (const { aspect, axis, delta } of suggestions) {
        const trial = globalThis.structuredClone(candidate), node = trial.nodes.find(n => n.id === actor.id);
        if (axis === 0) node.layout[aspect].x += delta / (aspect === 'portrait' ? 9.6 : 12);
        else node.depth += delta;
        if (aspects.some(a => node.layout[a].x < .02 || node.layout[a].x > .98) || node.depth < -4 || node.depth > 4) continue;
        if (!aspects.every(a => frames.every(f => actorSupportState(bodyAt(trial, { nodeId: actor.id }, a, f), bodyAt(trial, floorRef, a, f)).supported))) continue;
        const checked = auditSpatialChecks(trial, sentence);
        if (score(checked) < bestScore) { best = trial; bestScore = score(checked); }
      }
    }
    if (!best) break;
    Object.assign(candidate, best); audit = auditSpatialChecks(candidate, sentence);
  }
  return candidate;
}
function assertGroundedFurniture(drawing, sentence) {
  if (drawing.dimension !== '3d' || !drawing.nodes.some(n => n.actorId)) return;
  const floors = drawing.nodes.flatMap(node => node.meshes.map((mesh, meshIndex) => ({node, mesh, meshIndex})))
    .filter(({node,mesh}) => mesh.type === 'box' && mesh.size[1] <= .3 && mesh.size[0] >= 4 && mesh.size[2] >= 4
      && mesh.rotation.every(v => v === 0) && aspects.every(a => node.layout[a].rotate === 0) && !moving(drawing,node.id));
  if (floors.length !== 1) return;
  const floorRef = {nodeId:floors[0].node.id,meshIndex:floors[0].meshIndex};
  for (const node of drawing.nodes.filter(n => n.id !== floorRef.nodeId && ['table','chair','wall'].includes(solidRole(n)))) {
    if (!levelPath(drawing,node.id) || node.meshes.some(m => !['box','sphere','cylinder'].includes(m.type))) continue;
    for (const aspect of aspects) {
      const floor = bodyAt(drawing,floorRef,aspect,sentence.startFrame);
      const bottom = Math.min(...node.meshes.map((_,meshIndex) => {const b=bodyAt(drawing,{nodeId:node.id,meshIndex},aspect,sentence.startFrame);return b.center[1]-extent(b)[1];}));
      const gap=bottom-floor.center[1]-floor.half[1];
      if(Math.abs(gap)>.04) throw new Error(`illustration: ${node.id} sem apoio no piso em ${aspect}; diferençaY=${Number(gap.toFixed(4))}; alinhe a base e preserve os objetos apoiados no móvel`);
    }
  }
  // A bag on a desk must not pass QA merely because it floats clear of every
  // obstacle. Carry clips are handled separately: their object follows hands,
  // so a floor/table requirement would reject a legitimate carried load.
  if (drawing.nodes.some(n => /^Carry/.test(n.actorMotion || ''))) return;
  const surfaces = [...supportSurfaces(drawing), ...drawing.nodes.filter(n => solidRole(n) === 'table')
    .flatMap(node => node.meshes.map((mesh, meshIndex) => ({nodeId:node.id,meshIndex})))];
  for (const node of drawing.nodes.filter(n => solidRole(n) === 'bag')) {
    if (node.meshes.length !== 1 || node.meshes[0].type !== 'box') continue;
    const frames = moving(drawing, node.id) ? Array.from({length: Math.ceil((sentence.endFrame-sentence.startFrame)*4)+1},
      (_,i) => Math.min(sentence.endFrame,sentence.startFrame+i/4)) : [sentence.startFrame];
    for (const aspect of aspects) for (const frame of frames) {
      const body = bodyAt(drawing,{nodeId:node.id,meshIndex:0},aspect,frame);
      if (body.opacity <= .05) continue;
      if (surfaces.some(ref => ref.nodeId !== node.id && actorSupportState(body,bodyAt(drawing,ref,aspect,frame)).supported)) continue;
      throw new Error(`illustration: ${node.id} flutua sem apoio em ${aspect}, frame ${frame}; mantenha a bolsa sobre o piso/tampo por todo o movimento ou use transporte com clip Carry e contato nas mãos`);
    }
  }
}
module.exports = { repairGroundedStage, assertGroundedFurniture };
