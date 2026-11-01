# Auditoria e remediação de dependências; compatibilidade SQLite

**Data:** 13/10/2026
**Escopo:** auditoria NPM, compatibilidade isolada de `node-cron`/OAuth Google e avaliação inicial de drivers SQLite. Uma mudança de manifest/lock apareceu no checkout compartilhado às 16h24; sua autoria não foi atribuída nesta sessão. O `node_modules` do checkout e os serviços ativos não foram substituídos.

## Auditoria NPM

O lock original apontava **3 vulnerabilidades moderadas**, sem severidades alta/crítica:

| Pacote afetado | Caminho no lock | Versão do lock | Correção indicada |
|---|---|---|---|
| `uuid` | `node-cron` | `8.3.2` | `11.1.1` ou posterior corrigida; major exige teste de compatibilidade. |
| `uuid` | `gaxios` | `9.0.1` | a faixa afetada termina antes de `11.1.1`; depende de atualização compatível do consumidor/transitivo. |
| `node-cron` | dependência direta | `3.0.3` | npm propõe `4.6.0`, major. |

O advisory descreve gravação fora do limite nas funções UUID v3/v5/v6 quando quem chama fornece buffer e offset inválidos. A pesquisa estática encontrou `gaxios` usando `uuid.v4()`, mas a correção removeu a versão vulnerável do lock em vez de depender de uma exceção baseada apenas no callsite. [Advisory GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)

O `npm audit fix --dry-run --json` original projetou mudanças amplas e não foi aplicado. Uma alteração posterior no checkout compartilhado declarou `node-cron` 4.6.0 e um override de `google-auth-library` restrito a `@google-cloud/local-auth`; o lock resolve Google Auth 10.9.1 e `gaxios` 7.3.1, removendo o ramo vulnerável de `gaxios` 6/`uuid` 9. Às 16h26, `npm audit --json` sobre o lock atual retornou **zero vulnerabilidades**. Uma instalação descartável do lock terminou com 424 pacotes e zero avisos de audit. O SDK de fala já fixa `uuid` 11.1.1. A árvore instalada do checkout continua diferente: `sqlite3` 5.1.7 versus 6.0.1 no lock, `node-cron` 3.0.3 versus 4.6.0 e Google Auth 9.15.1 versus 10.9.1. Nenhuma dessas mudanças foi carregada pelo serviço ativo.

## Compatibilidade do `node-cron`

`schedules/daily-automation.js` cria oito tarefas suspensas e inicia-as explicitamente. No v3, isso usa `schedule(..., { scheduled: false })`; no v4, usa `createTask()`. A camada de compatibilidade acompanha `start()`/`stop()` no v3, que não expõe estado público, e considera `idle` e `running` ativos no v4. Os testes passaram com a versão v3 instalada, com o pacote real 4.6.0 em diretório temporário (2/2) e com contrato v4 simulado. Ainda faltam execução numa instância Express isolada e testes de calendário/timezone. [Guia oficial de migração v3→v4](https://www.nodecron.com/migrating-from-v3.html)

`@google-cloud/local-auth` continua na versão 3.0.1, mas declara `google-auth-library` `^9`; o override localiza somente essa integração na versão 10.9.1, sem alterar as demais dependências do pacote. O teste carregou o pacote real com Google Auth 10, construiu `OAuth2Client` e validou `generateAuthUrl`/`getToken` sem abrir navegador nem autenticar uma conta. `npm ci` em uma cópia descartável do lock atualizado instalou 424 pacotes e terminou com zero avisos de auditoria. O preflight dessa cópia reportou 29 verificações OK, 2 avisos opcionais do perfil neural e zero erros; os seis testes de backup/restauração passaram com o `sqlite3` 6.0.1 do lock. A confirmação de OAuth real permanece para a etapa controlada de emulador.

No checkout ativo, o mesmo preflight reportou **8 divergências de versão** (`axios`, `express`, `form-data`, SDK de fala, `moment`, `node-cron`, `sharp` e `sqlite3`), 21 verificações OK, 2 avisos opcionais e zero outros erros. `node_modules` não foi substituído porque o scheduler e uma geração de vídeo estavam ativos. O gate de runtime limpo e rollback segue em YAI-001; uma atualização no lock, sozinha, não comprova implantação.

## Driver SQLite

O projeto importa `sqlite3` em `database/db.js`, `utils/sqlite-backup.js` e `utils/project-backup.js`. O wrapper converte operações callback em Promises; snapshot usa a API de backup do `sqlite3`. O repositório oficial `TryGhost/node-sqlite3` foi arquivado em 01/07/2026 e está somente leitura, apesar de o pacote 6.0.1 continuar publicado. [Repositório oficial e estado de arquivamento](https://github.com/TryGhost/node-sqlite3)

`better-sqlite3` é uma alternativa mantida com releases recentes, mas é síncrona e exige addon nativo; adaptar o wrapper, concorrência e backup requer uma migração isolada com fixtures. [Releases oficiais do better-sqlite3](https://github.com/WiseLibs/better-sqlite3/releases) `node:sqlite` reduziria dependência externa, porém continua “active development” no Node 22 e “release candidate” no Node 24; o runtime observado do projeto é Node 22.22.1. Não é candidato estável para adoção imediata. [Documentação oficial do Node 22](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html) [Documentação oficial do Node 24](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)

## Recomendação e estado

1. Preservar o lock que hoje não apresenta alertas e não instalar por cima do `node_modules` enquanto processos ativos dependerem dele; alinhar o runtime numa janela segura e executar o preflight previsto em YAI-001.
2. Durante a implantação, validar o scheduler isolado com timezone, parada/retomada e ocorrência real do próximo tick. A autenticação Google aguarda o teste controlado do emulador e não foi realizada nesta auditoria.
3. Seguir a decisão registrada em [ADR-0002](adr/0002-sqlite-driver.md): manter `sqlite3@6.0.1` no lock por enquanto e reavaliar `better-sqlite3` somente após medição; uma futura migração exige adapter, fixture de esquema/dados, backup/restore e rollback por cópia restaurável.
4. Aplicar package/runtime changes somente após os testes isolados e janela coordenada de implantação.

YAI-050 permanece **Parcial**: o lock passou audit sem avisos e contratos de cron/OAuth/SQLite foram exercitados em cópia limpa. O runtime ativo ainda diverge; esse alinhamento depende de YAI-001 e de janela coordenada. A decisão de SQLite está registrada em ADR-0002, com gates de fixture e rollback para eventual migração futura.

## Reauditoria datada — 13/10/2026, 22h53 BRT (IMP-20261014-11)

`npm audit --json` foi executado novamente contra o lock atual com Node v22.22.1 e npm 9.2.0. Resultado: exit code 0 e zero vulnerabilidades em todas as severidades. O hash SHA-256 do lock e o resumo agregado estão em `docs/evidencias/npm-audit-2026-10-14.json`. O resultado não representa a árvore `node_modules` instalada nem o runtime implantado; YAI-050 permanece Parcial até o alinhamento coordenado de YAI-001.

## Reauditoria e fechamento local — 14/10/2026 (IMP-20261014-45)

No checkout atual, `npm audit --json` voltou a terminar com exit 0 e zero vulnerabilidades. `node scripts/preflight-runtime.js --json` registrou 26 checks OK, quatro avisos relativos ao perfil neural/modelos opcionais e um erro para o executável Rhubarb ausente; não houve erros de versão, manifest/lock ou dependências instaladas. As versões de `node_modules` consultadas coincidem com as versões do lock. Não rodei `npm ci` nem atribuo a instalação alinhada a esta sessão.

`node --test tests/project-backup.test.js tests/database-backup.test.js` passou 8/8 no estado corrente, carregando `sqlite3@6.0.1`, incluindo cópia de snapshot protegida contra alteração entre validação/restauração, WAL, integridade e restore isolado. ESLint e sintaxe passaram. A decisão ADR-0002 de manter `sqlite3@6.0.1` até que uma medição justifique migração permanece válida; nenhum driver ou override foi trocado nesta reauditoria.

YAI-050 está **Concluído localmente**: o lock está limpo, as versões instaladas coincidem, os contratos e testes do driver foram exercitados e a decisão de migração está registrada. Rhubarb e os componentes/modelos do perfil neural continuam pendentes em YAI-001; isso não é divergência npm nem altera a decisão SQLite. A verificação local não declara um processo persistente antigo implantado/atualizado.
