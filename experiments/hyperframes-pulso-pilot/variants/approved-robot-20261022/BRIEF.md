# Robô aprovado → malha 3D → atuação

Fonte única: `assets/brand/pulso-robot-approved-reference-2026-10-21.png`; SHA e estado verificável em `provenance.json`. Não substituir o desenho por modelos anteriores.

## Geração autorizada

Uma geração pela interface Tencent autenticada, somente após conferir a cota e o custo atuais. Sem compra e sem inferência na GPU compartilhada. Em 22/10, o proprietário autenticou a sessão dedicada; uma geração V3.1/500k foi concluída (cota 20→19). Login histórico resolvido; perfil persistente preservado.

Se houver campo de direção junto à imagem, usar:

> Reconstruct this exact approved robot as a full-body textured 3D character. Preserve its proportions, pearl-white armor, dark-teal joints and panels, glossy black face, large cyan circular eyes, cyan smile and chest light, and pink spherical antenna tip. Keep both arms separated from the torso, hands and feet fully visible. Preserve the articulated shoulder, elbow and wrist structure. Keep rigid armor plates stable and provide clean joint separation suitable for later arm animation. Do not redesign the head, face, hands or silhouette. No environment, floor, text, accessories or additional characters.

## Recepção e validação

1. Confirmar o novo job e a referência no próprio card antes do download; manter URLs assinadas fora de logs/manifestos.
2. Salvar `assets/approved-robot-hunyuan.glb`; registrar hash, tamanho e identificação do job em `provenance.json`.
3. Reutilizar `scripts/audit-generated-glb.py` (comando completo no manifesto) para geometria, assets, rig e animações realmente presentes.
4. Revisar frente, perfil e costas; conferir braços/mãos separados, articulações e identidade. Malha estática permanece provisória.
5. Só então preparar rig corporal e controles faciais. Testar ombro, cotovelo, punho, piscar e boca; auditar deformação em seeks repetidos antes de integrar ao Remotion. Um GLB baixado não comprova rig nem movimento.

O auditor antigo `audit-bonito-rig.py` compara exclusivamente o personagem anterior e não serve como prova para esta referência. Não reutilizar binds/pesos às cegas.

## Resultado desta execução

- Fonte Hunyuan preservada: `assets/approved-robot-hunyuan.glb`, 499.984 triângulos, sem rig.
- Rig próprio Mixamo concluído após revisão dos oito marcadores; FBX Binary/Original Pose preservado. GLB fonte: `assets/approved-robot-rigged-source.glb`, 65 juntas, sem clips/facial.
- Candidato para Remotion: `assets/approved-robot-rigged-runtime.glb`, 122.912 triângulos, 9.810.184 bytes, PBR original restaurado, texturas 2k e Meshopt. UVs idênticas nos 1.499.952 corners permitem recuperar material sem reprojeção.
- Pesos normalizados, zero juntas inválidas/posições não finitas; geometria em repouso dista no máximo 0,0000154 m da fonte. Frente/perfil/costas do runtime comparados à fonte sem perda visível de identidade/silhueta. Relatórios no manifesto.
- Pendência: atuação final no Remotion, controles faciais e QA de deformação das poses efetivamente usadas; os três frames animados do preview Mixamo não substituem esse QA.
- Sessão: perfil `/media/servidor/nvme_data/ana_meshy_profile`, CDP `http://127.0.0.1:9222`; Tencent e Mixamo autenticados pela UI, navegador mantido aberto, sem copiar credenciais.
- Reproduzir inspeção estática: `node qa/render-review.cjs <GLB> <pasta-saida>` a partir de qualquer pasta; depende de Three/esbuild/Playwright já instalados no projeto.
