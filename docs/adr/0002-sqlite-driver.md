# ADR-0002 — Manter o driver SQLite atual até medir uma alternativa

- **Status:** Decidido; reavaliar se surgir falha de manutenção ou gargalo medido.
- **Data:** 13/10/2026.
- **Relacionados:** YAI-001, YAI-017, YAI-050.

## Contexto

O código usa a API assíncrona de `sqlite3` em `database/db.js`, `utils/sqlite-backup.js` e `utils/project-backup.js`. O backup consistente chama a API nativa `database.backup()`. O repositório upstream está arquivado, o que aumenta o risco de manutenção futura. A instalação limpa do lock atual (`sqlite3@6.0.1`) carregou no Node 22.22.1; seis testes de backup, integridade e restauração passaram usando essa versão.

## Opções consideradas

1. **Manter `sqlite3@6.0.1` por agora.** Preserva o contrato callback/Promise e o backup já validado; não elimina o risco de upstream arquivado.
2. **Migrar para `better-sqlite3`.** É mantido e suporta SQLite atual, mas troca a API assíncrona por chamadas síncronas, exige revisar o adaptador e o caminho de backup e pode bloquear o event loop. Ainda não há medição que demonstre que esse custo é aceitável.
3. **Migrar para `node:sqlite`.** Reduz dependência nativa externa, mas o projeto suporta Node 22 e 24; o estado de estabilidade documentado nas versões suportadas ainda não justifica adotá-lo como padrão.

## Decisão

Manter `sqlite3@6.0.1` fixado no lock e adiar a substituição do driver. O lock limpo passou o preflight de dependências, o módulo nativo carregou e os testes de backup/restauração passaram com a versão bloqueada. Não se observou falha funcional ou latência que exija mudar a API agora.

## Consequências e condição de reavaliação

- A aplicação mantém o contrato existente e evita introduzir trabalho síncrono no caminho do painel.
- O arquivamento do upstream permanece um risco aceito e limitado; avisos de segurança ou incompatibilidade com o Node passam a exigir nova decisão.
- Reavaliar `better-sqlite3` se medições de atraso do event loop, suporte a builds ou uma falha de manutenção justificarem a migração. `node:sqlite` só entra na comparação quando o estado de estabilidade cobre todas as versões Node suportadas.

## Gate para uma migração futura

Executar a mudança em checkout isolado. Antes da troca, capturar backup restaurável e fixture que contenha esquema, índices, chaves estrangeiras, linhas com JSON, transação revertida e dados WAL. Comparar contagens e consultas, validar integridade/backup/restore e medir atraso do event loop sob concorrência representativa. Publicar apenas com plano de rollback que restaure o lock, o driver e o banco anterior sem sobrescrever a única cópia válida.

## Evidência desta decisão

- `npm ci` em `/tmp/yai-lock-candidate` concluiu com zero vulnerabilidades; o preflight limpo identificou `sqlite3@6.0.1` e terminou com zero erros de dependência.
- `tests/database-backup.test.js` e `tests/project-backup.test.js`, carregando explicitamente o módulo `sqlite3` do lock candidato, passaram 6/6.
- O runtime principal ainda tem `sqlite3@5.1.7`; alinhar esse ambiente está separado em YAI-001 e aguarda uma janela segura enquanto serviços estão ativos.
