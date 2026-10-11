
# PLANO — Virar uma produtora de cinema automatizada

> Visão: não é "gerar vídeo de notícia", é operar como um estúdio — qualidade de imagem, som, ritmo e distribuição em nível profissional, 24h, sem gente no teclado.
> Este plano incorpora e supera o plano anterior de motion graphics (seção 0, já majoritariamente concluída) e expande para os outros pilares que faltam para parecer uma produtora de verdade: som, consistência de direção, dados, escala e distribuição.

---

## 0. Base já conquistada (motion graphics) — ✅ maduro

Migração para o estilo **UI/Product Motion Graphics** (Linear/Vercel dark premium + Bento cards + FUI + data-flow + legendas animadas) está implementada e rodando em produção.

- Referências analisadas: ViktorKav (`F-8KHgCK6dc`, `mYGCDyuulMM`), Gustavo Honorato (`AATRjnEM-1Q`).
- Especificação consolidada em `docs/especificacao-estilo-animado.md` (445 linhas) e `docs/padroes-visuais-referencias.md`.
- Engine de produção: HyperFrames em `utils/hyperframes-video-renderer.js`, com timeline determinística, kit de cenas, áudio mixado e robô Three.js aprovado em `experiments/hyperframes-pulso-pilot/`.
- Componentes no catálogo: bento-card, demo-header, progress-bar, caption animada, highlight sweep, kinetic-number, step-chart, node-graph, segmented-control, waveform, PiP, glitch transition, lower-third.
- Pendente de polimento (backlog antigo, mantido): `compare-table`, `checklist` animado, cards com rotação 3D leve, HUD de timestamp.

Esta base é sólida — o foco agora é tudo que falta **em volta** dela para parecer produtora de cinema, não só vídeo bonito.

---

## 1. Som e trilha — o maior gap atual

Hoje o áudio é só **narração (edge-tts) + legenda**. Confirmado em código: `utils/ffmpeg.js` é só wrapper fino (resolver binário, rodar comando, ler duração via ffprobe) — zero filtro de áudio, zero `loudnorm`/`amix`/`dynaudnorm` em qualquer lugar do repo. Zero música de fundo, zero efeitos sonoros, zero mixagem, zero normalização. Isso é a diferença mais perceptível entre "vídeo de IA" e "produção profissional" — o ouvido nota antes do olho.

- [x] **Trilha de fundo**: ✅ implementado — `utils/audio-mix.js` com banco de trilhas por mood em `data/assets/music/{epic,curious,tense,light}/` (README lá explica onde baixar), seleção determinística por seed, mood derivado do texto. **Falta só: baixar trilhas livres e jogar nas pastas** (o vídeo sai só com narração masterizada até lá — não quebra nada).
- [x] **Mixagem automática**: ✅ implementado — ducking real via `sidechaincompress` (trilha abaixa quando a narração fala) + loop da trilha, integrado ao áudio usado pelo renderer HyperFrames (vídeo longo e cortes verticais).
- [ ] **SFX pontuais**: whoosh em transições de cena, "tick" em contadores/progress-bar, "pop" em cards que entram — biblioteca pequena de 10-15 sons livres, acionados pelos mesmos tempos da timeline HyperFrames e dos componentes em `assets/scenes/kit.js`.
- [x] **Masterização final**: ✅ implementado — `loudnorm` (-14 LUFS, YouTube) aplicado a todo áudio final, consistência de volume entre todos os vídeos.
- [ ] **Abertura/encerramento de marca** (bumper): 2-3s de vinheta com logo "Pulso IA" animado + stinger sonoro, igual toda produtora/canal profissional tem.

## 2. Direção de arte e consistência visual

- [ ] **Guia de marca único**: hoje a paleta/tipografia está só no doc de especificação; formalizar como tokens de design (`assets/scenes/tokens.css` ou JSON) para garantir que todo canal/tema futuro herde a mesma "linguagem de estúdio", com variação controlada de accent color por tema.
- [x] **Conectar thumbnail ao sistema visual real** — ✅ implementado: `renderThumbnail()` em `generate-animated-video.js` gera a capa 1280x720 com o MESMO kit visual (bento + watermark, paleta dark premium, título grande centralizado), e `upload-to-youtube.js` aplica via `thumbnails.set` (falha de thumbnail não perde o upload). Thumbnail vai no ledger (`entry.thumbnailPath`) e é apagada na limpeza pós-upload.
- [ ] **Fechar os componentes pendentes do backlog visual**: `compare-table`, `checklist` animado, cards com leve rotação 3D, HUD de timestamp — hoje listados como "evolução futura" em `docs/padroes-visuais-referencias.md`.
- [x] **Correção de ritmo de corte**: cenas consecutivas alternam entre `hero` e `split` quando há imagem; layouts fixos de cortes verticais continuam respeitando `forceLayout`.
- [ ] **Grading de cor consistente** (LUT ou filtro ffmpeg) aplicado a todas as imagens/renders para unificar temperatura de cor entre fontes diferentes (Gemini web, prints reais, gráficos gerados) — hoje a consistência depende só do *prompt* de geração de imagem (`"dark premium tech aesthetic..."`), não de pós-processamento; o único filtro de cor no repo é um `eq=brightness=-0.12` aplicado só ao fundo blurado dos Shorts (`utils/clip-maker.js`), nada no vídeo longo.

## 3. Roteiro e narrativa — virar "roteirista", não só "resumidor"

- [x] **Estrutura de três atos no roteiro**: ✅ implementado — prompt do roteirista agora tem "REGRA DE RETENÇÃO": hook cria gap de curiosidade nos 3 primeiros segundos sem entregar a resposta, proibida saudação, seções puxam para a próxima, conclusão fecha com payoff + CTA.
- [x] **Feedback do editor-chefe (loop de revisão)**: ✅ implementado — `critiqueScript()` em `generate-animated-video.js`: segunda passada de LLM checando gancho/idioma/coerência/tamanho antes de narrar; se reprovar, regenera UMA vez com o feedback (desligável via `NO_SCRIPT_CRITIC=1`).
- [ ] **Variedade de tipos de gancho**: portar a lógica dos 5 templates (question/statistic/statement/challenge/promise) de `agents/script-writer-agent.js` como instrução de variedade no prompt do pipeline real.
- [ ] **Variedade de narrador**: voz ainda fixa por `.env` — fazer o roteirista sugerir pitch/rate por seção (urgente vs. curiosidade) dentro do próprio JSON do roteiro.
- [x] **Título e SEO de verdade**: ✅ implementado — `generateSEO()` gera título CTR + descrição + hashtags POR NOTÍCIA (sanity check de PT-BR, fallback para título do roteiro); vai no ledger (`entry.seo`) e o scheduler usa com fallbacks. Acabou a descrição/hashtags fixas hardcoded. A/B de thumbnail continua futuro.

## 4. Multi-plataforma — virar "distribuidora", não só "um canal"

Pontos já identificados em exploração anterior do projeto:

- [ ] Resolver login/branding **TikTok** (captcha bloqueando a conta reaproveitada) e **Kwai** (login manual pendente no emulador Android).
- [ ] Confirmar/estabilizar fluxo de upload **Instagram** (mapeado mas não confirmado 100% estável).
- [ ] Ativar **Telegram** (login pendente).
- [x] Rever a lógica de limpeza automática (`DELETE_AFTER_UPLOAD`): master e thumbnail dependem da confirmação do YouTube e dos destinos longos ativos; cada corte é limpo segundo seus próprios resultados. Falhas preservam apenas os artefatos necessários, sem bloquear o master e os outros cortes aprovados. Shorts pulados pela cota entram no retry do YouTube.

## 5. Dados e inteligência — virar "estúdio com departamento de análise"

- [ ] **Coletor de métricas de viralização** por vídeo/plataforma (views, retenção, CTR de thumbnail) — ainda não implementado, é a peça que falta para o pipeline aprender o que funciona.
- [ ] **Loop de feedback**: usar essas métricas para ajustar automaticamente duração ideal, tipo de gancho, hora de publicação, e eventualmente ranking de temas.
- [ ] **Rodízio dos 10 temas** (`CONTAS-E-TEMAS.md`) — hoje só o tema IA está implementado no scheduler; implementar seleção de fonte de notícia + voz/branding por tema para escalar como "estúdio com múltiplas séries", não um canal só.
- [ ] **Cota de imagens por vídeo**: `channel-scheduler.js` força `IMAGES_PER_GROUP=4` (reduzido do padrão 6) só para economizar cota do Gemini web — vale revisar quando resolver custo/limite de imagem, já que mais variação visual por seção = menos sensação de repetição.

## 6. Processo de estúdio — QA antes de publicar

- [x] **Controle de qualidade automatizado pré-publicação**: ✅ implementado — `probeVideoHealth()` em `utils/ffmpeg.js`: valida duração (min 15s / max 30min), presença de trilha de áudio e integridade do arquivo antes de QUALQUER upload; o scheduler aborta a publicação e alerta se reprovar.
- [ ] **Versionamento/arquivo de masters**: manter o vídeo final + fontes por período antes de limpar (parcial: caches de roteiro/prints já persistem em `data/scripts/` e `data/images/`).
- [x] **Consolidar o renderer em HyperFrames**: vídeos longos, cortes verticais e modo animado usam o robô 3D aprovado e a composição HyperFrames validada.
- [ ] **Decidir o destino do pipeline legado em `agents/`**: há bastante funcionalidade boa e órfã lá (SEO completo, thumbnail A/B, templates de hook) construída para um pipeline (`index.js`) que não é o que roda em produção. Ou se investe em plugar essas peças no pipeline real (`generate-animated-video.js`/`channel-scheduler.js`), ou se arquiva/remove para não confundir manutenção futura — hoje existem dois "roteiristas" e dois "designers de thumbnail" no mesmo repo, só um conjunto rodando de fato.

## 7. Operação e confiabilidade — virar "estúdio que não depende de alguém olhando o terminal"

- [x] **Alertas de falha**: ✅ implementado — `utils/alerts.js`: webhook Slack/Discord (`NOTIFICATION_WEBHOOK_URL`) e/ou Telegram (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_ADMIN_CHAT_ID`), disparado no scheduler quando upload falha, geração falha, QA reprova vídeo, ou ciclo perdido (2 falhas seguidas = nenhum vídeo publicado). Configurar as variáveis no `.env` para ativar.
- [x] **Cache/idempotência para screenshots de artigo e render final**: ✅ implementado — `screenshotArticles` reaproveita prints já capturados (valida variância antes de reusar), scheduler reusa o mesmo `outPath` no retry com `--resume` (se o render já concluiu, pula direto para publicação; caches de roteiro/narração já existiam).
- [x] **Retry com backoff exponencial de verdade na chamada NVIDIA**: ✅ implementado — base 1.5s dobrando por tentativa, e rate-limit (429) recebe o dobro da paciência (3s/6s).
- [x] **Teste automatizado do pipeline real**: ✅ implementado — `tests/pipeline-smoke.js` (`npm run test:pipeline`): 12 checks offline, sem API paga — módulos, buildScenes (watermark/caption em toda cena), QA reprova arquivo quebrado, moods, gate de orçamento, alerts no-op, mixdown.
- [x] **Controle de custo/orçamento ativo**: ✅ implementado — `utils/api-usage.js`: contador diário por serviço (`data/state/api-usage.json`), gate que falha cedo ao estourar `NVIDIA_CALLS_PER_DAY` (padrão 200, ~4x margem); crítico/SEO são pulados graciosamente sem orçamento em vez de travar o vídeo.

## 8. Identidade de marca em vídeo — virar "canal com cara própria", não só paleta de cor

- [x] **Identidade visual do apresentador**: robô 3D alto e em pé aprovado; aparece na composição HyperFrames com movimentos determinísticos e boca guiada pela fala.
- [x] **Elemento de marca recorrente na tela**: watermark "Pulso IA" mantida no kit de cenas e posicionada para não ficar encoberta pelo canvas do robô.

## 9. Risco legal/copyright — mitigar, não ignorar

- [x] **Atribuição de fonte na tela e na descrição** — já funcionava (nome do veículo sobre o print + URL na descrição) e continua como política fixa; agora também entra `Fonte:` no texto do SEO dinâmico.
- [ ] **Revisar uso de prints de página inteira** vs. recorte só do trecho relevante — recortar (crop) a área da manchete/imagem em vez do print completo reduz a superfície de risco e fica visualmente mais limpo no card.

---

## Priorização sugerida (ordem de impacto por esforço)

> **Sessão de 10/10/2026: itens 1, 3, 4 (parcial), 5 (parcial), 8, 11 (parcial), 12, 13, 14 implementados e testados** (12 checks no `npm run test:pipeline`, render end-to-end de validação, thumbnail e mixagem testados). Pendências humanas: baixar trilhas para `data/assets/music/`, configurar webhook/Telegram no `.env`, logins TikTok/Kwai/Telegram.

1. ~~**Alertas de falha** (seção 7)~~ ✅ — aguarda só configuração do `.env`.
2. **Som e mixagem** (seção 1) — ✅ implementado; falta você baixar as trilhas livres para `data/assets/music/` (o vídeo já sai masterizado -14 LUFS sem elas).
3. ~~**QA pré-publicação** (seção 6)~~ ✅ implementado.
4. ~~**Watermark de marca** (seção 8)~~ ✅ implementado.
5. ~~**Thumbnail conectada** (seção 2)~~ ✅ implementado (A/B ainda futuro).
6. ~~**Título/descrição/SEO variável** (seção 3)~~ ✅ implementado.
7. **Desbloquear multi-plataforma** (seção 4) — exige login manual: TikTok (captcha), Kwai (emulador), Telegram.
8. **Métricas de viralização** (seção 5) — ainda não implementado.
9. **Decidir destino do pipeline legado em `agents/`** (seção 6) — organizar antes de crescer mais.
10. **Fechar componentes visuais pendentes + grading de cor** (seção 2) — `compare-table`, `checklist`, cards 3D, HUD.
11. **Variedade de gancho/voz** (seção 3) — ✅ crítico de roteiro + regra de retenção feitos; variedade de tipos de gancho e voz por seção pendentes.
12. ~~**Teste de fumaça do pipeline real** (seção 7)~~ ✅ implementado (`npm run test:pipeline`).
13. ~~**Controle de custo ativo** (seção 7)~~ ✅ implementado (`NVIDIA_CALLS_PER_DAY`).
14. ~~**Cache/idempotência de prints + retry exponencial NVIDIA** (seção 7)~~ ✅ implementado.
15. **Rodízio de 10 temas** (seção 5) — escala horizontal, só depois do core redondo num tema.
16. **SFX pontuais + bumper de abertura** (seção 1) — polimento de áudio.
17. **Crop dos prints de artigo** (seção 9) — reduz risco e melhora visual.

---

## Orquestração de execução
- Subagentes: modelo leve NVIDIA (nemotron-3-super-120b-a12b) para implementação; gate final/correções 2× reprovadas → ultra-550b-a55b.
- Contexto do chat: apenas `caminho + status + resumo 1 linha`.
- Segurança: `NVIDIA_API_KEY` fica apenas no ambiente; nunca em arquivos/logs.
