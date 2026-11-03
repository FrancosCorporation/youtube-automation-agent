# Autoria, carregamento e enquadramento — 03/11/2026

Diagnóstico do rascunho real de Psicologia `aadd101f-53bd-4eb9-b758-740a42ab4b1a`, segunda cena, primeira frase. **Não é vídeo aprovado nem publicação.** [Resultados e hashes](verification.json).

1. Os pés estavam em −2,45 e o topo do piso também em −2,45. O corpo excedia a borda Z em até 0,215 unidade; a mensagem anterior sugeria um problema de altura. O reparo limitado aumentou a profundidade do piso de 9 para 9,45, sem mover ator, caminho, clip, espessura ou narração. Colisões e apoio continuam obrigatórios. Expansão grande/ambígua é recusada.
2. O `Suspense` interno com fallback vazio escondia do `ThreeCanvas` a espera pelos GLBs. Remotion capturava um quadro completo com a ilustração ausente. A espera agora pertence ao `ThreeCanvas`. A câmera não era a causa dessa imagem vazia.
3. Após carregar, os corpos ficavam cortados. A autoria agora ajusta posição/alvo da câmera por formato, preservando lente, offsets animados, corpos e trajetórias. A validação estrita projeta o volume dos atores no viewport real em quartos de frame e rejeita cortes. Testes com a projeção do próprio Three.js conferem o cálculo.

| Prova no frame 98 | Horizontal | Vertical |
|---|---|---|
| Captura prematura | [Antes](landscape-before-loading.png) | [Antes](portrait-before-loading.png) |
| GLBs carregados, enquadramento errado | [Intermediário](landscape-loaded-but-cropped.png) | [Intermediário](portrait-loaded-but-cropped.png) |
| Carregamento e enquadramento corrigidos | [Depois](landscape-framed.png) | [Depois](portrait-framed.png) |

Foram capturados frames 12, 98, 195 e 98, nos dois formatos a 50% da resolução, com a composição real `NarrativeEpisode` e trecho de 8,208 s da voz original. As duas capturas do frame 98 têm SHA idêntico em cada formato. Não houve MP4 completo, inserção em fila, geração de roteiro/TTS ou chamada de publicação neste diagnóstico.

A captura inicial usou `angle`. A conferência final usou `swangle` explicitamente em CPU: `PULSO_RENDER_SOFTWARE_ONLY=1`, `PULSO_REMOTION_GL=swangle`, perfil compartilhado, nice 10 e afinidade de seis CPUs, sob o lock real de render. Mantidos limites de RAM/swap/carga e exclusão de renders concorrentes. Somente esse backend de software dispensa reserva de VRAM; pedidos incoerentes são recusados. A configuração do serviço de produção não foi alterada.

Evidência privada reproduzível neste host: `data/reports/support-footprint-20261102/{draft-before.json,plan.json,audio.m4a,capture.cjs,capture.json}`. A captura é executada sob `benchmarks/video_3d/shared/guard.cjs`. A fixture pública dos testes reproduz apoio/enquadramento sem depender do cache privado.

Validação: CI completa (1.197 execuções de testes Node, incluindo grupos que se sobrepõem, 40 Python e verificações de browser), lint/TypeScript do Remotion, lint dos JS alterados e 21 testes do gate após acrescentar o modo de software. Teste de retomada comprova o reparo do piso sem solicitar outro modelo. Em produção, o log `gen_2026-11-03T03-09-11-090Z.log` registrou a revalidação local da parte 1/8 e avanço para a parte 2/8, que ainda colidiu adulto/mesa e encontrou provedores indisponíveis.

**Limites visuais observados:** mesa/cadeira/mochila ainda são caixas mal posicionadas, há objetos flutuando e a interação mão/objeto não explica adequadamente a fala. A correção dos três defeitos não aprova essa encenação. Próximo trabalho: autoria de props, apoios/contatos e recuperação da parte seguinte; conferir um episódio integral antes de declarar publicação. Serviço observado em `waiting_resources`, reserva de VRAM insuficiente e fila vazia. Nenhum reinício, reenvio ou interrupção do treinamento nesta entrega.
