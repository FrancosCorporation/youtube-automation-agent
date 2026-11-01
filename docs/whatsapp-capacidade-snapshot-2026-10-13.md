# Snapshot de capacidade compartilhada — 13/10/2026

Leitura local e não invasiva às 17h01 (-03, America/Sao_Paulo), vinculada a YAI-041. Nenhum prompt foi enviado ao modelo e nenhum serviço foi parado ou reiniciado.

## Disponibilidade observada

| Verificação | Resultado | Tempo observado |
|---|---|---:|
| `pulso-assistant` — `GET /api/pulso/health` dentro do container | HTTP 200 | 121 ms |
| `llama-cpp` — `GET /health` em `127.0.0.1:8081` | HTTP 200 | 104 ms |
| `llama-cpp` — `GET /v1/models` | HTTP 200; modelo anunciado `Qwen2.5-VL-7B` | 8 ms |

No mesmo snapshot do Docker, `pulso-assistant` estava `Up` havia ~23 h; `llama-cpp`, ~4 h; `fran-trainer`, ~40 h; `qwen35-trainer`, ~39 h; e `whatswave_backend`, ~40 h. Estado `Up` comprova processo/container iniciado, não prontidão do modelo para inferência nem treinamento ativo.

Uma amostra `docker stats --no-stream` mostrou o contêiner `llama-cpp` com 4,719 GiB de memória de 17 GiB disponíveis e 0,00% de CPU naquele instante; `whatswave_backend` com 109,7 MiB de 512 MiB e 0,57% de CPU. Os contêineres trainers apareceram com CPU arredondada para 0,00% e pouco RSS. Uma leitura separada do host observou `llama-server` com ~7,2% de CPU e ~5,44 GB RSS. São amostras instantâneas, coletadas por interfaces com janelas diferentes, e não devem ser somadas nem interpretadas como consumo de GPU.

## Limites e próximo ensaio

- O health da API Pulso verifica o servidor HTTP. Os tempos do health/model-list não medem tokenização, inferência, fala, fila ou interação concorrente com usuários.
- `rocm-smi` e `amd-smi` não estavam disponíveis no `PATH`; não há medida de uso/VRAM da GPU neste snapshot.
- O scheduler e uma geração de vídeo estavam ativos. `llama-cpp`, `fran-trainer` e `qwen35-trainer` também estavam iniciados. Para proteger o atendimento compartilhado, não foi enviada inferência de teste nem carga concorrente.
- Não foram alteradas cotas, prompts, persona, históricos, containers ou unidades de serviço.

O ensaio pendente deve ocorrer em uma janela coordenada: registrar carga/GPU antes, fazer uma chamada curta controlada por cada rota autorizada, observar latência ponta a ponta e verificar que atendimento/mascote preservam sessão e persona distintas. Só então decidir limites de quota ou concorrência. O usuário foi consultado se prefere esperar a janela ociosa ou autoriza uma chamada curta durante a carga atual.

## Rechecagem read-only — 17h10 (-03)

O scheduler (`channel-scheduler.js`) e uma geração de vídeo permaneciam ativos. No Docker, `pulso-assistant`, `llama-cpp`, `fran-trainer`, `qwen35-trainer` e `whatswave_backend` estavam `Up`; uma nova amostra registrou 4,719 GiB usados no container `llama-cpp`, 121,1 MiB no `whatswave_backend`, 44,03 MiB no `pulso-assistant` e CPU arredondada entre 0,00% e 0,65%. Isso não comprova que os trainers estavam executando treino nem substitui telemetria GPU.

A listagem local de processo mostra o alias servido `Qwen2.5-VL-7B` associado ao modelo Fran-Pedra/Qwen3.5-4B v13. Nenhum prompt foi enviado. A medição de inferência e concorrência segue aguardando a escolha de janela do usuário.
