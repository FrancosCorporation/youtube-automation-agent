# Resumo de entregas do Pulso

## 05/11/2026 — autoria fragmentada, recursos e sessão X, v2.41.0

Recuperada a autenticação X com a conta Google existente; identidade própria conferida. Eliminadas apenas duplicatas e fragmentações inequívocas de trilhas na autoria; comparação por frame preserva movimentos. Corrigido clamp de carga que ignorava 1,10 configurado no perfil instalado, com fallback finito para configuração inválida. 54 testes focados e lint passaram; CI isolada completa passou; 48 testes adicionais de retry/X e lint também passaram. O rascunho real passou de sete para três trilhas válidas, ainda retido pela colisão seguinte. Reutilizados normalizador, controles, locks e guard existentes.

Kwai ocioso foi parado sob lock após consumo anormal; llama-cpp pausado temporariamente conforme autorização anterior e timer de restauração armado. Treino preservado. Reconstrução/revisão e publicação nova permanecem pendentes. [Detalhes](docs/releases/v2.41.0.md).

## 04/11/2026 — concorrência de geração/retry, X e Android, v2.40.0

A retomada corrigiu a assimetria que deixava retries começarem durante geração, mas bloqueava geração quando um retry já estava ativo no perfil compartilhado. O composer X distingue upload real, barra ociosa e contador de caracteres; texto da legenda não vira mensagem de erro. Falhas anteriores ao clique guardam a etapa, enquanto cliques incertos continuam exigindo reconciliação.

Identificada e recuperada VM Android pausada apesar da unit ativa. O controle comum confirma `stopped`, obtém o lock e retoma sem reiniciar; resposta atrasada é reconciliada por estado, sem repetir start. Probe de boot limitado a cinco segundos. CI isolada completa e lint passaram, além dos 97 testes de integração e 30 focados. Worker NVIDIA deixou patch incompleto e atingiu timeout; implementação Android final foi feita pelo orquestrador. Sem dependências novas; helpers de controle, lock e CDP reaproveitados.

Chrome tinha configuração inicial e ANRs; CDP recuperado, autenticação X em verificação. Serviço continua gerando/adiando conforme providers e recursos; fila sem episódio novo. Reconstrução e revisão visual ainda pendentes: não há prova de autonomia completa. Pausa de llama-cpp foi feita pela sessão anterior com timer de restauração de 90 minutos; treinamento preservado. Alterações preexistentes de TTS, geração, apoio, experimentos e planning ficaram fora da entrega. [Evidências](docs/evidencias/autonomia-2026-11-04/retry-e-x.md).

## 04/11/2026 — retomada visual e X Android, v2.39.0

Recuperados seis checkpoints após troca de conta. Finalização da reconstrução agora encerra a reserva antes de limpar o marcador; espera de recursos/interrupção preserva a mesma tentativa. Crítica feita durante o render é aplicada ao manifesto concluído, permitindo a reconstrução posterior. Enquadramento passou a ter tamanho mínimo obrigatório na autoria, com reparo de câmera e espaço para o título horizontal; capturas reais dos dois formatos inspecionadas. A cena dos fósseis continua semanticamente reprovada, apesar da aproximação.

X integrado ao Chrome Android com identidade própria, lock, proteção de rascunhos e resultado incerto preservado para reconciliação. Menu da conta e editor reais conferidos sem upload de teste. A reconciliação inclui masters/cortes do X; Instagram retorna ao topo antes de paginar, e falhas de carregamento de Instagram/TikTok não são confundidas com conta divergente. Reutilizados os helpers de lock/CDP, prontidão social, ledger e revisão existentes; sem dependência nova.

Worker NVIDIA anterior entregou rascunho refeito pelo orquestrador; o worker desta retomada excedeu quatro minutos com patch incompleto, não integrado. Correção de leitura de textarea/contenteditable e teste em HTML local realizados pelo orquestrador. Treino, mídias, filas e mudanças anteriores preservados. CI concluída (49 verificações iniciais, 1.273 casos Node, 40 Python e browser), lint/TypeScript aprovados; recarga ociosa aplicada às 18:55 UTC, recuperando o mesmo job. Estado final registrado na [evidência da entrega](docs/evidencias/autonomia-2026-11-04/README.md). Sem publicação nova comprovada; YAI-062/063 continuam parciais.



## 04/11/2026 — recuperação de crítica visual, v2.38.0

O agendador só repetia a revisão de um vídeo retido e não solicitava reconstrução. Implementada reserva persistente por crítica/hash, entrada na fila existente e retomada do mesmo job após interrupção entre masters. O original não é sobrescrito; publicações incertas impedem uma substituição automática. Limite de duas gerações de reconstrução e três tentativas por job, exceto espera de recursos; falha terminal encerra aquela recuperação. Capítulos fora da crítica são revalidados e preservados.

A revisão dos frames de Psicologia aos 60/180 s foi convertida em crítica executável de `scene-02`; fonte, áudio, roteiro, imagens e sete capítulos preserváveis conferidos com os arquivos reais. Isso foi uma prova isolada de preparação; nenhuma reconstrução ou publicação nova foi alegada. CI completa (incluindo 40 testes Python e browser), 90 testes de integração focados e 61 posteriores passaram. Recarga será aplicada pelo guard em janela ociosa. O ajuste local de câmera segue sem validação visual e fora desta entrega. A reconstrução continua exigindo revisão nova; a rejeição original não é apagada. [Evidências e trabalho restante](docs/evidencias/recuperacao-visual-2026-11-04/README.md).

Requisitos: [decisões vigentes](docs/decisoes-vigentes.md). Estado/objetivos: [plan.md](plan.md). Acrescentar entregas datadas aqui; substituir o cursor no plano, sem manter várias versões concorrentes.

## 03/11/2026 — finalização e distribuição recuperáveis, v2.37.0

Pedido: completar a automação pelo código, sem acompanhamento contínuo. Corrigida finalização silenciosa com capas/cortes ausentes: o job permanece recuperável, com adiamento após repetição. Cortes possuem checkpoints por origem/receita/hash/duração; promoção do master possui intenção persistida para recuperação após crash. Consumer recupera revisão delegada pendente; retries podem executar durante geração no perfil compartilhado, com serialização do publicador e lock Android. Studio persiste o ID remoto observado e reconcilia periodicamente por conta, hash e linha pública/publicada.

Guard existente ganhou reload solicitado por PID/hash, somente após comprovar ociosidade e ausência de filhos/locks; elimina a necessidade de acompanhar manualmente a janela de atualização. Alterações anteriores de TTS, apoios, experimentos e `.planning` preservadas fora desta entrega. [Release](docs/releases/v2.37.0.md), [evidências e limites](docs/evidencias/autonomia-2026-11-03/README.md).

O horizontal do job `aadd101f` está concluído (461,013 s), e o serviço retomou o vertical em blocos. A execução integral e publicação do novo episódio ainda não estão comprovadas; YAI-062/063 permanecem parciais. X requer identidade/adaptador; pergunta sobre a conta enviada ao proprietário nesta conversa.

Retomada após troca de conta: corrigida confirmação do SIGSTOP no guard (estado T real antes de conferir ociosidade novamente). CI final local: 1.251 testes Node, 40 Python e browser/enquadramento; lint sem erros e um aviso anterior. Pedido de reload por PID/hash gravado e corretamente adiado com render ativo; vertical passou a 1.440 quadros concluídos. O proprietário orientou acesso ao X com Google no emulador; crash nativo reproduzido e atualização disponível iniciada pela Play Store. Nenhum novo envio comprovado; não confundir reconciliação de postagens antigas com produção/publicação nova.

Login Google concluído no Chrome do emulador: perfil próprio Pulso IA `@RodolfoFrancod1` confirmado. App nativo continua falhando e atualização foi bloqueada por espaço; adaptador X pendente. Colisão real de CDP corrigida no Studio/Gemini, preservando Chrome do host e validando encaminhamento Android; 55 testes focados e conexão real passaram. Worker NVIDIA realizou auditoria estática em snapshot; proposta CDP insuficiente não foi integrada, correção final feita e validada pelo orquestrador.

## 03/11/2026 — render com retomada por bloco e Instagram, v2.36.0

Após ler os 14 checkpoints, a inspeção atual encontrou a autoria concluída e o job `aadd101f` já renderizando 461 s de vídeo. Corrigido o limite de três horas compartilhado entre horizontal e vertical; a nova execução persiste blocos de 30 s por identidade/hash/duração, preserva os tempos globais e monta o áudio contínuo uma única vez. Um watchdog detecta ausência de avanço sem confundir CPU lenta com travamento. Recuperação de capturas antigas confere cada arquivo antes de reutilizá-lo; 4.320 quadros reais foram preservados inicialmente sem parar o renderer. O monitor temporário `/tmp/pulso-checkpoint-active-render.cjs` só copia capturas completas do PID original, respeita identidade/lock e termina com esse processo; não gera nem publica.

Corrigido outro bloqueio reproduzido: Instagram abria uma postagem já existente e devolvia `unknown`. O verificador retorna uma vez ao perfil e exige controles próprios e handle aprovado. Conferência real passou após o patch; TikTok/Kwai também estavam autenticados. X ainda falha por biblioteca nativa `libyoga.so`, sem conta/adaptador configurados. Pergunta de identidade enviada ao proprietário enquanto o restante continua. Planejamento dos cortes da narração atual passou para os destinos, mas isso não comprova render nem envio dos cortes.

Serviço único preservado, sem restart/reenvio. A renderização iniciada antes do patch ainda usa o código antigo; o próximo processo carrega a recuperação nova. Testes e evidências em [render retomável](docs/evidencias/render-retomavel-2026-11-03/README.md). Modificações anteriores de TTS, apoio, benchmarks e `.planning` ficaram fora desta entrega. Ainda não há novo master integral/publicação confirmado; acompanhar render, QA, publicação e próximo ciclo.

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
