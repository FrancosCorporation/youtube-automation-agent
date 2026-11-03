export function narrativeLabelMaxWidth(input: { x: number; width: number; spacing: number; margin?: number }): number;
export function placeProjectedLabels<T extends {id: string; x: number; y: number; width: number; height: number}>(labels: T[], width: number, height: number, gap?: number, excluded?: {x: number; y: number; width: number; height: number}[]): T[];
