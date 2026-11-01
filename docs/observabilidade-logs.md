# Observabilidade de geração e publicação

## Correlação

Cada execução iniciada pelo `channel-scheduler` recebe um `jobId` UUID. O scheduler o encaminha ao gerador por `VIDEO_JOB_ID`. O gerador grava esse ID e um `videoId` no ledger `data/state/topics.json`; o mesmo par é incluído na fila persistida `data/state/publish-queue.json`. O `videoId` é `vid_` mais 24 caracteres hexadecimais do SHA-256 do caminho absoluto de saída: permanece estável para o mesmo caminho e não revela o nome do arquivo. Artefatos derivados recebem um `artifactId` igualmente opaco nos eventos de envio.

Execuções iniciadas diretamente pelo gerador criam seu próprio `jobId`. Registros antigos do ledger sem os IDs continuam legíveis; o scheduler calcula o `videoId` pelo caminho e os identifica como `legacy_<videoId>`. Esse fallback permite agrupar eventos novos de publicação, mas não reconstrói a execução antiga.

## Eventos estruturados

Os arquivos Winston usam JSON e os componentes `PipelineObserve` e `VideoPipeline`. Geração registra início e término, renderização e capa registram duração, e a publicação registra estado agregado e tentativas por destino (`youtube`, `kwai`, entre outros), separando master de corte. As tentativas de envio são medidas entre a intenção persistida e o resultado persistido. Erros estruturados guardam somente classe/código, sem mensagem, stack, caminho de mídia, título, prompt, roteiro, legenda, áudio ou resultado bruto do adapter.

O logger redige campos cujo nome indica credencial, sessão, conta, usuário, prompt, texto, roteiro, legenda, áudio ou corpo de requisição. Também filtra padrões comuns de bearer token, chaves de API, JWT, webhooks e parâmetros secretos de URL. Estados de publicação fora do vocabulário conhecido viram `unknown`; texto de erro do uploader não é copiado para o evento.

Os alertas enviados por webhook/Telegram passam título e detalhe pelo mesmo sanitizador inline antes do envio, incluindo erros de upload. O texto é limitado ao teto definido pelo sanitizador; testes usam um transporte injetado e não contatam destinatários.

## Retenção

O Winston rotaciona os arquivos por tamanho: `combined.log` em 5 MiB com até 5 arquivos; `error.log` em 5 MiB com até 3; e cada log de componente em 2 MiB com até 3. `Logger` permite injetar limites alternativos em testes, sem alterar a política de produção. O teste de rotação escreve em diretório temporário e confirma que o número de arquivos combinados fica dentro do limite.

Os arquivos de diagnóstico `logs/gen_*.log` continuam separados dos JSON Winston. O scheduler filtra esses fluxos linha a linha para remover segredos embutidos, redigir valores rotulados como texto/prompt e descartar linhas acima de 8 KiB; os avisos do crítico também não registram o feedback textual. Os temas e títulos editoriais que aparecem nos logs existentes são metadados de pauta pública, não IDs de correlação.

## Retomada da produção após reboot

Na máquina de produção, `ai-video-scheduler.service` é uma unidade `systemd --user` enabled; sua definição canônica fica em `deploy/systemd/ai-video-scheduler.service` e o override do Blender em `deploy/systemd/ai-video-scheduler.service.d/10-blender.conf`. `loginctl linger servidor` permite iniciá-la no boot sem login interativo; `Restart=always` e `RestartSec=30s` reiniciam o scheduler se o processo sair. A unidade `ai-video-scheduler-guard.timer` também verifica aproximadamente a cada dois minutos (tolerância de 15 s) e inicia o scheduler se uma parada explícita ou outra condição o deixar inativo. Para reinstalar as definições sem encerrar um scheduler ativo:

```bash
install -D -m 0644 deploy/systemd/ai-video-scheduler.service "$HOME/.config/systemd/user/ai-video-scheduler.service"
install -D -m 0644 deploy/systemd/ai-video-scheduler.service.d/10-blender.conf "$HOME/.config/systemd/user/ai-video-scheduler.service.d/10-blender.conf"
install -D -m 0644 deploy/systemd/ai-video-scheduler-guard.service "$HOME/.config/systemd/user/ai-video-scheduler-guard.service"
install -D -m 0644 deploy/systemd/ai-video-scheduler-guard.timer "$HOME/.config/systemd/user/ai-video-scheduler-guard.timer"
systemctl --user daemon-reload
systemctl --user enable --now ai-video-scheduler.service ai-video-scheduler-guard.timer
```

Não é necessário reiniciar o serviço se a unidade já está ativa. Verifique com `systemctl --user status ai-video-scheduler.service` a partir da sessão do usuário, ou defina `XDG_RUNTIME_DIR=/run/user/1000` e `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus` quando operar de outra sessão. Docker também está enabled no systemd do host.

Em manutenção que exija pausar o producer, pare primeiro o timer guard e depois o serviço; ao finalizar, inicie o serviço e reative o timer:

```bash
systemctl --user stop ai-video-scheduler-guard.timer ai-video-scheduler.service
# executar a manutenção
systemctl --user start ai-video-scheduler.service ai-video-scheduler-guard.timer
```

Apenas parar `ai-video-scheduler.service` não mantém a pausa: o guard solicitará seu retorno em aproximadamente dois minutos (com tolerância de 15 s). A versão corrente permanece enabled/active entre slots.

O producer de vídeo é um processo Node no host, não um container Docker. O container Redroid `kwai-emulator` atende somente aos uploads Android; não executa a geração. Docker inicia no boot, e a unidade de usuário `kwai-emulator-boot.service` espera o daemon ficar pronto, executa `kwai-emulator.js up` e valida Android/ADB. O Compose usa `restart: unless-stopped` para recuperar o container em reinício/crash do Docker; o uploader ainda pode removê-lo após o uso para devolver RAM. Após reboot, não inicie um segundo producer manualmente. O scheduler restaura `data/state/publish-queue.json` e, se `data/state/generation-in-flight.json` existir, refaz a tentativa interrompida no mesmo tema em um caminho novo. O arquivo parcial é preservado e o marcador só é removido depois de a nova saída estar na fila persistida. Se o marcador estiver corrompido, o scheduler o preserva como `.invalid.*` e segue o rodízio normal; não apague esses estados durante a recuperação.

Um comando `shutdown`/`poweroff` normal para processos corretamente; `systemd` volta a subir o serviço quando a máquina ligar novamente, mas não consegue ligar hardware que permaneça desligado. Auto power-on requer configuração de firmware/energia ou Wake-on-LAN.

## Limites de validação

Os testes usam somente arquivos temporários e resultados sintéticos. O gerador PID 71198 e o scheduler PID 69491 já estavam ativos e foram preservados; nenhum serviço foi reiniciado. O scheduler carregado em memória ainda não passa IDs nem emite os novos eventos por destino. Geradores filhos iniciados depois da atualização podem gravar os próprios IDs no ledger, mas a confirmação completa da correlação operacional depende de uma futura inicialização autorizada do scheduler. Entradas antigas e eventos anteriores não recebem IDs retrospectivos.

## Snapshot operacional — 15/10/2026

O trecho de limites acima descreve a sessão histórica em que foi escrito. Na operação observada em 15/10, `ai-video-scheduler.service` iniciou às 08:45:59 sem login interativo, com `Restart=always`, `RestartSec=30s` e `linger=yes`; o gerador registrou `jobId` UUID e eventos correlacionados. O job legado terminou às 14:47 BRT após 141,5 min. As quatro partes narrativas ficaram em 146,967 s, 137,933 s, 164,167 s e 90,033 s, todas H.264/AAC, 1080×1920/30 fps e abaixo de 179 s. A captura usou Radeon; o `check` legado usou SwiftShader, motivo para remover `--no-browser-gpu` das próximas checagens.

A pauta permaneceu sem contexto-fonte verificável, então o gate bloqueou a publicação. A fila estava `pending=[]`, `inFlight=null`; o marcador manual foi removido somente após confirmar esse estado terminal. O scheduler foi parado quando não havia nenhum filho ativo para rodar CI completa e lint; voltou às 14:56 BRT (PID 969074, `NRestarts=0`), já com IMP-75/76. A primeira pauta pós-restart não tinha candidatas dentro do limite padrão de 36 h. Uma leitura sem dedupe por histórico viu candidatas recentes em cinco dos dez temas; o scheduler tenta novamente após a rotação de tema.

`generate-animated-video.js` agora classifica essa situação como `no_fresh_topic_candidates` e registra somente contagens de candidatas/idade, sem título ou URL no erro. Isso diferencia falta de novidade de timeout externo genérico. Não relaxe `MAX_TOPIC_AGE_HOURS` nem remova os gates de evidência para mascarar indisponibilidade de pauta. O produtor principal é Node no host. Redroid/Kwai segue sob demanda para upload; Docker host inicia no boot. Um host fisicamente desligado depende de firmware, energia ou Wake-on-LAN.

**Verificação adicional — 15/10/2026, 15:05 BRT:** o serviço continuou ativo após a tentativa de 1,7 s sem pauta e refez a pesquisa cinco minutos depois, sem reinicializar o scheduler. A tentativa seguinte encontrou contexto recente, gravou checkpoint `0600` e iniciou o roteiro; no snapshot, o primeiro modelo Nemotron tinha respondido HTTP 503 em duas chamadas e o primeiro pedido no segundo modelo atingiu timeout. Assim, o caminho de retry está funcionando; indisponibilidade do provider não equivale à interrupção anterior por `poweroff`. Nenhuma publicação foi iniciada e o serviço foi deixado ativo para continuar tentando. A recuperação de boot é feita pela unidade systemd enabled com linger, não por container: Redroid/Kwai não executa o producer e sobe só no upload.

**Autorrecuperação confirmada — 15/10/2026, 15:40 BRT:** a primeira causa de interrupção foi o poweroff normal do host na noite de 14/10; o serviço iniciou sozinho no boot às 08:45:59 de 15/10. A lacuna de 14:47 veio de uma parada para manutenção/CI, que esta sessão de manutenção executou; uma parada explícita não aciona `Restart=always`. Para reduzir esse risco, `ai-video-scheduler-guard.timer` e `ai-video-scheduler-guard.service` foram instalados e habilitados. O timer verifica a cada aproximadamente dois minutos (tolerância de 15 s), e o guard inicia a unidade somente quando inativa. O oneshot executou pelo timer às 15:40:39 com sucesso, preservando os PIDs do scheduler e do gerador. O código do producer está em `scripts/ensure-ai-video-scheduler.sh`; o teste unitário simula serviço ativo/parado. A manutenção planejada deve parar guard e producer juntos e reativá-los ao concluir.

A geração segue no processo Node do host; não existe container de render. Docker está enabled/active e o Redroid/Kwai continua `restart: no` propositalmente. O uploader o cria sob demanda com Compose; ele não precisa estar ligado durante boot ou render para que a produção continue. Checkpoint de geração permite refazer o tema atual em uma saída nova após boot, sem prometer retomar o frame exato. O reboot não foi repetido com render ativo; a inicialização automática do producer já foi observada em boot real.

O último estado do emulador Kwai foi `Exited (137)`, mas `OOMKilled=false`, `RestartCount=0`; terminou às 22:04 BRT, antes do poweroff às 22:49. O código não permite atribuir a causa específica do exit code apenas por esse estado. Em cada upload, `scripts/kwai-emulator.js` usa `docker compose up -d` se o container está parado, espera `sys.boot_completed=1` e depois o remove para liberar RAM. Por isso `restart: no` é compatível com a retomada após boot e não afeta o produtor.

No startup, `channel-scheduler` agora registra `webhook` e `Telegram` como `configured`, `incomplete` ou `missing`. A linha não contém URL, token nem chat ID e não tenta enviar uma mensagem; configurações ausentes permanecem explícitas no log operacional.

## Continuidade após reboot e parada explícita — 15/10/2026, 15:14 BRT

O boot observado iniciou `ai-video-scheduler.service` às 08:45:59 sem login; verificação atual: `enabled/active`, `Restart=always`, `RestartSec=30s`, `NRestarts=0` e `loginctl linger servidor=yes`. O daemon Docker também está `enabled/active`. A parada às 14:47:30 foi normal durante manutenção/CI, depois do job anterior terminar; a unidade foi iniciada às 14:56:34. `Restart=always` recupera saídas inesperadas, mas não substitui uma solicitação explícita de `systemctl stop`. Para operação contínua, deixar o scheduler ativo entre slots e evitar pausar a unidade para QA concorrente.

Às 15:14 havia um filho gerador Node ativo e checkpoint `0600`; a fila persistida estava vazia, aguardando saída pronta. O producer encontrou pauta e avançou pelo roteiro e produção de áudio/imagens. Indisponibilidades de provider acionaram fallbacks e a revisão factual indisponível manteve o bloqueio de publicação. A tentativa atual não foi interrompida para teste de reboot.

Não existe container de geração neste projeto. O container Redroid `kwai-emulator` usa `restart: no` e liga sob demanda exclusivamente durante upload pelo Android; não precisa subir para renderizar. A retomada após reboot é responsabilidade do serviço de usuário com linger, já comprovada no boot real. O checkpoint repete a tentativa do mesmo tema em saída nova; ele não retoma o render do frame exato.

A unidade e o override do Blender foram sincronizados do repositório após `systemd-analyze verify` (exit 0; aviso preexistente restrito a `/etc/systemd/system/anydesk.service`). Depois de `systemctl --user daemon-reload`, os PIDs do scheduler (969074) e do gerador (989383) permaneceram iguais; a unidade continua `enabled/active`, com `Restart=always` e `NRestarts=0`.

Às 15:21 BRT, o render seguia pela captura `hyperframes-render-gpu`, em 41% (2.276/7.646 frames). Isso confirma que a geração seguiu após recarregar a configuração systemd; não foi feito reboot com o render em andamento.

O teste focal dos adaptadores Android/Kwai passou 13/13, cobrindo reconnect depois do startup de host/container e um reinício se o Android continuar sem boot completo. A suíte usa fakes e não inicializou o Redroid real; a geração de vídeo não depende desse emulador.

Na composição ativa revisada às 15:28 BRT, timeline e narração medem 318,552 s; as 30 cenas duram de 9,108 s a 12,662 s, sem cenas abaixo de 9 s. O robô mantém `full/right` nos 30 planos. A captura GPU estava em 72%; o MP4 e a inspeção quadro a quadro ainda aguardam fim do processo.

Às 15:31 BRT, o master fechou pela GPU e `ffprobe` confirmou H.264, 1920×1080/24 fps, AAC estéreo/48 kHz e 318,583 s. O filho continuou para os cortes verticais, sem reinício do scheduler. A revisão factual indisponível mantém qualquer publicação bloqueada.

O primeiro vertical (`corte1.mp4`) terminou com 15,533 s, H.264 1080×1920/30 fps e AAC/48 kHz; o render preparou uma única cena. O quadro médio inspecionado mostra mascote e texto sem colisão aparente. A detecção HyperFrames identificou Radeon RX 6750 XT como GPU de hardware; os demais cortes ainda estavam em andamento.


## Diagnóstico atualizado da continuidade — 15/10/2026, 16:02 BRT

A interrupção noturna foi causada por poweroff normal do host em 14/10 (journal às 22:49), não por crash do scheduler. O boot real seguinte iniciou o serviço de usuário às 08:45:59 sem login. A lacuna de 14:47:30 foi uma parada explícita de manutenção/CI desta sessão, resolvida às 14:56:34; `Restart=always` não reinicia uma unidade que recebeu `stop`. O guard instalado em IMP-82 trata uma parada acidental: em 15/10 às 16:02:09 o timer executou novamente com sucesso e deixou o scheduler PID 969074, `NRestarts=0`, inalterado. Serviço e timer continuam enabled/active; `linger=yes`; Docker enabled/active.

Às 16:00:26, o job Economize falhou antes do render: `no_fresh_topic_candidates`, 18 candidatas e zero dentro do limite de 36 h. O scheduler segue ativo, aguardando o retry de cinco minutos. No job Saúde anterior, o processo iniciado antes do bump integrado chegou ao HyperFrames 0.8.155 e o checker marcou `text_occluded` entre `.category` e `#three-layer`; a fixture reduzida passou tanto em 0.8.155 quanto 0.8.162 e não reproduziu o finding. A próxima execução elegível precisa validar a composição completa no pin atual 0.8.162. Não afirmar que a atualização resolveu a oclusão sem essa evidência.

Os masters recentes foram gerados, mas o gate factual bloqueou a publicação por falta de contexto-fonte verificável. Essa é uma barreira de envio, separada da parada do host e das tentativas sem pauta recente. Não relaxar os gates editoriais para mascarar indisponibilidade de fontes.

O produtor não é um container: é Node no host, iniciado pelo serviço systemd persistente. O único container do projeto é o Redroid Kwai para uploads, `restart: no`, iniciado via Compose quando o uploader precisa e encerrado ao final. Não o manter ativo não afeta renders; um host que fique fisicamente sem energia depende de firmware/energia/Wake-on-LAN para voltar a ligar.


**Continuidade às 16:06 BRT:** o retry seguinte iniciou às 16:05:29 no tema Psicologia. O scheduler (PID 969074) e o gerador Node (PID 1249546) estão ativos; o checkpoint está em modo 0600. O hunter encontrou uma pauta com 13 h e 3.892 caracteres de contexto de um veículo; o roteiro está sendo gerado novamente após descartar cache incompatível. Ainda não chegou ao HyperFrames: a versão integrada 0.8.162 e o render GPU não foram exercitados por esse job. Nenhuma publicação ocorreu.


## Rechecagem dos serviços compartilhados — 15/10/2026, 16:04–16:08 BRT

Docker confirmou `llama-cpp` e `whatswave_backend` encerrados normalmente (código 0, sem OOM), com `hasBeenManuallyStopped=true`; não foi possível atribuir a solicitação. Ambos tinham sido iniciados minutos antes. Não toquei neles nem nos trainers; `pulso-assistant`, `fran-trainer` e `qwen35-trainer` seguem ativos. YAI-041 continua sem prova de inferência/latência concorrente, então não alterei quotas nem reiniciei recursos compartilhados.

A produção Pulso é independente: scheduler PID 969074, `NRestarts=0`; gerador PID 1249546 ativo desde 16:05:29, checkpoint 0600. Em 16:08 avançou à etapa HyperFrames e `gpu_busy_percent` foi 8% em uma amostra. O `check` e o uso real do renderer 0.8.162 ainda não concluíram. A geração segue mesmo com indisponibilidade de SEO/edge-tts/Gemini, usando fallbacks; a pauta tinha só um veículo e o crítico estava indisponível, por isso publicação permanece bloqueada.


**Render GPU e check real — 15/10/2026, 16:10 BRT:** o gerador de Psicologia passou pela composição integrada com HyperFrames 0.8.162: 44 cenas, 1920×1080/24 fps, duração de 476,640 s. `check`: lint/runtime/motion com zero erros e avisos, layout sem findings em nove amostras, contraste WCAG AA 60/60. O probe reconheceu a AMD Radeon RX 6750 XT. A captura/encode começou em qualidade `high`, 11.440 frames, com `--gpu --browser-gpu` e modo hardware; o log amostrou GPU 99%. O MP4 ainda está em temporários RAM: duração/codec final e inspeção visual pendem. Nenhuma carga de teste adicional foi iniciada. Crítico indisponível mantém o envio bloqueado.

**Pacing estrutural do mesmo job:** 44 cenas ao longo de 476,640 s; duração mínima 9,107 s, mediana 10,293 s e máxima 22,883 s; nenhuma abaixo de 9 s. O mascote está `right/full`, sem cenas ocultas, em todas as 44 cenas. Métricas vieram do plano temporário, sem emitir texto do roteiro; inspeção visual do MP4 final ainda pendente.


## Verificação pós-boot e proteção contra parada — 15/10/2026, 16:13 BRT

O estado observado no manager do usuário foi `ai-video-scheduler.service=enabled/active/running`, PID 969074, `NRestarts=0`, `ExecMainStatus=0`; `ai-video-scheduler-guard.timer=enabled/active`; `loginctl show-user servidor` confirmou `Linger=yes`. O script de guarda foi executado enquanto o serviço estava saudável e não alterou seu PID. As três unidades e o override instalados coincidem byte a byte com os arquivos versionados. O journal do boot real às 08:45:59 confirma partida sem login depois do poweroff normal de 14/10 às 22:49. `Restart=always` reinicia saídas inesperadas; o timer de cerca de dois minutos recupera também uma parada explícita acidental.

A geração continua sendo Node no host sob systemd, sem container de render. Docker enabled/active não muda isso; o Redroid Kwai é iniciado somente pelo uploader. O checkpoint permite refazer a tentativa interrompida em um caminho de saída novo, sem recuperação do frame exato. Às 16:13:20, o job real de Psicologia seguia em render GPU pela AMD Radeon RX 6750 XT, HyperFrames 0.8.162, em 2.006/11.440 frames (35%). Nenhum reboot, parada ou reinício de container foi necessário para validar. Testes de guard/checkpoint passaram 4/4; `bash -n` e `git diff --check` passaram.


## Render master real pela GPU — 15/10/2026, 16:27 BRT

O job de Psicologia concluiu o master integrado com HyperFrames 0.8.162, 11.440 quadros e encoder hardware VAAPI na AMD Radeon RX 6750 XT. `ffprobe` confirmou H.264 1920×1080/24 fps, AAC estéreo/48 kHz, 476,667 s e 168.344.670 bytes. A captura/encode levou 17m18s; o log registrou um probe `BeginFrame` não executado e avisou que a captura por screenshot pode ser mais lenta, mas marcou o artefato validado e o render terminou 100%.

A timeline registra 44 cenas de 9,107 a 22,883 s (mediana 10,293 s), nenhuma abaixo de 9 s; o mascote está `right/full` e visível em todas as 44. O produtor iniciou a etapa seguinte de cortes verticais 9:16 e executa o check integrado em 0.8.162; a Radeon foi reconhecida. Ainda faltam validar os arquivos sociais com `ffprobe` e revisar visualmente amostras do master. A publicação continua sujeita aos gates editoriais existentes.


**Amostra do corte curto 1/3:** `ffprobe` confirmou 14,733 s, H.264/AAC 48 kHz, 1080×1920/30 fps. Quadros em 0/5/10 s exibiram enquadramento constante do mascote e legenda legível, com poses da boca variadas; não foi observada troca rápida de cena nesses pontos. O código o roteia a Shorts/Kwai/X; Instagram/TikTok recebem partes narrativas próprias. É uma amostra, não inspeção quadro a quadro.


## Falhas do scheduler e correção do cabeçalho — 15/10/2026, 17:11 BRT

O serviço do usuário continuou ativo (PID 969074, `NRestarts=0`); portanto, os ciclos sem saída entre 16:47 e 17:06 foram falhas de jobs individuais. O checker HyperFrames 0.8.162 encontrou `.category` sob `#three-layer`: `#scene-root` criava um stacking context que bloqueava o cabeçalho acima do canvas 3D. Com o root sem esse stacking context e somente `.demo-header` na camada 6, o caso reconstruído com pauta e áudio reais, seed original, 56 cenas e duração de 603,504 s passou: zero findings em 9 amostras, 61/61 contrastes AA e nenhum erro de lint/runtime/motion. Os jobs anteriores parados em `no_fresh_topic_candidates` são outro caso: 30 pautas, zero dentro de 36 h; o processo agenda novo retry.

O autostart correto é a unidade de usuário `ai-video-scheduler.service`, enabled em `default.target`, com `linger=yes`; boot real às 08:45:59 confirmou início sem login. `Restart=always` cobre crash; `ai-video-scheduler-guard.timer` recupera `stop` explícito acidental em aproximadamente 2 min. Não existe container de render neste projeto. Redroid Kwai é apenas upload e on-demand. O checkpoint refaz tentativa em novo arquivo, sem retomar frame. A saída gerada que permanece em revisão factual continua retida; não foi publicada.

Testes focados: **28/28** passaram; sintaxe, ESLint e diff-check passaram. Às 17:11, o scheduler iniciou nova pauta financeira, 6.877 caracteres e quatro fontes independentes. Às 17:15, o check real da nova composição concluiu sem findings (30 cenas/318,552 s; 9 amostras; 52/52 AA; zero lint/runtime/motion). O render `high` começou pela Radeon RX 6750 XT/browser-GPU, 7.646 quadros/24 fps; falta a saída final e o `ffprobe`. A publicação continua no hold factual.

A timeline já construída tem duração de cenas entre 9,037 e 15,712 s (mediana 10,375), sem cortes menores que 9 s. O `presenterShot` é `right/full` e o robô fica visível em 30/30 cenas.

O master finalizou às 17:27 por hardware Radeon RX 6750 XT/VAAPI; tempo HyperFrames 12m15s. `ffprobe`: H.264 1920×1080/24 fps, AAC estéreo/48 kHz, 318,583 s, 117.363.419 bytes. Thumbnail pronta e etapa nativa vertical 9:16 ativa. A revisão factual permaneceu unavailable; não houve publicação.

O vídeo gerou três cortes curtos verticais destinados a Shorts/Kwai/X (14,6 s, 10,7 s e 12,2 s) e duas partes narrativas exclusivas de Instagram/TikTok. Parte 1/2: 13 cenas, check sem findings em 9 amostras, 64/64 WCAG AA; render pela GPU em H.264 1080×1920/30 fps + AAC 48 kHz, 140,867 s e 47.076.891 bytes. A duração passa de 1 min e fica abaixo de 2m59. A Parte 2 ainda está em andamento, sem `RangeError`.

## Continuação IMP-89 — 15/10/2026, 17:51 BRT

O checker da Parte 2/2 (177,696 s) barrou sobreposição de legenda com a categoria e com a porcentagem da barra em uma cena; o log localiza o achado entre 163,16 e 166,423 s. A alteração marca narrativas estáticas que possuem `progress-bar` e posiciona apenas essa legenda abaixo do canvas do robô. O guard `ai-video-scheduler-guard.timer` continua enabled/active, e seu script agora limpa `failed` antes de chamar `start` para contornar o rate limit do systemd.

O teste focal passou **29/29**; ESLint, `bash -n` e `git diff --check` passaram. O renderer automático seguinte avançou no host pela Radeon RX 6750 XT. Sua timeline tem 39 cenas de 9,214 a 13,871 s, nenhuma menor que 9 s, e o mascote visível à direita em 39/39. O reparo manual da Parte 2 aguardará a GPU ficar livre, depois terá novo checker, render e `ffprobe`; o gate factual segue bloqueando publicação.

## Fechamento IMP-89 — 15/10/2026, 18:33 BRT

A Parte 2 financeira foi reconstituída com os arquivos TTS e timings originais, validada no HyperFrames 0.8.162 (16 cenas; 0 achados em 9 amostras; 52/52 AA; zero lint/runtime/motion errors) e renderizada pela Radeon RX 6750 XT em 8m20s. `ffprobe`: H.264 1080×1920/30 fps, AAC estéreo 48 kHz, 177,700 s e 59.658.389 bytes. O frame de 164 s mostra o selo PARTE 2/2, a categoria e a barra de 87% no topo, robô ao centro e legenda legível abaixo; a sobreposição anterior desapareceu sem afrouxar o gate.

A Parte 2/2 entrou no ledger, roteada somente a Instagram/TikTok. `publicationEligible=false`, `publicationHold=publication_review_unverified` e inelegibilidade para retries de publicação foram preservados. Nada foi enviado.

O job automático que começou às 17:41 BRT também concluiu: master H.264 1920×1080/24 fps + AAC, 422,917 s; três cortes curtos de 19,767/15,700/14,800 s; três partes narrativas de 139,567/126,700/156,667 s, todas 1080×1920/30 fps, acima de 60 s e abaixo de 179 s. A timeline tem 39 cenas de 9,214–13,871 s, sem trocas abaixo de 9 s; mascote à direita em 39/39. O contexto-fonte insuficiente manteve o upload bloqueado.

Atualização operacional — verificação às 18:36:04 BRT: `ai-video-scheduler.service` está enabled/active/running, PID 969074, `NRestarts=0`; guard timer active, último disparo 18:36:01; `Linger=yes`. O log registra retry de Economia às 18:22 encerrado por `no_fresh_topic_candidates` (18 candidatas, zero dentro de 36 h), seguido de nova geração automática de Psicologia às 18:27:31. O snapshot de render às 18:33:45 mostrou 1.985/11.440 quadros, pela Radeon RX 6750 XT; o job tem 44 cenas de 9,107–22,883 s, mediana de 10,442 s, sem cenas abaixo de 9 s e robô visível em 44/44. Às 18:36:04, `pgrep` confirmou scheduler, gerador, HyperFrames e FFmpeg/VAAPI ativos para esse job. A renderização manual financeira coincidiu por aproximadamente dois minutos com o início automático; ambas seguiram sem erro e a Parte 2 concluiu. Nenhum serviço, host ou container foi reiniciado. Testes focados passaram 29/29; ESLint, `bash -n` e `git diff --check` passaram.

## IMP-90 — fontes configuradas, estado de 15/10 às 18:41 BRT

O auditor HTTP read-only amostrou 13 URLs, até 8 KiB/feed, com timeout de 8 s e duas requisições concorrentes: 10 XMLs válidos, BBC Offbeat e ScienceDaily Health em 404, TecMundo em 204 vazio. As mesmas três falhas constavam na consulta de 13/10. O acesso não leu artigos completos nem alterou a configuração. Licenciamento de conteúdo derivado, retenção, idioma e relevância continuam fora da prova técnica; nenhum candidato foi ativado.

## IMP-91 — correlação parcial do job de Psicologia, 15/10/2026 18:53 BRT

O job `ad1c4641-5aac-4860-afde-7feccc197ee2` possui, no log sanitizado do componente, `generation_started` às 18:27:35, `render_started` às 18:27:46, `render_finished=completed` às 18:48:55 (1.269.850 ms) e `thumbnail_finished=completed` às 18:48:56 (618 ms), todos com o mesmo content ID opaco e destino apropriado. `ffprobe` confirmou o master H.264 1920×1080/24 fps + AAC, 476,667 s, 168.686.435 bytes. Às 18:53:33 o processo de geração (PID 1785762) continuava ativo, produzindo cortes curtos e preparando a primeira parte narrativa; ainda não há `generation_finished` nem `generation_process_finished`, portanto YAI-043 permanece Parcial até a saída terminal e retenção/rotação.


## Autostart do container social após reboot — 15/10/2026, 19:00 BRT

O journal identifica um poweroff normal em 14/10 às 22:49; o serviço do scheduler recebeu o encerramento do host e iniciou de novo às 08:45:59 do dia seguinte, sem login, por estar enabled em `default.target` com `linger=yes`. Separadamente, em 15/10 houve uma parada explícita do scheduler durante manutenção/CI; `Restart=always` não reinicia uma unidade parada manualmente e o guard cobre paradas acidentais. Atualmente o processo produtor continua sendo Node no host (PID 969074), não um container.

O container Redroid Kwai é parte do envio Android. O Docker o reporta `exited`, exit 137, `OOMKilled=false`, finalizado em 14/10 às 22:04 — antes do poweroff. O código encerra o emulador após o uso com `docker compose down`; como a configuração anterior era `restart: no`, o container não foi recriado no boot. Isso não bloqueou geração de vídeo, mas deixava a próxima publicação Android dependente do `up` sob demanda.

Para que também volte após boot, `docker-compose.kwai.yml` agora define `restart: unless-stopped`; `scripts/kwai-emulator.js start-container` garante `binder` e inicia Compose sem esperar o boot gráfico inteiro; a criação usa o lock `android-social-upload.lock` para não competir com um envio em andamento. `scripts/wait-for-docker.sh` cobre a corrida entre o manager de usuário e o daemon Docker no boot. A unidade `deploy/systemd/kwai-emulator-boot.service` foi instalada em `~/.config/systemd/user`, habilitada em `default.target` e comparada com a fonte versionada. O user manager tem `linger=yes`, já comprovado no boot real. A unidade está habilitada e inativa no momento, intencionalmente: não iniciei o Redroid enquanto o produtor usava a Radeon para render social.

Testes focalizados de ciclo de vida, waiter, bootstrap Android e roteamento passaram **13/13**. ESLint, `node --check`, `bash -n`, `git diff --check`, `systemd-analyze verify` e `docker compose config --quiet` também passaram. A configuração não foi validada com reboot forçado nem com inicialização real do container durante o render em andamento; esses dois checks permanecem pendentes. O gate de revisão factual continua bloqueando envios das saídas retidas.

## Partes sociais do job de Psicologia — atualização 15/10, 19:07 BRT

O master H.264 1920×1080/24 fps, AAC, 476,667 s já concluiu e a produção social divide a narrativa em quatro partes para manter cada Reel abaixo de 179 s. `ffprobe` das Partes 1/4 e 2/4 mostrou H.264 1080×1920/30 fps + AAC estéreo 48 kHz: 111,667 s (36.981.213 B) e 119,267 s (39.323.195 B). Aos 55 s em cada arquivo, a amostra visual CPU mostrou selo correto de parte, legenda legível e robô no lado direito, sem colisão aparente nesse quadro.

No mesmo snapshot, a Parte 3/4 estava em encode por Radeon (HyperFrames GPU/VAAPI); Parte 4 e `generation_finished`/`generation_process_finished` ainda não existiam. O scheduler PID 969074 e o gerador PID 1785762 seguem ativos. A evidência factual continua não verificada, então nenhuma das saídas foi publicada.

## Recuperação confirmada sem interromper geração — 15/10/2026, 22:48 BRT

O desligamento de 14/10 às 22:49 foi solicitado via `shutdown`/`poweroff`; o journal registra o encerramento normal do scheduler e do Docker, sem evidência de crash/OOM do produtor. O scheduler de usuário iniciou sozinho no boot de 15/10 às 08:45:59. O host ficou desligado até ser ligado novamente; nenhum serviço de software consegue ligar a máquina enquanto faltar energia ou ela permanecer em poweroff.

Estado atual: `ai-video-scheduler.service` enabled/active com `Restart=always`, `NRestarts=0` e `linger=yes`; guard timer enabled/active. O produtor (PID 2630939) e o render HyperFrames/FFmpeg VAAPI estão sob o scheduler PID 2262523. Docker está enabled/active. `kwai-emulator-boot.service` enabled e `active (exited)` com `Result=success`; foi instalado após o boot da manhã e sua execução às 21:26 esperou Docker e validou Android/ADB. O container `kwai-emulator` está `running`, `restart=unless-stopped`, `OOMKilled=false`, `RestartCount=0`.

O checkpoint permite refazer a geração interrompida num caminho novo após boot, mantendo qualquer arquivo parcial; não retoma o frame exato. A inicialização automática do scheduler foi observada em boot real; a unidade do container foi exercitada com sucesso e está pronta para o próximo boot, mas ainda não foi observada em outro reboot físico. Não reiniciei o host nem o container enquanto a renderização pela Radeon estava ativa. Testes automatizados de reboot/readiness e verificação de configuração ficam registrados em IMP-120.
