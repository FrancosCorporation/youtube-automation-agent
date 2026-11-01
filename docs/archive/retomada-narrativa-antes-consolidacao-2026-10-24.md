# Registro histórico do guia narrativo

Cópia preservada antes da consolidação de 24/10/2026, 22:08 BRT. PIDs, filas, módulos pendentes e comandos abaixo pertencem ao repasse anterior; não executar como instrução atual. Retomar por `plan.md` e `docs/workflow-autonomo.md`.

# Retomada da linha narrativa aprovada

Este é o guia técnico da próxima ação de `plan.md` §3.0, não um backlog concorrente. Leia `AGENTS.md`, essa seção do plano e este guia. Não releia todo o histórico nem execute outros YAI por inferência.

## Pedido e ordem obrigatória

O proprietário aprovou GPS v2 com “agora sim”, “é isso”. Pediu episódio completo (~6 min), cortes e publicação nas redes. Depois esclareceu: **primeiro concluir e publicar o primeiro episódio; depois retirar o criador antigo e fazer a produção recorrente usar o método aprovado em todos os temas**. Finalmente pediu planejamento/código/contexto organizados para continuar com um modelo mais barato.

Não pedir nova autorização por render, capa, corte ou publicação dentro desse escopo. A autorização permanente está em `config/publication-review-policy.json`. A revisão visual do agente e as fontes/hashes continuam necessárias. Não declarar integração universal, exclusão ou publicação apenas por haver código/testes.

**Estado no repasse (2026-10-24 01:28 UTC):** episódio escrito, revisado por dois modelos, narrado, animado, capa feita, Studio e trechos de movimento revistos. Master horizontal concluído; vertical em ~63% no PID `2809577`, sem reiniciar. Finalização, seis cortes finais, revisão dos arquivos e publicação ainda pendentes. Instagram/Kwai autenticados. TikTok pede a data de nascimento do proprietário para completar o fluxo Google. X continua caindo por `libyoga.so`; a seleção da conta Google na web voltou à página pública, sem perfil autenticado. A prévia do browser deixa as abas existentes do Studio intactas. O adaptador universal para as dez pautas ainda precisa ser implementado; os arquivos específicos de IA não são essa integração.

## O que já existe e deve ser reutilizado

Todos os caminhos abaixo são relativos a `/home/servidor/Git/youtube_ai/youtube-automation-agent`.

| Responsabilidade | Código/artefato existente | Estado real |
|---|---|---|
| Referência humana | `experiments/remotion-motion-review/src/GpsExplainerV2.tsx`, registrada em `experiments/remotion-motion-review/src/Root.tsx`; página https://francoscorporation.ddns.net/remotion-review/previews/gps-explainer-20261023-v2/ | Aprovada pelo proprietário |
| Robô, rig, boca e gestos | `experiments/remotion-motion-review/src/ApprovedRobotPresenter.tsx`; `public/pulso-story/approved-robot-rigged.glb` | Reutilizado; não substituir por PNG |
| Primeiro episódio | `experiments/remotion-motion-review/src/AiAnswerExplainer.tsx`, registrado em `src/Root.tsx` | Específico à pauta de IA; não universal |
| TTS e alinhamento | `scripts/prepare-ai-answer-episode.py`; `scripts/synthesize-edge-tts-word-boundaries.py` | Executados; cache e palavras reais preservados |
| Mix | `experiments/remotion-motion-review/scripts/prepare-ai-answer-audio.cjs` | Executado; −14,05 LUFS / −3,48 dBTP |
| Studio e determinismo | `experiments/remotion-motion-review/scripts/check-ai-answer-studio.cjs` | QA completo + revisão das cenas alteradas passaram |
| Render com gate e lock | `experiments/remotion-motion-review/scripts/render-ai-answer.mjs` | Seis trechos GPU concluídos; masters em execução |
| Mux, cortes e inspeção técnica | `experiments/remotion-motion-review/scripts/finalize-ai-answer-package.cjs` | Implementado; executar após os masters |
| Capa | `scripts/prepare-ai-answer-thumbnail.cjs`; `docs/evidencias/ia-como-responde-2026-10-23/thumbnail/cover.png` | Inspecionada/aprovada; ferramenta integrada image_gen após timeout do Gemini; original `thumbnail/artwork.png` e prompt `thumbnail/imagegen-prompt.txt` no mesmo diretório de evidência |
| Pacote gerenciado e QA | `scripts/stage-ai-answer-publication.cjs` | Implementado, exige revisão final por hash; ainda não executado |
| Envio social com checkpoints | `scripts/publish-ai-answer-socials.cjs` | Implementado; ainda não enviou. `--only instagram,kwai` permite lotes parciais retomáveis; exclui API YouTube/Shorts |
| Infraestrutura compartilhada | `utils/video-qa-manifest.js`, `utils/video-qa-review.js`, `utils/social-publication-state.js`, `utils/platform-video-policy.js`, `utils/topic-ledger.js` | Reutilizar; não inventar novo ledger |
| Agendador atual | `scripts/channel-scheduler.js` → `scripts/generate-animated-video.js` → `utils/remotion-story-video-renderer.js` → HyperFrames + `NarrativeComposite` | Caminho visual anterior; ainda não usa `AiAnswerExplainer`/GPS v2 como método universal |

O agendador anterior foi parado em janela ociosa: fila vazia, sem `inFlight`, filhos ou locks Android vivos. Evidência: `docs/evidencias/method-migration-2026-10-23/legacy-scheduler-stopped-for-handoff.json`. A pausa de geração, sozinha, **não bloqueava retries de publicação**. O override abaixo agora também bloqueia os envios do fluxo antigo em caso de start externo:

`/home/servidor/.config/systemd/user/ai-video-scheduler.service.d/99-narrative-method-migration.conf`

```ini
[Service]
Environment=PAUSE_VIDEO_GENERATION=1
Environment=DISABLE_YOUTUBE_UPLOAD=1

[Unit]
ConditionPathExists=!/home/servidor/Git/youtube_ai/youtube-automation-agent/data/state/narrative-method-migration.paused
```

Outro processo externo continuava iniciando o serviço. Por isso foi adicionado o marcador `data/state/narrative-method-migration.paused` e a condição de start. Teste real confirmou `ConditionResult=no`, `MainPID=0`, `ActiveState=inactive`. Não remover essas travas até existir a nova rota validada. No rollout, revisar a nova rota e então remover o marcador e o drop-in de migração, ajustar `PAUSE_VIDEO_GENERATION` da `.env`, fazer daemon-reload e iniciar o único serviço em janela ociosa. Não iniciar outro scheduler. A `.env` também tem `PAUSE_VIDEO_GENERATION=1`; variáveis de systemd prevalecem. Não imprimir outros valores do ambiente.

## Etapa 1 — terminar e publicar o episódio atual

Tema: **Como uma IA monta uma resposta — e por que às vezes inventa**. Narração: 1009 palavras, 9634 quadros a 24 fps, **401,416667 s (6min41s)**. Masters 1920×1080 e 1080×1920. Seis capítulos consecutivos, aproximadamente 62,29 / 63,71 / 68,46 / 70,96 / 67,88 / 68,13 s; cortes cobrem todos os quadros e são compreensíveis isoladamente.

Fontes, roteiro e consenso factual estão em `docs/evidencias/ia-como-responde-2026-10-23/`. `factual-review-approved.json` vincula roteiro e contexto às aprovações reais de `z-ai/glm-5.3` e `z-ai/glm-5.3-flash`. Não alterar a narração sem nova revisão factual e novo alinhamento. Contexto factual não é notícia datada: não inventar anúncio/evento.

Assets reprodutíveis: `experiments/remotion-motion-review/public/ia-answer-20261023/`. Saídas: `experiments/remotion-motion-review/renders/ia-answer-20261023/`.

1. **Verificar o render existente antes de iniciar qualquer outro.** Consulte `render.lock` (PID), `master-render.log`, relatórios `masters-both-*.json` e existência/ffprobe dos MP4s. Um arquivo aberto/parcial não é concluído. Na última observação, o master landscape já terminou e o portrait seguia no PID `2809577`, em ~63%. O log contém uma tentativa anterior interrompida antes de gerar frames porque o manifesto de pré-render ainda não estava no caminho correto; já corrigido. Procurar o último `render-start`/`render-complete`, não tratar o erro histórico como estado atual.
2. Se o processo ainda estiver ativo, acompanhar o log. Se terminou, exigir ambos os jobs `completed`. Se falhou, preservar log e resolver a causa; retomar só o formato faltante, sem sobrescrever master completo. O script usa `render.lock` para impedir duplicação. O gate não deve ser contornado.
3. Após ambos concluídos, executar finalização. Ela conserva o stream de vídeo, coloca o mesmo AAC nos dois, cria seis cortes, mede codecs/frames/loudness, decodifica todos e extrai amostras. `technical-qa.json` ainda fica com revisão visual pendente por definição.
4. Inspecionar os quadros finais e a reprodução de cada arquivo, particularmente cortes, legendas, primeiro/último instante, fala/pausas, robô e fontes. Corrigir defeito real e repetir apenas a validação afetada. Criar `final-visual-review.json` na pasta de renders **somente após essa revisão**, no formato `{ "status":"approved", "reviewer":"Codex", "reviewedAt":"ISO", "assets":[{"path":"absoluto", "sha256":"64hex"}], "notes":"o que foi conferido" }`. Nove assets: dois masters, seis cortes, capa. Não copiar uma aprovação de outra versão.
5. Com o scheduler antigo **inativo**, executar staging. O script verifica as nove aprovações/hashes, checks técnicos e consenso; copia sem sobrescrever conteúdo diferente, escreve manifesto, insere uma entrada no ledger e registra a liberação visual delegada. IDs: `jobId=ia-answer-20261023-gps-v2`; `videoId` derivado do caminho pelo utilitário existente. Se houver falha após inserir a entrada, reconciliar a mesma entrada; não criar outro ID nem zerar tentativas.
6. Executar pré-checagem do publisher e depois `--publish`. Ele envia pelas rotas Android existentes, persiste antes/depois por destino e respeita estados incertos. Não marcar o pacote inteiro publicado se uma rede falhar. Registrar links/IDs e prova pública real; um domínio de prévia não substitui publicação social.
7. YouTube/Shorts exigem **Studio no Chrome autenticado no Android**, por instrução persistente. O helper social foi escrito com `skipYouTube=true` e `skipShorts=true` justamente para não usar a API proibida. Preparar/usar automação Studio com lock do Android, QA por hash e checkpoints antes/depois do envio. Não alterar para API para driblar a cota.

Comandos de retomada (execute do diretório indicado; não encadear se uma etapa falhar):

```bash
# A partir de experiments/remotion-motion-review, apenas se não houver job ativo:
PULSO_CONSTRAINED_RENDER=1 PULSO_REMOTION_GL=angle-egl nice -n 10 taskset -c 0-5 node scripts/render-ai-answer.mjs masters both --wait
# Troque "both" por "landscape" ou "portrait" se apenas um formato precisar ser retomado.
node scripts/finalize-ai-answer-package.cjs

# A partir da raiz youtube-automation-agent, depois da revisão visual final:
node scripts/stage-ai-answer-publication.cjs
node scripts/publish-ai-answer-socials.cjs
node scripts/publish-ai-answer-socials.cjs --publish
```

Renderer aprovado para esse job: `angle-egl`, Chrome for Testing, concorrência 2, prioridade 10, afinidade de seis CPUs. `pre-render-review.json` vincula composição, áudio e renderer aos seis trechos realmente inspecionados. A aceleração GPU foi confirmada pelo CLI Remotion; [documentação primária](https://www.remotion.dev/docs/options/gl). Não inferir ETA de 2 s de benchmark; o log do master contém progresso observado. Há guard de memória no render.

### Destinos e pendências reais

| Destino | Estado observado | Próxima ação |
|---|---|---|
| Instagram | `@pulso_ai_news` autenticado, handler existente | Revalidar identidade imediatamente antes de enviar os seis cortes |
| Kwai | Login confirmado em `127.0.0.1:5555`, handler existente | Revalidar, enviar, comprovar no perfil; estados antigos `unknown` não autorizam reenvio |
| YouTube/Shorts | Canal `UCT_Scob-q-jUJgfDUaMvejA`, Chrome Android/CDP 9223 | Cota observada até **24/10/2026 05:23:43Z / 02:23 BRT**; rechecagem real no Studio após prazo |
| TikTok | Google sign-in consent accepted; currently asks owner for birth date to create the account | Await correct DOB; account creation must not guess. Handler of submission still missing |
| X | Launch attempted; app crashed and Android showed “X keeps stopping” | Restart/login requires app to open normally; dismissing crash dialog alone did not fix it. Handler missing |
| Telegram | Excluído explicitamente | Não enviar |

Evidências: `docs/evidencias/method-migration-2026-10-23/social-readiness-current.json`, `instagram-recheck.json`; cota em `data/state/youtube-studio-upload-progress-2026-10-23.json`. Usar `utils/android-social-target.js` e locks; não clicar no emulador compartilhado enquanto outra operação detém o lock. Não fechar abas/sessões alheias. Não inventar identidade/login/certificação nem escolher nascimento/documento do titular.

**Saída desta etapa:** ao menos a primeira publicação no método aprovado comprovada em destino acessível, pacote revisado e pendências das outras redes explicitamente registradas. Continuar os destinos restantes independentemente, respeitando cota/login. Não esperar TikTok/X para publicar Instagram/Kwai.

## Etapa 2 — substituir o criador, preservando infraestrutura útil

Esta seção define a implementação seguinte; os módulos marcados como novos **ainda não existem**. O trabalho não está reduzido a apertar Render: falta integrar e validar a criação de cenas específicas a cada pauta.

### Fluxo de destino

`channel-scheduler` → pauta/fontes → roteiro + mapa de citações literais → QA factual determinístico (sem LLM revisor, até dois reparos pelo writer) → TTS + palavras reais → **plano narrativo específico da pauta** → assets e ações → **composição Remotion compartilhada com robô** → gates pré-render → masters 16:9/9:16 → cortes por capítulo/frase → revisão técnica/visual por hash → ledger → distribuição por destino → confirmação.

Reutilizar coleta, revisão factual, TTS, mix, assets, QA, locks, ledger e confirmação atuais. Retirar a seleção visual antiga do caminho ativo. Não apagar `generate-animated-video.js` cegamente: ele exporta helpers usados pela revisão factual. Extraí-los antes se for necessário remover o módulo. A retirada do criador significa remover sua rota ativa e fallbacks visuais, não destruir fontes, rig, bibliotecas de áudio, provas ou sessões.

| Incremento | Arquivos concretos a criar/alterar | Critério verificável |
|---|---|---|
| A. Contrato de episódio | Novo `utils/narrative-episode-plan.js` + testes | Plano versionado, tema, fontes/claims, hashes de roteiro/áudio, capítulos, cues TTS, cenas/ações/câmera/apresentador e layout por proporção; validação rejeita lacunas, referências inválidas, tempos fora da narração e planos apenas textuais |
| B. Autor de cenas | Novo `utils/narrative-scene-author.js`; integrar após TTS em `scripts/generate-animated-video.js` | Usa fonte/roteiro aprovados, duração real e tema. Produz objetos/ações adequados a cada frase, com cache por hash. Não transportar laptop/tokens para saúde, fitness etc. Arte específica por provider existente e SVG/3D com ações quando adequado |
| C. Composição compartilhada | Novo `experiments/remotion-motion-review/src/NarrativeEpisode.tsx`; registrar em `src/Root.tsx` | Recebe plano por props, preserva `ApprovedRobotPresenter`, envelope da fala e gestos, interpreta ações determinísticas, reorganiza 16:9/9:16. Migrar episódio IA para esse contrato sem mudar roteiro/voz |
| D. Adaptador de render | Novo `utils/narrative-episode-renderer.js`; reutilizar gate/lock/registro de `render-ai-answer.mjs` | Um job gera ambos os masters, respeita host, relata falhas e retoma apenas etapas inválidas. Novo hash de código/plano/áudio invalida a aprovação anterior |
| E. Finalização comum | Extrair utilidades dos scripts `prepare-ai-answer-*` e `finalize-ai-answer-package.cjs`; integrar `utils/clip-maker.js` | Cortes preservam toda a narrativa, começam/terminam em fronteiras reais, têm identificação e limites de cada destino; não herdam enquadramento/QA automaticamente do master |
| F. Entrada recorrente | `scripts/generate-animated-video.js` e `scripts/channel-scheduler.js` | Scheduler chama a nova rota; saída mantém o contrato de `videoPath`, `clips`, `thumbnailPath`, QA e ledger. Remover antigo fallback, não manter flag que volta silenciosamente ao visual rejeitado |
| G. Distribuição | `scripts/upload-to-socials.js`, `utils/tiktok-upload-flow.js`, `utils/x-upload-flow.js`, futura rota Studio Android | Preservar checkpoint por destino e autoria/conta. Implementar TT/X somente contra UI real após login. Trocar YouTube do caminho recorrente para Studio exigido, inclusive retries |
| H. Retirada/rollout | Serviço existente, imports/testes/referências da rota velha | Provar ausência de chamadas ao criador antigo; remover somente código obsoleto depois da extração. Reativar em janela ociosa após E2E; acompanhar primeiro ciclo real |

Contrato mínimo recomendado para A, sem executar código arbitrário vindo do modelo:

```text
episode: schemaVersion, jobId, themeId, title, fps, sourceEvidence,
         scriptSha256, narrationSha256, narrationDurationFrames,
         speechEnvelope, captions, palette, assets[], chapters[], scenes[]
chapter: id, title, startFrame, durationFrames, narrationSentenceIds[]
scene: id, chapterId, startFrame, durationFrames, narrationSentenceIds[], claimRefs[],
       objects[], actions[], cameraShots[], presenter{side,framing,gestureCues},
       layouts{landscape,portrait}, shortLabels[]
action: targetObjectId, narrationCue, startFrame, endFrame,
        kind (travel/reveal-part/transform/rearrange/compare), from, to, easing
asset: id, managedPath, sha256, kind, sourceOrGenerationRecord, illustrative
```

Não aceitar apenas nome de um efeito como prova de ação explicativa. O plano tem que ligar objeto, origem, ação, destino/transformação e consequência à fala. Câmera alterna geral/detalhe/resultado com motivo; fades, pulsos e troca de texto sozinhos não passam. Texto/rótulos precisam vir da fala/fonte ou ser identificados como exemplo didático. Restringir assets/caminhos e propriedades; nunca executar TS/JS arbitrário retornado pelo modelo. Imagens autorais ilustrativas não são evidência de evento real.

### Validação progressiva da migração

1. Testar contrato e recuperação de cache: mudança de roteiro, áudio, asset ou código invalida só as etapas dependentes; corrupção/falta de revisão bloqueia envio; não gerar novos IDs em retry.
2. Migrar o episódio IA já aprovado para a composição comum; comparar cobertura narrativa, enquadramento, boca, gestos, legendas e mix. Não reescrever suas seis cenas como substituto de todos os temas.
3. Validar os dez IDs de `config/themes.json`: `ia`, `curiosidades`, `dinheiro`, `saude`, `economize`, `psicologia`, `relacionamentos`, `fitness`, `misterios`, `carreira`. São configurados como enabled, mas isso não prova contas prontas. Todos devem conseguir gerar plano válido com assunto/fonte/objetos próprios; usar fontes verificadas também nos testes E2E.
4. Fazer E2E visual real em temas contrastantes (ex.: curiosidades física, saúde, dinheiro), ambos os formatos, usando o QA determinístico por fonte/citação sem chamar modelos revisores na rota normal. Naqueles de saúde/dinheiro, não converter afirmações gerais em recomendação individual ou promessas.
5. Testar scheduler → novo gerador → QA → consumer com adaptadores de envio simulados **somente nos testes**; garantir que nenhum branch/retry chama YouTube API ou o renderer antigo. Testes não contam como postagem.
6. Após testes focados e inspeção dos renders, reativar o único serviço; acompanhar um job real e uma confirmação real por destino disponível. Não prometer 60 vídeos/dia por haver essa cadência configurada; capacidade depende das medições.

Testes existentes úteis: `tests/narrative-visual-coverage.test.js`, `tests/platform-video-policy.test.js`, `tests/video-qa-manifest.test.js`, `tests/video-qa-review.test.js`, `tests/social-publication-state.test.js`, `tests/delegated-publication-review.test.js`, mais testes do novo contrato/renderer. Rodar somente os relacionados ao incremento. Na entrega atual, 64 testes de cenas/legendas/visuais/SFX já passaram; TS da composição e ESLint dos scripts passaram. Não reexecutar tudo sem mudança/falha que justifique.

**Saída desta etapa:** nova rota recorrente comprovada, antigo criador fora do caminho de execução, dez temas suportados pelo contrato e planos próprios, E2Es contrastantes revisados, limitações de redes/cotas registradas e ciclo real observado. Só então atualizar o status pertinente do plano; YAI-063 não vira concluído apenas pelo primeiro vídeo.

## Etapa 3 — limpeza autorizada, sem perder o trabalho novo

O pedido inicial “todos os vídeos no disco” recebeu pergunta de escopo e ainda não houve resposta delimitando vídeos Pulso versus outros projetos. A ordem mais recente adia a retirada do criador para depois da primeira publicação. Não inferir autorização para apagar vídeos de outros projetos, fontes ou os masters novos.

Inventário anterior à produção: `docs/evidencias/method-migration-2026-10-23/video-inventory-before.json` — 162 arquivos / 3,70 GiB no checkout e saída legada, com inode/size/mtime. Nenhum foi apagado nesta execução. Há cópias públicas e caminhos externos que esse inventário não inclui. Quando o escopo estiver claro, comparar identidade do arquivo, conferir writers/locks, registrar hashes e remoção, aposentar referências na fila/ledger e preservar fontes/modelos/evidência. Não usar `find / ... -delete` nem remover por extensão sem inventário fechado. Não apagar vídeos do canal remoto: isso não foi pedido.

## Cuidados de continuidade

- O checkout tem muitas alterações anteriores e arquivos não rastreados. Não `reset`, `clean`, restaurar arquivos alheios ou fazer commit global.
- Não usar `.planning/` ou `PLANO.md` como backlog vigente. Atualizar apenas cursor/linha pertinente em `plan.md`, evidência e nota curta no topo de `resumo.md` a cada entrega.
- Não iniciar tarefas com outros agentes: usuário não pediu delegação. Trocar o modelo da sessão não é autorização para spawn de subagentes.
- Uma pergunta sobre pausar `llama-cpp-test` ficou **superada**: carga caiu e GPU/render restrito permitiram prosseguir. O serviço de outro projeto não foi pausado; não executar essa ação por causa da pergunta antiga.
- Revalidar tempo, processos e sessões ao retomar. Este guia registra fatos de 23/10/2026 BRT; não transforma uma observação antiga em estado atual.

Mensagem de retomada sugerida: “Leia AGENTS.md, plan.md §3.0 e docs/retomada-linha-narrativa-2026-10-23.md. Verifique o render ativo antes de iniciar outro. Termine/revise/publique o episódio IA de 6min41s; depois implemente progressivamente a migração do criador recorrente para o método GPS v2 em todos os temas, atualizando as evidências e sem repetir envios incertos.”
