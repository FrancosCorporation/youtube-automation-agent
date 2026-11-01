import themes from '../../../config/themes.json';
import * as THREE from 'three';

// Same precedence and deterministic palette index as the production renderer.
export function paletteFor(themeId = 'ia', seed = 1, visualPalettes) {
  const theme = themes.themes.find(t => t.id === themeId) || themes.themes.find(t => t.id === 'ia');
  const palettes = visualPalettes?.variants?.length ? visualPalettes.variants : theme.visualPalettes.variants;
  const index = ((Math.trunc(seed) % palettes.length) + palettes.length) % palettes.length;
  return { id: theme.id, brand: theme.brand, colorName: theme.visualPalettes.identity?.name,
    paletteIndex: index, accents: palettes[index].accents };
}

export function applyBonitoTheme(model, palette) {
  const accent = new THREE.Color(palette.accents[0]);
  const seen = new Set();
  model.traverse(node => {
    if (!node.isMesh || seen.has(node.material)) return;
    const material = node.material; seen.add(material);
    if (material.name === 'VisorCyanLED') {
      material.color.copy(accent); material.toneMapped = false;
    }
    if (material.name !== 'Material.001') return;
    // Native material treatment: preserve the original texture and UVs. Tint
    // only its blue inserts; ceramic shell and mechanical joints stay neutral.
    material.envMapIntensity = .65;
    if (material.specularColor) material.specularColor.setRGB(.7, .7, .7);
    if ('specularIntensity' in material) material.specularIntensity = .45;
    material.onBeforeCompile = shader => {
      shader.uniforms.pulsoAccent = { value: accent.clone() };
      shader.fragmentShader = 'uniform vec3 pulsoAccent;\n'+shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        float pulsoInsert = smoothstep(0.04, 0.22, diffuseColor.b - diffuseColor.r)
          * smoothstep(0.06, 0.25, diffuseColor.b);
        float pulsoLight = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
        diffuseColor.rgb = mix(diffuseColor.rgb,
          pulsoAccent * (0.45 + 0.75 * pulsoLight), pulsoInsert);
      `).replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = max(roughnessFactor, 0.32);
      `).replace('#include <metalnessmap_fragment>', `
        #include <metalnessmap_fragment>
        metalnessFactor = min(metalnessFactor, 0.7);
      `).replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        totalEmissiveRadiance += pulsoAccent * pulsoInsert * 0.18;
      `);
    };
    material.customProgramCacheKey = () => 'pulso-native-theme-v1';
    material.needsUpdate = true;
  });
}
