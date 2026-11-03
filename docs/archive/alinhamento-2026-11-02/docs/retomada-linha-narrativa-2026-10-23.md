# Retomada da linha narrativa aprovada

Reconciliado em **24/10/2026, 22:23 BRT**. Correções locais de recuperação, recursos e isolamento de publicação foram adicionadas; ainda aguardam E2E e não foram implantadas no serviço. Este guia preserva a origem da migração e os artefatos do primeiro episódio. O cursor de execução é [plan.md §3.0](../plan.md); a arquitetura recorrente, recuperação, melhorias de contexto/Remotion e critérios estão em [workflow-autonomo.md](workflow-autonomo.md). A [versão anterior completa](archive/retomada-narrativa-antes-consolidacao-2026-10-24.md) foi preservada como histórico.

## Pedido e continuidade

O proprietário aprovou GPS v2 e pediu episódio completo, cortes e publicação. A ordem era publicar o primeiro episódio e depois substituir o criador recorrente em todos os temas. O primeiro episódio foi publicado. O pedido mais recente exige que a agenda, geração, recuperação e distribuição rodem sozinhas, sem alguém chamar um assistente programador para cada falha; também solicita melhorias Remotion/contexto e documentação persistente.

A autorização para gerar, revisar capas, aplicar QA e publicar nas contas configuradas permanece. Não pedir aprovação individual por vídeo. Evidências, hashes, recursos e identidade da conta continuam sendo requisitos técnicos. O QA factual recorrente usa verificador local e até dois reparos pelo writer, sem modelos revisores rotineiros. O consenso por dois modelos pertence ao episódio histórico específico.

## Estado reconciliado

- **YouTube:** [episódio público YVlMlolFUk8](https://youtu.be/YVlMlolFUk8), confirmado em 24/10 às 18:34 BRT via Studio Android. Master SHA `3e523d80d0a179ea5b5057bb4513bfe6418518577d479f192663f254bd6e156b`; manifesto SHA `74a2334a5caf38d1d49720267ee58639f718da758f5c519481323fe07eca9d52`. Não reenviar esse master por ler um status antigo de render pendente.
- **Pacote:** masters próprios 1920×1080 e 1080×1920, 401,423 s, seis capítulos/cortes e capas. Prova em [youtube-studio-published.json](evidencias/ia-como-responde-2026-10-23/youtube-studio-published.json).
- **Kwai:** parte 1/6 reconciliada como confirmada, sem reenvio. Partes 2–6 exigem conciliação de rascunho e divergência do perfil. [Prova](evidencias/ia-como-responde-2026-10-23/kwai-part1-reconciliation.json).
- **Shorts:** não enviados nesta entrega. **Instagram:** handler/conta existem, mas última checagem encontrou 5,16 MiB livres contra 48 MiB exigidos. **TikTok:** nascimento do titular e handler pendentes. **X:** crash do app e handler pendente. **Telegram:** excluído.
- **Integração recorrente:** contrato, autor de cenas, composição e renderer compartilhados já existem e são chamados pelo gerador. Não criar esses módulos novamente. Falta comprovar E2E e operação recorrente.
- **Último E2E:** `source_claims_unverified`, sem MP4/upload; diagnóstico e próximos incrementos em [workflow-autonomo.md](workflow-autonomo.md).
- **Serviço:** unidade de usuário instalada/enabled, mas inactive/ConditionResult=no por migração; guard timer active e Linger=yes. Consulta sem bus de usuário causou o diagnóstico incorreto de unit ausente. [Snapshot atual](evidencias/workflow-autonomo-2026-10-24/state.json).

## Artefatos específicos a preservar

Caminhos relativos à raiz `youtube-automation-agent/`, salvo indicação em contrário.

| Responsabilidade | Arquivo / artefato | Uso atual |
|---|---|---|
| Referência GPS v2 | `experiments/remotion-motion-review/src/GpsExplainerV2.tsx` | Referência visual aprovada, não template fixo para todos os assuntos |
| Apresentador | `experiments/remotion-motion-review/src/ApprovedRobotPresenter.tsx`; `experiments/remotion-motion-review/public/pulso-story/approved-robot-rigged.glb` | Preservar identidade, rig, boca e gestos |
| Episódio IA | `experiments/remotion-motion-review/src/AiAnswerExplainer.tsx` | Implementação específica já publicada; não é o motor universal |
| Narração/alinhamento | `scripts/prepare-ai-answer-episode.py`; `scripts/synthesize-edge-tts-word-boundaries.py` | Preservar voz, cache e palavras reais |
| Mix | `experiments/remotion-motion-review/scripts/prepare-ai-answer-audio.cjs` | Mix revisado do episódio: −14,05 LUFS / −3,48 dBTP |
| QA Studio | `experiments/remotion-motion-review/scripts/check-ai-answer-studio.cjs` | Evidência do episódio específico, não da composição universal |
| Render específico | `experiments/remotion-motion-review/scripts/render-ai-answer.mjs` | Recuperação desse episódio se algum artefato se tornar inválido; não iniciar um segundo render |
| Finalização | `experiments/remotion-motion-review/scripts/finalize-ai-answer-package.cjs` | Mux/cortes/checks do pacote já produzido |
| Capas | `scripts/prepare-ai-answer-thumbnail.cjs`; `docs/evidencias/ia-como-responde-2026-10-23/thumbnail/` | Arte e composições por aspecto; preservar origem e hashes |
| Staging/QA | `scripts/stage-ai-answer-publication.cjs` | Pacote e ledger já preparados; reconciliar identidade antes de executar de novo |
| Social específico | `scripts/publish-ai-answer-socials.cjs` | Estados por destino; nenhum reenvio de confirmado/incerto |
| Estado antigo | `docs/evidencias/ia-como-responde-2026-10-23/handoff-state.json` | Snapshot histórico anotado com referência ao estado atual; PIDs não são atuais |

## Situação dos incrementos da migração

| Incremento | Implementação encontrada | O que falta provar/completar |
|---|---|---|
| A. Contrato | `utils/narrative-episode-plan.js` | Contexto/evidências por IDs e cobertura nos dez temas; validar dependências/cache |
| B. Autor de cenas | `utils/narrative-scene-author.js` | Melhorar pergunta, ator, ação, transformação e consequência ligados à fonte/fala; E2Es contrastantes |
| C. Composição compartilhada | `experiments/remotion-motion-review/src/NarrativeEpisode.tsx`, registrada em `src/Root.tsx` | Validação de props e QA visual real dos dois aspectos na rota recorrente |
| D. Renderer | `utils/narrative-episode-renderer.js` | Bundle reutilizável, memória, validação/commit atômico, retomada integrada ao scheduler |
| E. Finalização comum | Gerador, `utils/clip-maker.js`, áudio e QA existentes | Cobertura integral das falas, cortes próprios por destino e manifesto completo em job real |
| F. Entrada recorrente | `scripts/generate-animated-video.js` chama a nova rota; `scripts/channel-scheduler.js` continua dono | Espera por recursos, job/saída/seed estáveis, timeout e retry por causa |
| G. Distribuição | YouTube/Shorts/retries já apontam para `utils/youtube-studio-publisher.js`; handlers sociais existentes | Comprovar novo ciclo, isolar legado, reconciliar Kwai e resolver IG/TT/X; não reintroduzir API YouTube |
| H. Rollout | Serviço e guard existentes, trava de migração ainda presente | Validar incrementos, levantar bloqueio com backlog protegido e observar ciclos sem intervenção |

A ordem detalhada e os testes pertinentes estão no [workflow autônomo](workflow-autonomo.md). Não reabrir etapas concluídas com base em listas antigas. YAI-063 continua parcial até evidência de produção/variantes/distribuição, não apenas presença de módulos.

## Serviço e travas de migração

O drop-in é `~/.config/systemd/user/ai-video-scheduler.service.d/99-narrative-method-migration.conf`:

```ini
[Service]
Environment=PAUSE_VIDEO_GENERATION=1
Environment=DISABLE_YOUTUBE_UPLOAD=1

[Unit]
ConditionPathExists=!/home/servidor/Git/youtube_ai/youtube-automation-agent/data/state/narrative-method-migration.paused
```

A `.env` também define `PAUSE_VIDEO_GENERATION=1`. Pausar apenas o producer não suspende consumer/retries. O rollout já está autorizado, mas deve primeiro impedir que o backlog legado seja liberado; depois ajustar somente essas travas, recarregar e iniciar a unidade existente em janela sem escritores. O serviço deve esperar recursos e retomar automaticamente, em vez de depender de uma nova conversa.

Consulta correta neste host:

```bash
env XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  systemctl --user show ai-video-scheduler.service -p LoadState -p ActiveState -p UnitFileState -p ConditionResult -p MainPID
```

## Recuperação excepcional do episódio inicial

O pacote já foi produzido/publicado. Os comandos seguintes são referência de reparo **somente se um artefato específico precisar ser recuperado**; não são a rotina recorrente e não autorizam reenvio. Revalidar arquivos, hashes, processos e locks antes de usá-los. Alteração de bytes invalida o QA anterior.

```bash
# Em experiments/remotion-motion-review/, somente com gate aprovado e sem render concorrente:
PULSO_CONSTRAINED_RENDER=1 PULSO_REMOTION_GL=angle-egl nice -n 10 taskset -c 0-5 node scripts/render-ai-answer.mjs masters both --wait
node scripts/finalize-ai-answer-package.cjs
# Na raiz, somente após revisão por hash e conciliação do pacote existente:
node scripts/stage-ai-answer-publication.cjs
```

O render específico usou `angle-egl`, Chrome for Testing, concorrência 2 e afinidade de seis CPUs. Isso não autoriza alterar o renderer recorrente nem forçar o gate sob carga; `PULSO_CONSTRAINED_RENDER=1` tem critérios próprios de RAM/swap/prioridade. Preservar checkpoints e prova do arquivo já publicado. O publicador social específico tem modo de pré-checagem sem `--publish`; antes de qualquer envio, conferir novamente destino, QA e estados remotos.

## Limpeza e preservação

O pedido de excluir vídeos antigos não define escopo para apagar outros projetos. Preservar fontes, modelos, clipes, sessões, novos masters e mídia com destino incerto. Inventário histórico: `docs/evidencias/method-migration-2026-10-23/video-inventory-before.json` (162 arquivos / 3,70 GiB naquele momento); revalidar antes de qualquer limpeza. Não confundir arquivo sem registro com prova de não envio. Não excluir vídeos do canal remoto: isso não foi pedido.

O checkout contém alterações anteriores e arquivos não rastreados: não usar reset/clean nem restaurar arquivos alheios. O treino Qwen e serviços de outros projetos não devem ser interrompidos para produzir vídeos. Não delegar a subagentes sem pedido aplicável. Consultar o [índice](README.md) e atualizar cursor do plano, evidência e nota curta no resumo ao concluir cada incremento.
