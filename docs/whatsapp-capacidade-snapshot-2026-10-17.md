# Capacidade compartilhada Pulso/WhatsApp — snapshot passivo 17/10/2026

**Coleta:** 13:18 BRT (16:18 UTC). Leitura pontual de sistema, containers e endpoints locais de health/models; nenhuma inferência, mensagem WhatsApp, alteração de quota ou restart.

## Observações

- Host ligado há 2 dias e 4h32. Load average em `13:18:06`: **24,61 / 29,74 / 33,96**. Durante `vmstat` (amostras de 5 s após a média inicial), fila `r` ficou em **22, 27 e 23**, CPU idle em **43%, 40% e 40%**, sem swap-out nas três amostras; leituras de swap-in foram **80, 22 e 62 KiB/s**. Houve pressão de memória no sistema: **11 GiB disponíveis** de 30 GiB, com **20 GiB de swap usados**.
- GPU Radeon AMD lida pelo sysfs: **3% busy** no instante da leitura, VRAM **8.563.404.800 / 12.868.124.672 bytes** (aprox. 8,56/12,87 GiB; 66,5%). `rocm-smi` e `amd-smi` não estão instalados.
- `whatswave_backend`: container `Up 21 hours`, snapshot Docker **0,56% CPU / 120 MiB de 512 MiB**. `whatswave_frontend`, MongoDB e Redis também estavam `Up`; a leitura é um instante, não taxa de mensagens nem teste funcional.
- `llama-cpp`: container `Up 21 hours`, **3,316 GiB / 17 GiB** e 0,00% CPU no instante de `docker stats --no-stream`; o processo host `llama-server` também estava vivo. `GET http://127.0.0.1:8081/health` retornou `200 {"status":"ok"}`; `GET /v1/models` retornou `200` para **`Fran-Pedra-v13-4B`**, 4.326.350.848 parâmetros, quantização **Q4_K_M**. A porta publicada é `127.0.0.1:8081 → container:8080`.
- `pulso-assistant`: container `Up 2 days`, ~2,95 MiB de 1,465 GiB e 0,00% CPU na amostra; porta interna 3117 não está publicada no host. A saúde do llama server não prova o fluxo do assistant nem o encaminhamento de persona/histórico.
- O teste de screenshot imediatamente anterior havia falhado sob carga; nessa amostra, um processo `chrome-headless` consumia 780% CPU. A leitura anterior, às 13:15, encontrou Chrome GPU a 1.068% e outro Chromium a 715%. Não encerrei esses processos nem alterei o scheduler.

## Correção de roteamento e limite

O host `127.0.0.1:8080` não é o llama server: corresponde ao container `searxng_base`; `127.0.0.1:8000` é `graphiti-mcp`. Requests GET de health/modelos nesses dois endereços retornaram páginas/not-found e não executaram inferência. O endereço correto do modelo neste snapshot é a porta publicada **8081**.

Esta coleta comprova disponibilidade do processo/modelo e registra carga observada, mas não mediu TTFT, throughput, latência concorrente, prioridade real de requisições, uso de VRAM durante geração ou impacto no atendimento WhatsApp. Como a fila de execução estava alta e o backend é compartilhado, não emiti prompt de teste. **YAI-041 permanece com validação pendente** até haver uma janela coordenada que compare latência/concorrência sem competir com atendimento ativo.

## Rechecagem passiva — 13:58 BRT

Em nova leitura sem inferência nem mensagem, `GET /health` e `GET /v1/models` na porta local 8081 retornaram HTTP 200; o health declarou `ok` e a lista tinha um modelo. O host estava ligado havia 2 dias e 5h12, com load average **36,66 / 31,04 / 25,71**. Nas três amostras correntes do `vmstat`, a fila `r` ficou em **36–38**, CPU user em **83–84%**, idle em **10–11%**, swap-in em **100–160 KiB/s** e sem swap-out; havia **11 GiB disponíveis** e **20 GiB de swap usado**. Docker: `whatswave_backend` 0,45%/128,5 MiB de 512 MiB; `llama-cpp` 0%/3,322 GiB de 17 GiB; `pulso-assistant` 0%/2,812 MiB; MongoDB WhatsWave 101,50%/284 MiB de 512 MiB; Redis 0,65%/6,02 MiB; frontend 0%/6,262 MiB.

A combinação de fila de execução 36–38, idle 10–11% e MongoDB acima de um núcleo torna esta uma janela inadequada para ensaio concorrente de inferência/latência. Nenhum container, atendimento, scheduler, quota ou modelo foi alterado; não atribuo a carga a um processo específico. YAI-041 segue pendente de janela coordenada e medição de TTFT/concorrência real.

## Ensaio unitário de latência — 15:55–15:57 BRT (janela de baixa carga)

A carga observada às 15:54–15:55 BRT caiu para load average **4,30–4,58 / 6,27 / 6,49**, com `whatswave_backend` em 0,62% CPU/82,2 MiB, MongoDB 0,50%/115,9 MiB, `llama-cpp` 0,00%/1,419 GiB, `pulso-assistant` 0,00%/15,1 MiB e nenhum atendimento evidenciado. Nessa janela ociosa foi executado um ensaio unitário mínimo de latência no endpoint correto `127.0.0.1:8081` (publicação 8081→8080 do container): três inferências triviais de teste (“o que é uma API?”/“Diga apenas: ok”, sem persona, sem histórico de clientes, sem mensagens WhatsApp), com `stream:true` e limites de 16–400 tokens. Nenhum container foi reiniciado, nenhuma quota alterada, nenhum atendimento tocado.

**Medições (amostras unitárias, janela ociosa):**

- TTFT (primeiro chunk do stream): **0,097 s, 0,200 s e 0,234 s** nas três execuções.
- Métricas nativas do servidor no chunk final (`finish_reason: stop`): prompt de 4 tokens processado em **103,9 ms** (~38,5 tokens/s de prompt com overhead fixo dominando a amostra mínima; `cache_n: 11` mostra prefixo cacheado), **146 tokens gerados em 1.382,5 ms = 104,9 tokens/s** de geração, e speculative decoding ativo com **69/76 drafts aceitos (90,8%)**.
- Observação de comportamento: o modelo emite `delta.reasoning_content` antes do conteúdo visível e, com limites curtos (80/400), as execuções de amostra encerraram em `stop` após o raciocínio sem produzir `delta.content` na janela observada; throughput/TTFT permanecem válidos como medida de capacidade do servidor.

**Limites desta amostra:** medição unitária em janela ociosa; não mede concorrência real com atendimento ativo, prioridade de filas do WhatsWave, comportamento sob carga do MongoDB, uso de VRAM durante geração em cadeia longa, nem latência percebida pelos clientes. Não foi fabricada carga artificial no atendimento. O ensaio concorrente/prioridade sob carga real permanece pendente de janela coordenada com o titular (consulta registrada em 13/10 sem resposta); a decisão de quotas do mascote continua exigindo essas evidências. YAI-041 avança de “validação pendente” para **Parcial**: disponibilidade + TTFT + throughput unitários medidos e datados; concorrência/prioridade reais seguem sem medição.
