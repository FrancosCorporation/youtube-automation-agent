# Arquivamento seguro de mídia

Este procedimento cria uma cópia íntegra de um arquivo regular de `data/videos/` em armazenamento externo. O comando de arquivamento **não apaga nem altera o original**. A política de retenção, o prazo de guarda e a autorização para remoção continuam pendentes.

## Pré-requisitos

- Use um volume externo montado e criptografado, com espaço e permissões adequados. A ferramenta não detecta nem comprova criptografia do destino.
- Confirme que o caminho de destino está fora do checkout e que o volume está montado antes de executar `archive`.
- Escolha um master ou fonte elegível e confirme que não está sendo escrito por uma geração ativa.
- Preserve ledger, fila, arquivos aguardando retry, fontes necessárias, evidências e qualquer item com estado de publicação incerto.

## Arquivar e verificar

Na raiz `youtube-automation-agent/`, substitua `/mnt/volume-criptografado/pulso` pelo caminho real do volume:

```bash
node utils/media-archive.js archive \
  --root "$PWD" \
  --archive-root /mnt/volume-criptografado/pulso \
  --file data/videos/master-elegivel.mp4
```

O comando informa o SHA-256, o tamanho e se o conteúdo já existia no arquivo. Cada objeto usa o hash como identificador e guarda o manifesto junto da mídia. Para verificar a integridade, use o diretório `objects/<sha256>` informado pelo comando:

```bash
ARCHIVE_OBJECT=/mnt/volume-criptografado/pulso/objects/SHA256_DO_ARQUIVO
node utils/media-archive.js verify \
  --root "$PWD" \
  --archive-dir "$ARCHIVE_OBJECT"
```

## Restaurar sem sobrescrever

Escolha um novo caminho abaixo de `data/videos/`. A restauração verifica hash/tamanho e recusa substituir um arquivo existente:

```bash
RESTORE_TO=data/videos/restaurado/master-elegivel.mp4
node utils/media-archive.js restore \
  --root "$PWD" \
  --archive-dir "$ARCHIVE_OBJECT" \
  --to "$RESTORE_TO"
```

Depois, confira o hash reportado e o arquivo restaurado antes de retomar qualquer fluxo que dependa dele. Restaure primeiro para um nome novo; reconcilie ledger e fila separadamente.

## Limites e retenção

- O utilitário permite apenas formatos de mídia definidos no código, rejeita origens fora de `data/videos/`, destinos de arquivo dentro do workspace, symlinks na raiz gerenciada e restauração sobre arquivo existente.
- Ele mantém a cópia operacional original e não implementa expurgo, sincronização, backup contínuo ou gestão de chaves.
- Não foi arquivada mídia operacional ao criar este procedimento. Os testes usam fixtures sintéticas em diretórios temporários.
- A duração oficial de retenção por tipo de artefato precisa de decisão. Os períodos configuráveis da limpeza atual não equivalem a uma política aprovada.
- Antes de remover qualquer original, exija política aprovada, estado de publicação confirmado por destino, carência cumprida, fontes/evidências protegidas e restauração verificada do objeto arquivado.

## Restauração isolada exercitada — 17/10/2026

Arquivei e restaurei uma cópia do MP4 de integração local `/tmp/pulso-portrait-integration-20261017.mp4` em um workspace temporário. O conteúdo é H.264/AAC, 1080×1920, 30 fps, 4,4 s, SHA-256 `a45e83a1844b103a47298ca451a060caf4a0b9bbc6905917db6e8509d0625438`; manifesto, payload e restauração concordaram em hash e ffprobe. O original ficou intacto e removi o diretório de scratch ao final. Evidência agregada: `evidencias/media-archive-restore-2026-10-17.json`.

Esta é uma prova temporária do ciclo de cópia/verificação/restauração, não um arquivo persistente ou uma validação de política: o volume temporário não era criptografado, nenhum master de produção foi copiado e nenhum original foi removido. Para arquivo operacional real continuam necessários volume criptografado e política aprovada de carência/retenção.
