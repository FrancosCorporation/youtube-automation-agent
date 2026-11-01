# Pulso como mascote interativo do site_corp

Ideia solicitada pelo usuário em 12/10/2026, durante a revisão das cores do robô. Protótipo autorizado e implementado em 12/10/2026. A seção “Implementado em 12/10/2026” é um snapshot histórico; o estado técnico atual está no adendo ao final desta nota.

## Experiência desejada

O apresentador 3D Pulso passa a ser também o mascote do site_corp. O visitante abre uma caixa de diálogo, escreve uma pergunta ou envia áudio pela própria caixa. O mascote entende a pergunta, responde em texto/voz e anima boca, sorriso, olhar e gestos.

Além de conversar, ele pode ensinar a usar a página atual: identificar um controle real, apontar para ele, explicar a ação e acompanhar o passo do usuário.

### Exemplo pedido: onde comparar

1. Cliente pergunta por texto ou áudio: “Onde vou para comparar?”
2. O Pulso responde: “Para comparar, é só clicar neste botão.”
3. A página aproxima a atenção do botão: traz o alvo à área visível e mostra uma camada preta sobre o restante da interface.
4. A janela de destaque acompanha o retângulo real do botão, com bordas arredondadas, interior totalmente transparente e contraste forte ao redor. O botão continua legível e clicável.
5. O mascote aponta para o alvo. Ao clicar no botão correto, a orientação avança ou encerra. O visitante pode fechar o tutorial.

## Primeiro protótipo proposto

- Widget flutuante com o mesmo personagem e caixa de chat.
- Entrada de texto e gravação/envio de áudio; transcrição e resposta falada com alternativa em texto.
- Roteiro inicial “onde comparar” ligado ao botão real da interface escolhida.
- Spotlight com recorte arredondado, posicionamento atualizado em scroll/resize e apontador sincronizado à fala.
- Registro do passo atual, alvo encontrado, clique esperado, fechamento e conclusão.

## Modelos, prompt pedra e proteção da recepção

Solicitação adicional do usuário: encaminhar as requests para os modelos usados no atendimento dos clientes de WhatsApp, com um **prompt pedra diferente**, próprio do mascote do site_corp. Confirmar modelo/endpoint e estado de aprovação antes de implementar; compartilhar o serviço/modelo não significa compartilhar a persona, o histórico de conversas ou o prompt do WhatsApp.

- Prompt do mascote versionado separadamente: atendimento do site, explicação das funções da página e tutorial ligado a controles reais.
- Recepção apenas pelo backend; chamadas ao endpoint de inferência não partem diretamente do navegador.
- Rate limit no código de recepção, antes de transcrição/inferência, por visitante/sessão e IP.
- Limite global de concorrência e fila com tamanho máximo; não permitir que uma rajada consuma todas as vagas do modelo.
- Limites de caracteres, tamanho/duração do áudio, tokens de entrada/saída e tempo de processamento; cancelamento libera a vaga.
- Rejeição com HTTP 429 e Retry-After quando exceder o limite. Se houver várias instâncias, contadores compartilhados para não multiplicar a cota.
- Isolar a cota do mascote para preservar o atendimento WhatsApp. Validar a identificação do IP atrás do proxy e testar uma rajada pequena controlada.

Rate limiting da aplicação protege os recursos de transcrição/inferência; proteção contra saturação da rede exige também a camada de proxy/infra. Parâmetros e ferramentas serão definidos após inspecionar o serviço existente.

## Continuidade local no navegador após atingir a cota

Pedido adicional do usuário: ao atingir o rate limit, continuar com uma IA menor executada no computador do visitante. O navegador mostra uma mensagem de aguardando/preparação e baixa o modelo local sob demanda, mantendo a conversa disponível sem consumir a inferência compartilhada.

Fluxo planejado: resposta 429 do backend → exibir “Preparando assistente local…” com progresso real → verificar compatibilidade do dispositivo → baixar/carregar pesos de uma variante pequena → responder localmente. Nas próximas vezes, reutilizar os arquivos já disponíveis no armazenamento do navegador quando possível. Respeitar Retry-After, sem ficar repetindo chamadas bloqueadas ao servidor.

Os pesos serão arquivos estáticos versionados, servidos com cache e entrega de assets separada da rota de inferência, preferencialmente armazenamento/CDN adequado. Não criar nem transmitir o modelo pelo processo que atende o WhatsApp a cada 429: o download também precisa evitar carga repetida no servidor protegido.

O código, pesos e prompt enviados ao navegador são inspecionáveis. Portanto o fallback contém apenas conhecimento público do site, persona pública e rotinas de apresentação/tutorial. Chaves, prompt interno do atendimento, regras privilegiadas e dados de outros clientes nunca devem ser enviados ao cliente. Minificação não é proteção de segredo. Ações que precisam de dados ou autorização seguem passando pelo backend e pelos mesmos limites.

WebLLM é uma opção a avaliar para inferência no navegador com aceleração WebGPU e execução em Web Workers: https://webllm.mlc.ai/docs/ (documentação oficial consultada em 12/10/2026). Não foi escolhido nem baixado um modelo neste registro. A escolha precisa validar português, tamanho do download, tempo de primeira resposta e consumo de memória em desktop/celular; dispositivos incompatíveis recebem orientação estática e indicação de quando a cota do servidor estará disponível.

Áudio no modo local precisa de avaliação própria de transcrição/síntese e permissões do microfone; não supor que o pequeno modelo de texto substitui automaticamente esse caminho. Não prometer esconder JavaScript ou rodar o modelo em todo navegador.

## Decisões a resolver na implementação

- Escolher a primeira página do site_corp e localizar a rota/botão real de comparação. Não inventar seletores ou URLs.
- Reutilizar os serviços de conversa/áudio existentes quando adequados, após inspecionar o backend.
- Distinguir ação guiada (visitante clica) de ação automática explicitamente solicitada.
- Otimizar o personagem para uso web: o GLB experimental atual tem cerca de 90 MB. Validar um modelo reduzido antes de incorporá-lo ao site.
- Sincronia labial atual é por envelope de áudio; planejar expressões/gestos compatíveis com respostas em tempo real.
- Garantir que teclado, toque e fechamento funcionem e que o destaque não fique preso a um controle ausente.

## Critérios de avaliação

O cliente consegue perguntar por texto e áudio; a resposta aponta para o botão correto; o recorte acompanha o alvo sem encobri-lo; o clique realiza a ação real; fechar devolve a página normalmente. Validar desktop e celular, incluindo scroll e mudanças de tamanho.

Referência visual já pronta: robô Pulso, variantes em experiments/hyperframes-pulso-pilot/variants/robo-bonito-temas/. Cores dos temas em revisão separada. Esta anotação não altera produção nem o scheduler.


## Implementado em 12/10/2026

Site principal e https://francoscorporation.ddns.net/games/play/pulso-mascote/ usam o robô GLB web otimizado, texto/voz/áudio, tutorial FranRadar e backend privado com modelo WhatsApp compartilhado/prompt separado/cotas. Fallback WebLLM Qwen0.5B em Worker comprovado em GPU, guia estático para incompatibilidade. ASR é WhisperCPU, transcrição revisável; boca acompanha a fala, sem visemas fonéticos. Operação e limitações atuais em /home/servidor/Git/site_corp/docs/PLANO_MASCOTE_PULSO_INTERATIVO.md. Esta seção substitui o estado anterior de somente plano; histórico preservado. O parágrafo é um snapshot de 12/10, corrigido pelo adendo de 15/10 abaixo.

## Estado técnico revisado — 15/10/2026

O backend no checkout `site_corp/services/pulso` expõe chat, transcrição de áudio e fala opcional. `/api/pulso/speech` e `voice:true` chamam Piper `pt_BR-faber-medium`, com Rhubarb fornecendo cues fonéticos; a transcrição usa Whisper base/int8 em CPU. O chat permanece utilizável quando a síntese falha. Os subprocessos têm limites de saída/tempo e são encerrados no cancelamento do cliente. Chat, fala e áudio compartilham os limites de IP/sessão/global.

`npm run pulso:core:test` passou **24/24** em 15/10; os casos incluem texto preservado sem TTS, rota de fala, quota comum, timeout e aborto real do processo filho. `services/pulso/README.md` é a referência de operação; `docs/PULSO_WIDGET_QA.md` descreve QA de browser fixture-only. A validação visual desktop/mobile documentada não comprova inferência real nem aparelho físico, e uma nova execução do QA visual após os ajustes do checkout continua pendente. `docs/runtime-audio-neural.md` descreve setup isolado, pins e preflight; o binário instalado Rhubarb 1.14.0 foi encontrado e passou no preflight de produção. Não fiz deploy nem reiniciei serviços compartilhados.
