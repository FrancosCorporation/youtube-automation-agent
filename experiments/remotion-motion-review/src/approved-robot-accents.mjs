import { Color } from 'three';

const luminance = (color) => color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
const readableColor = (hex) => {
  if (typeof hex !== 'string' || !/^#[\da-f]{6}$/i.test(hex)) {
    throw new TypeError('Robot accents must be six-digit hex colors.');
  }
  const color = new Color(hex);
  const light = luminance(color);
  // Keep LED details readable against the dark visor without tinting the shell.
  if (light < 0.18) color.lerp(new Color(1, 1, 1), (0.18 - light) / (1 - light));
  return color;
};

export const createApprovedRobotAccentState = (input) => {
  const accents = Array.isArray(input) ? (input.length ? { primary: input[0], secondary: input[1] } : undefined) : input;
  return ({
  enabled: { value: accents ? 1 : 0 },
  primary: { value: accents ? readableColor(accents.primary) : new Color(0, 0.66, 0.78) },
  secondary: { value: accents ? readableColor(accents.secondary ?? accents.primary) : new Color(0, 0.66, 0.78) },
});
};

/** Install after the face hook; uniforms can change without replacing geometry or textures. */
export const installApprovedRobotAccentShader = (material, state) => {
  const previous = material.onBeforeCompile?.bind(material);
  const previousKey = material.customProgramCacheKey?.bind(material) ?? (() => '');
  material.customProgramCacheKey = () => `${previousKey()}:approvedRobotAccentsV1`;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    shader.uniforms.uApprovedRobotAccentEnabled = state.enabled;
    shader.uniforms.uApprovedRobotAccentPrimary = state.primary;
    shader.uniforms.uApprovedRobotAccentSecondary = state.secondary;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nuniform float uApprovedRobotAccentEnabled;\nuniform vec3 uApprovedRobotAccentPrimary;\nuniform vec3 uApprovedRobotAccentSecondary;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      // Cyan texels are LEDs. Rose texels are recolored only at the very top
      // of the normalized rig, isolating the antenna from the shell.
      float approvedAccentChroma = min(diffuseColor.g, diffuseColor.b) - diffuseColor.r;
      float approvedAccentMask = smoothstep(0.07, 0.22, approvedAccentChroma)
        * smoothstep(0.10, 0.35, min(diffuseColor.g, diffuseColor.b))
        * uApprovedRobotAccentEnabled;
      float approvedAccentFace = smoothstep(2.55, 2.75, vApprovedRobotPosition.y);
      vec3 approvedAccentTarget = mix(uApprovedRobotAccentSecondary, uApprovedRobotAccentPrimary, approvedAccentFace);
      float approvedAccentLight = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      float approvedAccentTargetLight = max(0.01, dot(approvedAccentTarget, vec3(0.2126, 0.7152, 0.0722)));
      diffuseColor.rgb = mix(diffuseColor.rgb, approvedAccentTarget * clamp(approvedAccentLight / approvedAccentTargetLight, 0.35, 3.0), approvedAccentMask);
      float approvedAntennaRose = smoothstep(0.08, 0.28, diffuseColor.r - diffuseColor.g)
        * smoothstep(0.05, 0.24, diffuseColor.r - diffuseColor.b)
        * smoothstep(0.18, 0.52, diffuseColor.r);
      float approvedAntennaPosition = smoothstep(3.58, 3.78, vApprovedRobotPosition.y);
      float approvedAntennaMask = approvedAntennaRose * approvedAntennaPosition * uApprovedRobotAccentEnabled;
      float approvedAntennaLight = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      diffuseColor.rgb = mix(diffuseColor.rgb, uApprovedRobotAccentPrimary
        * clamp(approvedAntennaLight / max(0.01, dot(uApprovedRobotAccentPrimary, vec3(0.2126, 0.7152, 0.0722))), 0.45, 1.8), approvedAntennaMask);`,
    );
  };
  material.needsUpdate = true;
};

// CPU equivalent for checking which authored texels the shader is allowed to tint.
export const approvedRobotAccentMask = ([r, g, b], enabled = true) => {
  const smooth = (low, high, value) => {
    const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
    return t * t * (3 - 2 * t);
  };
  return enabled ? smooth(0.07, 0.22, Math.min(g, b) - r) * smooth(0.10, 0.35, Math.min(g, b)) : 0;
};

// CPU equivalent of the pink-source + top-of-rig antenna mask in the shader.
export const approvedRobotAntennaMask = ([r, g, b], y, enabled = true) => {
  const smooth = (low, high, value) => {
    const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
    return t * t * (3 - 2 * t);
  };
  if (!enabled) return 0;
  const rose = smooth(0.08, 0.28, r - g)
    * smooth(0.05, 0.24, r - b)
    * smooth(0.18, 0.52, r);
  return rose * smooth(3.58, 3.78, y);
};
