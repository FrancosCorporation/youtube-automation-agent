export function narrativeConceptVisual(input: { label: string; kind: string; sentence: string }): {
  kind: string;
  values: Array<{ label: string; value: number }>;
};
export function narrativeObjectVisual(object: { label: string; kind: string; labelType: string }, sentence: { text: string }): {
  kind: string;
  values: Array<{ label: string; value: number }>;
};
