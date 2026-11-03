# Pré-verificação real do render — 02/11/2026

O renderer de produção criou uma amostra de 92 quadros nos dois formatos, com narração, mixagem, robô aprovado e checkpoints isolados. H.264/AAC, 24 fps, 3,84 s, 1920×1080 e 1080×1920; ambos decodificados integralmente. Tempo total: 44,913 s, com treino preservado e render sequencial de baixa prioridade. Hashes em [evidence.json](evidence.json).

**Revisão visual reprovada.** A cena antiga em cache declarava deslocamento sem alterar a posição e desenhava blocos sem encenação, alguns cortados. O novo validador rejeita ausência de mudança durante a fala em cada formato, inclusive retenções constantes e movimento somente de câmera. A mesma amostra agora falha antes do render e na revisão de publicação, para voltar ao reparo do writer. Isso não resolve sozinho a qualidade artística de toda cena.

Capturas: [horizontal](landscape.png), [vertical](portrait.png). Os MP4s permanecem localmente em `data/videos/diagnostics/`; não entraram na fila de publicação. O episódio de produção continua independente.

`scripts/check-narrative-render.js --plan <plano.json> --audio <audio> --report-dir data/reports/<teste>` exercita o renderer real com ID `diagnostic-*`, saída isolada e sem chamada de publicação. Respeita o gate e o lock de produção; não execute em paralelo com um gerador ativo. O plano precisa passar pela validação atual; a amostra acima é evidência do defeito encontrado antes da correção, e não deve ser reclassificada como aprovada.
