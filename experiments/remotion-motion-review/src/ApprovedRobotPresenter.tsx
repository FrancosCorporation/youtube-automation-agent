import React, { useEffect, useMemo } from "react";
import { ThreeCanvas } from "@remotion/three";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
// This experiment's installed `three` package does not include TypeScript declarations.
// @ts-expect-error Runtime package is present; declarations are not bundled by Three.js.
import { AnimationMixer, BufferAttribute, Box3, Quaternion, Vector3 } from "three";
// @ts-expect-error Runtime addon is present; declarations are not bundled by Three.js.
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
// @ts-expect-error Runtime addon is present; declarations are not bundled by Three.js.
import { clone } from "three/addons/utils/SkeletonUtils.js";
// @ts-expect-error Runtime addon is present; declarations are not bundled by Three.js.
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { useCurrentFrame, useVideoConfig } from "remotion";
import {
  approvedRobotArmDeltasAtFrame,
  approvedRobotIdleDeltasAtFrame,
  type ApprovedRobotGestureCues,
} from "./approved-robot-arm-motion.mjs";

import {
  createApprovedRobotAccentState,
  installApprovedRobotAccentShader,
  type ApprovedRobotAccents,
  type ApprovedRobotAccentState,
} from "./approved-robot-accents.mjs";

export type ApprovedRobotSide = "left" | "right";

export type ApprovedRobotAssetInfo = {
  bounds: { width: number; height: number; depth: number };
  skinCount: number;
  boneNames: string[];
  animationNames: string[];
  morphTargetNames: string[];
};

export type ApprovedRobotPresenterProps = {
  /** A Remotion staticFile() URL pointing at the approved GLB. */
  src: string;
  side: ApprovedRobotSide;
  /** Theme accents tint cyan LEDs and the antenna sphere; neutral armor stays authored. */
  accents?: ApprovedRobotAccents;
  /** Play one baked GLB clip by its exact name; omitted means preserve the authored bind pose. */
  animationClipName?: string;
  /** Narration-aligned frame cues for the presenter gestures. */
  gestureCues?: ApprovedRobotGestureCues;
  /** Normalized voice energy with one value per lipSyncFps frame. */
  lipSyncEnvelope?: readonly number[];
  lipSyncFps?: number;
  lipSyncOffsetFrames?: number;
  /** Optional exact canvas size in composition pixels. */
  canvasSize?: { width: number; height: number };
  style?: React.CSSProperties;
  onAssetInfo?: (info: ApprovedRobotAssetInfo) => void;
};

const NORMALIZED_MODEL_HEIGHT = 4;
const CAMERA_VERTICAL_SPAN = 5.1;
type VectorLike = {
  x: number;
  y: number;
  z: number;
  multiplyScalar: (value: number) => void;
  applyMatrix4: (matrix: MatrixLike) => VectorLike;
  applyQuaternion: (quaternion: QuaternionLike) => VectorLike;
  normalize: () => VectorLike;
};
type MatrixLike = object;
type BufferAttributeLike = { count: number };
type GeometryLike = {
  attributes: { position?: BufferAttributeLike };
  clone: () => GeometryLike;
  setAttribute: (name: string, attribute: unknown) => void;
  dispose?: () => void;
};
type BoundsLike = {
  min: VectorLike;
  getSize: (target: VectorLike) => VectorLike;
  getCenter: (target: VectorLike) => VectorLike;
};
type ModelNodeLike = {
  type: string;
  name: string;
  isSkinnedMesh?: boolean;
  morphTargetDictionary?: Record<string, number>;
  quaternion?: QuaternionLike;
  parent?: BoneParentLike | null;
  isBone?: boolean;
  getWorldQuaternion?: (target: QuaternionLike) => QuaternionLike;
  material?: MaterialLike | MaterialLike[];
  geometry?: GeometryLike;
  matrixWorld?: MatrixLike;
  getVertexPosition?: (index: number, target: VectorLike) => VectorLike;
};
type ModelLike = ModelNodeLike & {
  scale: VectorLike;
  position: VectorLike;
  updateMatrixWorld: (force?: boolean) => void;
  traverse: (callback: (node: ModelNodeLike) => void) => void;
};
type AnimationClipLike = { name: string };
type AnimationActionLike = { stop: () => void; reset: () => void; play: () => void };
type MixerLike = {
  time: number;
  clipAction: (clip: AnimationClipLike) => AnimationActionLike;
  stopAllAction: () => void;
  update: (seconds: number) => void;
};
type LoadedGltf = { scene: ModelLike; animations: AnimationClipLike[] };
type QuaternionLike = {
  x: number;
  y: number;
  z: number;
  w: number;
  copy: (value: QuaternionLike) => QuaternionLike;
  premultiply: (value: QuaternionLike) => QuaternionLike;
  clone: () => QuaternionLike;
  setFromAxisAngle: (axis: VectorLike, angle: number) => QuaternionLike;
};
type BoneParentLike = {
  getWorldQuaternion: (target: QuaternionLike) => QuaternionLike;
};
type BonePoseTarget = {
  bone: ModelNodeLike;
  bindQuaternion: QuaternionLike;
  worldZAxisInParent: VectorLike;
};
type IdlePoseTarget = {
  bone: ModelNodeLike;
  bindQuaternion: QuaternionLike;
  worldAxesInParent: Record<"x" | "y" | "z", VectorLike>;
};
type FaceUniform = { value: number };
type FaceShaderLike = {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
};
type MaterialLike = {
  clone: () => MaterialLike;
  onBeforeCompile?: (shader: FaceShaderLike) => void;
  customProgramCacheKey?: () => string;
  needsUpdate?: boolean;
  dispose?: () => void;
};
type FaceDisplayState = {
  accents: ApprovedRobotAccentState;
  blink: FaceUniform;
  mouthOpen: FaceUniform;
  materials: MaterialLike[];
  geometries: GeometryLike[];
};

const RIG_BONE_NAMES = [
  "mixamorigLeftShoulder",
  "mixamorigLeftArm",
  "mixamorigLeftForeArm",
  "mixamorigLeftHand",
  "mixamorigRightShoulder",
  "mixamorigRightArm",
  "mixamorigRightForeArm",
  "mixamorigRightHand",
] as const;

const normalizedBoneName = (name: string) => name.replace(/[^a-z0-9]/gi, "");

const installFaceDisplay = (model: ModelLike): FaceDisplayState => {
  const state: FaceDisplayState = {
    accents: createApprovedRobotAccentState(),
    blink: { value: 0 },
    mouthOpen: { value: 0 },
    materials: [],
    geometries: [],
  };
  model.traverse((node) => {
    if (!node.isSkinnedMesh || !node.material) return;
    if (!node.geometry?.attributes.position || !node.getVertexPosition || !node.matrixWorld) {
      throw new Error("A malha facial aprovada precisa expor posições skinned para fixar a máscara ao rosto.");
    }
    const geometry = node.geometry.clone();
    const positionAttribute = geometry.attributes.position;
    if (!positionAttribute) throw new Error("A malha facial aprovada precisa expor posições de vértice.");
    const vertexCount = positionAttribute.count;
    const restPositions = new Float32Array(vertexCount * 3);
    const vertex = new Vector3() as VectorLike;
    for (let index = 0; index < vertexCount; index += 1) {
      node.getVertexPosition(index, vertex);
      vertex.applyMatrix4(node.matrixWorld);
      restPositions[index * 3] = vertex.x;
      restPositions[index * 3 + 1] = vertex.y;
      restPositions[index * 3 + 2] = vertex.z;
    }
    geometry.setAttribute("approvedRestPosition", new BufferAttribute(restPositions, 3));
    node.geometry = geometry;
    state.geometries.push(geometry);

    const originalMaterials = Array.isArray(node.material) ? node.material : [node.material];
    const faceMaterials = originalMaterials.map((original) => {
      const material = original.clone();
      const originalCacheKey = material.customProgramCacheKey?.bind(material) ?? (() => "");
      material.customProgramCacheKey = () => `${originalCacheKey()}:approvedRobotFaceDisplayV1`;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uApprovedRobotBlink = state.blink;
        shader.uniforms.uApprovedRobotMouthOpen = state.mouthOpen;
        shader.vertexShader = shader.vertexShader.replace(
          "#include <common>",
          "#include <common>\nattribute vec3 approvedRestPosition;\nvarying vec3 vApprovedRobotPosition;",
        );
        shader.vertexShader = shader.vertexShader.replace(
          "#include <skinning_vertex>",
          "#include <skinning_vertex>\nvApprovedRobotPosition = approvedRestPosition;",
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <common>",
          "#include <common>\nuniform float uApprovedRobotBlink;\nuniform float uApprovedRobotMouthOpen;\nvarying vec3 vApprovedRobotPosition;",
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          vec3 approvedFacePoint = vApprovedRobotPosition;
          float approvedFaceFront = smoothstep(0.31, 0.43, approvedFacePoint.z);
          float approvedLeftEye = 1.0 - smoothstep(0.92, 1.08, length(vec2((approvedFacePoint.x + 0.32) / 0.2, (approvedFacePoint.y - 3.0) / 0.19)));
          float approvedRightEye = 1.0 - smoothstep(0.92, 1.08, length(vec2((approvedFacePoint.x - 0.32) / 0.2, (approvedFacePoint.y - 3.0) / 0.19)));
          float approvedEyeArea = max(approvedLeftEye, approvedRightEye) * approvedFaceFront * uApprovedRobotBlink;
          vec3 approvedVisorColor = vec3(0.008, 0.018, 0.023);
          float approvedEyeLineL = (1.0 - smoothstep(0.012, 0.026, abs(approvedFacePoint.y - 3.0))) * (1.0 - smoothstep(0.105, 0.13, abs(approvedFacePoint.x + 0.32)));
          float approvedEyeLineR = (1.0 - smoothstep(0.012, 0.026, abs(approvedFacePoint.y - 3.0))) * (1.0 - smoothstep(0.105, 0.13, abs(approvedFacePoint.x - 0.32)));
          float approvedEyeLine = max(approvedEyeLineL, approvedEyeLineR) * approvedFaceFront * uApprovedRobotBlink;
          float approvedMouthRegion = (1.0 - smoothstep(0.9, 1.08, length(vec2(approvedFacePoint.x / 0.29, (approvedFacePoint.y - 2.8) / 0.17)))) * approvedFaceFront;
          float approvedSpeaking = smoothstep(0.07, 0.2, uApprovedRobotMouthOpen);
          float approvedMouthPatch = approvedMouthRegion * approvedSpeaking;
          float approvedMouthHeight = 0.018 + 0.052 * uApprovedRobotMouthOpen;
          float approvedMouthOuter = 1.0 - smoothstep(0.86, 1.02, length(vec2(approvedFacePoint.x / 0.17, (approvedFacePoint.y - 2.8) / approvedMouthHeight)));
          float approvedMouthInner = 1.0 - smoothstep(0.72, 0.92, length(vec2(approvedFacePoint.x / 0.135, (approvedFacePoint.y - 2.8) / max(0.008, approvedMouthHeight - 0.01))));
          float approvedMouthOpening = approvedMouthInner * approvedSpeaking * approvedFaceFront;
          float approvedMouthRim = approvedMouthOuter * approvedSpeaking * approvedFaceFront;`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <opaque_fragment>",
          `#include <opaque_fragment>
          gl_FragColor.rgb = mix(gl_FragColor.rgb, approvedVisorColor, max(approvedEyeArea, approvedMouthPatch));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uApprovedRobotAccentPrimary, max(approvedEyeLine, approvedMouthRim));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.004, 0.008, 0.012), approvedMouthOpening);`,
        );
      };
      installApprovedRobotAccentShader(material, state.accents);
      material.needsUpdate = true;
      state.materials.push(material);
      return material;
    });
    node.material = Array.isArray(node.material) ? faceMaterials : faceMaterials[0];
  });
  if (state.materials.length === 0) {
    throw new Error("O GLB aprovado precisa conter material na malha facial para blink e lip-sync.");
  }
  return state;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const blinkAtFrame = (frame: number, fps: number) => {
  const time = Math.max(0, frame / fps);
  const intervals = [2.9, 3.4, 2.8, 3.8, 3.1];
  let nextBlink = 1.25;
  let intervalIndex = 0;
  while (nextBlink <= time && intervalIndex < 200) {
    nextBlink += intervals[intervalIndex % intervals.length];
    intervalIndex += 1;
  }
  const elapsed = time - nextBlink + (intervals[(intervalIndex - 1 + intervals.length) % intervals.length] ?? 0);
  if (elapsed < 0 || elapsed > 0.19) return 0;
  const close = clamp01(elapsed / 0.04);
  const open = clamp01((0.18 - elapsed) / 0.14);
  return Math.min(1, close, open);
};

const envelopeAtFrame = (
  envelope: readonly number[] | undefined,
  frame: number,
  fps: number,
  sampleFps: number,
  offsetFrames: number,
) => {
  if (!envelope?.length) return 0;
  const position = Math.max(0, ((frame - offsetFrames) / fps) * sampleFps);
  const index = Math.min(envelope.length - 1, Math.floor(position));
  const fraction = position - index;
  const left = envelope[index] ?? 0;
  const right = envelope[Math.min(envelope.length - 1, index + 1)] ?? left;
  const before = envelope[Math.max(0, index - 1)] ?? 0;
  const after = envelope[Math.min(envelope.length - 1, index + 2)] ?? 0;
  const amplitude = Math.min(1, (left * (1 - fraction) + right * fraction) * 0.65 + (before + after) * 0.175);
  return clamp01((amplitude - 0.035) / 0.3);
};

const captureArmBones = (model: ModelLike): Record<(typeof RIG_BONE_NAMES)[number], BonePoseTarget> => {
  const found = new Map<string, ModelNodeLike>();
  model.traverse((node) => {
    if (node.isBone || node.type === "Bone") found.set(normalizedBoneName(node.name), node);
  });
  const missing = RIG_BONE_NAMES.filter((name) => !found.has(name));
  if (missing.length) {
    throw new Error(`O rig Mixamo aprovado não contém os ossos de atuação: ${missing.join(", ")}`);
  }

  return Object.fromEntries(RIG_BONE_NAMES.map((name) => {
    const bone = found.get(name)!;
    if (!bone.quaternion || !bone.parent?.getWorldQuaternion) {
      throw new Error(`O osso ${name} não possui quaternion ou pai 3D válido.`);
    }
    const parentWorld = new Quaternion() as QuaternionLike & { invert: () => void };
    bone.parent.getWorldQuaternion(parentWorld);
    parentWorld.invert();
    const localAxis = new Vector3(0, 0, 1) as VectorLike & { applyQuaternion: (q: QuaternionLike) => void; normalize: () => void };
    localAxis.applyQuaternion(parentWorld);
    localAxis.normalize();
    return [name, {
      bone,
      bindQuaternion: bone.quaternion.clone(),
      worldZAxisInParent: localAxis,
    }];
  })) as unknown as Record<(typeof RIG_BONE_NAMES)[number], BonePoseTarget>;
};

const IDLE_BONE_NAMES = ["mixamorigSpine2", "mixamorigNeck", "mixamorigHead"] as const;

const captureIdleBones = (model: ModelLike): Record<(typeof IDLE_BONE_NAMES)[number], IdlePoseTarget> => {
  const found = new Map<string, ModelNodeLike>();
  model.traverse((node) => {
    if (node.isBone || node.type === "Bone") found.set(normalizedBoneName(node.name), node);
  });
  const missing = IDLE_BONE_NAMES.filter((name) => !found.has(name));
  if (missing.length) {
    throw new Error(`O rig Mixamo aprovado não contém os ossos de idle: ${missing.join(", ")}`);
  }

  return Object.fromEntries(IDLE_BONE_NAMES.map((name) => {
    const bone = found.get(name)!;
    if (!bone.quaternion || !bone.parent?.getWorldQuaternion) {
      throw new Error(`O osso ${name} não possui quaternion ou pai 3D válido.`);
    }
    const parentWorld = new Quaternion() as QuaternionLike & { invert: () => void };
    bone.parent.getWorldQuaternion(parentWorld);
    parentWorld.invert();
    const worldAxis = (x: number, y: number, z: number) => {
      const axis = new Vector3(x, y, z) as VectorLike;
      axis.applyQuaternion(parentWorld);
      axis.normalize();
      return axis;
    };
    return [name, {
      bone,
      bindQuaternion: bone.quaternion.clone(),
      worldAxesInParent: {
        x: worldAxis(1, 0, 0),
        y: worldAxis(0, 1, 0),
        z: worldAxis(0, 0, 1),
      },
    }];
  })) as unknown as Record<(typeof IDLE_BONE_NAMES)[number], IdlePoseTarget>;
};

const CameraAim: React.FC<{ targetY: number }> = ({ targetY }) => {
  const { camera } = useThree();

  useFrame(() => {
    camera.position.set(0, targetY, 10);
    camera.lookAt(0, targetY, 0);
    camera.updateProjectionMatrix();
  }, -200);

  return null;
};

const ApprovedRobotModel: React.FC<{
  src: string;
  frame: number;
  fps: number;
  side: ApprovedRobotSide;
  accents?: ApprovedRobotAccents;
  animationClipName?: string;
  gestureCues?: ApprovedRobotGestureCues;
  lipSyncEnvelope?: readonly number[];
  lipSyncFps?: number;
  lipSyncOffsetFrames?: number;
  onAssetInfo?: (info: ApprovedRobotAssetInfo) => void;
}> = ({
  src,
  frame,
  fps,
  side,
  accents,
  animationClipName,
  gestureCues,
  lipSyncEnvelope,
  lipSyncFps,
  lipSyncOffsetFrames = 0,
  onAssetInfo,
}) => {
  const gltf = useLoader(GLTFLoader, src, (loader) => {
    loader.setMeshoptDecoder(MeshoptDecoder);
  }) as LoadedGltf;
  const model = useMemo(() => {
    const cloned = clone(gltf.scene) as ModelLike;
    cloned.updateMatrixWorld(true);

    // precise=true evaluates the bind-pose skinning and root rotation, so normalization
    // uses the visible GLB bounds rather than the unskinned accessor box.
    const sourceBounds = new Box3().setFromObject(cloned, true) as BoundsLike;
    const sourceSize = sourceBounds.getSize(new Vector3()) as VectorLike;
    if (!Number.isFinite(sourceSize.y) || sourceSize.y <= 0) {
      throw new Error("O GLB aprovado precisa ter altura 3D maior que zero.");
    }

    cloned.scale.multiplyScalar(NORMALIZED_MODEL_HEIGHT / sourceSize.y);
    cloned.updateMatrixWorld(true);
    const normalizedBounds = new Box3().setFromObject(cloned, true) as BoundsLike;
    const center = normalizedBounds.getCenter(new Vector3()) as VectorLike;
    cloned.position.x -= center.x;
    cloned.position.y -= normalizedBounds.min.y;
    cloned.position.z -= center.z;
    cloned.updateMatrixWorld(true);
    return cloned;
  }, [gltf.scene]);

  const armBones = useMemo(() => captureArmBones(model), [model]);
  const idleBones = useMemo(() => captureIdleBones(model), [model]);
  const faceDisplay = useMemo(() => installFaceDisplay(model), [model]);
  const accentState = useMemo(
    () => createApprovedRobotAccentState(accents),
    [accents],
  );

  const mixer = useMemo(() => new AnimationMixer(model) as MixerLike, [model]);
  const clip = useMemo(() => {
    if (!animationClipName) return null;
    return gltf.animations.find((candidate) => candidate.name === animationClipName) ?? null;
  }, [animationClipName, gltf.animations]);
  const action = useMemo(() => (clip ? mixer.clipAction(clip) : null), [clip, mixer]);

  useFrame(() => {
    if (action) {
      // Remotion may seek directly to arbitrary frames. Rebuild this baked pose from t=0
      // so the result never depends on renderer wall time or the previous requested frame.
      action.stop();
      action.reset();
      action.play();
      mixer.time = 0;
      mixer.update(Math.max(0, frame) / fps);
    }

    const pose = approvedRobotArmDeltasAtFrame(frame, fps, gestureCues, side);
    for (const name of RIG_BONE_NAMES) {
      const target = armBones[name];
      const delta = new Quaternion() as QuaternionLike;
      delta.setFromAxisAngle(target.worldZAxisInParent, pose[name]);
      // If a baked clip is selected, layer the gesture over that frame's clip pose.
      // Without a clip, start from bind pose so seeking never accumulates rotations.
      const frameBase = action ? target.bone.quaternion!.clone() : target.bindQuaternion;
      target.bone.quaternion!.copy(frameBase).premultiply(delta);
    }
    const idlePose = approvedRobotIdleDeltasAtFrame(frame, fps);
    for (const name of IDLE_BONE_NAMES) {
      const target = idleBones[name];
      const angles = idlePose[name];
      const frameBase = action ? target.bone.quaternion!.clone() : target.bindQuaternion.clone();
      for (const axisName of ["x", "y", "z"] as const) {
        const angle = angles[axisName];
        if (angle === 0) continue;
        const delta = new Quaternion() as QuaternionLike;
        delta.setFromAxisAngle(target.worldAxesInParent[axisName], angle);
        frameBase.premultiply(delta);
      }
      target.bone.quaternion!.copy(frameBase);
    }
    faceDisplay.accents.enabled.value = accentState.enabled.value;
    faceDisplay.accents.primary.value = accentState.primary.value;
    faceDisplay.accents.secondary.value = accentState.secondary.value;
    faceDisplay.blink.value = blinkAtFrame(frame, fps);
    faceDisplay.mouthOpen.value = envelopeAtFrame(
      lipSyncEnvelope,
      frame,
      fps,
      lipSyncFps ?? fps,
      lipSyncOffsetFrames,
    );
    model.updateMatrixWorld(true);
  }, -100);

  useEffect(() => {
    if (!onAssetInfo) return;
    const sourceBounds = new Box3().setFromObject(gltf.scene, true) as BoundsLike;
    const size = sourceBounds.getSize(new Vector3()) as VectorLike;
    const boneNames: string[] = [];
    const morphTargetNames = new Set<string>();
    let skinCount = 0;
    gltf.scene.traverse((node) => {
      if (node.type === "Bone") boneNames.push(node.name);
      if (node.isSkinnedMesh) skinCount += 1;
      Object.keys(node.morphTargetDictionary ?? {}).forEach((name) => morphTargetNames.add(name));
    });
    onAssetInfo({
      bounds: { width: size.x, height: size.y, depth: size.z },
      skinCount,
      boneNames: boneNames.sort(),
      animationNames: gltf.animations.map(({ name }) => name),
      morphTargetNames: [...morphTargetNames].sort(),
    });
  }, [gltf, onAssetInfo]);

  useEffect(
    () => () => {
      mixer.stopAllAction();
      faceDisplay.materials.forEach((material) => material.dispose?.());
      faceDisplay.geometries.forEach((geometry) => geometry.dispose?.());
    },
    [faceDisplay, mixer],
  );

  return <primitive object={model} dispose={null} />;
};

/**
 * Real approved GLB presenter layer. The source mesh is cloned and normalized to a
 * four-unit world height using evaluated skinned bounds. Arm cues layer as local
 * quaternions over the verified Mixamo bind pose; the face shader masks only the
 * approved display for deterministic blinking and audio-envelope lip sync.
 */
export const ApprovedRobotPresenter: React.FC<ApprovedRobotPresenterProps> = ({
  src,
  side,
  accents,
  animationClipName,
  gestureCues,
  lipSyncEnvelope,
  lipSyncFps,
  lipSyncOffsetFrames,
  canvasSize,
  style,
  onAssetInfo,
}) => {
  const frame = useCurrentFrame();
  const { fps, width: videoWidth, height: videoHeight } = useVideoConfig();
  const canvasWidth = Math.max(1, Math.round(canvasSize?.width ?? videoWidth * 0.31));
  const canvasHeight = Math.max(1, Math.round(canvasSize?.height ?? videoHeight * 0.92));
  const cameraZoom = canvasHeight / CAMERA_VERTICAL_SPAN;

  return (
    <div
      aria-label="Apresentador 3D aprovado"
      style={{
        position: "absolute",
        top: "4%",
        height: `${(canvasHeight / videoHeight) * 100}%`,
        left: side === "left" ? "2.5%" : undefined,
        right: side === "right" ? "2.5%" : undefined,
        width: `${(canvasWidth / videoWidth) * 100}%`,
        overflow: "visible",
        pointerEvents: "none",
        ...style,
      }}
    >
      <ThreeCanvas
        width={canvasWidth}
        height={canvasHeight}
        orthographic
        camera={{ position: [0, 2, 10], zoom: cameraZoom, near: 0.1, far: 100 }}
        gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        <CameraAim targetY={NORMALIZED_MODEL_HEIGHT / 2} />
        <ambientLight intensity={0.55} />
        <hemisphereLight args={[0xf5f6ed, 0x223435, 1.35]} />
        <directionalLight position={[-3.5, 5, 5]} intensity={2.25} color={0xfff4e7} />
        <directionalLight position={[4, 2, 3]} intensity={1.05} color={0xa7ded0} />
        <directionalLight position={[0, 4, -4]} intensity={1.8} color={0xb8d8ff} />
        <ApprovedRobotModel
          src={src}
          frame={frame}
          fps={fps}
          side={side}
          accents={accents}
          animationClipName={animationClipName}
          gestureCues={gestureCues}
          lipSyncEnvelope={lipSyncEnvelope}
          lipSyncFps={lipSyncFps}
          lipSyncOffsetFrames={lipSyncOffsetFrames}
          onAssetInfo={onAssetInfo}
        />
      </ThreeCanvas>
    </div>
  );
};
