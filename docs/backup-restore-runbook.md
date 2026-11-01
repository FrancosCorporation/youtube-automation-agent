# Backup e restauração isolada

O fluxo canônico está em `scripts/project-backup.js` e `utils/project-backup.js`; `utils/sqlite-backup.js` usa a API de backup do SQLite e executa `PRAGMA quick_check`. O backup combina o banco, os arquivos JSON do `STATE_DIR` efetivo e uma seleção de fontes/configuração do workspace. O manifesto registra tamanho e SHA-256. A restauração exige um diretório novo, valida os arquivos e o banco e publica a cópia por rename.

## Conteúdo e proteção

O perfil padrão inclui `plan.md`, `resumo.md`, `CONTAS-E-TEMAS.md`, `.env`, dependências/locks, agentes, configuração, database, scripts/utilitários, scripts de pauta, piloto HyperFrames e `remotion-pilot`. O `STATE_DIR` ativo é adicionado como JSON. Pastas `.git`, `.planning`, `.hyperframes`, `.agents`, `node_modules`, `dist`, `build`, `renders`, `variants` e `logs` são omitidas; symlinks são omitidos. Vídeos, perfis autenticados e caches não entram nesse perfil.

Arquivos do backup usam permissão `0600` e a pasta-raiz `0700`; isso restringe acesso local, mas **não cifra os dados**. O backup contém `.env` e pode conter credenciais da aplicação. Escolha um volume criptografado fora do workspace e nunca coloque o backup no Git. Não copie perfis de navegador/ADB sem procedimento criptografado específico.

O SQLite tem snapshot consistente; a cópia do banco e dos arquivos JSON não é uma transação única. Execute o backup numa janela sem escritores do scheduler para preservar a relação entre DB, ledger e fila. O comando não pausa o serviço automaticamente. A chamada também não é um ensaio de backup do SiteCorp.

## Criar backup

O destino deve ficar fora do workspace. Cada execução cria uma pasta única `pulso-backup-*` dentro do destino:

```bash
node scripts/project-backup.js backup \
  --workspace /home/servidor/Git/youtube_ai \
  --destination /mnt/backup-criptografado/pulso
```

O script lê `.env` para resolver `STATE_DIR` e o caminho do banco, mas não imprime os valores. Ele não faz login, upload ou restart. Antes de uma execução real, confirme que a janela operacional está sem geração/publicação e que o destino pertence a um volume criptografado. Nesta sessão não foi criado backup dos dados operacionais.

## Restaurar sem tocar na produção

Escolha um destino fora do workspace que ainda não exista:

```bash
node scripts/project-backup.js restore \
  --workspace /home/servidor/Git/youtube_ai \
  --snapshot /mnt/backup-criptografado/pulso/pulso-backup-<timestamp>-<uuid> \
  --to /tmp/pulso-restore-2026-10-13
```

Depois confira no diretório restaurado a contagem e o relacionamento entre ledger e arquivos, inicialize o serviço apenas contra a cópia e execute os smokes locais. Nunca substitua DB, fila, página ou assets de produção durante o ensaio.

## Retenção

Há um comando explícito para remover snapshots cujo `createdAt` exceda a idade indicada:

```bash
node scripts/project-backup.js prune \
  --workspace /home/servidor/Git/youtube_ai \
  --destination /mnt/backup-criptografado/pulso \
  --days 30
```

A primeira execução é somente uma prévia: lista snapshots candidatos e não apaga nada. Para aplicar a remoção depois de revisar o prazo e o destino, acrescente `--apply`. Esse comando destrutivo não foi executado fora de fixtures temporárias. O período de 30 dias acima é somente exemplo; defina retenção, cópia externa e carência antes de programá-lo. A rotina não decide se há uma recuperação em curso e não deve ser agendada até essa política ser aprovada.

## Rollback do mascote no SiteCorp

A homepage de referência da imagem instalada é `/media/servidor/nvme_data/pulso/frontend-index-installed-image.html`. Antes de restaurar, confirme que todos os hashes apontados pelo HTML existem no diretório de assets do mesmo release e teste a homepage isolada. Troque HTML e assets como um conjunto, com rollback atômico preparado. `frontend-index-before.html` pertence a outra instalação e não pode ser restaurado sem conferir hashes: houve um incidente anterior de app em branco por incompatibilidade de assets.

O SiteCorp fica fora do workspace padrão do backup. Seu snapshot e rollback precisam de procedimento separado. Não foram executados nesta sessão porque o repositório está sob trava concorrente DolphinFlix; aguarde a liberação e preserve a homepage/assets atualmente instalados.

## Validação local

```bash
node --test tests/project-backup.test.js tests/database-backup.test.js
```

Os testes usam banco e arquivos de fixture temporários e cobrem WAL, cópia privada, restauração SQLite/JSON, hashes, permissões, traversal, symlinks e retenção em uma pasta temporária. Eles não acessam estado operacional, contas, serviços ou uploads.
