import React, { useLayoutEffect, useMemo } from "react";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import { Easing, interpolate, useVideoConfig } from "remotion";
// @ts-expect-error Runtime Three.js is installed; this project does not bundle its declarations.
import { CatmullRomCurve3, PerspectiveCamera, Vector3, Shape, ExtrudeGeometry } from "three";
// @ts-expect-error Three.js addon runtime follows the same declaration policy.
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { IllustrationMesh, IllustrationNode, NarrativeIllustration } from "../../../utils/narrative-illustration-plan.js";
import { animationState, type AnimationState } from "../../../utils/narrative-animation-tracks.js";
import { NarrativeIllustratedProp } from "./NarrativeDirectedScene";

const progress = (frame: number, start: number, end: number) => interpolate(frame, [start, Math.max(start + 1, end)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(.4, 0, .2, 1) });
const mix = (a: number, b: number, p: number) => a + (b - a) * p;
const DirectedCamera: React.FC<{ position: [number,number,number]; target: [number,number,number]; fov: number }> = ({ position, target, fov }) => {
  const { camera, invalidate } = useThree();
  useLayoutEffect(() => {
    camera.position.set(...position);
    camera.lookAt(...target);
    if ('fov' in camera) camera.fov = fov;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(); invalidate();
  }, [camera, position, target, fov, invalidate]);
  return null;
};
export function illustrationPose(node: IllustrationNode, illustration: NarrativeIllustration, aspect: "landscape" | "portrait", frame: number) {
  const state = { ...node.layout[aspect], opacity: 1, draw: 1 };
  for (const motion of illustration.motions.filter(item => item.targetId === node.id).sort((a, b) => a.startFrame - b.startFrame)) {
    const p = progress(frame, motion.startFrame, motion.endFrame);
    if (motion.kind === "reveal") state.opacity = p;
    if (motion.kind === "draw") state.draw = p;
    if (motion.kind === "move" && motion.to) {
      const to = motion.to[aspect];
      state.x = mix(state.x, to.x, p); state.y = mix(state.y, to.y, p);
      state.scale = mix(state.scale, to.scale, p); state.rotate = mix(state.rotate, to.rotate, p);
    }
    if (motion.kind === "rotate") state.rotate += (motion.amount || 0) * p;
    if (motion.kind === "scale") state.scale *= mix(1, motion.amount || 1, p);
  }
  return state;
}

type V3 = [number, number, number];
const add = (a: V3, b: V3 = [0, 0, 0]): V3 => a.map((v, i) => v + b[i]) as V3;
const multiply = (a: V3, b: V3 = [1, 1, 1]): V3 => a.map((v, i) => v * b[i]) as V3;
const Mesh: React.FC<{ mesh: IllustrationMesh; draw: number; opacity: number; animation: AnimationState }> = ({ mesh, draw, opacity, animation }) => {
  const roundedBox = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 3, .045), []);
  const points = mesh.points;
  const extrusion = useMemo(() => {
    const shape = new Shape();
    const outline = points || [[-.5, -.5, 0], [.5, -.5, 0], [.5, .5, 0], [-.5, .5, 0]];
    outline.forEach((point, index) => index ? shape.lineTo(point[0], point[1]) : shape.moveTo(point[0], point[1]));
    shape.closePath();
    return new ExtrudeGeometry(shape, { depth: mesh.size[2], bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .035, bevelThickness: .025 });
  }, [points, mesh.size]);
  const curve = useMemo(() => new CatmullRomCurve3((points || [[0, 0, 0], [1, 0, 0]]).map(point => new Vector3(...point))), [points]);
  const visibleCurve = useMemo(() => new CatmullRomCurve3(Array.from({ length: 33 }, (_, index) => curve.getPoint(index / 32 * Math.max(.001, draw)))), [curve, draw]);
  const scale: V3 = mesh.type === "tube" ? [1, 1, 1] : mesh.type === "extrude" ? [mesh.size[0], mesh.size[1], 1] : mesh.size;
  const alpha = mesh.opacity * opacity * (animation.opacity ?? 1);
  return <mesh position={add(mesh.position, animation.position3d)} rotation={add(mesh.rotation, animation.rotation3d)} scale={multiply(scale, animation.scale3d)} castShadow receiveShadow visible={alpha > .001}>
    {mesh.type === "box" && <primitive object={roundedBox} attach="geometry" />}
    {mesh.type === "sphere" && <sphereGeometry args={[.5, 32, 24]} />}
    {mesh.type === "cylinder" && <cylinderGeometry args={[.5, .5, 1, 40]} />}
    {mesh.type === "cone" && <coneGeometry args={[.5, 1, 40]} />}
    {mesh.type === "torus" && <torusGeometry args={[.5, .12, 16, 56, Math.PI * 2 * draw]} />}
    {mesh.type === "tube" && <tubeGeometry args={[visibleCurve, 64, mesh.size[0], 10, false]} />}
    {mesh.type === "extrude" && <primitive object={extrusion} attach="geometry" />}
    <meshStandardMaterial color={mesh.color} roughness={.36} metalness={mesh.metalness} opacity={alpha}
      transparent={alpha < 1} depthWrite={alpha >= .95} />
  </mesh>;
};

export const NarrativeIllustrationScene: React.FC<{ illustration: NarrativeIllustration; frame: number; portrait: boolean; side: "left" | "right" }> = ({ illustration, frame, portrait, side }) => {
  const { width, height } = useVideoConfig();
  const aspect = portrait ? "portrait" : "landscape";
  const is3d = illustration.dimension === "3d";
  const sceneWidth = Math.round(width * (portrait ? .92 : is3d ? .88 : .64)), sceneHeight = Math.round(height * (portrait ? .42 : .62));
  const canvasWidth = portrait ? 900 : 1100, canvasHeight = portrait ? 730 : 650;
  const worldWidth = portrait ? 9.6 : 12;
  const states = illustration.nodes.map(node => {
    const pose = illustrationPose(node, illustration, aspect, frame);
    const animation = animationState(illustration.tracks, node.id, frame);
    return { node, pose, position: add([(pose.x - .5) * worldWidth, (.5 - pose.y) * 7, node.depth], animation.position3d),
      rotation: add([0, 0, pose.rotate * Math.PI / 180], animation.rotation3d), scale: multiply([pose.scale, pose.scale, pose.scale], animation.scale3d), opacity: pose.opacity * (animation.opacity ?? 1) };
  });
  const baseCamera = illustration.camera?.[aspect] || { position: [0, 2.6, 15] as V3, target: [0, 0, 0] as V3, fov: 34 };
  const cameraAnimation = animationState(illustration.tracks, "camera", frame);
  // Camera tracks are offsets, preserving the independently directed aspect views.
  const cameraPlan = { ...baseCamera, position: add(baseCamera.position, cameraAnimation.position3d), target: add(baseCamera.target, cameraAnimation.target3d) };
  const camera = new PerspectiveCamera(cameraPlan.fov, sceneWidth / sceneHeight, .1, 100);
  camera.position.set(...cameraPlan.position); camera.lookAt(...cameraPlan.target); camera.updateMatrixWorld();
  const labelPosition = (x: number, y: number, z: number) => {
    const projected = new Vector3(x, y, z).project(camera);
    return { left: `${(projected.x + 1) * 50}%`, top: `${(-projected.y + 1) * 50}%` };
  };
  return <div data-qa="adaptive-illustration" data-dimension={illustration.dimension} data-cue={illustration.cueSentenceId}
    style={{ position: "absolute", left: portrait ? "4%" : is3d ? "3%" : side === "left" ? "35%" : "3%", top: portrait ? "21%" : "22%", width: sceneWidth, height: sceneHeight }}>
    {illustration.dimension === "3d" ? <>
      <ThreeCanvas width={sceneWidth} height={sceneHeight} camera={{ position: cameraPlan.position, rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z], fov: cameraPlan.fov }} shadows gl={{ alpha: true, antialias: true }}>
        <DirectedCamera {...cameraPlan} />
        <ambientLight intensity={1.2} /><hemisphereLight args={["#e7f4ee", "#31536a", 2]} />
        <directionalLight position={[-5, 7, 8]} intensity={3} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[6, 1, -3]} intensity={2} color="#88dccc" />
        {states.map(({ node, pose, position, rotation, scale, opacity }) => <group key={node.id} position={position}
          rotation={rotation} scale={scale} visible={opacity > .001}>
          {node.meshes.map((mesh, index) => <Mesh key={index} mesh={mesh} draw={pose.draw} opacity={opacity} animation={animationState(illustration.tracks, node.id, frame, index)} />)}
        </group>)}
      </ThreeCanvas>
      {states.filter(({ node }) => node.label).map(({ node, position, opacity }) => <div key={node.id} style={{ position: "absolute", ...labelPosition(position[0], position[1] - .65, position[2]),
        color: "#f3eee0", background: "#09212ad9", padding: "5px 10px", borderRadius: 5, fontSize: portrait ? 22 : 22, fontWeight: 600, transform: "translate(-50%,0)", opacity }}>{node.label}</div>)}
    </> : <svg width="100%" height="100%" viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}>
      <defs>
        <linearGradient id="direct-metal" x2=".8" y2="1"><stop stopColor="#ccddd0" /><stop offset="1" stopColor="#587e78" /></linearGradient>
        <linearGradient id="direct-paper" x2=".8" y2="1"><stop stopColor="#f9f4e5" /><stop offset="1" stopColor="#c7d4bf" /></linearGradient>
        <linearGradient id="direct-dark" x2="0" y2="1"><stop stopColor="#527a6e" /><stop offset="1" stopColor="#213f3e" /></linearGradient>
        <linearGradient id="direct-shirt" x2="1" y2="1"><stop stopColor="#b2d8b8" /><stop offset="1" stopColor="#6ca894" /></linearGradient>
      </defs>
      {states.map(({ node, pose, opacity }) => <g key={node.id} transform={`translate(${pose.x * canvasWidth} ${pose.y * canvasHeight}) rotate(${pose.rotate}) scale(${pose.scale})`} opacity={opacity}>
        {node.prop && <NarrativeIllustratedProp entity={{ visual: node.prop, kind: "illustration", label: node.label }} fill={pose.draw} frame={frame} />}
        {node.shapes.map(({ type, ...attrs }, index) => React.createElement(type, { key: index, ...attrs,
          ...(type === "path" || type === "line" ? { pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - pose.draw } : {}),
          opacity: (attrs.opacity ?? 1) * (attrs.fill === "none" ? 1 : pose.draw), strokeLinecap: "round", strokeLinejoin: "round" }))}
        {node.label && <text textAnchor="middle" y="195" fontFamily="Arial" fontSize="24" fontWeight="600" fill="#f3eee0">{node.label}</text>}
      </g>)}
    </svg>}
    <div style={{ position: "absolute", bottom: "8%", left: "3%", fontSize: 18, letterSpacing: 1.5, color: "#a2bbb0" }}>ILUSTRAÇÃO {illustration.dimension === "3d" ? "3D" : "EDITORIAL"} • ESQUEMA EXPLICATIVO</div>
  </div>;
};
