# Benchmark de quatro motores — concluído localmente em 01/11/2026

Tema sorteado: como uma eclusa levanta um barco. Semente `1055545869`. Experimento isolado, sem publicação social e sem alteração do renderer da produção.

- [x] Arquitetura, skill, dependências e documentação oficial inspecionadas.
- [x] Tema e narrativa única registrados; uma síntese Edge TTS de 46,584 s reutilizada nos cinco MP4s.
- [x] Storyboard, geometria, acontecimentos e movimentos compartilhados.
- [x] A: composição `NarrativeEpisode` original, sem modificar seus componentes.
- [x] B: ThreeCanvas/R3F com geometria procedural em Three r187, sem GLB.
- [x] C: Blender Eevee nativo com 1.440 PNGs e montagem Remotion.
- [x] D: GLB exportado realmente do Blender e animado em Remotion/R3F.
- [x] QA completo, métricas, comparativo 2×2, prancha e relatório.
- [x] Retomada por hash, preservação do projeto, commit/push/tag/release v2.14.0.

Os quatro masters e o comparativo têm 1920×1080, 30 fps, 48 s, 1.440 frames, H.264/AAC e a mesma faixa de áudio. FFprobe, decodificação integral, áudio, presença de geometria e ausência de anomalias passaram. B/D passaram 14 verificações reais de seek com diferença máxima de pixels 0. A produção original mantém seus hashes; o scheduler permaneceu ativo e não foi reiniciado.

O renderer original já usa Three.js no palco adaptativo e no apresentador. Portanto A versus B compara a arquitetura/composição existente com uma implementação dedicada, não SVG puro versus 3D. B não carrega o apresentador GLB; essa diferença está explicitada no relatório.

Versões: Remotion 4.0.537, React 19.2.3, R3F 9.8.2; A preserva Three 0.186.1 da produção; B/D usam Three 0.187.0 isolado; Blender 5.2.2 LTS. A GPU/VRAM foi registrada como dispositivo inteiro, não como consumo exclusivo do motor.

Tempos medidos desde roteiro/áudio congelados até MP4 validado: A 2min27,6s; B 2min12,4s; C 16min56,0s; D 2min38,2s. As esperas ficam separadas no relatório. A síntese inicial e o desenvolvimento/revisão não foram cronometrados e permanecem explicitamente não medidos.

Falhas corrigidas: D inicialmente vazio por espera GLTF mascarada; água do GLB recomposta por frame; C subiu de 32 para 64 amostras; fila/gate deixou de contar guards aguardando como renders ativos. As evidências permanecem em `comparacoes/defeitos.json`, inclusive o frame vazio histórico.

Entrega: fontes, scripts, evidências e relatório estão no Git; os cinco MP4s e os assets binários recuperáveis estão anexados à release `v2.14.0`. A versão não comprova desbloqueio de YouTube/X, publicação social ou cadência de 60 vídeos/dia.
