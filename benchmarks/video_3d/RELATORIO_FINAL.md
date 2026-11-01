# Benchmark real de quatro motores de vídeo 3D

## Resultado e escopo

Quatro masters reais e um comparativo sincronizado, todos com **1920×1080, 30 FPS, 48 segundos, 1.440 frames e a mesma narração PT-BR**. Os arquivos passaram por contagem de frames, decodificação completa, verificação de áudio e inspeção de presença de geometria. A conclusão visual depende da evidência registrada abaixo. O experimento não foi enviado à fila social e não alterou os componentes de produção.

Tema sorteado: **Como uma eclusa levanta um barco**. Semente **1055545869**; seleção `random.Random(seed).choice(candidates)`, lista em `roteiro/tema.json`. É uma demonstração educativa em corte, com dimensões e velocidade ilustrativas, sem solver físico de fluido. A explicação de comportas, equalização de níveis e enchimento por gravidade segue a [TVA](https://www.tva.com/Environment/Managing-the-River/How-the-Navigation-System-Works).

## Narrativa única

Um barco precisa passar de um trecho baixo do canal para outro mais alto, e a eclusa funciona como um elevador de água.
Primeiro, ele entra numa câmara que está no mesmo nível da água do lado de baixo.
A comporta se fecha atrás do barco, isolando essa câmara entre duas portas resistentes.
Válvulas deixam a água do trecho mais alto entrar por passagens controladas, movida pela gravidade.
Conforme a câmara enche, o nível da água sobe e o barco flutua junto, sem precisar de um guindaste.
Quando a água alcança o mesmo nível do trecho superior, a outra comporta pode se abrir.
O barco segue viagem, enquanto a eclusa fica pronta para outro ciclo: controlar a água permite vencer a diferença de altura.

Uma única síntese Edge TTS, voz `pt-BR-AntonioNeural`, sem trilha. Fala original de 46,584 s, início deslocado em 500 ms e duração final de 48 s. `narracao.wav` é o master PCM; `narracao.m4a` foi codificado uma vez e copiado sem recodificar para todos os MP4. O SHA-256 do áudio canônico é `a04957d1cbf90dce0720584808afb821e400f64e3e647e693686390e7ee01f8a`; o hash da fala decodificada é igual nos cinco MP4. Eventos reais de palavras controlam a mesma paginação de legendas.

## Storyboard e acontecimentos

| Intervalo | Conceito | Objetivo visual comum |
|---|---|---|
| 0.00–8.27s | Um elevador de água | Estabelecer canal baixo, câmara e trecho alto; órbita de visão geral. |
| 8.27–13.60s | Entrada no nível baixo | Travelling acompanha barco pela comporta inferior aberta. |
| 13.60–19.77s | Fechar para isolar | Vista lateral mostra fechamento depois de o barco estar dentro. |
| 19.77–26.47s | A gravidade faz o trabalho | Aproximação à passagem de enchimento; fluxo entra por baixo. |
| 26.47–33.33s | A água sobe. O barco também. | Câmera se aproxima da câmara aberta em corte; barco e água sobem juntos. |
| 33.33–39.00s | Níveis iguais: passagem livre | Abrir comporta superior apenas após equalização; explorar ângulo oposto. |
| 39.00–48.00s | Uma diferença de altura vencida | Acompanhar saída e afastar para mostrar diferença de níveis. |

A câmera orbita, muda para vista lateral, aproxima a passagem de enchimento, entra na área aberta em corte e se afasta para acompanhar a saída. A água e o barco sobem juntos; a comporta inferior fecha antes do enchimento, e a superior abre após equalização. Câmera, poses e eventos derivam dos mesmos frames; o Blender recebe keyframes reais e não imagens estáticas com zoom.

## Arquitetura encontrada e preservada

`scripts/channel-scheduler.js` coordena a produção existente. `scripts/generate-animated-video.js` integra roteiro, QA factual, Edge TTS e autoria de cenas; `utils/narrative-scene-author.js`, planos de episódio/ilustração e trilhas normalizam a encenação. `utils/narrative-episode-renderer.js` aplica o lock e renderiza `NarrativeEpisodeV2.tsx`, que contém o palco `NarrativeIllustrationScene.tsx` e o robô aprovado. Os hashes desses componentes foram registrados em `comparacoes/environment.json`; a verificação final está em `comparacoes/preservation.json`.

A adaptação da narrativa usa esses normalizadores, o envelope da fala e o validador de props. O benchmark tem pacote npm próprio; nenhum upgrade de Three.js foi aplicado à produção.

| Versão | Implementação real | Particularidades |
|---|---|---|
| A | CLI, composição e métodos atuais, com props de eclusa | Mantém robô aprovado e Three 0.186.1. O original já é 3D. |
| B | Remotion + ThreeCanvas + R3F; meshes procedurais | Three r187, materiais físicos, iluminação de ambiente procedural e normais de água vinculadas ao frame; não carrega GLB. |
| C | Python bpy cria meshes, materiais, câmera, luzes e animações; Eevee renderiza PNGs; Remotion monta | Eevee 64 amostras, ray tracing, AgX, DOF e reflexos. Cena `.blend` reproduzível. |
| D | Blender exporta GLB real; GLTFLoader/R3F animam grupos | Bevels e geometria exportada; mesma câmera/eventos por frame. Materiais glTF não reproduzem integralmente os nós do Blender; normal da água recomposta por frame no Three. |

O palco 3D tem **1690×670 pixels dentro do master Full HD**, respeitando a área original; C renderiza essa área nativamente, sem upscale. B/C/D compartilham títulos, legendas e montagem. A preserva seu apresentador existente, ausente nos demais; isso adiciona custo e diferencia a composição, portanto não é uma comparação isolada de bibliotecas. O modelo educativo é equivalente nos quatro.

## Tecnologias e versões

- Remotion / @remotion/three **4.0.537**, React / React DOM **19.2.3**, R3F **9.8.2**.
- Three **0.186.1** em A; **0.187.0 (r187)** em B/D, confirmado no pacote instalado e no [release oficial](https://github.com/mrdoob/three.js/releases/tag/r187).
- Blender **5.2.2 LTS**, exportador Khronos glTF Blender I/O **5.2.40**; FFmpeg **8.0.1**, Node **22.22.1**, Python **3.14.4**.
- Host Xeon E5-2697 v3, 28 threads lógicas, cerca de 30 GiB RAM; AMD Navi 22 com 12 GiB VRAM. Renders serializados, `nice 10`, afinidade de 6 CPUs, Remotion concorrência 1, ANGLE. Outros serviços permaneceram ativos.
- Todos os masters: H.264, CRF 19, preset medium, yuv420p; mesma faixa AAC. Comparativo: cada master reduzido a 960×540, grade 2×2 e áudio único.
- Documentação primária consultada: [Remotion Three](https://www.remotion.dev/docs/three), [ThreeCanvas](https://www.remotion.dev/docs/three-canvas), [R3F](https://r3f.docs.pmnd.rs/getting-started/introduction), [Three.js](https://threejs.org/). API bpy conferida na versão instalada; consulta web ao manual Blender não ficou disponível.

## Tempo de criação até o MP4 pronto

Valores medidos, incluindo criação automática a partir do roteiro/áudio congelados, render, mux e validação completa. Em A/B, a instanciação da geometria acontece dentro do processo de render e está incluída nessa coluna, sem cronômetro separado. A preparação comum é incluída em cada coluna de custo individual; a criação Blender compartilhada entra em C e D para representar cada caminho executado isoladamente. **Não somar essas linhas para estimar o lote**, pois recursos compartilhados seriam contados duas vezes.

| Motor | Criação/preparo | Render + montagem | Mux | Validação | Pronto, trabalho ativo | Espera registrada |
|---|---:|---:|---:|---:|---:|---:|
| A | 0min 01.1s | 2min 07.0s | 0min 00.5s | 0min 19.1s | **2min 27.6s** | 0min 00.3s |
| B | 0min 01.1s | 1min 48.5s | 0min 00.5s | 0min 22.3s | **2min 12.4s** | 0min 00.3s |
| C | 0min 36.9s | 15min 55.7s | 0min 00.5s | 0min 22.9s | **16min 56.0s** | 1min 47.8s |
| D | 0min 24.7s | 1min 54.8s | 0min 00.5s | 0min 18.1s | **2min 38.2s** | 0min 36.3s |

**C detalhado:** render nativo Blender 13min 23.0s; montagem/encode Remotion 2min 32.7s. A espera por lock/recursos fica separada, inclusive quando um motor aguardou outro experimento.

**Limite explícito da medição:** a síntese inicial única e o tempo de desenvolvimento/revisão pelo agente não foram cronometrados separadamente nesta execução. Assim, o total inicial absoluto desde a escolha do tema permanece **não medido**; não é apresentado como se fosse conhecido. Os totais da tabela começam com o roteiro e a voz congelados. O runner agora mede a preparação e, quando não há áudio, também a síntese inicial para execuções futuras. Não ressintetizamos a narração para fabricar esse número.

## Desempenho medido

| Motor | FPS de produção | Pico RAM árvore GiB | Pico VRAM dispositivo GiB | MP4 MiB | Frames | Falhas de processo no render final |
|---|---:|---:|---:|---:|---:|---:|
| A | 11.34 | 2.00 | 8.84 | 9.19 | 1440 | 0 |
| B | 13.27 | 1.81 | 8.80 | 8.40 | 1440 | 0 |
| C | 1.51 | 2.30 | 11.36 | 7.57 | 1440 | 0 |
| D | 12.54 | 1.51 | 9.18 | 8.26 | 1440 | 0 |

FPS de produção = 1.440 / tempo de render; em C inclui render nativo e montagem. RAM é soma de RSS da árvore amostrada a cada 500 ms, podendo contar páginas compartilhadas mais de uma vez. VRAM é **o dispositivo inteiro**, incluindo outros processos; consumo exclusivo do motor não foi mensurável. Os resultados são uma execução neste host, sem várias rodadas estatísticas. Tempos incluem empacotamento, carregamento e encode. O menor tempo automático até pronto observado foi **B**.

Comparativo 2×2: criação e verificação em **0min 44.7s**. Métricas brutas, comandos, tentativas e tempos de espera estão em `comparacoes/measure-*.json`; logs locais em `logs/`.

## Verificação, falhas e correções

- FFprobe confirma 1920×1080, 30 FPS, 48 s, 1.440 frames e áudio nos quatro masters. FFmpeg decodifica integralmente, sem erro; hashes do áudio decodificado coincidem com o canônico.
- Detecção de preto/congelamento registrada por motor em `metricas.json`. Presença de geometria verificada aos 3, 11, 16, 23, 29, 36 e 44 s com máscara do cenário, além da inspeção visual. Isso detecta a prévia híbrida vazia que um exit code zero não detectou; não é um detector universal de defeitos gráficos.
- Testes espaciais em todos os 1.440 estados: fundo da câmara fixo, barco flutuando, comportas na ordem correta e espaço de passagem. Teste de repetição de poses após seeks. B/D passaram 14 comparações reais de canvas em navegador, após avanço/retorno: diferença máxima de canal **0**, em `seek-pixels.json`. O renderer observado foi ANGLE/AMD Radeon RX 6750 XT, WebGL 2.0.
- Primeira prévia D terminou sem geometria: Suspense interno ocultava a espera de carregamento do ThreeCanvas. Removido o limite interno; modelo carrega antes de capturar. Evidência preservada em `D-preview-blank.png`, com correção e verificação em `defeitos.json`.
- C tinha granulação nas reflexões com 32 amostras; render final usa 64. B tinha ondulações excessivamente regulares; amplitude reduzida e ondas periódicas combinadas. Passagem da tubulação recebeu abertura no corte da parede.
- A fila também identificava guards aguardando como renders ativos por seus argumentos; corrigido excluindo apenas os próprios guards enquanto o lock está adquirido, sem ocultar filhos reais.
- Gate inicial confundia autoria com render; após adquirir o mesmo lock da produção, apenas o processo exato de autoria é excluído. Filhos de render e limites de RAM/carga continuam protegidos. Espera interrompida não é contabilizada como render fracassado.
- Retomada usa hashes de entradas e saídas; sequência Blender tem manifesto próprio. Frames de outra cena são arquivados, nunca reutilizados silenciosamente. Cache nativo não substitui sua medição original por tempo próximo de zero.

## Avaliação visual e recomendação

Avaliação subjetiva do agente baseada na prancha dos mesmos sete instantes dos quatro MP4 (28 quadros), quadros completos próximos, prévias renderizadas, contratos espaciais em 1440 frames e 14 testes reais de seek B/D com diferença de pixels zero. Escala 0–10: espaço = perspectiva, volume e relações estáveis; visual = luz, materiais, acabamento e ruído; clareza = associação fala/ação e foco; movimento = continuidade das poses/câmera amostradas e determinismo; automação = reprodução, dependências, retomada e execução observada. As notas não são medições objetivas nem estudo com espectadores.

| Motor | Espaço | Visual | Clareza | Movimento | Automação |
|---|---:|---:|---:|---:|---:|
| A | 8 | 6.5 | 8 | 8 | 9 |
| B | 8 | 7.5 | 8.5 | 8 | 9 |
| C | 8.5 | 8 | 8 | 8 | 7 |
| D | 8.5 | 7.5 | 8.5 | 8 | 8 |

**A:** Preserva o robô, a paleta e a composição existentes. Profundidade e eventos são claros, mas água lisa e iluminação mais uniforme dão acabamento menos rico. O apresentador permanece à direita e adiciona custo/composição que os outros não têm.

**B:** Bordas e sombras mais definidas; reflexo de ambiente e ondulação aparecem nos planos de entrada/elevação. A água ainda tem padrão estilizado e o casco simples limita realismo. Melhor combinação observada de clareza e tempo neste cenário procedural.

**C:** Reflexos relacionam barco e superfície e as sombras variam suavemente nos ângulos. DOF e iluminação oferecem o acabamento mais agradável nos planos próximos. Ainda há granulação fina nas áreas reflexivas; menor contraste e foco suave reduzem um pouco a legibilidade de detalhes. Custo nativo e 1,2 GiB de intermediários pesam na automação.

**D:** Geometria Blender arredondada permanece consistente de frente e de lado. O modelo carregou integralmente após a correção e a água recuperou brilho/normal animada, mais discreta que B por diferenças de UV. Não preserva os reflexos/iluminação nativos de C; neste cenário simples a exportação não produziu salto visual que supere o custo extra de preparo.

**Melhor resultado visual observado:** C — Blender nativo: reflexos do barco e das comportas na água, sombras mais suaves e profundidade mais convincente nos planos de 23–29 s. A diferença é observável nas imagens renderizadas, não inferida da lista de recursos. **Abordagem recomendada neste experimento:** B — Three.js procedural para este tipo de explicação automatizada: menor tempo medido e boa legibilidade, com controle integral por frame e menos etapas. Usar C em planos de maior exigência estética; D quando a modelagem Blender trouxer complexidade que justifique exportar e manter assets. Nenhuma substituição automática do original foi feita.

Limite da avaliação: Não houve avaliação com público nem observação humana integral dos cinco vídeos em tempo real. Fluidez foi julgada por amostras, poses e seek, sem afirmar preferência subjetiva de espectadores. Mesma geometria simples favorece proximidade entre B e D; não extrapolar para personagens complexos. Primeiro/último enquadramento são amplos em todos, e o diagrama em corte não busca fotorealismo.

## Limitações restantes e combinação dos motores

Esta é uma encenação específica, com cenário procedural dirigido; não comprova transformar qualquer narrativa arbitrária em 3D cinematográfico nem substituir a autoria do pipeline de notícias. O software reproduz o benchmark sem LLM adicional, depois de fixados roteiro e contrato espacial. Para novos assuntos é necessário elaborar outro contrato visual.

Os enquadramentos e acontecimentos foram mantidos equivalentes. A topologia arredondada do Blender e diferenças de iluminação/material fazem parte da comparação; glTF não preserva todos os shaders nativos. O fluxo de água é indicado de forma esquemática, e a parede frontal é um corte. A avaliação não equivale a teste com público nem a inspeção humana integral em tempo real.

É possível reutilizar modelos Blender em D e reservar C para planos que dependem de reflexos/DOF nativos, usando o mesmo storyboard, narração e composição Remotion. A produção original segue disponível; nenhum motor experimental foi ativado nela automaticamente.

## Arquivos e reprodução

- A: [video_A_original.mp4](outputs/video_A_original.mp4) — `/home/servidor/Git/youtube_ai/youtube-automation-agent/benchmarks/video_3d/outputs/video_A_original.mp4`; SHA-256 `7d1a79f7a3f9a8d5ed9b1b38988a709b083df078bfc0e75d810948215b9ea1e7`.
- B: [video_B_threejs_procedural.mp4](outputs/video_B_threejs_procedural.mp4) — `/home/servidor/Git/youtube_ai/youtube-automation-agent/benchmarks/video_3d/outputs/video_B_threejs_procedural.mp4`; SHA-256 `dd0a035d63058b39d3c8b775d9f20cfabe12714274ef4ca2127d1a3ebec32261`.
- C: [video_C_blender.mp4](outputs/video_C_blender.mp4) — `/home/servidor/Git/youtube_ai/youtube-automation-agent/benchmarks/video_3d/outputs/video_C_blender.mp4`; SHA-256 `439b3c7dd5b3014d6b9d2d37317bcf0c4d00318eb7d39e725264f1889420d5b3`.
- D: [video_D_hibrido.mp4](outputs/video_D_hibrido.mp4) — `/home/servidor/Git/youtube_ai/youtube-automation-agent/benchmarks/video_3d/outputs/video_D_hibrido.mp4`; SHA-256 `b9a0bad84b58b4f043acba96b5e450306a5541000236e862b6174a4af5cbd325`.
- [Comparativo sincronizado](outputs/comparativo_4_motores.mp4) — `/home/servidor/Git/youtube_ai/youtube-automation-agent/benchmarks/video_3d/outputs/comparativo_4_motores.mp4`.
- [Prancha comparativa](comparacoes/comparativo.png), [métricas](comparacoes/metricas.json), [storyboard](roteiro/storyboard.json), [roteiro](roteiro/narrativa.md), [WAV único](roteiro/narracao.wav).
- Modelos: `motores/blender/eclusa.blend` e `motores/hibrido/lock.blender.glb`; frames nativos em `motores/blender/frames/`.
- Evidências de integridade, ambiente e hashes em `comparacoes/`; fontes de cada motor em `motores/`.

```bash
python3 benchmarks/video_3d/run.py --all
node --test benchmarks/video_3d/shared/contracts.test.cjs
```

O comando prepara entradas, constrói a cena Blender quando necessário, aguarda recursos, renderiza ou retoma saídas válidas, verifica os arquivos, gera o comparativo e este relatório. Dependências npm são isoladas e fixadas no lockfile. Pacotes de sistema ausentes são informados explicitamente; nenhum motor é substituído. Conteúdo binário pode ser recuperado pelos assets da release indicada no README. Preservação do projeto e status do serviço são registrados separadamente, sem confundir esse benchmark com comprovação de envio social.
