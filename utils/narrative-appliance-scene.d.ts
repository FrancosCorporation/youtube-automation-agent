export function applianceExchangeBeat(input: { title: string; sentence: { text: string } }): boolean;
export function applianceContextBeat(input: { title: string; sentence: { text: string } }): "savings" | "criteria" | "family" | "forecast" | null;
export function applianceVisualMode(input: { title: string; sentence: { text: string } }): "exchange" | "savings" | "criteria" | "family" | "forecast" | null;
export function applianceCueReached(sentence: { wordTimings?: Array<{ text: string; startFrame: number }> }, frame: number, prefixes: string[]): boolean;
export function applianceCriteriaMilestones(sentence: { text: string; wordTimings?: Array<{ text: string; startFrame: number }> }): Array<{ label: string; icon: string; startFrame: number }>;
export function applianceExchangeLabel(sentence: { text: string; wordTimings?: Array<{ text: string; startFrame: number }> }, frame: number): string;
export function applianceExchangeProgress(sentence: { endFrame: number; wordTimings?: Array<{ text: string; startFrame: number }> }, frame: number, fps: number): number;
export function applianceSavingsSequence(sentence: { text: string; wordTimings?: Array<{ text: string; startFrame: number }> }, frame: number): 'efficiency' | 'budget' | 'leisure' | 'closing' | null;
export function applianceFamilyDetails(sentence: { text: string; wordTimings?: Array<{ text: string; startFrame: number }> }): { first: string; firstAge: string; second: string; secondAge: string; firstFrame: number; firstAgeFrame: number; secondFrame: number; secondAgeFrame: number; benefitFrame: number; exchangeFrame: number } | null;
