# Documentação do Pulso neste checkout

Atualização: 25/10/2026. O plano único de execução é [plan.md](../plan.md); este índice organiza a leitura, sem duplicar o backlog.

| Para entender ou retomar | Documento |
|---|---|
| Instruções permanentes e autorização | [AGENTS.md](../AGENTS.md) |
| Prioridade, cursor e objetivos YAI | [plan.md](../plan.md), [critérios de aceite](criterios-aceite-pulso.md) |
| Fluxo automático, lacunas, contexto, Remotion, retries, redes e rollout | [Workflow autônomo](workflow-autonomo.md) |
| Estado verificável e implementação desta revisão | [Ativação e estado do serviço em 25/10](evidencias/workflow-autonomo-2026-10-25/activation-state.json), [snapshot de implementação de 22:25 em 24/10](evidencias/workflow-autonomo-2026-10-24/implementation-state.json), [captura original de 22:08](evidencias/workflow-autonomo-2026-10-24/state.json) |
| Episódio inicial e origem da migração GPS v2 | [Retomada narrativa](retomada-linha-narrativa-2026-10-23.md) |
| Distinguir Pulso de AgentTube/Express | [ADR-0001](adr/0001-fronteira-entre-pipelines.md) |
| QA factual, vídeo/capas e liberação por hash | [Runbook de QA](video-qa-review-runbook.md) |
| Motion e composição | [Skill local](../.agents/skills/pulso-motion-design/SKILL.md), [projeto Remotion](../experiments/remotion-motion-review/README.md) |
| Formatos e distribuição por rede | [Matriz de formatos](formatos-video-por-rede-2026-10-13.md); consultar o workflow para disponibilidade atual das contas |
| Métricas reais | [Runbook de performance](daily-performance-runbook.md) |
| Acervo, imagens e restauração | [Acervo](media-archive-runbook.md), [banco de imagens](image-library-runbook.md), [backup](backup-restore-runbook.md) |
| Evidências e decisões anteriores | [resumo.md](../resumo.md), `docs/evidencias/`, `docs/archive/` |

Precedência: pedido mais recente do proprietário → evidência pertinente ao artefato/estado → cursor atual do plano → histórico. Não usar a data de um arquivo ou teste aprovado como prova de vídeo publicado. Leituras de serviço precisam do manager **de usuário**; `enabled`, `active`, heartbeat recente, geração concluída e envio confirmado são fatos distintos.
