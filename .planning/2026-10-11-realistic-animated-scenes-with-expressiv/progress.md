# Progress Log

## Session: 2026-10-11

### Current Status
- **Phase:** 9 - Personagem 3D e prévia visual
- **Started:** 2026-10-11

### Actions Taken
- Li o resumo e localizei o gerador de vídeos animados em `youtube-automation-agent`.
- Confirmei que há muitas alterações anteriores no estado Git e decidi preservá-las.
- Identifiquei a proibição explícita de pessoas nos prompts de imagem como uma lacuna em relação ao pedido.

### Test Results
- Na retomada, `node --check` passou nos arquivos JavaScript alterados e `python3 -m py_compile` passou no renderizador Blender.
- Renderizei e conferi uma prévia local de 55,17 s em H.264/AAC, 1280×720; nenhuma rede social recebeu esse arquivo.

### Errors
| Error | Resolution |
|-------|------------|
| Comando Git na pasta contêiner retornou “not a git repository” | Redirecionado ao repositório `youtube-automation-agent` |

### Discovery update
- A engine troca imagens a cada frase e já anima cada plano; a lacuna de expressões está no prompt `No people` da geração, não na capacidade de captura.
- O render atual escurece cada transição; os componentes HTML já têm as animações de entrada necessárias para cortes limpos.
- Abordagem selecionada: perfil textual estável de apresentadora, expressão por seção e cortes cinematográficos com b-roll contextual; melhorias focadas no roteiro também dão ritmo à narração.

### Implementation update
- Ampliei as instruções de roteiro: gancho curto com payoff, menos repetição e exemplos concretos; adicionei emoção por seção e critérios correspondentes ao editor-crítico.
- Direcionei 3 de cada 4 primeiros enquadramentos para uma apresentadora recorrente em imagens fotorrealistas; os demais continuam como b-roll sem pessoas. A identidade pode ser ajustada por `VIDEO_PRESENTER_PROFILE`.
- Separei a cache de imagens por identidade/estilo, para não reutilizar imagens antigas geradas com a proibição de pessoas.
- O renderer agora reserva fade para a primeira e a última cena do vídeo; os cortes internos preservam a continuidade entre frases.
- Uma primeira aplicação de patch falhou porque o contexto do arquivo não correspondia ao bloco esperado; refiz as alterações em blocos menores.

### Errors
| Error | Resolution |
|-------|------------|
| Patch consolidado do roteiro não encontrou o contexto exato e não aplicou alterações | Reabri as linhas atuais e apliquei o prompt, normalização e crítico em patches menores |
- Identifiquei que roteiro e narração são cacheados por slug; vou separar a nova revisão do cache anterior para reaproveitar os assets com segurança e não mascarar as mudanças nas pautas repetidas.
- Separei cache de script/TTS como `retention-emotions-v2`; ajustei o consumidor de imagens do `clip-maker` para selecionar o cache visual novo e aceitar o antigo como fallback.
- Revisei os caminhos de cache usados na montagem dos Shorts e encontrei uma instrução fixa de estética tecnológica no wrapper do Gemini; vou torná-la editorial/fotorrealista para os dez temas.

### Final review and handoff
- Tornei o wrapper do Gemini independente de estética exclusivamente tecnológica para combinar com os dez temas.
- Documentei como personalizar a apresentadora em `.env` e o que a identidade textual consegue garantir.
- Confirmei no scheduler que cada geração é iniciada em um processo filho: o ciclo já em curso não é interrompido e o próximo carrega o código atualizado sem reiniciar o serviço.
- Revisei manualmente os caminhos de roteiro, narração, imagens e clips verticais. Não rodei testes nem render nesta entrega.
- **Status:** as mudanças anteriores de roteiro e publicação estão preservadas; a inclusão real do personagem 3D e a prévia local foram concluídas nesta retomada.

### Follow-up: navegador invisível
- Inspecionei o serviço `ai-video-scheduler.service`, o scheduler em execução e os caminhos de lançamento do Chromium. O log do processo atual registra `display virtual :99 ativo`; TikTok/X são as únicas plataformas de upload configuradas com browser headed, e Gemini já é headless por padrão.
- O scheduler antigo podia cair no display da sessão se o Xvfb falhasse ou estivesse desativado. Substituí esse fallback por validação real via `xdpyinfo`, inicialização do Xvfb e erro explícito sem display virtual; o display gráfico herdado não é usado.
- Documentei que os comandos de login manual continuam abrindo janela quando exigem interação humana; isso não integra o ciclo recorrente de produção/publicação.
- Não reiniciei o scheduler nem rodei testes/render. O processo atual já está usando `:99`; o código novo passa a proteger também as próximas inicializações.
- **Status:** follow-up implementado e revisado manualmente.

### Auditoria do envio e prévia
- Confirmei no log real que a execução usou `:99`, publicou o vídeo longo e um Short no YouTube, e registrou os três cortes como `ok` em TikTok, Kwai, Instagram e X. A rotina só limpou os arquivos após o registro de sucesso de todas as plataformas.
- A geração mais recente concluiu 50 cenas, 356,9 s, 72,3 MB e 3 cortes verticais. A rotina já publicou o vídeo longo em https://www.youtube.com/watch?v=1go-lXUWX5s e o Short em https://www.youtube.com/watch?v=j9q7mwABW4E; `DELETE_AFTER_UPLOAD=1` removeu o MP4 local.
- Corrigi três pontos para as próximas inicializações: remoção do publish duplicado/antecipado dentro do producer; matching do ledger por caminho absoluto/relativo; status do Instagram só conclui após observar confirmação ou fim do processamento. Corrigi também persistência dos resultados mesmo quando os arquivos são limpos.
- `node --check` passou para `scripts/channel-scheduler.js` e `scripts/upload-to-socials.js`. Não iniciei upload de teste, para não publicar conteúdo duplicado. O processo atual não foi reiniciado.
- **Status:** auditoria, correções e prévia concluídas.

### Retomada: personagem 3D real e prévia de validação
- A revisão anterior só tinha mudado prompts/cache; o vídeo postado não tinha personagem 3D. Corrigi essa divergência com um apresentador procedural em geometria Blender, renderizado em atlas transparente com sete expressões e quatro poses de boca.
- Integrei o atlas ao kit de cenas e ao renderer headless. A expressão muda por seção e a boca acompanha o ritmo das legendas; isso não é sincronização fonética. O apresentador entra nos beats alternados do vídeo longo, não nos cortes verticais.
- Mudei o cache de geração para `retention-emotions-v3-avatar3d`, para pautas repetidas não reaproveitarem roteiro/TTS/imagens da revisão anterior.
- Gerei `data/videos/preview_avatar3d_2026-10-11.mp4`: amostra local de 55,17 s com cenas, imagens de apoio, gráficos, legendas e apresentador. Revisei quadros em 2 s, 18 s e 42 s; o MP4 tem vídeo H.264 e áudio AAC. Não foi publicado.
- O scheduler existente permaneceu ativo. A geração que já estava em andamento começou sob a revisão v2, então não recebe o novo código em memória; os próximos processos filhos carregarão a v3 sem reiniciar o serviço.
- Atualizei a própria skill instalada `browser:control-in-app-browser`: se Chrome não estiver disponível e o usuário não exigiu Chrome, ela orienta selecionar o navegador padrão; se a ferramenta/conector não existir na sessão, a skill informa essa limitação sem fingir que pode instalá-lo.
- **Status:** prévia visual criada e pronta para validação; serviço de produção não reiniciado e nenhuma publicação de teste feita.

### Nova revisão visual: mascote PBR em EEVEE
- A amostra anterior foi rejeitada por aparência de boneco e cabelo em bolinhas. A geometria humana manual foi substituída por um mascote de IA original, com visor expressivo e traje teal/cerâmica.
- O renderizador usa EEVEE com materiais Principled, luzes de área e sprites alfa; o atlas recebe revisão própria para forçar reconstrução automática na próxima geração.
- A cadência de boca foi desacelerada para 125 ms por estado e agora inclui breves fechamentos. As expressões continuam associadas à emoção da seção.
- Renderizei as 28 células (7 emoções × 4 bocas) em EEVEE e instalei `assets/scenes/presenter-atlas.png` com revisão `pulso-mascot-pbr-eevee-v1`.
- Renderizei uma prévia de 9,375 s em 1280×720 H.264/AAC usando o motor de cenas atual e Chromium headless; conferi o quadro de 4 s. A prévia é `data/videos/preview_mascote3d_2026-10-11.mp4` e não foi publicada.
- A geração automática que já estava em andamento completou as cenas e os três cortes; não a interrompi e o scheduler permaneceu ativo. Por ter iniciado antes da atualização, ela não é a validação do mascote novo.
- `node --check` passou nos módulos JS envolvidos e o script Blender passou na análise sintática; o render completo do atlas e do clipe exercitou o fluxo headless. Nenhuma janela visível foi aberta.
- **Status:** mascote instalado para as próximas gerações; amostra local pronta para revisão.

### Ajuste de braços e tórax após feedback
- Redesenhei o tórax para ficar menos largo, removi o disco grande do peito e adicionei um painel curvo menor com frisos cianos.
- Acrescentei membros articulados em Blender com encaixes que continuam o material teal do tronco, juntas douradas, antebraços cerâmicos e luvas; gestos variam entre tensão e admiração.
- Renderizei as 28 células do atlas v2 em EEVEE para `/tmp/pulso-mascot-v2-atlas.png`; mantive o asset instalado v1 intacto enquanto o produtor atual podia estar lendo-o. O código v2 força reconstrução automática no próximo processo.
- Renderizei e revisei `data/videos/preview_mascote3d_bracos_2026-10-11.mp4` (9,25 s, 1280×720, H.264/AAC), sem publicação. As imagens de conferência estão ao lado do vídeo.
- A análise sintática Python e `node --check` passaram. O scheduler continua ativo e não foi reiniciado.
- **Status:** geometria v2 e prévia local concluídas; nenhuma publicação de validação.

### Revisão de profundidade após feedback
- Mudei a câmera do Blender para perspectiva em três quartos e reforcei as luzes de recorte para que visor, laterais da cabeça e juntas revelem volume.
- Afinei a transição entre tórax e pescoço no próprio mesh, removendo o topo reto que parecia um corte; reduzi a abertura das mãos para preservar o enquadramento.
- Renderizei o atlas completo de 28 células em `/tmp/pulso-mascot-v3-atlas.png` e montei `data/videos/preview_mascote3d_perspectiva_2026-10-11.mp4` com duas poses. Revisei quadros aos 2 e 6 s; H.264/AAC, 9,25 s, não publicado.
- `python3` AST, `node --check` e `ffprobe` passaram. O scheduler/job existente não foi parado nem reiniciado; o asset compartilhado ficou intacto e a revisão v3 será reconstruída por processo novo.
- **Status:** prévia 3D em perspectiva pronta para revisão.
