# Humanos locais — missão de reflorestamento

Demonstração fictícia de 32 segundos, com humanos 3D detalhados, drone, dispersão de sementes e narração em português. Substitui o tema da entrega de encomendas para esta avaliação. Não é reportagem nem registro de uma operação real.

## Método

O [Ara 3D Gen](https://github.com/olatunde85/3d-gen), fixado no commit `2e5724de1b12444bf0c2454555fedfc976a4274c`, monta os personagens localmente a partir da malha, roupas e texturas MakeHuman. O rig tem 69 joints na configuração exportada. A caminhada vem do mocap retargeteado distribuído pelo Ara; os demais movimentos selecionados são animações locais do projeto. Não há upload, marcação de esqueleto ou dependência de Mixamo por vídeo.

O corpo é uma malha humana preexistente ajustada por parâmetros, não um boneco de cápsulas. Isso não significa ausência de algoritmos: proporções, encaixe do figurino e rig são calculados. Para este teste foram escolhidas roupas previamente modeladas; as roupas geradas por ajuste superficial foram descartadas após inspeção visual.

O [repositório indicado pelo proprietário](https://github.com/hmthanh/3d-human-model) foi examinado como referência de GLB/Three.js: `assets/model/Thanh.glb` tem 16.993 triângulos, 67 joints e 15 imagens, mas não traz clips de animação. Não incorporamos seus modelos ao projeto; o pacote declara MIT, porém a proveniência/licença dos modelos requer verificação própria.

## Partes reutilizáveis e limite atual

- `../shared/build-human-library.mjs`: lê uma especificação de personagens, gera GLBs com clips selecionados e reaproveita arquivos apenas quando parâmetros/origem e SHA conferem. Não contém lógica sobre drones ou reflorestamento.
- `../shared/AssetHuman.jsx`: carrega qualquer GLB compatível e controla clip, tempo absoluto, mistura, posição e orientação. Não conhece o tema.
- `characters.json`: aparência e figurino deste elenco fictício.
- `Scene.jsx` e `motion.cjs`: direção específica desta demonstração, incluindo personagens, trajetória, queda e persistência das sementes.

Este piloto não comprova geração automática de qualquer objeto ou história. O compositor recorrente ainda precisa receber uma integração validada dos assets humanos: atualizar o prompt sozinho não acrescenta suporte a GLB ao contrato existente. Não houve reinício do scheduler nem liberação de publicação social por causa deste teste. A narração é sintetizada por Edge TTS; a independência de sites aqui se refere à criação/rig/animação dos humanos.

## Reproduzir

Requer o pacote de benchmark já instalado (`npm ci --prefix benchmarks/video_3d`) e Node 22. A instalação inicial do Ara baixa os assets públicos; as gerações seguintes são locais.

```bash
git clone https://github.com/olatunde85/3d-gen.git "$HOME/.cache/pulso/ara3d"
git -C "$HOME/.cache/pulso/ara3d" checkout 2e5724de1b12444bf0c2454555fedfc976a4274c
npm --prefix "$HOME/.cache/pulso/ara3d" ci --ignore-scripts
npm --prefix "$HOME/.cache/pulso/ara3d" run setup-assets

"$HOME/.cache/pulso/ara3d/node_modules/.bin/tsx" benchmarks/video_3d/shared/build-human-library.mjs --spec benchmarks/video_3d/reforestation_demo/characters.json --out benchmarks/video_3d/reforestation_demo/public/humans
node benchmarks/video_3d/reforestation_demo/prepare.cjs
node benchmarks/video_3d/shared/guard.cjs node benchmarks/video_3d/reforestation_demo/render.cjs --preview
node benchmarks/video_3d/shared/guard.cjs node benchmarks/video_3d/reforestation_demo/render.cjs
node --test tests/reforestation-motion.test.js tests/creative-direction-feedback.test.js
```

O robô aprovado deve estar em `experiments/remotion-motion-review/public/pulso-story/approved-robot-rigged.glb`, recuperável nas releases anteriores. `render.cjs` usa um bundle para ambos os aspectos, gera MP4 H.264/AAC e grava medições, hashes e quadros em `reports/`. A execução passa pelo lock/gate compartilhado antes de renderizar. Um render novo substitui os MP4s desta demonstração.

## Proveniência e validação

Entrega medida: 960 frames, 32,000 s, 30 fps, H.264/AAC; 1920×1080 em **84,51 s** de render e 1080×1920 em **86,79 s**. Tempos excluem instalação inicial, voz, autoria, bundle, esperas e revisões. GPU observada no browser: ANGLE / AMD Radeon RX 6750 XT. Não extrapolar esses números para qualquer complexidade de cena.

QA: decodificação integral, áudio (-24,8 dB médio), nenhum trecho preto ou congelamento de três segundos no recorte inspecionado da cena. Foram revistos seis frames extraídos de cada MP4 e suas pranchas. 39 testes focados e lint/sintaxe passaram. Seek real: 24 comparações nos dois canvases/aspectos, mais 12 comparações do vertical final após a correção de enquadramento; diferença máxima de um nível de canal na rodada inicial, dentro da tolerância. Relatórios identificam quais provas correspondem a cada aspecto.

SHA-256 horizontal: `911c1e43293ecdaebe5e7f10a242598fe31b884be3ce8d6ed3fc15d069e80842`.

SHA-256 vertical: `0f971435b72fd114a1d457386cc95e2dc707ac052e8915a655842811b66feeed`.

Código Ara: MIT. Dados de personagem MakeHuman: CC0 1.0. Mocap CMU: uso comercial permitido, sem revenda isolada dos dados de movimento. As licenças acompanham os assets. O restante da cena foi escrito neste projeto; a referência 2D antes gerada para o Tencent não foi usada, e nenhuma geração foi submetida ao Tencent/Mixamo.

As medições de criação/exportação do elenco final, os SHAs dos modelos e os resultados de render ficam em `models-provenance.json` e `reports/`. QA técnico, revisão visual pelo agente e aceite estético do proprietário são estados distintos. A inspeção geométrica dos modelos animados mediu a extremidade inferior a -1,3 mm / +0,8 mm do piso na pose amostrada; isso não equivale a verificar todos os vértices de todos os frames. O teste de trajetória mantém o raio das hélices fora do corredor reservado à equipe, verifica saída/queda/persistência das cápsulas e repetição de estados por frame.
