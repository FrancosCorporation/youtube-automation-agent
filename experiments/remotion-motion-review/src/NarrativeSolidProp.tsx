import React, {useMemo} from "react";
// @ts-expect-error Three addon declarations follow the project's runtime policy.
import {RoundedBoxGeometry} from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

type V3 = [number, number, number];
type Props = {role: "table" | "chair" | "bag"; color: string; opacity: number};
// All parts stay inside the authored unit box: the same conservative volume
// remains valid for collisions, grounding and camera fitting.
export const NarrativeSolidProp: React.FC<Props> = ({role, color, opacity}) => {
  const geometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 3, .04), []);
  const part = (key: string, position: V3, scale: V3, materialColor = color) => <mesh key={key} position={position} scale={scale} castShadow receiveShadow>
    <primitive object={geometry} attach="geometry" />
    <meshStandardMaterial color={materialColor} roughness={.55} metalness={.08} opacity={opacity} transparent={opacity < 1} />
  </mesh>;
  if (role === "table") return <group>
    {part("top", [0, .44, 0], [1, .12, 1])}
    {[-.41,.41].flatMap(x => [-.41,.41].map(z => part(`leg-${x}-${z}`, [x, -.06, z], [.09, .88, .09], "#485956")))}
    {part("apron", [0, .3, .4], [.88, .14, .08])}
  </group>;
  if (role === "chair") return <group>
    {part("seat", [0, -.02, 0], [.95, .1, .95])}
    {part("back", [0, .27, -.43], [.9, .46, .12])}
    {[-.36,.36].flatMap(x => [-.36,.36].map(z => part(`leg-${x}-${z}`, [x, -.285, z], [.09, .43, .09], "#485956")))}
  </group>;
  return <group>
    {part("bag", [0, -.03, 0], [.83, .9, .66])}
    {part("pocket", [0, -.22, .36], [.63, .36, .17], "#385a62")}
    {part("zipper", [0, -.03, .45], [.58, .025, .025], "#e8d7af")}
    {[-.22,.22].map(x => part(`strap-${x}`, [x, -.02, -.38], [.1, .8, .13], "#163b3e"))}
    {part("handle", [0, .46, 0], [.3, .07, .12], "#163b3e")}
  </group>;
};
