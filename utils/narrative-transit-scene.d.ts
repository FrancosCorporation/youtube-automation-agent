export function transitBeat(input: { title: string; episodeText: string; sentence: { text: string } }): 'journey' | 'gratitude' | 'research' | null;
export function transitCueProgress(sentence: { startFrame: number; endFrame: number; wordTimings?: Array<{ text: string; startFrame: number; endFrame: number }> }, frame: number, words: string[]): number;
