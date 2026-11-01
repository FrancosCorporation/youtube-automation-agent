import React, { useLayoutEffect, useMemo } from "react";
import { useLoader } from "@react-three/fiber";
// @ts-expect-error Runtime Three.js is installed; this project does not bundle its declarations.
import { AnimationMixer, LoopOnce, LoopRepeat } from "three";
// @ts-expect-error Three.js addon runtime follows the same declaration policy.
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// @ts-expect-error Three.js addon runtime follows the same declaration policy.
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { staticFile } from "remotion";
import catalog from "../public/pulso-humans/catalog.json";

type AnimationClipLike = { name: string; duration: number };
type CloneableMaterial = { clone: () => CloneableMaterial };
type MeshLike = {
  isMesh?: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  frustumCulled: boolean;
  material: CloneableMaterial | CloneableMaterial[];
};
type ModelLike = { scene: unknown; animations: AnimationClipLike[] };
type ActorRootLike = {
  traverse: (visitor: (object: MeshLike) => void) => void;
  updateMatrixWorld: (force?: boolean) => void;
};

type Props = {
  actorId: string;
  motion: string;
  motionStartFrame: number;
  frame: number;
  fps: number;
  opacity: number;
};

export const NarrativeHumanActor: React.FC<Props> = ({ actorId, motion, motionStartFrame, frame, fps, opacity }) => {
  const actor = catalog.actors.find((entry) => entry.id === actorId);
  if (!actor) throw new Error(`Unknown narrative human actor: ${actorId}`);
  const loaded = useLoader(GLTFLoader, staticFile(`pulso-humans/${actor.file}`));
  const model = loaded as unknown as ModelLike;
  const state = useMemo(() => {
    const root = clone(model.scene) as ActorRootLike;
    root.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
      if (Array.isArray(object.material)) object.material = object.material.map((material) => material.clone());
      else object.material = object.material.clone();
    });
    const mixer = new AnimationMixer(root);
    const idleClip = model.animations.find((item) => item.name === "Idle");
    const clip = model.animations.find((item) => item.name === motion);
    if (!idleClip || !clip || !actor.animations.includes(motion)) throw new Error(`Animation ${motion} unavailable for ${actorId}`);
    return { root, mixer, clip, idleClip };
  }, [model, actorId, actor, motion]);

  useLayoutEffect(() => {
    state.mixer.stopAllAction();
    const idle = state.mixer.clipAction(state.idleClip);
    idle.reset().play();
    idle.setLoop(LoopRepeat, Infinity);
    idle.setEffectiveWeight(1);
    idle.time = ((frame / Math.max(1, fps)) % state.idleClip.duration + state.idleClip.duration) % state.idleClip.duration;
    if (motion !== "Idle") {
      const action = state.mixer.clipAction(state.clip);
      const looping = actor.loopingAnimations.includes(motion);
      action.reset().play();
      action.setLoop(looping ? LoopRepeat : LoopOnce, looping ? Infinity : 1);
      action.clampWhenFinished = !looping;
      const elapsedFrames = Math.max(0, frame - motionStartFrame);
      const elapsed = elapsedFrames / Math.max(1, fps);
      const blend = Math.max(0, Math.min(1, elapsedFrames / Math.max(1, Math.round(fps * .25))));
      action.setEffectiveWeight(blend);
      idle.setEffectiveWeight(1 - blend);
      action.time = looping
        ? ((elapsed % state.clip.duration) + state.clip.duration) % state.clip.duration
        : Math.min(elapsed, Math.max(0, state.clip.duration - 0.001));
    }
    state.mixer.update(0);
    state.root.updateMatrixWorld(true);
  }, [state, actor, motion, motionStartFrame, frame, fps]);

  return <primitive object={state.root} visible={opacity > 0.01} />;
};
