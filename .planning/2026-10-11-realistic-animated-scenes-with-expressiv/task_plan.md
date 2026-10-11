# Task Plan: Vídeos com personagens expressivos e ritmo visual

## Goal
Evoluir o gerador automatizado para narrativas visuais mais envolventes, com personagem recorrente, expressões alinhadas ao tom de cada seção e montagem mais fluida, sem interromper o serviço que já está rodando.

## Next Step
Aguardar a validação do usuário para ajustar estilo ou escala, se necessário.

## Current Phase
Phase 11

## Phases

### Phase 1: Requisitos e descoberta
- [x] Ler `resumo.md` e localizar o gerador ativo
- [x] Identificar alterações preexistentes no repositório e preservar o estado
- [x] Documentar o objetivo visual e a arquitetura existente em findings.md
- **Status:** complete

### Phase 2: Planejamento
- [x] Definir o menor conjunto de mudanças com efeito visível e fallback seguro
- **Status:** complete

### Phase 3: Implementação
- [x] Melhorar geração/crítica do roteiro para ganchos e ritmo
- [x] Adicionar perfil recorrente, emoções e cenas realistas com personagem
- [x] Manter fallback quando a geração de imagem falhar ou estiver desativada
- [x] Fazer cortes fluírem sem flashes de preto entre cada frase
- [x] Versionar caches para pautas repetidas adotarem o roteiro novo
- [x] Atualizar o `clip-maker` para os nomes novos do cache visual
- **Status:** complete

### Phase 4: Revisão
- [x] Revisar manualmente as alterações e os consumidores de cache/cortes
- [x] Confirmar que o scheduler gera vídeos em processos filhos e não precisa ser reiniciado
- [x] Não executar render ou testes nesta entrega
- **Status:** complete

### Phase 5: Entrega
- [x] Registrar arquivos, efeito e limitações
- **Status:** complete

### Phase 6: Navegador invisível no scheduler
- [x] Rastrear os lançamentos de Chromium e confirmar a configuração do scheduler ativo
- [x] Isolar o display dos uploads em Xvfb e remover fallback para o desktop do usuário
- [x] Documentar a diferença entre automação recorrente e login manual
- **Status:** complete

### Phase 7: Auditoria de publicação e geração de prévia
- [x] Conferir o display virtual em execução e os resultados reais registrados por plataforma
- [x] Localizar a geração mais recente feita pelo código atualizado e seus links publicados
- [x] Inspecionar o status de confirmação e a limpeza automática dos arquivos
- **Status:** complete

### Phase 8: Integridade da fila e dos status
- [x] Publicar somente no consumer, depois da geração e no slot da fila
- [x] Associar resultados do YouTube e de cada plataforma ao vídeo correto no ledger
- [x] Não retornar sucesso do Instagram sem confirmação de conclusão
- [x] Fazer checagem sintática dos dois arquivos modificados
- **Status:** complete

### Phase 9: Personagem 3D com acabamento e nova prévia
- [x] Substituir o apresentador humano geométrico por um mascote 3D original de IA, com materiais PBR
- [x] Usar iluminação real em EEVEE e revisar quadro no tamanho de vídeo
- [x] Renderizar atlas de sete expressões/quatro bocas e gerar prévia local, sem publicação
- [x] Confirmar que scheduler e geração em andamento continuam intactos
- **Status:** complete

### Phase 10: Braços articulados e peitoral integrado
- [x] Reduzir a silhueta do tronco e encaixar ombros, braços superiores, cotovelos, antebraços e mãos
- [x] Trocar a placa circular por um painel menor que acompanha a curvatura do tórax
- [x] Variar gestos por expressão e renderizar o atlas v2 fora do asset que a execução ativa pode estar lendo
- [x] Gerar prévia local com poses diferentes e conferir quadros, sem publicar nem reiniciar o scheduler
- **Status:** complete

### Phase 11: Mais profundidade no render 3D
- [x] Trocar a câmera frontal ortográfica por perspectiva em três quartos
- [x] Reesculpir o topo do tronco para unir ombros e pescoço sem uma borda reta
- [x] Reforçar luzes de recorte e ajustar os gestos para caber na tela
- [x] Renderizar atlas v3 temporário e conferir vídeo local em duas poses, sem publicar nem interromper o scheduler
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Trocar o rosto humano simplificado por um mascote de IA com visor expressivo | Evita a aparência estranha de boneco, dá uma identidade visual própria ao canal e mantém expressões legíveis em tela pequena |
| Renderizar a malha em EEVEE e montar os estados num atlas transparente | Preserva o renderer automatizado/headless e evita renderizar geometria 3D a cada quadro do vídeo |
| Manter o processo atualmente em execução intocado | O usuário pediu que o projeto continue rodando; o scheduler cria um processo de geração novo por ciclo |
| Trabalhar sobre o estado de trabalho já existente | Muitos arquivos já estão modificados e não pertencem a esta tarefa |
| Usar imagens cinematográficas do Gemini com a mesma descrição de apresentadora ao longo do episódio | Acrescenta rosto e expressões sem adicionar dependência de API ou etapas pagas |
| Marcar emoções por seção e pedir imagens de personagem com expressões complementares | As imagens já alternam a cada frase; novas variações faciais tornam os cortes expressivos |
| Remover fades para preto em todas as cenas | Cada beat já tem entradas visuais; preto repetido entre frases reduz a fluidez |
| Manter imagens temáticas como b-roll em algumas variações | Preserva contexto visual e evita que todo plano vire o mesmo close de rosto |
| Separar caches da revisão de roteiro e narração | Reexecução da mesma pauta passa a usar as novas instruções sem apagar os assets antigos |
| Manter TikTok/X com Chromium headed, mas sempre em Xvfb | Preserva o fluxo de publicação validado e mantém as janelas fora do desktop |
| Interromper a inicialização se o display virtual não estiver disponível | Evita exibir janelas no desktop como fallback; o scheduler ativo não será reiniciado nesta alteração |
| Usar a última geração automática para revisão em vez de criar uma segunda pauta concorrente | A fábrica acabou de renderizar e publicar um vídeo; uma nova execução disputaria a cota Gemini e poderia duplicar conteúdo |
| Deixar o consumer como único ponto de publicação da fila | Evita apagar o MP4 no producer antes do horário de publicação e evita repetição de upload |
| Persistir os retornos por caminho normalizado | O gerador registra o vídeo com caminho absoluto, enquanto o scheduler encaminha um caminho relativo |
| Tratar confirmação de Instagram como requisito para status `ok` | Evita classificar o clique em Compartilhar como publicação concluída quando a tela ainda indica processamento |
| Não reiniciar o scheduler ativo | Mantém a fábrica atual; correções carregam na próxima inicialização do processo |
| Gerar o atlas revisado em caminho temporário enquanto o job atual roda | Evita substituir o atlas que o processo de produção pode estar carregando; a revisão v3 será reconstruída automaticamente por um processo novo |
| Usar câmera em perspectiva com ângulo de três quartos e iluminação de recorte | Mostra espessura do visor, laterais da cabeça e profundidade dos membros sem alterar a composição editorial do vídeo |

## Errors Encountered
| Error | Resolution |
|-------|------------|
| `remotion-pilot` não é repositório Git | Localizado o projeto ativo em `youtube-automation-agent` |
| Patch consolidado do roteiro não encontrou o contexto exato | Reabertas as linhas atuais e alterações aplicadas em blocos menores |
