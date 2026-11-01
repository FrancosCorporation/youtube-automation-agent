export function narrativeBeatRelation(input: {
  sentence: string; objects: Array<{ id: string; label: string }>;
}): { kind: 'bidirectional' | 'comparison' | 'flow'; objectIds: [string, string]; trigger?: string; conditional?: boolean } | null;
export function narrativeCauseRelation(input: {
  sentence: string; objects: Array<{ id: string; label: string }>;
}): { kind: 'cause'; objectIds: [string, string]; trigger: string; conditional?: boolean } | null;
export function narrativeAlternativeRelation(input: {
  sentence: string; objects: Array<{ id: string; label: string }>;
}): { objectIds: [string, string]; trigger: string } | null;
