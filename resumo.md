# Resumo de entregas do Pulso

Requisitos: [decisões vigentes](docs/decisoes-vigentes.md). Estado/objetivos: [plan.md](plan.md). Acrescentar entregas datadas aqui; substituir o cursor no plano, sem manter várias versões concorrentes.

## 03/11/2026 — narração recuperada e contrato de autoria, v2.35.0

Recuperados os 13 checkpoints da cadeia `previous`. A pergunta pendente era se já havia envios; a conferência viva encontrou fila vazia e mais de 110 tentativas no job `53814e09`. Reproduzido: dois hífens isolados em “SSM - Population Health” eram contados como palavras. O helper de TTS produzia áudio correto, mas o alinhador o rejeitava e acionava a CLI alternativa, cuja transcrição longa veio truncada/repetida. Corrigida a tokenização sem remover pontuação das legendas nem aceitar palavras omitidas. O serviço concluiu 504,864 s de voz, avançou às imagens e obteve as duas capas Android, sem geração manual substituta.

Reutilizados os módulos de timings/cache e a fila de adiamento existente. A narração só substitui o checkpoint após validação textual; falha de alinhamento é distinta de indisponibilidade remota. Falhas repetidas de TTS também liberam outras pautas mantendo o job. Na autoria, o schema agora exige pontos de tubos/perfis, mensagens mostram campo e limite, e notas internas extensas são limitadas antes da validação estrita. Não foram relaxados fatos, colisões, apoios, duração ou publicação.

Reload em janela ociosa comprovada às 21:03:27 UTC; unidade única continua ativa. A execução anterior chegou às cenas mas não as concluiu; nenhum master novo ou envio novo foi confirmado. Evidências, hashes e validações em [recuperação de narração](docs/evidencias/recuperacao-narracao-2026-11-03/README.md). Mudanças anteriores de `.planning`, benchmark de encomendas, humanos procedurais experimentais e `SHA256SUMS` preservadas fora da entrega.

## 03/11/2026 — retomada, CPU e reparos limitados, v2.34.0

Retomada após mudança de conta, com leitura de toda a cadeia `previous`. Consolidadas as correções pendentes de CPU/preparação, cues repetidos, referências espaciais, apoio/móveis e rótulos. Corrigido piso tratado como mesa/apoio de si mesmo. Reparos agora têm contador persistido e recomposição do bloco reprovado após seis respostas; falha remota preserva o rascunho. Serviço executou esse caminho e reutilizou partes anteriores por hash, sem restart ou produção manual substituta.

Capturas reais horizontal/vertical mostram os rótulos nas malhas e fora da silhueta humana; retorno ao frame reproduz o mesmo SHA. A encenação diagnóstica continua reprovada por objetos/contatos inadequados. Ainda não houve episódio integral ou publicação nova confirmado. X permanece sem identidade/handler operacional e com crash nativo registrado. [Evidências e limitações](docs/evidencias/recuperacao-2026-11-03/README.md), [release](docs/releases/v2.34.0.md). Alterações experimentais e `.planning` preexistentes preservadas fora da entrega.

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
