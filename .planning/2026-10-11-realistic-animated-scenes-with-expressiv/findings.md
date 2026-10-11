# Findings & Decisions

## Requirements
- O projeto já está rodando e deve continuar rodando.
- O usuário quer vídeos mais envolventes, dinâmicos e visualmente agradáveis, com personagens e expressões durante a renderização.
- Implementar melhorias de forma autônoma no pipeline existente.
- “Viralizar” é um objetivo de desempenho, sem garantia; melhorar ganchos, ritmo e clareza visual de forma mensurável pelo design.

## Research Findings
- `resumo.md` identifica `youtube-automation-agent/scripts/generate-animated-video.js` como gerador usado em produção.
- O estado Git do projeto já contém numerosas alterações do trabalho anterior (tracked e untracked); preservar e editar o estado atual.
- `utils/animated-scene-renderer.js` converte beats/frases em cenas HTML capturadas frame a frame, com captions, cards, gráficos, layouts e imagens rotacionadas.
- `scripts/generate-animated-video.js` gera várias imagens via Gemini Web por seção; o prompt final acrescenta `No people`, então atualmente os personagens são excluídos.
- O kit `assets/scenes/kit.js` e `kit.css` define os componentes que podem receber animação determinística no tempo.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Avaliar um componente de personagem vetorial determinístico com emoções e fala por beat, integrado ao kit de cenas | Permite expressão legível e previsível sem exigir API paga adicional ou alterações ao uploader |
| Usar uma bíblia visual estável por tema/canal nos prompts de imagem e permitir pessoas apenas nas cenas adequadas | Corrige a proibição atual e reduz variações abruptas, mantendo variedade contextual |
| Ligar os estados emocionais à fala/categoria de beat e usar animação temporal determinística | A captura usa `renderAt(ms)` e precisa produzir os mesmos frames, sem timers reais |
| Não reiniciar nem chamar o serviço ativo nesta entrega | Evita interromper a operação; o processo existente carregará a atualização no próximo ciclo de execução |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Uma inspeção inicial tentou Git na pasta contêiner, que não é o repositório | Usar `youtube-automation-agent` como raiz Git |

## Resources
- `../resumo.md`
- `scripts/generate-animated-video.js`
- `utils/animated-scene-renderer.js`
- `assets/scenes/kit.js`
- `assets/scenes/kit.css`
- `docs/especificacao-estilo-animado.md`

## Architecture Notes
- `assets/scenes/kit.js` aplica animações por `window.renderAt(ms)`; o gerador já faz hard cuts por frase e movimento Ken Burns nas imagens.
- `utils/animated-scene-renderer.js` introduz fade in e fade out para cada MP4 de frase antes de concatenar; isso cria transições escuras repetidas. Cards, legendas e imagens já têm suas próprias animações de entrada.
- O script atual pede 5–7 seções longas e fala em retenção de forma genérica. O crítico revisa gancho, naturalidade, fatos, conclusão e tamanho, sem checar concisão inicial ou repetição de ideias.
- O gerador de imagens já cria várias variantes por seção e o renderer as alterna por beat, então expressões e enquadramentos podem mudar sem gerar mais imagens ou adicionar chamadas.
- A configuração por tema tem personas e marca, mas identidade de personagem ainda não existe. A descrição visual será um perfil único de apresentadora, editável por variável de ambiente.

## Implementation Plan
- Estender o schema JSON de roteiro com `emotion` por seção e `hookEmotion`; normalizar com heurística quando o modelo não preencher.
- Reescrever o prompt para um gancho curto e honesto, payoff, progressão de ideias, exemplos concretos e variação de emoção; atualizar o editor-crítico.
- Inserir a descrição estável da apresentadora em enquadramentos de personagem e gerar b-roll sem pessoas em outras variantes; usar emoções derivadas do roteiro.
- Versionar o nome dos arquivos de cache de imagem para não reciclar os frames antigos sem pessoas.
- Aplicar fade apenas no começo e no final do vídeo; manter animações locais e cortes entre os beats.
- Preservar imagens desativadas/indisponíveis como fallback já existente.
- O roteiro e o TTS também são cacheados por slug. Para que uma pauta repetida receba as novas instruções sem reaproveitar o texto/áudio antigo, a revisão do prompt precisa de um namespace de cache próprio.
- O perfil textual da apresentadora orienta consistência, mas geração independente de imagens não garante identidade facial perfeita. Um fluxo com imagem de referência é uma possível evolução se a avaliação dos primeiros vídeos mostrar drift excessivo.

## Final State
- O roteiro, a crítica, a direção de imagens e o renderer headless foram preservados; o apresentador agora é um mascote 3D original de visor expressivo.
- O atlas de 28 células foi renderizado com geometria 3D, materiais Principled, luzes de área e EEVEE. O renderer usa o atlas transparente como sprite sheet e alterna emoção/poses de boca pela legenda; não é um rig facial com captura fonética em tempo real.
- A versão de cache mudou para `retention-emotions-v4-robot3d`; a revisão `pulso-mascot-pbr-eevee-v1` faz o próximo processo reconstruir o atlas se estiver desatualizado.
- A prévia local `data/videos/preview_mascote3d_2026-10-11.mp4` tem 9,375 s, 1280×720, H.264/AAC. Foi gerada pelo renderer atual com Chromium headless, sem janela e sem publicação.
- O scheduler não foi reiniciado. A execução que já estava ativa terminou a geração e os três cortes, com a revisão carregada no início; as próximas gerações usam o mascote novo.
- Os prompts de imagem permanecem focados em objetos/cenários da pauta; não foram adicionados provedores ou chamadas pagas para criar o personagem.

## Revisão visual do tronco e dos braços
- A crítica do usuário correspondeu ao quadro: antes, a personagem tinha uma placa circular grande, ombreiras soltas e braços pouco definidos.
- O script Blender agora usa braços em segmentos sobrepostos (manga superior teal, juntas, antebraço cerâmico e luva), reduz o painel do peito para uma peça curva com frisos e inclui gestos por emoção.
- O gerador de atlas mudou para `pulso-mascot-pbr-eevee-v2-arms-torso`; assim, o próximo processo detecta a revisão e reconstrói os 28 sprites.
- Para não alterar arquivos que o job automático recém-iniciado possa estar lendo, o atlas v2 foi montado em `/tmp/pulso-mascot-v2-atlas.png`. A revisão/atlas instalados continuam v1 até o próximo processo fazer a troca sob demanda.
- A prévia `data/videos/preview_mascote3d_bracos_2026-10-11.mp4` usa duas poses (tensão e admiração), tem 9,25 s, 1280×720, H.264/AAC e não foi publicada. Conferi quadros aos 2 e 6 s.
- O scheduler e o processo automático em andamento permaneceram ativos. O novo processo usará a revisão v2, sem reinicialização manual.

## Revisão de perspectiva e profundidade
- O quadro anterior era frontal e ortográfico; mesmo com geometria Blender, a pouca perspectiva fazia o mascote parecer um boneco plano.
- A revisão v3 usa câmera em perspectiva a três quartos, lente longa, luz principal quente e recortes traseiros ciano/âmbar. O topo do tronco foi estreitado em direção ao pescoço para eliminar a borda horizontal de peça cortada.
- Reduzi a abertura das poses de surpresa e admiração para manter as mãos dentro do atlas portrait.
- O atlas completo v3 está em `/tmp/pulso-mascot-v3-atlas.png` e tem revisão `pulso-mascot-pbr-eevee-v3-perspective-studio`. O arquivo compartilhado em `assets/scenes` ficou intacto porque há um produtor automático em andamento; código com revisão nova força o rebuild por um processo novo.
- A prévia `data/videos/preview_mascote3d_perspectiva_2026-10-11.mp4` tem 9,25 s em 1280×720 H.264/AAC; mostra duas poses, foi revisada aos 2 e 6 s e não foi publicada.

## Navegador invisível — follow-up
- O serviço do usuário aponta para `scripts/channel-scheduler.js`; o processo está em execução e o log confirma o display virtual `:99` ativo. O fluxo de upload configura TikTok/X como headed e demais redes headless; Gemini Web também é headless por padrão.
- A implementação anterior tentava Xvfb, mas podia continuar com o display físico se Xvfb não estivesse disponível. O scheduler agora confirma conectividade com `xdpyinfo`, inicia Xvfb se necessário e não usa o display herdado. Sem Xvfb, a inicialização falha de forma explícita para evitar janelas no desktop.
- Os logins manuais permanecem interativos porque exigem autenticação humana; eles não rodam em cada ciclo automático.
- O scheduler ativo não foi reiniciado. Ele já roda em `:99`; a verificação estrita de Xvfb fica ativa após a próxima inicialização normal.

## Auditoria do fluxo de publicação
- A execução real mais recente gerou 50 cenas (~356,9 s), aprovou o QA (72,3 MB), publicou o longo e um Short no YouTube e registrou os três cortes como `ok` em TikTok, Kwai, Instagram e X. O log mostra Xvfb `:99` ativo antes do upload; nenhuma janela foi aberta no desktop pelo scheduler.
- O MP4 e os cortes foram removidos por `DELETE_AFTER_UPLOAD=1`; os links de publicação continuam disponíveis para revisão: `1go-lXUWX5s` (longo) e `j9q7mwABW4E` (Short).
- A revisão do scheduler encontrou um publish dentro de `generate()` além do publish do consumer. Isso permitia publicar e limpar os arquivos antes de a fila consumi-los. Removi o publish do producer para deixar o consumer como único ponto de publicação.
- A entrada do ledger guarda caminhos absolutos, mas o scheduler passa caminhos relativos a `markYouTubeDone` e `markResults`; normalizei ambos os lados e passei a salvar resultados antes da limpeza.
- A função de Instagram podia retornar `ok` mesmo se o spinner nunca sumisse ou o botão de compartilhar não existisse. Agora exige confirmação e devolve erro se exceder o timeout.
- O scheduler em memória não foi reiniciado; essas correções de processo entram na próxima inicialização normal. As duas alterações JavaScript passaram por `node --check`; não houve upload de teste nem nova renderização nesta etapa.

## Retomada: personagem 3D e validação visual
- A primeira implementação tinha mudado prompts e retenção, mas não renderizava um personagem 3D. O vídeo publicado anteriormente, portanto, não continha essa melhoria.
- O pipeline agora constrói um atlas de um personagem procedural em 3D com Blender: 7 expressões, 4 formas de boca, transparência e textura de cachos distribuída na geometria. A engine escolhe expressão por emoção da seção e muda a boca junto da palavra ativa da legenda; não há animação facial fonema a fonema.
- O kit HTML inclui o apresentador em beats alternados do vídeo horizontal, preserva a rota headless e aguarda o carregamento do atlas antes de capturar quadros. O atlas é criado sob demanda se ainda não existir. Os cortes verticais não recebem o avatar para conservar a área útil.
- O namespace de cache do pipeline mudou para `retention-emotions-v3-avatar3d`. A geração automática que já estava em andamento antes da mudança permanece em execução com a revisão v2; não reiniciei o scheduler. Novas gerações iniciadas por processos filhos usarão a v3.
- A prévia não publicada `data/videos/preview_avatar3d_2026-10-11.mp4` tem 55,17 s, 1280×720, H.264 e AAC. Foi renderizada com áudio/legendas/imagens já existentes e o novo atlas, sem upload. Quadros foram conferidos em 2, 18 e 42 s.
- Verificações executadas: `node --check` nos módulos JS alterados, `python3 -m py_compile` no script Blender e `ffprobe` na saída. A geração do atlas e do clipe exercitou o caminho de captura headless; não houve teste de publicação.
- A skill instalada `browser:control-in-app-browser` recebeu uma instrução para não tratar “Chrome not available” como falta da skill: quando Chrome não foi explicitamente exigido, deve escolher o navegador padrão disponível; se o conector/ferramenta estiver ausente na sessão, não há como a skill habilitá-lo.
- **Estado atual:** o serviço continua ativo, a prévia está disponível para revisão e não foi publicado nenhum vídeo desta validação.
