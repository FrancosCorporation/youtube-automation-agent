# Workflow autônomo do Pulso

Atualizado em 02/11/2026. Requisitos: [decisões vigentes](decisoes-vigentes.md). Único cursor/objetivos: [plan.md](../plan.md). A versão anterior, com PIDs/quotas/pausas de outubro e orientações superadas, está no [arquivo integral](archive/alinhamento-2026-11-02/docs/workflow-autonomo.md).

## Operação e fonte da verdade

`ai-video-scheduler.service` é a unidade **de usuário** e executa `scripts/channel-scheduler.js`. Não iniciar outro produtor; `npm run scheduler` é o fluxo independente AgentTube/Express, conforme [ADR-0001](adr/0001-fronteira-entre-pipelines.md).

Estado operacional vem de consulta recente à unit, heartbeat, processos, logs, filas e ledger. Uma unit ativa não prova MP4 ou envio. Na consolidação de 02/11, o serviço estava ativo com um filho de geração; o episódio de Psicologia tinha áudio de 461 s, a primeira cena aprovada e falhas de provider no segundo capítulo. Nenhum envio novo foi confirmado nessa observação. Consultar o cursor antes de agir; não reutilizar prazos históricos como bloqueio atual.

## Fluxo e responsabilidade

1. Agenda persistida e gate de recursos liberam a pauta; o snapshot da fonte tem URL, contexto e hash. Reservar pautas de jobs pendentes para não colidir.
2. Writer produz PT-BR e referências ao catálogo literal de evidências. Revisor local verifica cobertura, números, escopo, negação/incerteza; até dois reparos, com escalada do writer repetidamente falho. Não chamar modelo como revisor rotineiro.
3. TTS e capturas de referência; medir narração antes de imagens/autoria. Meta 950 palavras, piso editorial 850 e áudio horizontal de pelo menos 360 s. Fonte curta é rejeitada; não estender artificialmente.
4. Gemini Android cria imagens sob demanda e capas próprias 16:9/9:16. Solicitar Nano Banana Pro; registrar modelo efetivo não confirmado quando for o caso. Falha Android não deve abrir o navegador do host. Cache pode ser reutilizado apenas com identidade/proveniência compatível.
5. Autor recebe fala/tempos reais, fonte, direção e catálogo GLB local; propõe ações e geometrias por frase. Normalização e validações locais conferem contrato, movimento, apoio e colisões nos dois aspectos. Reparos preservam rascunho auditado e blocos aprovados, com limites e alternativa de modelo maior.
6. Remotion usa bundle por job, props validadas, lock/gate compartilhados, render sequencial e saída atômica. Retomar aspecto concluído somente com identidade e hashes válidos. Three.js r187 e humanos GLB locais; robô aprovado permanece.
7. Produzir cortes do vertical, mix, capas e QA técnico/visual/factual por hash. Revisão delegada não é novo aceite humano por vídeo. Arquivo reprovado permanece retido.
8. Fila e consumer publicam por destino autorizado, verificando conta e prova de conclusão. YouTube/Shorts pelo Studio Android. Resultado incerto vai à reconciliação; falha de rede não invalida publicação comprovada em outra.

## Mapa de código

| Responsabilidade | Arquivos |
|---|---|
| Agenda, produtor, consumer, recuperação | `scripts/channel-scheduler.js`, `utils/generation-retry.js`, `utils/generation-attempt.js` |
| Cache isolado e reserva de pautas | `utils/generation-cache-scope.js`, `utils/generation-topic-reservations.js` |
| Geração, fonte e roteiro | `scripts/generate-animated-video.js`, `utils/source-evidence-catalog.js`, `utils/deterministic-script-review.js`, `utils/script-repair.js` |
| Modelos NVIDIA e orçamento | `utils/nvidia-runtime.js`, `utils/nvidia-chat-completions.js`, `utils/api-usage.js` |
| Gemini Android e capas | `utils/gemini-image-provider.js`, `utils/gemini-android-image.js`, `utils/thumbnail-art.js` |
| Contrato, autoria, direção e atores | `utils/narrative-episode-plan.js`, `utils/narrative-scene-author.js`, `utils/narrative-creative-reference.js`, `utils/narrative-human-actors.js` |
| Render e capacidade | `utils/narrative-episode-renderer.js`, `utils/render-timing.js` |
| Composição | `experiments/remotion-motion-review/src/NarrativeEpisode.tsx`, `ApprovedRobotPresenter.tsx` no mesmo diretório |
| Cortes, áudio e QA | `utils/clip-maker.js`, `utils/audio-mix.js`, `utils/video-qa-manifest.js`, `utils/delegated-publication-review.js` |
| Publicadores | `scripts/upload-to-socials.js`, adaptadores Studio Android e redes usados pelo scheduler |

Dependências de produção conferidas no package do compositor: Remotion 4.0.537, React 19.2.3, Three 0.187.0 e R3F 9.8.2. Renderer narrativo v2; revisão de roteiro `retention-emotions-v29-inline-source-evidence`. Não mudar revisão/cache apenas para alinhar documentação.

## Persistência e recuperação

Os caminhos usam `STATE_DIR=data/state` por padrão. Não editar arquivos com writers ativos.

| Arquivo/diretório | Finalidade |
|---|---|
| `scheduler.json`, `theme-rotation.json` | Agenda/rodízio |
| `scheduler-health.json` | Heartbeat, producer/consumer, fila, falha e retry |
| `generation-in-flight.json`, `deferred-generation-attempts.json` | Job, fonte, seed, saída e prazo de retomada/adiamento |
| `publish-queue.json`, `topics.json` | Fila/ledger operacional por artefato e destino |
| `narrative-renders/`, `narrative-render.lock` | Conclusão por proporção e exclusão mútua |
| `data/scripts/`, `data/cache/narrative-scenes/` | Roteiro, revisão, blocos/rascunhos e hashes |
| `data/reports/narrative-episodes/`, `data/reports/qa/`, `logs/` | Planos, manifestos, diagnósticos e evidências privadas |

Falha transitória: preservar job/fonte/seed/saída, respeitar Retry-After/cooldown e retomar o primeiro estágio inválido. Falha persistente de autoria: adiar checkpoint e permitir outra pauta, sem sobrescrever áudio/roteiro de outro job. Sinal/crash do filho: preservar tentativa recuperável. Reprovação factual após dois reparos: bloquear o conteúdo e permitir seleção de outra pauta. Resultado remoto incerto: reconciliar sem reenviar.

O teto NVIDIA local de 600 chamadas foi removido por instrução do proprietário (`NVIDIA_CALLS_PER_DAY=0`); isso não elimina erros remotos. Outras rotas mantêm seu orçamento configurado. Só uma inferência real demonstra disponibilidade de um modelo.

## Recursos e Gemini compartilhados

Respeitar o perfil instalado de compartilhamento com treino (afinidade, prioridade, memória e um render de cada vez). Não encerrar treino, ignorar lock ou substituir limites por números de snapshots antigos. Configuração versionada em `deploy/systemd/`, configuração efetiva na unit/drop-ins do usuário.

Gemini usa Chrome Android do `emulator-5560`, conforme configuração local. O lock do aparelho é compartilhado com redes/Studio; proteger composição/upload, restaurar tela anterior com segurança e reutilizar aba/cache. Forward CDP deve conferir dispositivo/socket e não sobrescrever associação alheia. Não imprimir `.env`, tokens, cookies ou configuração autenticada.

## Diagnóstico e rollout

Consulta da unidade neste host:

```bash
env XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus   systemctl --user show ai-video-scheduler.service ai-video-scheduler-guard.timer   -p Id -p LoadState -p ActiveState -p UnitFileState -p MainPID
```

Conferir health recente, processos filhos, último `logs/gen_*.log`, fila e locks. Não reinstalar unit por consulta sem bus. Mudanças carregadas pelo próximo filho não exigem reiniciar uma geração ativa. Reload do serviço somente quando producer/consumer/retry e locks comprovarem janela ociosa; manter fila, slot, job e prazos.

YouTube/Shorts, Instagram, Kwai e TikTok possuem caminhos de publicação; revalidar sessão/identidade/estado por destino. X permanece dependente de compatibilidade e identidade verificável. Telegram está excluído. Quotas antigas não são diagnóstico atual, e ausência no perfil não prova que é seguro reenviar.

## Prova de conclusão

Correção: reproduzir → implementar → teste focal/lint → CI isolada quando houver integração de código → prova real pertinente. Motion: seguir [skill local](../.agents/skills/pulso-motion-design/SKILL.md), revisar pixels e movimento de ambos os formatos. Não chamar teste unitário de render ou publicação.

Autonomia concluída exige agenda, espera, recuperação, QA, publicação/reconciliação e ciclo seguinte pelo serviço sem assistência contínua. Documentar job, horários, hashes, causa/retry e confirmação por destino no cursor/linha do plano e em `resumo.md`. A presente consolidação não fecha esse critério.
