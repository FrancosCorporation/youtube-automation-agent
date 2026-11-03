# Recuperação de autoria e CPU — 03/11/2026

## Correções e prova

- Preparação remota não exige VRAM de render. O serviço usa `swangle`/CPU pelo drop-in `40-cpu-render.conf`, preservando afinidade, prioridade, RAM, swap e lock. Nenhum restart da unit foi executado nesta retomada.
- Cues repetidas recebem âncoras medidas inequívocas. Reparos locais não retimam ações arbitrariamente; a validação estrita é repetida. Referências sem índice só são completadas quando existe exatamente uma malha.
- A autoria recupera apoio de móveis/atores, conserva clips/percurso e verifica novamente os volumes. O piso único não é um móvel apoiado em si mesmo nem deve virar uma mesa no renderer.
- Reparos de geometria só recebem rascunhos normalizados. Erros estruturais voltam à autoria completa do bloco. Após seis respostas de reparo, o contador persistido exige recompor somente o bloco ainda reprovado. Erros de rede não consomem esse contador nem apagam o rascunho. Blocos aprovados permanecem em cache por hash.
- Os rótulos usam limites projetados das malhas com suas animações, em vez da origem compartilhada do grupo, e evitam a silhueta humana. Revisão de componente v2.34 impede retomar masters de pixels antigos.

## Capturas reais

O rascunho de cozinha foi lido do cache sem alterá-lo. O diagnóstico tem 5,75 s, fonte explicitamente inelegível para publicação e áudio recortado somente na pasta de relatório. Foram preservados os instantes de keyframes já resolvidos; o diagnóstico não certifica a qualidade de alinhamento do TTS de fallback.

[Horizontal antes](landscape-before.png) → [depois](landscape-1-30.png). [Vertical antes](portrait-before.png) → [depois](portrait-1-30.png).

Foram capturados frames 0, 30, 136 e novamente 30 nos dois formatos, em escala 0,5 de composições 1920×1080/1080×1920. O SHA do frame repetido coincide em ambos. [Hashes](capture.json), [validação](validation.json). Originais e scripts locais: `data/reports/relay-recovery-20261103/`.

A correção revela o personagem antes coberto pelo texto. **A encenação continua inadequada para publicação**: móveis não caracterizam bem pia/fogão, a ação não demonstra lavagem com contato e os rótulos do rascunho são fragmentos sem boa função explicativa. O prompt de nova autoria distingue essas formas e pede poucos rótulos; essa instrução ainda precisa demonstrar resultado real. Não confundir câmera/colisão aprovadas com encenação aprovada.

Os dois MP4s de diagnóstico herdados da conta anterior existem em `data/reports/grounded-stage-action-20261103/{landscape,portrait}.mp4`: 9,771 s, áudio AAC, 234 frames; renders em CPU de 123,485 s e 126,884 s. São diagnósticos, não episódios entregues nem publicações.

## Serviço observado

Em `logs/gen_2026-11-03T18-47-57-925Z.log`, Psicologia chegou ao limite persistido de reparos e mudou para recomposição; as rotas seguintes falharam por quota/rede. Em `logs/gen_2026-11-03T18-53-49-946Z.log`, Carreira reutilizou as partes 1–3/6 por hash e voltou à parte 4, ainda com colisão entre operador e pátio desenhado como parede. Health: producer ativo, fila pronta vazia, renderer `swangle`. Nenhum episódio integral ou envio novo foi confirmado nesta entrega.

X: a inspeção somente de leitura encontrou X 12.35.0-prod.01 ARM64 no Android 15 e crash registrado na carga nativa Yoga/SoLoader. Continua sem identidade configurada e sem publicador operacional. Foi solicitada a identidade da conta; nenhuma conta, privacidade ou sessão foi alterada.

## Verificação e preservação

CI final, lint/TypeScript e testes focados registrados em `verification.json`. A suíte usa estado temporário, sem credenciais de produção. Nenhum envio foi repetido. Mudanças experimentais anteriores em `benchmarks/video_3d/parcel_demo`, humanos procedurais de benchmark, `.planning` e `SHA256SUMS` permaneceram fora desta entrega.
