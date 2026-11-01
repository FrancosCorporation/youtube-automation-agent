import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Color, MeshStandardMaterial, Texture, ShaderLib, UniformsUtils } from 'three';
import { approvedRobotAccentMask, approvedRobotAntennaMask, createApprovedRobotAccentState, installApprovedRobotAccentShader } from '../src/approved-robot-accents.mjs';

const compile = (material) => {
  const shader = { uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms), vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  return shader;
};

test('two theme palettes reach actual PBR shader uniforms without changing its maps or neutral color', () => {
  const source = new MeshStandardMaterial({ color: '#ffffff', metalness: 0.9, roughness: 0.35, map: new Texture(), normalMap: new Texture(), metalnessMap: new Texture(), roughnessMap: new Texture() });
  const before = source.toJSON();
  const create = (accents) => {
    const material = source.clone();
    let previousHookCalled = false;
    material.onBeforeCompile = () => { previousHookCalled = true; };
    const state = createApprovedRobotAccentState(accents);
    installApprovedRobotAccentShader(material, state);
    const shader = compile(material);
    assert.equal(previousHookCalled, true);
    assert.equal(shader.uniforms.uApprovedRobotAccentEnabled.value, 1);
    assert.equal(shader.uniforms.uApprovedRobotAccentPrimary, state.primary);
    assert.equal(material.color.getHexString(), 'ffffff');
    assert.equal(material.metalness, source.metalness);
    assert.equal(material.roughness, source.roughness);
    for (const key of ['map', 'normalMap', 'metalnessMap', 'roughnessMap']) assert.equal(material[key], source[key]);
    assert.match(shader.fragmentShader, /diffuseColor\.rgb = mix\(diffuseColor\.rgb/);
    assert.match(shader.fragmentShader, /vApprovedRobotPosition\.y/);
    return { material, shader, state };
  };
  const news = create({ primary: '#69d9ea', secondary: '#8bcbb9' });
  const science = create({ primary: '#dd79ee', secondary: '#fac578' });
  assert.notDeepEqual(news.shader.uniforms.uApprovedRobotAccentPrimary.value.toArray(), science.shader.uniforms.uApprovedRobotAccentPrimary.value.toArray());
  assert.notDeepEqual(news.shader.uniforms.uApprovedRobotAccentSecondary.value.toArray(), science.shader.uniforms.uApprovedRobotAccentSecondary.value.toArray());
  assert.deepEqual(source.toJSON(), before);
});

test('palette updates are uniform-only and leave the cached program/source material intact', () => {
  const material = new MeshStandardMaterial();
  const state = createApprovedRobotAccentState({ primary: '#69d9ea' });
  installApprovedRobotAccentShader(material, state);
  const shader = compile(material);
  const key = material.customProgramCacheKey();
  const replacement = createApprovedRobotAccentState({ primary: '#dd79ee', secondary: '#fac578' });
  state.primary.value = replacement.primary.value;
  state.secondary.value = replacement.secondary.value;
  assert.equal(shader.uniforms.uApprovedRobotAccentPrimary.value, replacement.primary.value);
  assert.equal(shader.uniforms.uApprovedRobotAccentSecondary.value, replacement.secondary.value);
  assert.equal(material.customProgramCacheKey(), key);
});

test('mask preserves neutral armor, visor, dark teal joints and pink antenna', () => {
  for (const hex of ['#ffffff', '#dedbcf', '#06121a', '#0a514e', '#f3a3bc']) {
    const rgb = new Color(hex).toArray();
    assert.equal(approvedRobotAccentMask(rgb), 0, hex);
  }
  assert.ok(approvedRobotAccentMask(new Color('#19e6ea').toArray()) > 0.9);
  assert.equal(approvedRobotAccentMask([0, 1, 1], false), 0);
});

test('antenna tint follows the theme while the same rose texel below the head stays unchanged', () => {
  const rose = new Color('#f3a3bc').toArray();
  assert.ok(approvedRobotAntennaMask(rose, 3.9) > 0.95);
  assert.equal(approvedRobotAntennaMask(rose, 3.4), 0);
  assert.equal(approvedRobotAntennaMask(new Color('#19e6ea').toArray(), 3.9), 0);
  assert.equal(approvedRobotAntennaMask(rose, 3.9, false), 0);
  const material = new MeshStandardMaterial();
  installApprovedRobotAccentShader(material, createApprovedRobotAccentState({ primary: '#69d9ea' }));
  const shader = compile(material);
  assert.match(shader.fragmentShader, /approvedAntennaPosition = smoothstep\(3\.58, 3\.78, vApprovedRobotPosition\.y\)/);
  assert.match(shader.fragmentShader, /diffuseColor\.rgb = mix\(diffuseColor\.rgb, uApprovedRobotAccentPrimary/);
});

test('missing accents preserve source texels; dark accents are readable and invalid input fails clearly', () => {
  assert.equal(createApprovedRobotAccentState().enabled.value, 0);
  const state = createApprovedRobotAccentState({ primary: '#050015' });
  const c = state.primary.value;
  assert.ok(c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722 >= 0.179999);
  assert.deepEqual(state.primary.value.toArray(), state.secondary.value.toArray());
  assert.throws(() => createApprovedRobotAccentState({ primary: 'url(bad)' }), /hex colors/);
});

test('palette hook leaves the real approved GLB byte-identical', () => {
  const asset = new URL('../public/pulso-story/approved-robot-rigged.glb', import.meta.url);
  const hash = () => createHash('sha256').update(readFileSync(asset)).digest('hex');
  const before = hash();
  const material = new MeshStandardMaterial();
  installApprovedRobotAccentShader(material, createApprovedRobotAccentState({ primary: '#fac578' }));
  compile(material);
  assert.equal(hash(), before);
  assert.equal(before, '6a9eb38d99229ac5519bb2900bda50df462b6d4eed411daa2a872e41fbc48df5');
});


test('production accent arrays map to the same material uniforms as named colors', () => {
  const array = createApprovedRobotAccentState(['#69d9ea', '#8bcbb9']);
  const named = createApprovedRobotAccentState({ primary: '#69d9ea', secondary: '#8bcbb9' });
  assert.deepEqual(array.primary.value.toArray(), named.primary.value.toArray());
  assert.deepEqual(array.secondary.value.toArray(), named.secondary.value.toArray());
  assert.equal(createApprovedRobotAccentState([]).enabled.value, 0);
});
