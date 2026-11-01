export type ApprovedRobotAccents = { primary: string; secondary?: string } | readonly string[];
export type ApprovedRobotAccentColor = { r: number; g: number; b: number };
export type ApprovedRobotAccentState = {
  enabled: { value: number };
  primary: { value: ApprovedRobotAccentColor };
  secondary: { value: ApprovedRobotAccentColor };
};
export type ApprovedRobotAccentShader = {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
};
export declare function createApprovedRobotAccentState(accents?: ApprovedRobotAccents): ApprovedRobotAccentState;
export declare function installApprovedRobotAccentShader(material: {
  onBeforeCompile?: (shader: ApprovedRobotAccentShader) => void;
  customProgramCacheKey?: () => string;
  needsUpdate?: boolean;
}, state: ApprovedRobotAccentState): void;
export declare function approvedRobotAccentMask(rgb: readonly [number, number, number], enabled?: boolean): number;
export declare function approvedRobotAntennaMask(rgb: readonly [number, number, number], y: number, enabled?: boolean): number;
