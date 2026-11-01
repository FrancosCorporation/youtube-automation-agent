export function gratitudeResearchBeat(sentence: { text: string }): boolean;
export function gratitudeResearchMotion(sentence: { wordTimings?: Array<{ text: string; startFrame: number }> }, frame: number): { gratitude: number; help: number };
