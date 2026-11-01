# Mapa documental de contas, destinos e temas — 17/10/2026

Auditoria read-only feita às 20:03 BRT. Não consultei sessões, tokens, `.env`, páginas autenticadas ou perfis, e não alterei nomes, bios, handles, destinos, fila ou configuração.

## Marcas e temas configurados

`config/themes.json` contém dez temas habilitados. `theme.brand` vira `script.channel` e watermark; o campo não escolhe uma conta real nem liga um tema a um handle.

| ID | Tema | Marca configurada |
|---|---|---|
| `ia` | Inteligência Artificial | Pulso IA |
| `curiosidades` | Curiosidades insanas | Pulso Curiosidades |
| `dinheiro` | Dinheiro dos Ricos & Economia Bizarra | Pulso Dinheiro |
| `saude` | Saúde & Bem-estar Surpreendente | Pulso Saúde |
| `economize` | Economize dinheiro | Pulso Economia |
| `psicologia` | Psicologia & Mente Humana | Pulso Mente |
| `relacionamentos` | Psicologia dos Relacionamentos | Pulso Relações |
| `fitness` | Fitness & Treino Surpreendente | Pulso Fitness |
| `misterios` | Mistérios sem solução | Pulso Mistérios |
| `carreira` | Carreira & Sucesso Profissional | Pulso Carreira |

## Destinos e identidade comprovável

| Destino | Rota documentada no projeto | Identidade/handle aprovada | Temas atribuídos à conta | Estado da evidência |
|---|---|---|---|---|
| YouTube (vídeo longo e Shorts) | API oficial no publisher; o README descreve um canal conectado. O ledger local tem 12 URLs `youtube.com/watch` datadas de 7–9/10; os registros são referências/checagens, não um mapa de identidade. | Canal/ID/handle e nome/bio aprovados não foram encontrados nos artefatos seguros revisados. | Os dez temas e marcas estão habilitados, mas nenhum deles é associado a um canal/handle específico. | Canal como destino do produto: documentado. Conta real e roteamento por tema: não comprovados nesta auditoria. O plano já registrava dois masters confirmados em 17/10; isso não revela, por si só, o mapa de contas. |
| Kwai | Único handler Android configurado em `scripts/upload-to-socials.js`; documentação de publicação registra Kwai Lite no emulador e ressalta que uma flag/sessão antiga não prova autenticação atual. | Handle/conta ativa não registrado na evidência segura revisada. | Não há associação por tema comprovada. | Capacidade de handler local: documentada. Perfil, sessão atual e destino autorizado: não verificados. |
| Instagram | App oficial instalado no AVD `emulator-5560`; handler Android ainda ausente. | Perfil próprio observado em 18/10: `@pulso_ai_news`, nome `Pulso IA`; aprovação do destino/nome/bio segue pendente. | Não há associação por tema aprovada. | Sessão/profile observados; publicação Android ainda não implementada. |
| TikTok | Documentação de formatos e API; não há handler Android validado no estado registrado pelo projeto. | Handle/conta e nome/bio aprovados não registrados aqui. | Não há associação por tema comprovada. | Perfil/destino e caminho de publicação ainda precisam de validação própria. |
| X | Caps e documentação de rota existem; o tier Android depende da conta. | Handle/conta e nome/bio aprovados não registrados aqui. | Não há associação por tema comprovada. | Perfil, tier e destino não verificados. |
| Telegram | Decisão de escopo/ativação permanece pendente em YAI-046. | Sem conta aprovada registrada. | Sem temas atribuídos. | Não considerar destino ativo. |
| Facebook | Entrada ainda depende da decisão de escopo YAI-046. | Sem conta aprovada registrada. | Sem temas atribuídos. | Fora do mapa operacional até decisão registrada. |

## Checagem operacional deste snapshot

`data/state/scheduler-health.json` às 20:02 BRT informa scheduler `active`, produtor em `backoff`, consumidor `missed_slot_waiting_for_video`, 60 vídeos/dia configurados, intervalo nominal de 24 minutos, fila `pending=0` e `inFlight=false`. Portanto, neste snapshot não havia vídeo sendo enviado nem job na fila; atividade futura depende de um vídeo elegível e dos gates do pipeline. É uma leitura do health file, não validação de conta ou publicação externa.

## Pendências que impedem fechar YAI-019

- Confirmar identidade e handle de cada conta/destino com evidência do próprio perfil, sem inferir do texto global `CHANNEL_NAME`/`CHANNEL_DESCRIPTION`.
- Aprovar nomes e bios por destino e decidir se as dez marcas compartilham contas ou exigem canais separados.
- Registrar explicitamente a matriz tema→conta, preservando handles e a decisão de nichos.
- Resolver YAI-046 para Telegram/Facebook antes de incluí-los como destinos ativos.

Até a confirmação, manter a matriz como inventário de lacunas: não criar contas, não alterar perfis e não inferir identidade a partir de títulos, marcas, sessões antigas ou URLs de vídeos.

## Observação adicional de identidade — 18/10/2026, 09:54 BRT

Inspeção do perfil do app Kwai Lite autenticado no Redroid, sob lock compartilhado e sem publicação: nome exibido `rodolfo franco550`, ID exibido `kaceg425`. Captura/XML em `docs/evidencias/retomada-2026-10-18/kwai-profile.*`. Isso identifica a sessão observada; não é aprovação de nome/bio/branding nem uma associação dos dez temas a essa conta. A tentativa fitness 14 continua `unknown`, apesar de uma capa compatível na seção Drafts; ausência de confirmação pública continua exigindo reconciliação conclusiva antes de reenvio.


## Perfil Instagram observado — 18/10/2026

Na timeline do Instagram, abri a aba do perfil próprio. A tela exibiu o controle “Edit profile”, handle `@pulso_ai_news` no nó visível `com.instagram.android:id/action_bar_title`, nome `Pulso IA`, bio de notícias de inteligência artificial e link externo. O probe automático leu o mesmo handle; sem aprovação/env `ANDROID_SOCIAL_HANDLE_INSTAGRAM`, o estado permanece `identity_unconfirmed`. Isso distingue o perfil autenticado de uma timeline pública e dá identidade técnica observável. Não altera nem aprova bio, nome, handle, destino, roteamento ou associação tema→conta. Evidência sanitizada: `docs/evidencias/retomada-2026-10-18/social-login-observation.json`.

## Atualização somente leitura — 19/10/2026, 19:37 BRT

O app Android voltou a mostrar o perfil autenticado `@pulso_ai_news` / “Pulso IA” (189 posts, controle “Edit profile”). O Reel do job Marília foi aberto no perfil com legenda completa e reconciliado `confirmed` no ledger; evidências `docs/evidencias/retomada-2026-10-19/instagram-profile-observation-2026-10-19.{json,png}` e `instagram-public-reconciled-2026-10-19.{json,png}`. O handler Instagram existe e concluiu o fluxo Android; a confirmação é do perfil autenticado, não uma verificação anônima. Nenhuma mudança de nome, bio, handle ou roteamento foi feita. A identidade observada não decide quais dos dez temas pertencem à conta; YAI-019 permanece parcial.
