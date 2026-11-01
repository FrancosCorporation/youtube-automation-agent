# Proposta de retenção e arquivo — YAI-018

**Estado: proposta técnica para validação; não aprovada nem ativada.** Nenhuma mídia, log, estado, evidência ou backup operacional foi removido ou arquivado nesta revisão.

## Regras que não dependem de prazo

- Preservar `pending`, `inFlight`, `unknown`, falhas sem reconciliação, QA/revisão pendente e qualquer arquivo citado por esses registros. Sem expiração automática.
- Preservar ledger, fila, proveniência, scripts/fontes necessários para explicar o conteúdo, manifesto de QA, evidências por hash e prova de publicação por destino enquanto o ativo existir.
- Manter os masters e variantes de produção na origem até haver cópia íntegra, manifesta, restaurável e em armazenamento cifrado comprovado. A ferramenta atual verifica hash, mas não detecta criptografia.
- Preservar o original ao arquivar. Só permitir remoção após prazo aprovado, estado final confirmado em todos os destinos, ausência de dependências, manifesto validado e restore em caminho novo.

## Prazos sugeridos para discussão

| Classe | Prazo candidato | Elegibilidade e proteção |
|---|---|---|
| Job, upload, destino ou revisão pendente/incerta | Sem prazo fixo | Nunca candidato à limpeza automática; resolver e documentar o estado primeiro. |
| Master, cortes, thumbnail, roteiro e prova de publicação | 365 dias após confirmação final de todos os destinos | Manter cópia operacional; antes de qualquer remoção, exigir arquivo cifrado, hash confirmado, restore comprovado e carência adicional de 90 dias. Opção conservadora: retenção indefinida. |
| Fontes, créditos, permissões/licenças e evidências de alegações | 365 dias após a última publicação relacionada ou até terminar o prazo de direitos, o que for maior | Vincular à mídia por ID/hash; nunca apagar se houver disputa, revisão ou item público vivo. |
| Imagens geradas reutilizáveis não referenciadas | 14 dias após job terminal | Só cache regenerável, sem referência em roteiro, render, retry ou outra produção. O valor coincide com o default atual, mas não o torna política aprovada. |
| Capturas técnicas temporárias em `logs/snaps` | 7 dias | Só snapshots de depuração fora de evidências aceitas; capturas em `docs/evidencias/` não entram nesta regra. |
| Cache de perfil Chromium | 7 dias | Apenas `Cache`, `Code Cache` e `GPUCache` inativos; nunca perfis autenticados, cookies ou credenciais. |
| Backup integral de estado | 30 dias como hipótese inicial | Somente no volume cifrado; reconciliar frequência e número de cópias antes de programar. O exemplo de 30 dias do runbook ainda não é política. |
| Logs rotacionados por tamanho | Sem prazo adicional nesta proposta | Preservar os limites atuais de rotação; retenção temporal requer inventário próprio e não deve apagar evidências de incidente. |

Os períodos são uma proposta conservadora, não autorização para alterar variáveis ou ativar `--apply`. A remoção não deve ser agendada por cron antes da validação do titular.

## Ciclo seguro proposto

1. Gerar relatório somente de leitura, com classe, tamanho, data, ID, hash e referências do ledger/fila; não listar conteúdo de credenciais.
2. Excluir da elegibilidade tudo que esteja pendente, incerto, recente, referenciado por outra saída ou sem prova de destino. Registrar candidatos e motivo.
3. Após validação da política e da lista, copiar masters/fontes para volume cifrado, confirmar manifesto/hash, restaurar ao menos uma amostra em nome novo e validar mídia/ledger.
4. Aplicar carência adicional e repetir a prévia. Só então, com autorização específica para o lote e manifesto imutável revisado, executar remoção controlada e revalidar DB/JSON/ativos.
5. Reter log de auditoria e o manifesto da operação; falha, divergência de hash ou publicação `unknown` cancela o lote inteiro.

## Evidência e lacunas atuais

- `utils/disk-cleanup.js` usa defaults configuráveis de 7 dias para snapshots, 14 para imagens, 7 para cache de navegador e 24 horas de carência para mídia publicada. A exclusão de masters é opt-in (`deleteUploadedMedia` e `apply`); esses números são guardrails operacionais, não uma política decidida.
- `tests/disk-cleanup-retention.test.js` exercita exclusivamente uma fixture: a prévia escolhe um master antigo com publicação confirmada; `unknown`, ativo em fila, recente e confirmação de clipe para artefato divergente ficam preservados. O `apply:true` apaga somente o arquivo elegível dentro da pasta temporária do teste.
- `docs/evidencias/media-archive-restore-2026-10-17.json` registra a cópia/verificação/restauração por SHA de um render local de integração H.264/AAC (4,4 s); não era master publicado nem foi guardado em volume cifrado.
- `node --test tests/media-archive.test.js tests/disk-cleanup-retention.test.js` passou 4/4 em 17/10/2026. Isso valida o mecanismo em fixtures, não retenção em produção.
- YAI-017 continua Parcial: os volumes observados são ext4 sem criptografia declarada e não há janela de escritores confirmada para cópia de `.env`/DB/estado. Nenhum destino externo cifrado foi verificado.

**Decisão ainda necessária para adotar:** confirmar ou ajustar os prazos candidatos, a cadência/quantidade de backups e o destino cifrado. Até essa validação, manter a política como proposta e não executar expurgo.
