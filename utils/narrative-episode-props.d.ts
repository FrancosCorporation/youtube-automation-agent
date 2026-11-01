export interface NarrativeEpisodeRenderProps {
  episode: { fps: number; durationInFrames: number; durationMs: number; scenes: unknown[]; sentences: unknown[] } | null;
  audioSrc: string;
  robotSrc: string;
  aspect: "landscape" | "portrait";
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  accents: string[];
  lipSyncEnvelope: number[];
  lipSyncStepMs: number;
  gestureCues: Record<string, number>;
}

export interface NarrativeEpisodePropsValidation {
  valid: boolean;
  preview?: boolean;
  errors: string[];
}

export declare function validateNarrativeEpisodeProps(
  props: NarrativeEpisodeRenderProps,
  options?: { allowPreview?: boolean }
): NarrativeEpisodePropsValidation;
