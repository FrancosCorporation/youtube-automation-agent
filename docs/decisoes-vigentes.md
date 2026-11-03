# Decisões vigentes do Pulso

Consolidado em 02/11/2026 por solicitação do proprietário: eliminar contradições e seguir a última aprovação. Este documento registra requisitos; o estado de execução fica em [plan.md](../plan.md). Pedidos posteriores do proprietário prevalecem.

## Método visual aprovado

- Three.js r187 + Remotion, conforme os dois vídeos aprovados do [piloto de reflorestamento](../benchmarks/video_3d/reforestation_demo/README.md). Cenários, objetos e ações são específicos de cada assunto e frase; reflorestamento não é tema fixo.
- Humanos detalhados em GLB local, com malha, texturas, rig, clips, licença e SHA verificáveis. Usar o catálogo `experiments/remotion-motion-review/public/pulso-humans/catalog.json`. Preparar/reutilizar assets locais; nenhuma etapa Mixamo ou outro site por vídeo. Humanos de primitivas e o elenco Game Farma foram rejeitados.
- Preservar o robô GLB aprovado, com boca ligada à voz e gestos pertinentes. A referência de identidade é `assets/brand/pulso-robot-approved-reference-2026-10-21.png`; o apresentador recorrente é `ApprovedRobotPresenter.tsx`.
- Mostrar preparação, ação, contato/transformação e consequência; manter identidade e resultado entre planos. Câmera e texto apoiam ações visíveis. Conferir apoio no piso e volumes por todo o percurso, abrir portas antes da passagem, justificar trocas de roupa e evitar objetos decorativos sem função e halo na boca.
- Layouts próprios 1920×1080 (16:9 horizontal) e 1080×1920 (9:16 vertical). Movimento determinístico por frame, revisão dos dois aspectos e retorno na timeline. Detalhes em [direção criativa](padrao-criativo-aprovado.md).

## Duração, fonte e áudio

O master principal do YouTube deve ter **pelo menos 360 segundos de narração real**. A meta do writer é 950 palavras, com piso editorial de 850; a contagem não substitui medir o áudio. Escolher fonte com conteúdo suficiente, desenvolver a explicação em seções e animar os acontecimentos descritos. Não preencher tempo repetindo fatos ou inventando material.

Produzir também o master vertical e extrair dele Shorts e cortes adequados aos destinos. O mínimo de seis minutos vale para o master YouTube, não para cada corte. Narração, legendas e alinhamentos precisam corresponder aos bytes do áudio; fallback aproximado de timings deve continuar identificado.

## Capas e imagens

Usar Gemini no **emulador Android**, sem abrir navegador visível para o proprietário acompanhar. No host atual: `emulator-5560`, Chrome Android `com.android.chrome`. Compartilhar o lock com os publicadores; não interromper composição/upload social e restaurar a tela anterior quando seguro.

Pedir **Nano Banana Pro no prompt**, conforme a instrução mais recente. O seletor de conversa não comprova o modelo de imagem: registrar `requested-not-verified` enquanto a interface não o identificar. Não comprar upgrade nem declarar Pro efetivo com base apenas no prompt.

Criar arte fotorealista específica da pauta em duas composições, 16:9 e 9:16; não obter a vertical por simples corte da horizontal. Compor a chamada PT-BR separadamente: curiosidade fiel ao conteúdo, sem promessa falsa, com assunto/produto exato quando central. Capa horizontal final 1280×720. Preservar hashes/proveniência; não substituir capa dedicada ausente por print de matéria ou frame de cena.

Gerar imagens para a demanda medida da narração, sem lotes para preencher biblioteca. Preservar originais e arquivar sobras com origem, assunto e uso real conforme [runbook](image-library-runbook.md). O alvo de ~8 s e teto de 12 s por imagem dos cortes não autoriza substituir encenação por telas estáticas de palavras.

## Autonomia, modelos e publicação

- O único produtor/publicador recorrente do Pulso é a unidade de usuário `ai-video-scheduler.service`, que executa `scripts/channel-scheduler.js`. O código agenda, aguarda recursos, recupera checkpoints, revisa e envia; o assistente corrige defeitos, sem substituir o serviço por gerações manuais recorrentes.
- Writers podem criar/reparar roteiro e cenas. Ao falhar um modelo pequeno, escalar para modelo mais capaz por rotas autorizadas, com tentativas limitadas, orçamento aplicável e cache do trabalho aprovado. A rota NVIDIA usa a credencial autorizada do OpenCode e não tem o antigo teto local de 600 chamadas: `NVIDIA_CALLS_PER_DAY=0`. Disponibilidade remota ainda deve ser observada; catálogo não prova inferência.
- Revisão factual e supervisão rotineiras são locais. Fonte/citações, cobertura, números, QA visual/técnico e hashes continuam obrigatórios. Até dois reparos factuais; depois outra pauta. Nunca afrouxar um gate para declarar sucesso.
- Criação/correção de capas, revisão e publicação rotineiras nos destinos configurados já estão autorizadas. Não exigir nova aprovação humana por vídeo/capa nem um modelo revisor a cada etapa. Política: `config/publication-review-policy.json`.
- YouTube, Shorts e retries usam Studio Android. Não acrescentar YouTube Data API como fallback Pulso. Instagram, Kwai e TikTok usam seus adaptadores e contas verificadas; X exige identidade/handler operacionais. Telegram está excluído.
- Resultado `unknown`, `submitted`, `processing` ou equivalente exige reconciliação antes de qualquer reenvio. Falha de uma rede não deve bloquear outra elegível. Autorização não é confirmação de publicação.
- Meta configurada: 60 principais/dia nos dez temas, um a cada 24 min. É meta, não capacidade demonstrada. Não alterar agenda, conta, privacidade ou adquirir serviço pago nesta consolidação.
- Respeitar gate e lock de recursos e o perfil compartilhado com treino; não encerrar treino nem criar outro scheduler. Reload somente em janela sem geração/render/upload/retry ativo, preservando filas, IDs e prazos.

## Preservação e precedência

Ao entregar alteração autorizada: commit e push no remoto `fork` (FrancosCorporation/youtube-automation-agent), incremento minor +0.1, tag/release correspondente e SHA remoto conferido. Não publicar segredos, ambientes, bancos, caches ou sessões autenticadas. Preservar mudanças anteriores; sem reset, clean ou force-push.

`plan.md` é a única fila YAI; `resumo.md` registra entregas. `PLANO.md`, `.planning` antigos, releases, benchmarks comparativos e documentos arquivados não introduzem requisitos vigentes. Materiais de HyperFrames/AgentTube continuam disponíveis para seus usos históricos/independentes; não são fallback da produção Pulso.

A aprovação do piloto e do método não comprova geração universal, ausência de colisões, cadência ou postagem nova. Mudanças nesta documentação não invalidam caches nem autorizam apagar vídeos ou restaurar elenco rejeitado.
