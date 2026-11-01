# Cadência e capacidade observadas — 13/10/2026

## Escopo da medição

Auditoria somente de leitura feita em 13/10/2026, das 16h44 às 16h45 em `America/Sao_Paulo` (-03). Os timestamps do scheduler são UTC; o log cresceu enquanto o processo permanecia ativo. A série de eventos de geração com marcadores consistentes está disponível de 11/10 até o corte parcial de 13/10. Os dias anteriores têm publicação, mas não permitem reconstruir a mesma série de tentativas de geração.

Nenhuma geração, publicação, alteração de configuração, instalação de pacote ou reinicialização foi feita para esta medição.

## Configuração e recursos no instante observado

- O processo ativo `scripts/channel-scheduler.js` usa `VIDEOS_PER_DAY=60`, `IMAGES_PER_GROUP=4` e `DELETE_AFTER_UPLOAD=1`; `STATE_DIR` não estava definido e o código usa `data/state` como padrão.
- Sessenta slots em 24 horas correspondem a um intervalo de 24 minutos.
- Em uma amostra instantânea às 16h44 (-03), o processo usava 0,5% de CPU e cerca de 154 MiB de RSS; o indicador disponível de atividade da GPU mostrava 0%. Isso não representa o consumo histórico nem o consumo de um render em execução.
- `scheduler.json` registrava 67 execuções e zero recaps. `publish-queue.json` registrava zero itens pendentes. Esses contadores não substituem o ledger por destino nem provam que todas as publicações tiveram sucesso.

## Geração

Os eventos abaixo são contagens de linhas do scheduler. O código emite um marcador de início antes de cada chamada do producer, um marcador de falha quando a chamada retorna sem sucesso e um marcador `pronto em` quando uma geração termina com sucesso. Os dias são janelas de calendário; 13/10 estava incompleto no corte.

| Data | Inícios | Falhas registradas | Conclusões registradas | Inícios sem marcador terminal | Duração das conclusões |
|---|---:|---:|---:|---:|---|
| 11/10 | 25 | 7 | 16 | 2 | n=16; média 58,23 min; mediana 66,35 min |
| 12/10 | 300 | 294 | 6 | 0 | n=6; média 28,52 min; mediana 29,25 min |
| 13/10, até 16h44 | 57 | 41 | 14 | 2 | n=14; média 33,89 min; mediana 33,90 min |

O arquivo persistido `data/state/gen-history.json` continha dez durações em milissegundos: média de 36,28 min, mediana de 39,36 min, mínimo de 16,83 min e máximo de 78,19 min. É uma amostra pequena e não inclui tentativas malsucedidas. Os inícios sem terminal não foram classificados como sucesso nem falha; podem corresponder a trabalho ainda em curso, interrupção ou lacuna de log. O volume de eventos de 12/10 é incomum e não deve ser convertido isoladamente em taxa de sucesso ou throughput sustentável.

Como o producer aguarda cada chamada de geração antes de iniciar a seguinte, a média persistida de 36,28 min excede o slot de 24 min da configuração de 60/dia. A divisão teórica de 24 horas por essa média dá aproximadamente 40 gerações/dia, antes de falhas e outros custos; isso é uma inferência de capacidade idealizada, não uma medição de produção diária. Mesmo a média parcial de 33,89 min em 13/10 excede o intervalo configurado.

## Publicação e limpeza

O par de marcadores `publicando:` e `limpeza pós-publicação:` permite medir somente o ciclo visível até persistência/limpeza local, não o tempo puro de rede nem o sucesso de cada plataforma. O marcador de limpeza só existe quando `DELETE_AFTER_UPLOAD=1` e o fluxo alcança essa etapa.

Em 13/10 houve 15 inícios de publicação e 14 marcadores de limpeza. Treze ciclos puderam ser pareados sem sobreposição ambígua: média de 17,20 min, mediana de 17,85 min e máximo de 25,21 min. Um início não teve limpeza subsequente no corte; outro pareamento ficou ambíguo por inícios intercalados. Em 12/10, os sete inícios e um marcador de limpeza não permitem um pareamento confiável. Portanto, esses tempos não representam todas as publicações nem autorizam concluir que todos os destinos foram confirmados.

## Chamadas, orçamento e cota

- `api-usage.json`, na data 13/10, registrava 164 chamadas `nvidia` e seis `smoke_test`. O contador não contém custo monetário por chamada nem divide o uso entre todos os produtos/serviços.
- `yt-quota.json` continha somente um timestamp (`2026-10-13T16:39:16.466Z`), sem limite, consumo ou saldo restante. O código usa esse marcador temporal para pausar o YouTube durante o dia correspondente no fuso do Pacífico; não é possível estimar saldo da cota a partir desse arquivo.
- Não há medição histórica de CPU/GPU ou custo financeiro. A leitura instantânea de recursos acima é insuficiente para dimensionamento.

## Conclusão e decisão pendente

Os dados não justificam manter 60/dia como capacidade comprovada: a duração média de geração supera o intervalo configurado, há falhas registradas e o dia mais recente está incompleto. Eles também não determinam se a meta de produto deve ser cinco ou outra quantidade por dia. A meta permanece decisão do usuário; não alterei o scheduler ou o ambiente.

Para fechar YAI-021, falta escolher a cadência desejada e obter um custo/quota mensurável por janela. Depois dessa decisão, a configuração e os documentos poderão ser alinhados numa janela operacional segura. Até lá, preserve a configuração ativa e não trate estes eventos como autorização para aumentar a frequência de publicação.

## Rechecagem somente de leitura — 17/10/2026, 13:47 BRT

Agreguei `logs/scheduler.log` do dia local 17/10 até o último evento de geração, às 11:56:52 BRT. O parser contabiliza início do producer, resultado `pronto em` e falha terminal com código; não classifica linhas individuais nem publica conteúdo. O recorte contém **79 inícios, 76 falhas, 2 conclusões de geração e 1 início sem marcador terminal reconhecido**. Códigos das falhas: `visual_image_provider_unavailable` 53, `source_claims_unverified` 11, `source_context_too_short` 7, `visual_scene_image_coverage_insufficient` 3, `script_generation_unavailable` 1 e `budget_exhausted` 1. A lacuna de marcador permanece sem classificação.

As duas conclusões ocorreram às 10:11:59 (Psicologia, 90,1 min) e 11:40:36 (Fitness, 79,0 min). `pronto` significa que o producer enfileirou a geração; não prova publicação ou sucesso por plataforma. A duração dessas duas amostras é maior que o slot configurado de 24 min, e os 76 ciclos com falha não entram como geração concluída.

Leitura do health às 13:47: heartbeat `2026-10-17T16:47:23.609Z`, processo ativo, fila `pending=0`, `inFlight=false`, última falha `budget_exhausted` às 11:56:52 BRT, próximo retry às 21:00:01 BRT, configuração mantida em 60/dia (24 min). Amostra do PID 1316347 após backoff: 0,1% CPU e 101.100 KiB RSS; é ocioso, não mede custo de geração. Não há atribuição de uso NVIDIA por job/canal nem custo monetário. Não alterei scheduler, quota, env, fila, credenciais ou publicação.

Essa janela confirma baixa taxa de conclusão e um retry por orçamento indisponível, mas não permite decidir uma cadência-alvo nem estimar throughput sustentável/custo. YAI-021 permanece Parcial: faltam janela estável com mais conclusões, atribuição de quota/custo por sistema e decisão do titular sobre a meta. O estado anterior permanece referenciado como histórico, sem substituir o baseline.

## Observação posterior — 15/10/2026, snapshot parcial

O scheduler reiniciado no boot continua configurado para 60 vídeos/dia, isto é, slot de 24 min, mas a geração real incorpora master 16:9, cortes verticais e partes narrativas. Um job iniciado às 12:25 BRT ainda estava ativo às 13:51 (mais de 86 min): o master de 539,04 s e três cortes curtos estavam concluídos, assim como a parte narrativa 1/4 de 146,967 s; a parte 2/4 ainda validava as cenas. Os renders concluídos usaram aceleração de hardware. Como o job é parcial, 86 min é um limite inferior de duração, não uma média nem um throughput concluído. A fila estava vazia e sem `inFlight` no snapshot; esse fato não altera o gate factual, e a pauta corrente não podia ser publicada por contexto de fonte não verificável.

Esse caso mostra que o slot de 24 min não é evidência de capacidade da cadeia completa: o primeiro job ainda não havia chegado ao estado terminal depois de mais de três slots. Não alterei `VIDEOS_PER_DAY`, a fila ou a publicação; a meta continua decisão pendente YAI-021. A medição precisa ser repetida com jobs terminais e custo/quota por janela antes de converter duração parcial em cadência operacional.

**Atualização do mesmo job — 15/10, 14:10 BRT:** o processo de geração seguia ativo depois de aproximadamente 104 min. A parte narrativa 2/4 concluiu; `ffprobe` confirmou 137,933 s, H.264/AAC, 1080×1920/30 fps, 58,45 MB. A parte 3/4 havia iniciado o checker de 30 cenas, ainda em execução. O throughput continua sendo uma amostra incompleta e acima de quatro slots configurados, não uma média/taxa concluída. Serviço permaneceu ativo e fila vazia; publicação continua bloqueada por contexto de fonte não verificável.

**Atualização operacional — 15/10, 14:16 BRT:** scheduler segue ativo e o mesmo producer permanece na validação da parte 3/4, agora há cerca de 11 min no checker. As partes anteriores usam captura/encode pela Radeon; o checker HyperFrames `0.8.149` está usando SwiftShader/CPU. Sem override no ambiente do processo, o prazo externo é de 45 min; não há job terminal nem nova média de capacidade. IMP-75 adiciona `data/state/generation-in-flight.json`: registra tema e saída antes da geração e, após reboot, refaz o mesmo tema em outro caminho preservando o arquivo interrompido. Gravei o checkpoint manualmente para este job legado. No mesmo boot houve seis tentativas de geração malsucedidas em dependências externas; os logs identificam timeouts NVIDIA/OpenAI numa delas, mas quatro ficam apenas como `Error` por sanitização. O scheduler permaneceu ativo e repetiu a cada cinco minutos. O master anterior foi bloqueado para publicação porque o contexto-fonte estava vazio. `generation-attempt.test.js` passou 2/2; QA visual e CI completa continuam aguardando o checker/render.

O log do job corrente detalha os limites de publicação e conta: a pauta UOL produziu contexto de zero caracteres, a revisão factual falhou indisponível e Gemini Web indicou perfil sem login. O pipeline segue gerando, porém o gate não deixa publicar sem evidência factual suficiente; esses avisos não interromperam o scheduler.

**Atualização — 15/10, 14:20 BRT:** a validação 3/4 concluiu e a captura da parte narrativa 3/4 começou pela Radeon; estava em 31% de 4.925 frames. O job segue sem estado terminal. A unidade permanece active e a fila está vazia; checkpoint manual cobre o job legado. QA e CI seguem adiados até o render terminar.

**Atualização — 15/10, 14:27 BRT:** a parte 3/4 concluiu em 8m07,8s de captura/encode Radeon. `ffprobe` registrou 164,167 s, H.264/AAC, 1080×1920/30 fps e 68,74 MB, abaixo do teto de 179 s. O checker da parte 4/4 começou com 17 cenas; ainda não há estado terminal do job.

**Fechamento do mesmo job — 15/10, 14:47 BRT:** o producer terminou após 141,5 min totais, incluindo master, três cortes e quatro partes narrativas. As partes 1–4 medem 146,967 s, 137,933 s, 164,167 s e 90,033 s; todas são H.264/AAC, 1080×1920/30 fps e menores que 179 s. As capturas finais foram feitas pela Radeon. O checker antigo da última parte usou SwiftShader e levou ~16 min; a próxima geração usará detecção automática de GPU durante `check`. Trata-se de uma amostra terminal única, ainda bem acima do slot configurado de 24 min; não é média ou throughput sustentável e não justifica mudar YAI-021. O master foi retido pela ausência de contexto-fonte verificável, sem envio. Após persistir esse resultado, a fila voltou a vazia (`inFlight=null`) e o checkpoint manual foi reconciliado/removido; o serviço entrou em janela curta de manutenção para CI.

## Atualização de capacidade — 17/10/2026, 00:00–07:03 BRT

Leitura somente de `logs/scheduler.log` às 07:03:24 BRT, correlacionada pelo dia local `America/Sao_Paulo`. O health snapshot configurava 60 vídeos/dia (slot de 24 min), scheduler ativo, fila vazia e nenhum job em aberto.

| Janela local | Inícios | Falhas terminais | Conclusões | Em aberto | Falhas por código |
|---|---:|---:|---:|---:|---|
| 17/10, 00:00–07:03 | 68 | 68 | 0 | 0 | 53 `visual_image_provider_unavailable`; 7 `source_claims_unverified`; 6 `source_context_too_short`; 2 `visual_scene_image_coverage_insufficient` |

O contador compartilhado `data/state/api-usage.json` registrava 122 chamadas `nvidia` na data local. Ele agrega consumers do sistema e não atribui todas as chamadas ao scheduler nem estima custo monetário. Esta janela parcial mostra falha operacional total no período; não mede throughput sustentável. As 53 falhas de provider concentram-se em jobs anteriores à correção do preflight Gemini Android. Após essa correção, o job das 06:40 atravessou o gate e falhou por cobertura insuficiente; o smoke Android isolado baixou um PNG válido. A revisão factual continua sendo outro gate.

Não alterei `VIDEOS_PER_DAY`, retry, quota, fila ou publicadores. YAI-021 permanece parcial: o alvo configurado é explícito, mas viabilidade, orçamento atribuível e frequência de produto não foram comprovados nesta janela sem conclusões. Repetir a medição após estabilização do provider e em janela completa, incluindo geração terminal e confirmação por destino.

## Rechecagem somente de leitura — 17/10/2026, 19:59 BRT

Reprocessei os marcadores estruturados de `logs/scheduler.log` até 19:59 BRT, agrupando timestamps UTC por `America/Sao_Paulo`. No dia local 17/10: **80 inícios**, **77 falhas terminais**, **2 conclusões de geração** e **1 início sem terminal reconhecido**. Códigos de falha: `visual_image_provider_unavailable` 53, `source_claims_unverified` 11, `source_context_too_short` 7, `visual_scene_image_coverage_insufficient` 3, `budget_exhausted` 2 e `script_generation_unavailable` 1. Em relação ao corte das 13:47, acrescentou-se somente um início e uma falha por orçamento; nenhuma nova geração terminou.

As duas conclusões anteriores seguem sendo as únicas amostras terminais do dia: 90,1 e 79,0 min (média/mediana de 84,55 min, n=2). Cada uma excede o slot nominal de 24 min por cerca de 3,3–3,8 vezes. A amostra é pequena, exclui falhas do tempo de conclusão e não estima throughput sustentável. Não converter o quociente teórico (24h divididas por essa média) em meta operacional.

No mesmo snapshot, `scheduler-health.json` registrava scheduler ativo, produtor em `backoff`, fila `pending=0`, `inFlight=false`, última falha `budget_exhausted` às 19:39:43 BRT e próximo retry em 21:00:01 BRT. `api-usage.json` registrava 200 chamadas NVIDIA no dia UTC. Esse contador compartilhado não atribui chamadas ao scheduler nem fornece faturamento, saldo de cota externa ou custo por job. A configuração segue 60/dia, slot de 24 min.

Não alterei meta, runtime, processo, fila, quota, credenciais ou publicação. O resultado reforça que 60/dia é somente configuração e não capacidade demonstrada. YAI-021 permanece Parcial: há poucas conclusões, nenhuma atribuição de custo/cota por job e a meta de produto continua sem decisão registrada.
