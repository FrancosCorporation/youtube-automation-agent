# Resumo de entregas do Pulso

Requisitos: [decisões vigentes](docs/decisoes-vigentes.md). Estado/objetivos: [plan.md](plan.md). Acrescentar entregas datadas aqui; substituir o cursor no plano, sem manter várias versões concorrentes.

## 03/11/2026 — falhas de autoria/render, v2.33.0

Corrigidos três defeitos reproduzidos no rascunho real: mensagem de altura quando faltava borda de piso; captura vazia antes dos GLBs carregarem; personagens cortados nos dois formatos. Reparo limitado do suporte, espera gerida pelo ThreeCanvas e reparo/validação da câmera preservam atores, clips, narração e trajetórias. Cache antigo continua sujeito à validação estrita. O serviço revalidou a parte 1/8 da cena 2 localmente às 00:09 BRT e passou à parte seguinte, ainda bloqueada por colisão adulto/mesa e disponibilidade remota.

CI completa, regressões, lint/TypeScript e oito capturas passaram; repetir o frame 98 produz o mesmo SHA. Conferência final em modo de software explícito e limitado por CPU/RAM/lock, sem alterar o modo de produção. [Provas e limites](docs/evidencias/autoria-2026-11-03/README.md), [release](docs/releases/v2.33.0.md). O diagnóstico segue reprovado como encenação: props flutuam e não demonstram contato/ação suficientes. Nenhum episódio integral ou publicação nova confirmado. Serviço único preservado, sem restart/reenvio, observado aguardando VRAM. Próximo trabalho permanece no cursor do plano.

## 02/11/2026 — alinhamento à última aprovação, v2.32.0

Pedido: remover contradições deixadas pelas retomadas/modelos anteriores. Preservados integralmente os documentos anteriores e seus hashes em [arquivo](docs/archive/alinhamento-2026-11-02/README.md). Os 63 IDs e seus estados foram mantidos; nenhuma pendência foi declarada concluída por editar documentação.

Consolidados: Three.js r187/Remotion e humanos GLB locais do piloto aprovado, robô, ações por narrativa, mínimo real de seis minutos horizontal e vertical próprio/cortes, capas dedicadas Android, solicitação Nano Banana Pro sem identidade efetiva inventada, revisão local e autorização permanente de publicação/commit/push/tag. Removidos dos pontos de entrada os cursores concorrentes, roteiro limitado a 450 palavras, quotas/pausas antigas, HyperFrames como padrão e novo aceite por vídeo. Documentação AgentTube, planos antigos e pilotos superados ficaram identificados como históricos/independentes.

Correção de comportamento: `GeminiImageProvider` passa a usar Android por padrão e não migra ao navegador do host após falha Android. Uso web explícito continua disponível ao fluxo legado independente. Política de capas registra a instrução mais recente sem declarar Pro efetivo. Checkpoints/caches/filas e geração em andamento foram preservados; não houve restart, geração manual nem envio externo nesta consolidação.

Validação: 39 testes focados e três de apoio, CI completa (incluindo 40 Python e checks de browser), links atuais, preservação byte a byte dos 21 documentos e 63 IDs/estados passaram. Lint sem erros; um aviso preexistente no piloto CHAPEA. Erro de lint herdado em structuredClone do teste de apoio corrigido. Evidência em `docs/evidencias/alinhamento-2026-11-02/verification.json`. A execução de Psicologia observada em 02/11 tem áudio de 461 s, primeira cena aprovada e segundo capítulo retido por apoio dos pés/indisponibilidade dos modelos, com retomada automática observada às 23:10 BRT. Não há novo episódio completo/publicação confirmado nesta entrega; YAI-062/063 continuam parciais.

## Histórico anterior preservado

- [Resumo integral até esta consolidação](docs/archive/alinhamento-2026-11-02/resumo.md), incluindo recuperações e limitações das v2.30/2.31.
- [v2.31.0](docs/releases/v2.31.0.md): segundo reparo factual prioriza modelo maior; prova de escalada real ainda pendente.
- [v2.30.0](docs/releases/v2.30.0.md): cache por job, reserva de pautas, retomada por sinal, duração antes das imagens, consultas CDP limitadas e apoio de atores; não comprova fluxo completo.
- [v2.18.0](docs/releases/v2.18.0.md): integração do método de humanos GLB aprovado. [Piloto](benchmarks/video_3d/reforestation_demo/README.md): 32 s; renders 84,51/86,79 s, sem medir todo o trabalho editorial.

O áudio original do job legado `5af3c1c7` não foi recuperado por hash após sobrescrita anterior do cache compartilhado. O job Carreira `a8396c3c` preservou voz de 629,5 s, imagens/capas e retomada adiada; consultar a fila atual para prazo/estado. Não interpretar esses registros como autorização para regenerar ou reenviar manualmente.

A skill instalada `video-animado-ia` também foi alinhada, com versão anterior preservada localmente e cópia vigente recuperável em `docs/skills/video-animado-ia/SKILL.md`. Ponteiros de planejamento do checkout e do diretório pai agora remetem ao plano único. Fontes experimentais de encomendas, suas alterações locais e as exclusões preexistentes de `.planning` ficaram fora da entrega; seus textos contraditórios foram arquivados/identificados como históricos.
