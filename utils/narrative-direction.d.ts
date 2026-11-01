export type DirectedEntity = { visual: string; kind: string; label: string; index?: number };
export type DirectedSentence = { id: string; text: string; startFrame: number; endFrame: number; wordTimings?: Array<{text: string; startFrame: number; endFrame?: number}> };
export type DirectedSource = { eligible?: boolean; sourceTitle?: string; sourceUrl?: string; sourceName?: string };
export type DirectedBeat = { version: number; cueSentenceId: string; kind: string; startFrame: number; endFrame: number; actionFrame: number; resultFrame: number; entities: DirectedEntity[]; conditional: boolean; resultAffirmed: boolean; subject?: DirectedEntity; origin?: DirectedEntity; destination?: DirectedEntity; intrusion?: boolean };
export function directNarrativeBeat(input: {sentence: DirectedSentence; source?: DirectedSource; previousSentence?: {text: string}; fps?: number}): DirectedBeat | null;
export function narrativeEntities(text: string): DirectedEntity[];
export function fallbackActionKind(text: string): string;
