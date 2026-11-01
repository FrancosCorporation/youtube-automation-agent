# Robô Pulso — cores por tema e correção das placas (v2)

O robô mantém o casco claro e as juntas escuras. Olhos, boca e os insertos azuis originais passam a usar accents[0] da paleta escolhida em config/themes.json. Materiais nativos Three.js preservam mapas/UVs e reduzem os reflexos excessivos. A escolha segue a precedência de script.visualPalettes e o índice seed % variants.length do renderer de produção; estudo IA usa seed 1 (ciano #22D3EE), os outros temas usam seed 0.

Galeria: https://francoscorporation.ddns.net/games/play/pulso-ia/robo-temas-v2/
Vídeo: https://francoscorporation.ddns.net/games/play/pulso-ia/robo-bonito-tema-ia-v2.mp4
Vertical: https://francoscorporation.ddns.net/games/play/pulso-ia/robo-bonito-tema-ia-v2-vertical.mp4

A galeria contém imagens de dez temas; o vídeo mantém a paleta IA durante toda sua duração. Mesmo áudio e timing da prévia anterior: 27,625 s, 663 quadros a 24 fps, H.264/AAC. Foram preservados os vídeos antigos.

## Defeito dos braços e correção

O rastro relatado era uma deformação de faces: partes internas dos antebraços/mãos ficaram presas ao Chest. A malha original gerada por IA é uma superfície conectada; apenas testar pares de vértices com pesos rígidos deixou passar faces entre regiões. As maiores arestas ganhavam cerca de 0,34 unidades nativas no aceno.

A v2 corrige a região interna dos braços, mede os pivôs nas faixas pretas das articulações e usa cortes inclinados nos cotovelos/punhos. Cada triângulo pertence integralmente a um osso; vértices das costuras são duplicados por peça. Nenhum triângulo original foi eliminado. Esferas mecânicas escuras cobrem as costuras dos ombros/cotovelos/punhos no runtime Three.js; esses preenchimentos estão no renderer, não embutidos no GLB.

A auditoria serializada confirma cobertura dos 315.191 vértices originais e 500.036 triângulos, posições/UVs/texturas/winding preservados via mapeamento de origem, 17 ossos, pesos normalizados e todos os triângulos rigidamente ligados a um osso. Zero faces entre braços e pernas. Rest binds com erro <3e-8. Arestas das placas (primitiva do corpo, sem visor) medidas em nove poses: erro absoluto máximo <1,2e-7; nenhuma cresce 3x. Cada frame usa transformações absolutas, sem acúmulo.

## Validação e limites

- QA horizontal e vertical: 17 poses, oito tempos de fala/silêncio e enquadramento; hash do frame 1,5 s idêntico após poses diferentes e após reload. Também seek 22 → 2,4 → 22 idêntico.
- HyperFrames 0.8.149 check --strict: zero erros/avisos, nove amostras de layout por formato, 27/27 contrastes horizontal e 15/15 vertical.
- Áudio AAC decodificado: correlação RMS 0,999991, melhor deslocamento 0 ms (passo 10 ms), sem clipping.
- Quadros extraídos dos MP4s: aceno, gestos, rosto e vertical revisados pelo orquestrador. Galeria inspecionada em ciano, dourado e roxo.
- Dois workers NVIDIA extraíram paletas e resumiram números. Relatórios e revisão em worker-reports/. Não receberam responsabilidade por aprovação visual/anatômica.
- Sincronia da boca ainda usa envelope de áudio, não visemas fonéticos; dedos não articulados individualmente. Costuras/pequenos detalhes da superfície gerada ainda podem receber polimento. A auditoria de rigidez não é um teste exaustivo de auto-interseção.

Não houve integração do novo GLB no apresentador de produção, reinício de scheduler ou publicação em redes sociais. Prévia para avaliação.

## Reprodução

Execute no diretório experiments/hyperframes-pulso-pilot:

```bash
python3 scripts/rig-bonito-robot.py --variant robo-bonito-temas
node scripts/build-bonito-speaking-preview.js robo-bonito-temas
python3 scripts/audit-bonito-rig.py --variant robo-bonito-temas
node scripts/inspect-bonito-arm-edges.js robo-bonito-temas
node scripts/qa-bonito-speaking-preview.js robo-bonito-temas
node scripts/capture-bonito-themes.js
node scripts/build-bonito-theme-gallery.js
```

Sincronize GLB/bundle/áudio/fontes para robo-bonito-temas-vertical após rebuild. Conserve os seletores CSS [data-resolution="portrait"] ao acrescentar data-theme apenas à tag main. Execute os checks e QA dessa variante antes de renderizar. Pin 0.8.149 conservado.

Publicação validada em dns-publication.json: 14 arquivos com SHA idêntico via HTTPS, MIME correto, Range 206; dez seleções de tema em desktop/mobile e reprodução dos dois vídeos sem erros. Não representa teste de uma rede externa independente.
