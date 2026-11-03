# Critérios de aceite dos 63 objetivos Pulso

Contrato de escopo extraído do catálogo original em 17/10/2026. Não é uma segunda fila: estados e próximas ações ficam exclusivamente em [plan.md](../plan.md). As dependências abaixo são as históricas; limitam a integração/aceite correspondente, sem impedir preparação e testes isolados.

Os critérios são preservados literalmente para não reduzir a entrega durante a reorganização. Versões, contagens de testes e fotografias mencionadas são históricas, não exigência de retornar a uma versão antiga. Decisões posteriores registradas no plano prevalecem: adiar não equivale a implementar; Telegram desativado não precisa ser ativado para fechar outro objetivo. Uma evidência antiga pode continuar válida se cobre o mesmo código/artefato e ambiente exigido.

Fontes: [catálogo original](archive/plan-historico-ate-2026-10-16.md) e [plano v2 integral](archive/plan-v2-antes-revisao-2026-10-17.md). Para recuperar evidências, procurar o ID nestes arquivos ou em `resumo.md`; não ler o histórico inteiro a cada retomada.

<a id="yai-001"></a>
## YAI-001 — Alinhar dependências e preparar áudio reproduzível

**Dependências históricas:** —.
- **Conclusão objetiva:** Clone limpo em Node 22+ e venv neural reproduzem módulos, ferramentas e modelos; smoke valida voz/alinhamentos/transcrição em CPU; rollback fica documentado antes da implantação coordenada, fora de geração/upload. Divergência do runtime ativo só fecha depois de alinhar o ambiente persistente sem interromper trabalhos.

<a id="yai-002"></a>
## YAI-002 — Corrigir escopo e erros próprios do ESLint

**Dependências históricas:** —.
- **Conclusão objetiva:** `npm run lint` termina com zero erros e avisos; código próprio continua coberto e as variantes excluem somente bundles gerados.

<a id="yai-003"></a>
## YAI-003 — Fechar configuração insegura da API do painel

**Dependências históricas:** —.
- **Conclusão objetiva:** Bind remoto sem chave falha antes da inicialização e rotas privadas retornam 401/503 conforme configuração; loopback sem chave continua local; teste verifica leitura autenticada, health público e rejeição de configurações/perfis inválidos antes de persistir.

<a id="yai-004"></a>
## YAI-004 — Tornar orçamento de chamadas atômico

**Dependências históricas:** —.
- **Conclusão objetiva:** Concorrência entre processos não passa do limite; reserva antecede HTTP e conta tentativas; corrupção bloqueia uso e preserva o arquivo; testes usam estado temporário e verificam UTC/permissão privada.

<a id="yai-005"></a>
## YAI-005 — Validar scheduler e persistir posição dos temas

**Dependências históricas:** —.
- **Conclusão objetiva:** Reinício mantém o tema seguinte; zero temas e valores não finitos/fora de faixa falham com mensagem clara antes de gerar; estado corrompido cancela a execução e tema salvo desativado retorna ao primeiro ativo; fixture offline cobre retomada. Valores aceitos: 1–1.440 vídeos/dia (mínimo de um minuto por slot), 1–3.650 dias de recap e fase de 0–1.439 minutos. A validação preserva 60/dia e não muda a meta operacional.

<a id="yai-006"></a>
## YAI-006 — Persistir confirmação verificável por plataforma

**Dependências históricas:** —.
- **Conclusão objetiva:** `ok`, clique, envio iniciado e status desconhecido não liberam limpeza; registro confirmado exige plataforma, artefato, horário e evidência observada; URL/ID são guardados quando disponíveis; teste de perfil real documenta o alcance dos sinais.

<a id="yai-007"></a>
## YAI-007 — Evitar duplicação após publicação interrompida

**Dependências históricas:** YAI-006.
- **Conclusão objetiva:** Fixtures de queda antes/depois da confirmação resultam em no máximo uma postagem por destino; ambiguidade gera revisão; destinos já confirmados não são reenviados; códigos de cota/limite só ficam retryable quando a API comprova rejeição do pedido.

<a id="yai-008"></a>
## YAI-008 — Recuperar falhas das redes além do YouTube

**Dependências históricas:** YAI-006, YAI-007.
- **Conclusão objetiva:** Um corte falho é retomado apenas na rede pendente; cota/login/ambiguidade têm estados distintos; lote antigo tem inventário agregado e continua fora da fila automática até novo pedido específico.

<a id="yai-009"></a>
## YAI-009 — Limitar e paginar legendas longas com QA

**Dependências históricas:** —.
- **Conclusão objetiva:** Ordem, palavras, limite por bloco, timing e duração são preservados; a fonte real com seed/áudio/imagens recuperáveis passou no HyperFrames 0.8.149 em 16:9 e 9:16. A execução foi `validateOnly`, sem render de MP4.

<a id="yai-010"></a>
## YAI-010 — Executar testes do pipeline real na CI com isolamento

**Dependências históricas:** YAI-002.
- **Conclusão objetiva:** `test:ci` isola DB/estado, suprime dotenv e credenciais, executa testes de aplicação, smoke, concorrência, 31 testes Python e dois testes Chromium; não escreve no estado real nem envia notificações. CI remota requer execução no push/PR.

<a id="yai-011"></a>
## YAI-011 — Cobrir cues, silêncio e seeks dos visemas

**Dependências históricas:** YAI-001.
- **Conclusão objetiva:** Casos válidos/inválidos, silêncio e seeks repetidos são cobertos offline; aborto encerra helper da tarefa; áudio-fonte e cues continuam rastreáveis por hash.

<a id="yai-012"></a>
## YAI-012 — Ampliar testes da API de voz do mascote

**Dependências históricas:** —.
- **Conclusão objetiva:** Fixtures demonstram 429/Retry-After entre rotas, preservação da resposta textual e término dos processos próprios; limites de áudio/texto são verificados.

<a id="yai-013"></a>
## YAI-013 — Revalidar conversa e gravação reais da versão neural

**Dependências históricas:** YAI-012, YAI-041.
- **Conclusão objetiva:** Evidência sem interceptação inclui conversa, reprodução e pausa/fechamento em desktop/mobile e gravação com base; indisponibilidade é registrada sem reiniciar treinamento.

<a id="yai-014"></a>
## YAI-014 — Revalidar WebLLM após reforço de cancelamento

**Dependências históricas:** —.
- **Conclusão objetiva:** Duas respostas locais verificadas; nenhuma nova chamada bloqueada; cancelamento libera worker; incompatibilidade aparece como guia identificado, com cooldown.

<a id="yai-015"></a>
## YAI-015 — Incorporar QA portátil de voz e tutorial

**Dependências históricas:** YAI-012.
- **Conclusão objetiva:** Um comando documentado executa os quatro casos sem caminhos pessoais fixos; relatório separa fixture de inferência real e guarda screenshots no destino configurado.

<a id="yai-016"></a>
## YAI-016 — Atualizar runbooks de produção e mascote

**Dependências históricas:** YAI-001.
- **Conclusão objetiva:** Caminhos e comandos correspondem ao código; diferenças vídeo/site/voz local estão explícitas; disponibilidade e validações pendentes não são declaradas concluídas.

<a id="yai-017"></a>
## YAI-017 — Preparar backup, restauração e rollback

**Dependências históricas:** —.
- **Conclusão objetiva:** Restauração em diretório/ambiente separado valida DB/JSON e assets; backup protege segredos e possui retenção; não restaura cegamente frontend-index-before.html.

<a id="yai-018"></a>
## YAI-018 — Formalizar retenção e arquivo de masters/fontes

**Dependências históricas:** YAI-006, YAI-007, YAI-017.
- **Conclusão objetiva:** Simulação da política preserva tudo pendente, fontes necessárias e provas; remove apenas elegíveis após carência; restauração de um master arquivado é demonstrada.
- **Acréscimo autorizado em 18/10:** banco local de imagens geradas/sobras com compressão sem perda, resolução/pixels preservados, metadados por assunto/tema/fonte, deduplicação e uso rastreado. Gerar para a demanda atual, sem lotes antecipados; consulta/exportação permitem seleção editorial posterior pelo agente. Não confundir esse banco com conclusão do backup/expurgo dos masters.

<a id="yai-019"></a>
## YAI-019 — Consolidar marca e mapa real de contas

**Dependências históricas:** —.
- **Conclusão objetiva:** Mapa datado identifica conta por destino e temas atendidos; nomes/bios aprovados; handles preservados; alterações públicas ficam para execução autorizada.

<a id="yai-020"></a>
## YAI-020 — Auditar fontes e metadados por tema

**Dependências históricas:** YAI-019.
- **Conclusão objetiva:** Fixture por tema seleciona fonte e metadados coerentes; não depende de uma única conta presumida; mudança de nichos fica registrada como decisão a confirmar.

<a id="yai-021"></a>
## YAI-021 — Definir cadência viável e orçamento de operação

**Dependências históricas:** YAI-004.
- **Conclusão objetiva:** Relatório mede capacidade, erros e orçamento em janela datada; meta escolhida fica explícita; scheduler/configuração/documentos concordam sem alteração nesta auditoria.
- **Continuidade pedida em 24/10/2026:** medir o serviço real, inclusive espera por recursos, recuperação após restart e próximo ciclo sem intervenção de um assistente programador. Retry preserva prazo e identidade de tentativa; fonte reprovada não vira publicação. Cadência configurada de 60/dia não é throughput comprovado. Critérios e lacunas em [workflow-autonomo.md](workflow-autonomo.md).

<a id="yai-022"></a>
## YAI-022 — Avaliar formatos e duração por rede

**Dependências históricas:** YAI-019, YAI-023.
- **Conclusão objetiva:** Capacidade/limites oficiais atuais são verificados; controles de full X e limpeza têm fixtures; formatos novos têm avaliação explícita e métrica prévia.

<a id="yai-023"></a>
## YAI-023 — Conectar métricas existentes à produção animada

**Dependências históricas:** YAI-006, YAI-026.
- **Conclusão objetiva:** Um vídeo animado possui snapshot real identificado e janela datada; dado ausente/simulado não vira zero nem recomendação; limitações de cada rede são registradas.

<a id="yai-024"></a>
## YAI-024 — Executar e registrar experimentos de conteúdo

**Dependências históricas:** YAI-023.
- **Conclusão objetiva:** Cada teste tem comparação de um fator, métrica definida antes, dados reais e conclusão ou inconclusivo; não promete viralização; publicação depende do pedido de execução.

<a id="yai-025"></a>
## YAI-025 — Aplicar aprendizado aprovado ao scheduler real

**Dependências históricas:** YAI-023, YAI-024.
- **Conclusão objetiva:** Somente recomendações aprovadas alteram planejamento; mudança possui métrica/evidência e rollback; simulação insuficiente não orienta produção.

<a id="yai-026"></a>
## YAI-026 — Decidir relação entre os dois pipelines

**Dependências históricas:** —.
- **Conclusão objetiva:** ADR enumera dono de geração/publicação e ponte de dados; nenhuma exclusão sem alternativa; README distingue comandos e testes por fluxo.

<a id="yai-027"></a>
## YAI-027 — Formalizar tokens e consistência visual

**Dependências históricas:** —.
- **Conclusão objetiva:** Vídeo e thumbnail usam os mesmos tokens documentados; dez temas mantêm identidade; checks de contraste e enquadramento são registrados.

<a id="yai-028"></a>
## YAI-028 — Adicionar SFX com procedência e mixagem

**Dependências históricas:** YAI-027.
- **Conclusão objetiva:** Manifest registra fonte/licença/hash; seek não duplica sons; mix não clipa nem encobre fala; comparação audível documentada.

<a id="yai-029"></a>
## YAI-029 — Avaliar bumper e stinger de marca

**Dependências históricas:** YAI-027, YAI-028.
- **Conclusão objetiva:** Protótipo próprio tem duração/uso explícitos e comparação planejada; adoção ocorre após avaliação; não repete saudação nem sacrifica promessa inicial.

<a id="yai-030"></a>
## YAI-030 — Fechar componentes visuais pendentes

**Dependências históricas:** YAI-027.
- **Conclusão objetiva:** Cada incremento tem exemplo local, seek repetível e layout/contraste nos dois aspectos; só entra no pipeline após QA próprio.

<a id="yai-031"></a>
## YAI-031 — Padronizar tratamento e recorte de imagens

**Dependências históricas:** YAI-027.
- **Conclusão objetiva:** Amostras reais de foto/print/render mostram ganho aprovado; fontes ficam legíveis e atribuídas; crop não omite contexto necessário; escolhas são reproduzíveis.

<a id="yai-032"></a>
## YAI-032 — Variar gancho e prosódia com alinhamento explícito

**Dependências históricas:** YAI-009.
- **Conclusão objetiva:** Fixtures cobrem templates, português e limite de palavras; provider e alinhamento real/interpolado/estimado ficam registrados sem chamar alinhamento interpolado de exato; qualquer mudança posterior de velocidade é deliberada e revalida áudio/legendas.

<a id="yai-033"></a>
## YAI-033 — Obter avaliação final da demo neural

**Dependências históricas:** —.
- **Conclusão objetiva:** Avaliação registrada com links e itens aprovados/ajustes; implementado, testado, publicado e aprovado permanecem estados separados.

<a id="yai-034"></a>
## YAI-034 — Refinar visemas e nomes próprios em português

**Dependências históricas:** YAI-011, YAI-013, YAI-033.
- **Conclusão objetiva:** Fixtures PT-BR/nome próprio têm comparação antes/depois e pausas corretas; não anuncia captura facial/alinhamento humano; revisão do texto continua disponível.

<a id="yai-035"></a>
## YAI-035 — Ampliar gestos e expressões com auditoria do rig

**Dependências históricas:** YAI-033.
- **Conclusão objetiva:** Poses e seeks frio/quente passam sem crescimento indevido de arestas e cortes; rig antigo não substitui o corrigido; dedos individuais são avaliados apenas se necessários.

<a id="yai-036"></a>
## YAI-036 — Revalidar cores e legibilidade dos dez temas

**Dependências históricas:** YAI-027.
- **Conclusão objetiva:** Matriz de dez temas × dois aspectos tem evidência de contraste/legibilidade; decisão sobre cores preserva o histórico e não recolore tudo por conveniência.

<a id="yai-037"></a>
## YAI-037 — Evoluir tutoriais para ações públicas reais

**Dependências históricas:** YAI-013, YAI-038.
- **Conclusão objetiva:** Novo alvo funciona em scroll/resize, teclado/toque e desaparecimento; Escape fecha; modelo não fornece seletor/comando arbitrário; navegação é explícita.

<a id="yai-038"></a>
## YAI-038 — Validar acessibilidade e compatibilidade das interfaces

**Dependências históricas:** —.
- **Conclusão objetiva:** Matriz identifica navegador/dispositivo e recursos disponíveis; sem overflow; controles têm foco/nome; recusas de microfone/autoplay e incompatibilidade oferecem alternativa correta.

<a id="yai-039"></a>
## YAI-039 — Medir qualidade e custo do assistente local

**Dependências históricas:** YAI-014.
- **Conclusão objetiva:** Perguntas públicas têm avaliação datada; tempo/download/cache/memória medidos; pesos/persona locais não incluem segredos; guia estático é identificado.

<a id="yai-040"></a>
## YAI-040 — Avaliar ASR/TTS locais opcionais no navegador

**Dependências históricas:** YAI-038, YAI-039.
- **Conclusão objetiva:** Nota de viabilidade com medições/custos de download e decisão explícita; protótipo só após escopo aprovado; documentação não anuncia áudio local completo.

<a id="yai-041"></a>
## YAI-041 — Medir capacidade compartilhada com WhatsApp

**Dependências históricas:** —.
- **Conclusão objetiva:** Medição datada identifica disponibilidade, carga e prioridade; nenhum reinício unilateral; decisão de quotas usa evidência, com persona/históricos separados.

<a id="yai-042"></a>
## YAI-042 — Preparar limites distribuídos e camada de proxy

**Dependências históricas:** YAI-041.
- **Conclusão objetiva:** Decisão justifica armazenamento/proxy; teste de réplicas não multiplica cota; payload grande/abas/retry respeitam limites; sem implantação por hipótese nesta auditoria.

<a id="yai-043"></a>
## YAI-043 — Unificar observabilidade sem dados privados

**Dependências históricas:** YAI-006.
- **Conclusão objetiva:** Um incidente percorre pauta→geração→upload por ID; áudio/texto privado/token/prompt não são logados; rotação e retenção têm configuração verificável.

<a id="yai-044"></a>
## YAI-044 — Concluir configuração e resultado de alertas

**Dependências históricas:** —.
- **Conclusão objetiva:** Mocks de 200/400/500/timeout geram resultado correto sem tráfego de rede; no-op sem configuração permanece; teste real requer configurar um destinatário autorizado, ainda não informado.

<a id="yai-045"></a>
## YAI-045 — Migrar envios sociais do Playwright para o emulador Android

**Dependências históricas:** YAI-006, YAI-007.
- **Conclusão objetiva:** TikTok, Instagram, X e Telegram tentam upload apenas pelo emulador configurado; QA headless confirma identidade da conta, arquivo e estado final; falha/incerteza preserva a mídia e não abre Playwright. Login e um envio controlado por destino são testados no emulador após concluir as demais melhorias, sem reiniciar o scheduler durante trabalho ativo.

<a id="yai-046"></a>
## YAI-046 — Decidir Telegram e eventual Facebook

**Dependências históricas:** YAI-019, YAI-006.
- **Conclusão objetiva:** Ativo/desativado e conta correta são registrados; destino opcional não bloqueia limpeza indevidamente; Facebook tem escopo/decisão antes de implementação.

<a id="yai-047"></a>
## YAI-047 — Conectar resumo semanal por tema à agenda

**Dependências históricas:** YAI-020, YAI-021.
- **Conclusão objetiva:** Teste de calendário agenda no máximo um recap por janela/tema; fontes vêm do ledger; metadados do tema estão corretos; decisão precede ativação.

<a id="yai-048"></a>
## YAI-048 — Ampliar pesquisa de referências além do YouTube

**Dependências históricas:** —.
- **Conclusão objetiva:** Cada nova ficha distingue busca, observação audiovisual e métrica; cobertura e limitações explícitas; conteúdos de terceiros ficam privados; propostas são hipóteses testáveis.

<a id="yai-049"></a>
## YAI-049 — Manter documentação viva e versionável

**Dependências históricas:** —.
- **Conclusão objetiva:** Toda conclusão cita artefato e validação; resumo é append-only; docs têm estratégia de versionamento escolhida; prioridades históricas mapeadas sem duplicar tarefas.

<a id="yai-050"></a>
## YAI-050 — Resolver avisos moderados e avaliar driver SQLite

**Dependências históricas:** YAI-001, YAI-010.
- **Conclusão objetiva:** Audit datado e testes mostram correção ou exceção justificada por uso; nenhum override major cego; migração de driver tem ADR, fixture de dados e rollback se adotada.

<a id="yai-051"></a>
## YAI-051 — Validar recursos avançados do fluxo Express

**Dependências históricas:** YAI-001, YAI-002.
- **Conclusão objetiva:** Matriz por recurso aponta código, teste executado, simulação e dependência externa; nenhum provider pago/comment/post é acionado por audit offline; dependências para integração são explícitas.

<a id="yai-052"></a>
## YAI-052 — Decidir política para posts de baixo desempenho

**Dependências históricas:** YAI-023, YAI-024, YAI-017.
- **Conclusão objetiva:** Decisão escrita adota, rejeita ou adia; se adotada, exige evidência própria, backup e autorização explícita por lote; nenhum post removido por esta tarefa documental.

<a id="yai-053"></a>
## YAI-053 — Renderizar Floating3DAssistant permanentemente no layout

**Dependências históricas:** —.
- **Conclusão objetiva:** Acesso direto/navegação SPA e cada frontend servido separadamente exibem o corpo 3D nas dimensões desktop/mobile, sem caixa/overflow/canvas fullscreen; cliques externos e controles críticos preservados. Cobertura requer 26 páginas do manifesto + quatro demos, desktop e mobile. IMP-95 concluiu a matriz local de 60/60 e verificou a rota pública `emulacao-local`, mas a matriz pública completa não foi reexecutada. 331 centros de controles visíveis não ficaram sob o widget; a captura mobile ainda mostra sobreposição visual de texto auxiliar, e a aprovação estética/hardware permanece em YAI-056.

<a id="yai-054"></a>
## YAI-054 — Conectar corpo, animações e chat sem esconder o robô

**Dependências históricas:** YAI-053.
- **Conclusão objetiva:** Abrir/fechar mantém robô e histórico durante SPA; hover/toque/clique/mensagem/fala reagem sem deformação/rotação exagerada; Enter/Space e reduced motion funcionam; player, ASR, tutorial e cooldown não regridem.

<a id="yai-055"></a>
## YAI-055 — Limitar consumo e tornar cena 3D web estável

**Dependências históricas:** YAI-053.
- **Conclusão objetiva:** Uma cena/model load estável entre mensagens e navegação; medição orienta limite de frames/DPR; aba oculta pausa/throttle, erro não quebra página e todos os caminhos liberam recursos; fundo permanece transparente.

<a id="yai-056"></a>
## YAI-056 — Validar mascote flutuante com chat fechado em todas as páginas

**Dependências históricas:** YAI-053, YAI-054, YAI-055.
- **Conclusão objetiva:** Screenshots em desktop/mobile e todas as rotas mostram corpo com chat fechado; interação, voz/tour/cancelamento e degradação funcionam; build/testes pertinentes aprovados; aprovação estética registrada separadamente.

<a id="yai-057"></a>
## YAI-057 — Entregar código copiável e catálogo de modelos visuais distintos

**Dependências históricas:** — para o aceite portátil; a integração no site continua em YAI-056 e alinhamento de tokens em YAI-027.
- **Conclusão objetiva:** Copiar fontes/GLB/deps/README/exemplo para um diretório consumidor independente compila e roda; CSS fica transparente e sem caixa, modelo escolhido consta em catálogo com hash/tamanho/rig/licença; uma variante real diferente passa loader/poses sem erros; peso é apropriado para desktop/mobile ou tem perfil otimizado; nenhum provider pago/personagem novo é ativado implicitamente.

<a id="yai-058"></a>
## YAI-058 — Definir contrato Music AI ↔ Pulso sem duplicar motores

**Dependências históricas:** —.
- **Conclusão objetiva:** Contrato versionado e exemplo sem geração real demonstram consumo/validação de manifest; fronteiras/arquivos/erros/timing descritos; não declarar adaptação de layout como integração pronta.

<a id="yai-059"></a>
## YAI-059 — Validar vínculo musical com uma geração real autorizada

**Dependências históricas:** YAI-058.
- **Conclusão objetiva:** Gate operacional resolvido explicitamente; artefato real com duração/seed/procedência confirmado, timing/mix/clipe validados; falha/indisponibilidade documentada; nenhuma disputa de GPU.

<a id="yai-060"></a>
## YAI-060 — Reproduzir oclusão de diagramas sob o canvas e corrigir layout

**Dependências históricas:** —.
- **Conclusão objetiva:** Composição atual da fonte e fixture final passam HyperFrames 0.8.149 nos dois formatos sem erros/avisos de layout ou supressão do checker; testes de framing e lint passaram. Não foi gerado/publicado MP4.

<a id="yai-061"></a>
## YAI-061 — Decidir produto e promoção comercial por tema

**Dependências históricas:** YAI-019, YAI-023, YAI-029.
- **Conclusão objetiva:** Decisão escrita aprova/adia/rejeita produto/plataforma/atribuição; se aprovada, critérios de link/bumper/conversão e consentimento ficam definidos antes do código; nenhum pixel/afiliação ativado por esta auditoria.

<a id="yai-062"></a>
## YAI-062 — Criar thumbnails temáticas de alto apelo e fiéis ao vídeo

**Dependências históricas:** YAI-027, YAI-031.
- **Conclusão objetiva vigente:** capas dedicadas 16:9 (horizontal final 1280×720) e 9:16, fotorealistas e específicas da pauta, geradas no Gemini Android com Nano Banana Pro solicitado no prompt. Registrar `requested-not-verified` quando o modelo efetivo não for identificado. Não substituir por imagem de cena/artigo nem cortar a horizontal para obter a vertical. Chamada PT-BR composta separadamente, curta, legível e fiel à negação/qualificadores; assunto/produto exato quando central. Revisão e liberação automáticas por hash nos dois formatos. CTR exige impressões suficientes e não demonstra causalidade isolada. Ver [decisões vigentes](decisoes-vigentes.md#capas-e-imagens).
- **Autorização permanente (18/10/2026):** todos os nichos; criação, correção, revisão e liberação das capas pelo agente/QA automático, sem aprovação individual do proprietário. Mostrar assunto e nome exato do modelo/produto quando central ao vídeo; arte específica e curiosidade sem promessa falsa. O acompanhamento do proprietário ocorre após a publicação. Aplicar `config/publication-review-policy.json` e registrar a aprovação por arquivo/hash; corrigir defeitos reais sem convertê-los em pedido de permissão.

<a id="yai-063"></a>
## YAI-063 — Adaptar duração, enquadramento e cenas por plataforma

**Método vigente (aprovações de 01–02/11/2026):** Three.js r187 + Remotion e humanos GLB locais detalhados do catálogo aprovado, sem humanos de primitivas, elenco Game Farma ou Mixamo/site por vídeo. Preservar robô, ações específicas à fonte/fala e layouts próprios 16:9/9:16. Master YouTube horizontal com pelo menos 360 s reais de narração, meta 950 palavras/piso 850; cortes do master vertical, sem aplicar seis minutos a cada corte. Comprovar scheduler → geração → QA → envio/reconciliação por destino e próximo ciclo sem assistência recorrente. Implementação local e piloto aprovado não fecham o ciclo. Recuperar etapas automaticamente e isolar contas indisponíveis; não exigir aprovação humana por vídeo ou revisor LLM rotineiro. Detalhes em [workflow](workflow-autonomo.md); [plan.md](../plan.md) continua sendo a fila única.

**Dependências históricas:** Consultar histórico do ID.
- **Conclusão objetiva:** cada variante respeita política/rota, aspecto, fps, duração e tamanho documentados; cortes preservam o corpo da narração e das legendas em ordem; abertura contextual curta pode ser reapresentada nas partes seguintes, com duração real incluída no limite; cada parte introduz seu assunto e é compreensível isoladamente, sem fala acelerada; partes ficam na ordem e trazem identificação no vídeo e na legenda; revisão visual confirma lado estável e ritmo apropriado; app/conta Android são validados com evidência antes de um envio autorizado. App ausente significa mídia preservada e pendência registrada, sem fallback web.
- **Ritmo das imagens nos cortes:** alvo ~8 s e teto de 12 s por imagem, sem trocas a cada página de legenda. Gerar variantes conforme a duração real e arquivar sobras sem perda, com histórico de uso/assunto. A direção posterior exige ações explicativas ligadas à fala; títulos/cards/câmera isolados não substituem a encenação aprovada.
