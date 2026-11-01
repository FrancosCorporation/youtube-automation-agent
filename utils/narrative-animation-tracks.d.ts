export type TrackKey = {cueSentenceId:string; cueText?:string; boundary:'start'|'end'|'word';offsetSeconds:number;frame:number;value:number | [number,number,number];easing:string};
export type AnimationTrack = {targetId:string;meshIndex?:number;property:'position3d'|'rotation3d'|'scale3d'|'opacity'|'target3d';keyframes:TrackKey[]};
export type AnimationState = {position3d?:[number,number,number];rotation3d?:[number,number,number];scale3d?:[number,number,number];opacity?:number;target3d?:[number,number,number]};
export function evaluateAnimationTrack(track:AnimationTrack,frame:number):number | [number,number,number];
export function animationState(tracks:AnimationTrack[] | undefined,targetId:string,frame:number,meshIndex?:number):AnimationState;
export function normalizeAnimationTracks(raw:unknown,nodes:Array<{id:string;meshes:unknown[]}>,sentences:Array<{id:string;text:string;startFrame:number;endFrame:number}>,fps:number):AnimationTrack[];
