# Banco de imagens sob demanda

`generateSceneImages` aguarda as durações reais do TTS antes de pedir as variantes necessárias ao conteúdo atual; referências continuam em paralelo. O limite `IMAGES_PER_GROUP` permanece vigente. Consultar o banco não gera imagens e o banco não dispara produção antecipada.

O catálogo SQLite e os arquivos ficam em `data/image-library/` (ou `IMAGE_LIBRARY_DIR`). Cada original gerado é catalogado por hash, tema, assunto, seção, fonte e job. A cópia usa WebP lossless somente quando fica menor e mantém os pixels decodificados idênticos, sem resize; caso contrário preserva o formato original. Originais/cache não são apagados. Imagens de múltiplos frames, orientações especiais ou profundidade incompatível preservam os bytes originais.

O renderer registra quais representações entraram em cada vídeo concluído. `unused` indica sobra conhecida; importação histórica sem prova de uso permanece `unknown`. A importação não transforma imagem em aprovada para publicação.

```bash
npm run images:library -- stats
npm run images:library -- search "DeepSeek busca web" --theme ia
npm run images:library -- search "exercícios equilíbrio" --theme fitness --unused
npm run images:library -- archive data/images/<pauta>/<imagem>.png --theme ia --topic "Assunto" --section "Seção" --generator gemini
npm run images:library -- export <id> --out data/images/<pauta>/reutilizada.webp
```

`export` verifica hashes/pixels e recusa sobrescrever arquivos; use a extensão registrada no resultado. A busca retorna candidatos do tema com relevância textual e metadados de origem. O agente/QA confere compatibilidade com a nova pauta, fatos e conteúdo visual antes de reutilizar: `reviewRequired` não pede aprovação humana. Não reutilizar números, marcas, pessoas ou eventos de outra notícia só porque a imagem contém uma palavra semelhante.

Este é um banco local persistente. Backup externo/restore operacional seguem YAI-017/018: snapshot SQLite consistente e diretório `objects` precisam acompanhar-se. Nenhum expurgo ou migração destrutiva foi ativado.
