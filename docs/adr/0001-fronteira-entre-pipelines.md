# ADR-0001 — Fronteira entre AgentTube e Pulso

- **Status:** Aceita.
- **Data da decisão:** 17/10/2026.
- **Relacionados:** YAI-026, YAI-006, YAI-007, YAI-017.

## Contexto

Este checkout contém dois orquestradores e dois modelos de estado:

1. **AgentTube / fluxo Express:** `npm start` inicia `index.js`, dashboard/agentes e persistência SQLite em `database/db.js`. `npm run scheduler` inicia `schedules/daily-automation.js`, que usa a fila e as entidades SQLite.
2. **Pulso animado / fluxo operacional:** `scripts/channel-scheduler.js` coordena fila JSON, `STATE_DIR`, renderização e publicadores. Na decisão original usava HyperFrames; em 24/10/2026 a rota narrativa Remotion já está integrada no gerador. A unidade de usuário existe e está habilitada, mas bloqueada pela migração; não há comprovação de ciclo recorrente da nova rota. Estado e critérios de rollout em [workflow-autonomo.md](../workflow-autonomo.md).

Os dois fluxos têm funcionalidades que não são equivalentes. Analytics, revisão, publicação e estado do AgentTube não aparecem automaticamente no ledger/fila do Pulso. Iniciar os dois como publicadores da mesma conta pode duplicar geração ou envio.

## Opções consideradas

### A. Unificar imediatamente

Mover geração/publicação para um único orquestrador e migrar os estados restantes. Requer paridade funcional, contrato de IDs, migração testada, plano de rollback e janela operacional. Não há evidência atual para executar essa migração com segurança.

### B. Arquivar o fluxo Express

Reduz duplicidade, mas descartaria capacidades úteis de revisão, readiness, métricas, analytics e experimentação que não estão demonstradas no fluxo do Pulso. Não recomendado sem inventário, exportação e substituto verificável.

### C. Conviver com fronteira explícita — decisão aceita

Manter `channel-scheduler.js` como único dono operacional da geração/publicação automatizada do Pulso enquanto esse processo estiver em produção. Manter o Express/SQLite como fluxo independente de dashboard, revisão e experimentação, sem enviar itens para a fila do Pulso por compartilhamento implícito de arquivos.

Se houver integração futura, fazê-la por adapter versionado e inicialmente somente de leitura: `publicationId` estável, plataforma, artefato, estado tipado, timestamps e URL/evidência. Uma única camada fica autorizada a executar cada publicação. Escrever no ledger operacional exige idempotência e restauração testada.

## Consequências da recomendação

- Preserva funcionalidades úteis e evita migração ou exclusão sem prova de paridade.
- A documentação precisa distinguir comando, banco, fila e suíte de teste de cada fluxo.
- Não basta ambos usarem o nome “scheduler”: `npm start`, `npm run scheduler` e o serviço Pulso são processos diferentes.
- Ainda existe manutenção duplicada. Se o responsável escolher unificação ou arquivamento, isso exige uma tarefa separada de migração e aceite.

## Decisão

Adotar a convivência com fronteira explícita enquanto os dois fluxos permanecerem úteis e sem paridade comprovada. `scripts/channel-scheduler.js` continua sendo o único dono operacional da geração/publicação automatizada do Pulso. AgentTube/Express continua independente para dashboard, revisão e experimentação. Não há ponte implícita, migração de filas nem compartilhamento de credenciais.

Uma integração futura exige um ADR de implementação separado, contrato versionado, IDs estáveis, idempotência, restauração testada e um único executor de publicação. A primeira etapa deverá ser somente leitura. Esta decisão não autoriza iniciar o scheduler Express nem alterar a operação do serviço Pulso.
