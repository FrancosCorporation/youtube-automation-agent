export function selectNarrativeFlowPhase<T extends { id: string; label: string }>(input: {
  objects: T[]; relation: { kind: string; objectIds: [string, string] } | null;
  sentence: { wordTimings?: Array<{ text: string; startFrame: number }> }; frame: number;
}): T[];
