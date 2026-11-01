# Auditoria dos tokens visuais

**Data:** 13/10/2026, 16h17 (-03, America/Sao_Paulo)
**Escopo:** inspeção estática do kit de cenas, renderer HyperFrames, geração de thumbnails, paletas e verificações locais. Nenhum vídeo foi renderizado ou publicado nesta auditoria.

## Paletas por tema

`config/themes.json` contém dez temas habilitados. Cada um declara três variantes de paleta com quatro acentos, além de uma identidade nomeada. A cor de identidade corresponde ao primeiro acento da primeira variante em todos os dez temas:

| Tema | Identidade | Cor principal |
|---|---|---|
| `ia` | Ciano | `#22D3EE` |
| `curiosidades` | Amarelo | `#FDE047` |
| `dinheiro` | Verde-esmeralda | `#22C55E` |
| `saude` | Branco-gelo | `#F1F5F9` |
| `economize` | Laranja | `#FB923C` |
| `psicologia` | Violeta | `#C084FC` |
| `relacionamentos` | Rosa | `#F472B6` |
| `fitness` | Vermelho | `#F87171` |
| `misterios` | Azul-royal | `#60A5FA` |
| `carreira` | Cobre | `#BFA07A` |

O renderer de vídeo e a thumbnail chamam `selectThemePalette` com a mesma configuração e seed. A seleção usa a variante de `seed % quantidadeDeVariantes`; o primeiro acento alimenta o LED/apresentador e os detalhes coloridos da capa. Uma paleta fornecida pelo roteiro prevalece quando contém variantes; caso contrário, o renderer consulta a configuração do tema.

## Tokens que já existem

`assets/scenes/kit.css` centraliza parte do sistema de cena: fundo `#0A0A0F`, superfícies, texto, cores de destaque, fonte Inter com fallbacks e espaçamento geral de 5% da largura (`--pad`). Tipografia e componentes usam principalmente proporções da largura/altura. `utils/hyperframes-video-renderer.js` incorpora esse CSS, injeta as dimensões e o acento resolvido para cada composição e ajusta apresentador/conteúdo conforme o aspecto.

`utils/presenter-framing.js` define planos e câmera para o apresentador; `utils/portrait-scene-layout.js` reposiciona a fotografia no aspecto vertical. `utils/instagram-video-framing.js` verifica a moldura apresentada no compositor antes do envio. Essas regras são úteis para enquadramento, mas não estão expressas como um contrato comum de margens seguras consumido também pela capa.

## Diferenças ainda abertas

`utils/thumbnail-design.js` gera uma página própria de 1280×720, com fundos `#070b13`/`#101827`, fonte Inter, destaque fixo `#FFD84D`, contorno decorativo e composição editorial. Antes da IMP-20261013-47, essas medidas e a área segura estavam declaradas à parte do kit de vídeo.

`utils/visual-design-tokens.js` agora fornece o contrato base para as duas saídas: família tipográfica Inter com fallbacks próprios por contexto, fundo de vídeo, recuo proporcional do kit, dimensões e posições da capa, cor de destaque e limites de encaixe do título. O kit e o renderer recebem as variáveis CSS desse módulo; a thumbnail e o redimensionador do headline usam os mesmos valores centrais. As medidas antigas foram mantidas, então esta alteração centraliza a fonte dos valores sem redesenhar as composições.

O contraste testado cobre os quatro acentos de cada variante sobre o fundo de vídeo; isso não prova contraste de todos os textos e efeitos da thumbnail, legibilidade sobre imagens, nem resultado em cada tamanho de tela. A matriz visual dos dez temas nos dois aspectos também não foi capturada nesta sessão.

## Verificação executada

`node --test tests/theme-visual-tokens.test.js` passou com 2/2 testes. As asserções verificam dez temas habilitados e IDs únicos, três variantes por tema, quatro acentos válidos e distintos por variante, escolha determinística por seed, identidade alinhada à primeira variante e razão de contraste mínima de 4,5 dos acentos sobre o fundo do vídeo.

O teste de browser `tests/presenter-framing.js` existe e cobre composição nos aspectos horizontal e vertical, mas não foi executado nesta sessão. O scheduler de produção permanecia ativo, então evitei abrir uma carga adicional de Chromium/software rendering. A inspeção estática identificou seus utilitários correspondentes, sem alegar validação nova de enquadramento.

## Próxima etapa para concluir YAI-027

1. Completar a matriz de contrastes de texto e áreas seguras para 16:9 e 9:16, incluindo overlays de cada plataforma apenas quando seus requisitos forem verificados.
2. Capturar exemplos visuais do kit e das capas com a mesma seed em todos os dez temas, depois revisar legibilidade sobre imagens e composição em tamanho reduzido.
3. Incorporar o apresentador e novos elementos da UI somente quando consumirem tokens compatíveis, sem mudar a identidade de cada tema.

YAI-027 permanece **Parcial**: paletas de cor, família tipográfica base, fundo de vídeo, área segura proporcional e geometria editorial da capa agora têm fonte central e paridade de código testada. A validação visual combinada, contraste de todos os textos/efeitos, overlays de plataforma e consumidor de tokens no apresentador continuam pendentes.

## Continuação — capas temáticas (13/10/2026, 16h29)

Após o pedido do usuário por capas mais chamativas e fiéis ao vídeo, a imagem da thumbnail passou a receber somente no HTML da capa um realce leve (`saturate(1.42)`, `contrast(1.12)`, `brightness(1.14)`). A imagem original continua sendo entregue ao renderer; o gancho curto é passado ao renderizador somente depois que o MP4 foi renderizado, sem alterar roteiro, narração, cortes ou frames.

Uma amostra de cada um dos dez temas foi renderizada em Chromium headless a 1280×720 e reduzida a 320×180. A inspeção da folha de contato em `/tmp/yai-thumb-click-qa/contact-sheet-320.png` confirmou leitura do texto nos dez casos e imagens relacionadas a cada assunto. Os ganchos usados vieram do conjunto de QA existente; a renderização não gerou vídeo, acessou contas nem publicou conteúdo. O teste de headline continua validando ancoragem lexical e preservação de negação/incerteza (`tests/thumbnail-design.test.js`, 8 cenários de thumbnail, além da paleta de dez temas).

Esta amostra não compara cada PNG com o primeiro frame do MP4 correspondente nem mede CTR. O realce é restrito à capa e não integra um contrato compartilhado de tipografia/área segura; portanto, YAI-027 e YAI-062 continuam parciais. A validação de métricas depende de impressões suficientes e das contas próprias.

## Continuação — contrato comum de tokens (13/10/2026)

`utils/visual-design-tokens.js` agora centraliza fonte, fundo, superfícies, borda, texto, cor neutra, fallback de acento e dimensões/áreas da capa. `sceneCssTokens()` injeta os tokens comuns na composição HyperFrames; `assets/scenes/kit.css` consome superfícies, borda, texto, muteds e fallback de acento por variáveis. `thumbnailCssTokens(accent)` usa a mesma pilha de fonte e cores base, mantendo dimensões e área segura próprias do formato da capa. O destaque da chamada passou a usar o acento do tema, em vez de amarelo fixo.

`tests/theme-visual-tokens.test.js` foi ampliado para conferir a paridade do contrato, consumo pelo kit, acento por tema e fallback inválido. Os testes de composição e miniaturas são estáticos; não foi aberta outra renderização Chromium enquanto `generate-animated-video.js --auto` estava ativo. YAI-027 avança, mas permanece parcial até revisar amostras reais dos dez temas nos dois aspectos e registrar contraste/área segura sobre fundos e fotos reais.

## Contrato compartilhado de estilo — IMP-20261013-47 (13/10/2026)

`utils/visual-design-tokens.js` passou a declarar valores comuns usados pelo renderer e pela capa. `assets/scenes/kit.css` consulta a família tipográfica, fundo e recuo seguro pelo contrato injetado em `createCompositionHtml`; `utils/thumbnail-design.js` e `scripts/generate-animated-video.js` compartilham dimensões de 1280×720, encaixe do headline, margens e cor de destaque. Os valores efetivos anteriores foram preservados. `tests/visual-design-tokens.test.js` confere CSS gerado em 1920×1080 e 1080×1920, variáveis consumidas e limites de layout; junto aos testes de paridade da paleta, headline e thumbnail, 14/14 passaram. ESLint dos seis arquivos tocados passou sem avisos.

Não houve render ou screenshot nesta implementação. A matriz visual dez temas × dois aspectos, contraste do texto sobre imagens, área segura específica de cada plataforma e uso dos tokens pelo apresentador ainda faltam; YAI-027 segue Parcial e YAI-036 permanece Validação pendente.

## Revalidação da matriz — IMP-20261013-67

`tests/theme-visual-matrix.js` agora renderiza as dez identidades do canal em 1920×1080 e 1080×1920 usando Chromium/SwiftShader. As 20/20 combinações passaram: acento pertence à paleta escolhida, o contraste do acento contra o fundo-base atende ao teste, o branding é da identidade selecionada, o canvas do apresentador aparece e os cartões permanecem dentro do painel/tela sem overflow textual. As capturas e os resultados ficam em `docs/evidencias/theme-visual-matrix-2026-10-13/`; as amostras IA wide/tall foram inspecionadas.

A lacuna anterior da matriz sintética foi removida. Ela usa fundo escuro-base e canvas na resolução de composição; ainda não substitui contraste do texto sobre fotografias reais, overlays/safe areas de cada plataforma nem inspeção em celulares físicos. Por isso YAI-027 e YAI-036 continuam parciais. Thumbnails também têm prévias sintéticas por tema em `docs/evidencias/thumbnail-theme-matrix-2026-10-13/`, mas isso não conta como amostra fotográfica real nem como aceite do vídeo produzido.

## Contraste sobre fotografias — IMP-20261014-09 (13/10/2026)

`scripts/audit-photo-overlay-contrast.js` analisou 36 assets locais `g0a-visual` distribuídos pelos dez temas. Para cada imagem, fez o recorte central `object-fit: cover` e reduziu a cópia de medição a 256×144; compôs os pixels da região inferior (y=0,80–1,00) com os dois scrims definidos por `.img-hero .veil` e `.scene.hero::after` em `assets/scenes/kit.css`. Comparou texto principal `#F5F5F7`, secundário `#9CA3AF` e todos os acentos configurados do tema, usando razão WCAG mínima de 4,5:1. O menor resultado global foi 15,732:1 para texto principal, 6,747:1 para secundário e 5,217:1 entre os acentos; 36/36 imagens passaram sem falhas. O JSON com dimensões, arquivos, coordenadas e mínimos por cor está em `docs/evidencias/theme-photo-overlay-contrast-2026-10-14.json`; execução: `node scripts/audit-photo-overlay-contrast.js data/images docs/evidencias/theme-photo-overlay-contrast-2026-10-14.json`.

O escopo corresponde à legenda ancorada ao rodapé do kit hero. A simulação offline não cobre cenas `portrait-photo`, antialias de glifos, outras posições de conteúdo, diferenças de GPU/display nem aceite humano em aparelho físico; YAI-036 continua parcial até essa validação.

### Complemento — tokens e fundo das palavras destacadas

Na continuação IMP-20261014-09, os stops do véu fotográfico e a geometria/opacidade do scrim inferior foram centralizados em `utils/visual-design-tokens.js`; o CSS do kit e este auditor consomem a mesma configuração. As palavras coloridas da legenda também recebem o fundo escuro tokenizado `captionKeywordScrimAlpha=0.96`. O relatório JSON foi refeito após essa alteração e continua em 36/36 imagens aprovadas; os mínimos finais permanecem 15,732:1 (texto principal), 6,747:1 (texto secundário) e 5,217:1 (acentos com o fundo de palavra). Esse ajuste torna explícito o backing empregado na medição, sem ampliar a cobertura além do rodapé `hero`.

## Fallback do apresentador alinhado à capa — IMP-20261015-93

`VISUAL_DESIGN_TOKENS.presenter.fallbackAccents` centraliza o fallback do apresentador em uma lista cujo primeiro item é `color.fallbackAccent`. O renderer HyperFrames, o presenter legado/preview e o presenter Bonito de produção usam a mesma lista somente quando não há paleta temática válida. Isso remove o desacordo ciano/azul do caso de fallback sem mudar nenhuma das dez paletas configuradas. O acento azul continua sendo a identidade fallback da thumbnail.

`node --test tests/visual-design-tokens.test.js tests/theme-visual-tokens.test.js tests/thumbnail-design.test.js` passou 19/19. O bundle de produção do presenter foi construído por esbuild para `/tmp/yai027-presenter-fallback.js`; ESLint, `node --check` e `git diff --check` passaram. Não houve navegador nem render. Continuam pendentes contraste/amostragem visual combinada, zonas seguras de cada plataforma e revisão em aparelho físico.

O entrypoint ESM do piloto também passou por bundle esbuild em memória (`write:false`, 1.913.696 bytes), sem sobrescrever o bundle versionado/gerado do experimento.
