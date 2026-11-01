# Handoff de execução — Pulso / YouTube AI

> **Registro histórico de 20/10, superado para a retomada corrente.** PIDs, geração ativa, renderer e ordem abaixo descrevem aquela captura. Em 24/10, leia [plan.md §3.0](../plan.md) e [workflow-autonomo.md](workflow-autonomo.md): nova rota Remotion integrada em código, E2E factual reprovado, unidade de usuário habilitada mas bloqueada pela migração. Não retomar o job/PID antigo nem delegar a outros agentes por causa deste arquivo. O histórico foi preservado para rastreabilidade; não é fila concorrente.

Atualizado em 20/10/2026, 23:49 BRT. Base: `plan.md`, `resumo.md` e estado de produção observado. Objetivo: outro modelo executar em sequência as pendências viáveis já registradas no plano, sem criar escopo novo.

## Instruções de entrada

1. Trabalhar em `/home/servidor/Git/youtube_ai/youtube-automation-agent`.
2. Ler `AGENTS.md`, `plan.md` §§1–3 e a linha do YAI correspondente em §5; consultar o critério em `docs/criterios-aceite-pulso.md` antes de alterar cada frente. `resumo.md` guarda evidências e histórico; não reabrir investigações já encerradas sem mudança de estado.
3. O checkout já contém muitas modificações locais e arquivos não rastreados. Não usar `git reset`, `git clean`, checkout amplo, nem apagar diretórios como limpeza.
4. Fechar cada critério somente após evidência e teste correspondentes. Bloqueio externo fica registrado, sem simular aceite. Continuar para a próxima frente independente.

## Ordem de execução

### 0. Proteger a produção atual

- Scheduler existente: `ai-video-scheduler.service`, PID observado `772823`; produtor filho `827726`.
- Geração normal em andamento desde 23:45 BRT: tema Dinheiro, pauta iFood/Caju, saída `data/videos/auto_2026-10-21T02-45-43-238Z.mp4`, revisão v27.
- Estado observado às 23:49: gpt-oss retornou `SCRIPT_JSON_INVALID`; GLM-5.3-Flash teve `request_timeout`; Nemotron recebeu correção por `SCRIPT_JSON_INVALID`. São falhas em respostas/tempo dos providers nesta etapa, ainda sem evidência de defeito local. Acompanhar `logs/gen_2026-10-21T02-45-43-238Z.log` e `data/state/scheduler-health.json` até o resultado terminal; se a cadeia esgotar, investigar e corrigir a recuperação com base no log completo.
- Não reiniciar o scheduler, não iniciar outro `npm run scheduler` e não alterar fila/arquivos enquanto houver geração, render, upload ou retry ativo. Ao terminar, atualizar evidência e só recarregar a unidade existente em janela comprovadamente ociosa.

### 1. Provar motion graphics e sincronização no vídeo de produção (YAI-032/033; YAI-063)

- O último vídeo publicado, [`d6NhY5jxm2w`](https://www.youtube.com/watch?v=d6NhY5jxm2w), foi gerado na revisão v26 e teve **zero gráficos**; ele não demonstra o método pedido.
- A implementação de produção está em `scripts/generate-animated-video.js` e `assets/scenes/kit.js`. As estruturas permitidas incluem `node-graph` (etapas narradas) e `metric-compare` (medidas comparáveis, com unidade, sustentadas por fonte). O cue deve corresponder literalmente à fala.
- Critério visual: a informação narrada aparece como elementos construídos/animados no quadro no momento da explicação. Uma linha de progresso, contador de slides, imagem estática ou transição, por si só, não é motion graphic explicativo.
- Não inventar números, rótulos, causalidade ou ranking. Se a pauta atual não tiver comparação/processo comprovado, registrar “sem estrutura factual elegível” e deixar o próximo roteiro elegível demonstrar o gráfico; não forçar um gráfico no vídeo atual.
- No MP4 real, validar manifesto e cues, extrair frames antes/durante/depois de cada visual, conferir render/decodificação e confirmar que o tempo coincide com a narração. Não declarar que está provado só porque o prompt pediu.

### 2. Fechar áudio e karaokê palavra a palavra (YAI-001/013/032/033/054)

- Defeito reproduzido na geração anterior: Edge TTS devolveu 241 eventos para 245 palavras; quatro eventos continham duas palavras e v26 abortou antes do render.
- Correção local v27: expande eventos agrupados por duração proporcional ao número de caracteres, compara tokens com a transcrição, marca `edge-tts-word-boundary-mixed` e mantém timestamps do provedor nos eventos individuais. A expansão recupera 245 tokens em ordem monotônica; os limites dentro dos quatro eventos divididos são estimados, portanto não chamar todo o alinhamento de exato.
- O fallback silencioso de Francisca/Edge TTS para gTTS foi desativado. gTTS só pode ser usado quando explicitamente selecionado ou autorizado em `TTS_ALLOW_PROVIDER_FALLBACK=1`.
- Validar no áudio e MP4 reais: voz/provedor persistidos, sidecar/SRT alinhados, palavras visíveis no instante falado e ausência de deriva perceptível. Registar eventual tolerância e limite medido. Não declarar aceite estético de voz sem audição humana.

### 3. Corrigir o backlog não publicado, continuar produzindo e liberar disco automaticamente (YAI-008/018/019/021/022/045/063)

- Último inventário lido: 224 MP4 / 15.113.954.424 bytes, 205 vinculados e 19 sem vínculo; 30 destinos `unknown`; prévia de limpeza encontrou zero MP4 adicionais seguros para exclusão. Atualizar o inventário depois da geração em curso antes de tomar decisões.
- Muitos vídeos ficaram sem publicação por falhas de fluxo; este é trabalho prioritário, não motivo para reduzir a meta. A configuração acordada registra 60 vídeos/dia (§2 de `plan.md`): trate isso como cadência de produção/publicação, não como teto do backlog. Não impor limite artificial por lote, dia ou número de arquivos; continuar a produção normal e drenar em paralelo todo o backlog publicável, até concluir os itens elegíveis. Se houver quota/erro real da plataforma, manter a fila e retomar automaticamente quando liberar, sem descartar vídeos nem pausar a produção.
- Para cada mídia, conciliar inventário + ledger + manifesto/QA e tratar a causa: `confirmed` em todos os destinos exigidos pelo job → apagar cópia local pelo fluxo/hash; elegível sem tentativa → enviar; `confirmed_no_send`/falha pré-submissão → corrigir a causa e tentar novamente; `unknown` após submissão → verificar o perfil/destino para evitar duplicata e só então reconciliar ou reenviar; QA técnico reprovado → descartar pelo helper seguro e recriar; órfão sem fonte/job/QA → identificar antes de publicar. A autorização é processar e publicar o backlog; a confirmação persistida por destino é o gatilho para apagar o arquivo.
- `unknown`, falha após submissão, órfãos sem vínculo/QA, staging de hash divergente e itens apenas “pré-submetidos” não podem ser reenviados ou apagados em lote. Primeiro reconciliar cada destino por prova pública/conta; sem prova conclusiva, preservar e registrar bloqueio.
- TikTok ainda depende do primeiro uso/termos do titular; X não tem handler ativo. Corrigir o que for possível no código/fila e registrar exatamente quais itens aguardam desbloqueio; não declarar envio a essas redes sem prova. Telegram está excluído por decisão registrada.
- Descarte automático de reprovação técnica foi adicionado em `utils/rejected-generation-cleanup.js`; só remove arquivos do mesmo job com manifesto `failed`, caminho gerenciado e SHA-256 idêntico. Os testes focados passaram 4/4; falta a unidade ativa carregar essa mudança por reload seguro.

### 4. Continuar o restante viável do catálogo YAI

Use a tabela §5 de `plan.md`; não duplicar o catálogo neste handoff. Priorizar trabalho independente e comprovação local dos itens PARCIAL/VALIDAR. Frentes com dependência externa já comprovada:

- **Conta/permissão:** YAI-019/022/045 (TikTok/X sem primeiro uso/handler; mapa tema→conta), YAI-023 (API Analytics desativada; token sem `cloud-platform`/`serviceusage.services.enable`; `gcloud` ausente), YAI-044 (destinatário real de alerta).
- **Aceite/dispositivo real:** YAI-013 (microfone físico), YAI-033 (audição/aceite da demo), YAI-035 e YAI-038 (hardware/acessibilidade), YAI-053–056 (release SiteCorp/aparelhos/aceite estético).
- **Infra/coordenação:** YAI-017/018 (destino cifrado de backup), YAI-041/059 (treino/uso compartilhado de GPU; Music AI), YAI-047 (decisão de agenda de recap).

Esses bloqueios não impedem concluir código, testes, runbooks e preparação que o próprio critério permitir. Não marcar o critério inteiro como concluído enquanto faltar evidência externa.

## Erros observados: classificação

- **Defeito de código confirmado:** eventos Edge TTS com várias palavras não eram particionados. Corrigido em v27; a prova final é o áudio/vídeo novo e os testes de regressão.
- **Erro de resposta do provedor:** `SCRIPT_JSON_INVALID` significa que o modelo retornou JSON inválido; registrar modelo/fallback e verificar se o fallback concluiu. Só classificar como bug do parser/validação se a resposta válida for rejeitada ou a recuperação falhar por lógica local.
- **Indisponibilidade externa:** HTTP 503/404 de revisores/provedores são falhas externas quando a resposta veio do serviço. Verificar o fallback e preservar o corpo/status sanitizados; não confundir com aprovação factual ou defeito de código.
- **Qualquer erro novo:** ligar log, etapa, ativo/job e causa reproduzível; escrever teste de regressão para causa local antes de fechar.

## Validação e atualização de continuidade

- Alteração de código: testes focados da frente, lint/sintaxe e `git diff --check`; suíte completa quando não houver render/writer ativo.
- Produção: acompanhar log/health, revisar roteiro e fonte, testar render/manifesto, inspecionar frames e áudio; confirmar publicação pelo destino e hash antes da limpeza.
- Atualizar a linha YAI afetada em `plan.md` e acrescentar uma nota curta em `resumo.md` com resultado, teste/evidência, bloqueio e próxima frente. Não reescrever o histórico nem inflar contagens.
- Baseline já validado nesta retomada: 58/58 testes focados, ESLint direcionado, sintaxe JS/Python, `bash -n` e `git diff --check` passaram; caso real de timing expandiu 241 eventos em 245 palavras monotônicas. Repetir a validação relevante após novas alterações.
