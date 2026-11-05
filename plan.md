# Plano de entrega — Pulso / YouTube AI

**Cursor vigente — 04/11/2026, v2.40.0:** corrigidos o bloqueio do produtor durante retry no perfil compartilhado, a falsa indicação de upload pendente no X e a recuperação do Android pausado dentro de unit ativa. VM retomada sem reboot; Chrome passou pela configuração inicial e CDP voltou, mas a sessão X ainda precisa de autenticação/verificação. 97 testes de integração passaram; CI isolada completa e lint passaram. Serviço preservado: Psicologia foi adiado por falha de provider, Saúde retomou autoria; reconstrução visual continua reservada na fila. Publicação permanece sem episódio novo confirmado. Próximo: aplicar reload ocioso, restabelecer sessão X, concluir reconstrução/revisão e confirmar distribuição/ciclo seguinte. Pausa temporária de llama-cpp tem religação automática às 22:10 BRT; treino preservado. YAI-062/063 continuam parciais. [Evidências](docs/evidencias/autonomia-2026-11-04/retry-e-x.md).

## 1. Leia isto para retomar

[AGENTS.md](AGENTS.md) → [decisões vigentes](docs/decisoes-vigentes.md) → este cursor → [workflow autônomo](docs/workflow-autonomo.md) → somente código/evidência pertinentes. `resumo.md` é registro, não outra fila. `PLANO.md` e os ponteiros `.planning` remetem aqui.

## 2. Entrega final e fronteiras

Produzir e publicar pelo serviço, com fonte verificável, narração, ações explicativas, humanos GLB locais/robô aprovados, masters próprios, cortes, capas, QA e reconciliação. YouTube horizontal deve atingir seis minutos de áudio real. Manter dez temas e agenda configurada; medir capacidade sem prometer 60/dia. AgentTube/Express é independente conforme [ADR-0001](docs/adr/0001-fronteira-entre-pipelines.md).

## 3. Próxima ação e ordem de execução

### 3.0 Prioridade vigente — produzir na direção narrativa aprovada e distribuir por código

Concluir a recuperação de YAI-063 pelo produtor existente. Seguir o método do piloto de reflorestamento aprovado, adaptando tema/cena/ação à fala, preservando robô, humanos GLB e layouts independentes. Referência criativa detalhada em [direção aprovada](docs/padrao-criativo-aprovado.md). As instruções antigas de humanos procedurais, HyperFrames como padrão, roteiro limitado a 450 palavras, pausas/cotas datadas e aprovação individual não estão vigentes.

### 3.1 Fluxo que deve funcionar ao final

Agenda/recursos → pauta e fonte → writer + revisão factual local → narração medida → imagens/capas Android → autoria e reparos limitados com cache → render dos dois formatos → cortes/mix/QA por hash → fila por destino → publicação/reconciliação → próximo ciclo. Falhas transitórias preservam identidade e trabalho válido; pauta insuficiente não deve monopolizar o serviço.

### 3.2 Correções prioritárias: causa, execução e saída

1. Conferir log/health/checkpoints do job atual; reproduzir falhas de autoria preservando dados reais. Corrigir causas no código e testar o comportamento afetado; não acumular tentativas cegas ou flexibilizar QA.
2. Comprovar render horizontal ≥360 s e vertical próprio no método aprovado, com movimento, apoio/colisões, fontes, legenda, áudio, capa e busca na timeline verificados. Medir tempos por etapa e separar espera de render.
3. Deixar o consumer existente publicar os arquivos elegíveis, conferir prova por destino e reconciliar resultados incertos antes de qualquer reenvio.
4. Observar retomada e próximo ciclo pelo serviço. Só então avaliar cadência/estabilidade; fixture, piloto e heartbeat não encerram esse critério.

### 3.3 Demais entregas necessárias

Preservar os 63 objetivos abaixo. Rede sem identidade/handler, acesso Analytics, janela real de coleta, backup e aceites de site/voz continuam com critérios próprios. Uma dependência não paralisa trabalho independente. Não repetir autorização já concedida para produção, capas ou commit/push/release.

### 3.4 Como executar e prestar contas

Escolher incremento concreto → reproduzir → corrigir → testes focados → prova real aplicável → substituir cursor e linha YAI → registrar entrega. Preservar treino, mídia, credenciais, alterações anteriores e filas; não reiniciar durante trabalho. O histórico não é instrução para apagar material ou reenviar postagem.

## 4. Regra de execução até concluir

Registrar somente conclusões comprovadas: implementado, testado, renderizado, aprovado e publicado são estados diferentes. IDs/URLs/hashes e horários acompanham provas. As autorizações permanentes estão em [decisões vigentes](docs/decisoes-vigentes.md); segui-las sem criar novos pedidos de permissão.

## 5. Catálogo único — 63 objetivos

**FECHADO:** critério delimitado atendido segundo evidência herdada; não é nova auditoria. **VALIDAR:** entrega técnica existe, falta comprovar o aceite integral indicado. **PARCIAL/PENDENTE:** há trabalho restante. **BLOQUEADO:** dependência concreta impede o passo final. **ADIADO:** decisão registrada, funcionalidade não entregue. **DECIDIDO:** objetivo de decisão encerrado, sem integração presumida. Não contar adiamento como implementação.

Cada ID abre seu critério completo, incluindo dependências. Evidências detalhadas anteriores estão no [v2 preservado](docs/archive/plan-v2-antes-revisao-2026-10-17.md); resultados novos entram em `resumo.md`. Estados VALIDAR de 010/013/014/035/037 explicitam lacunas já registradas, preservando o trabalho local concluído.

**Contagem desta revisão:** 5 ADIADO, 2 BLOQUEADO, 1 DECIDIDO, 24 FECHADO, 28 PARCIAL, 3 VALIDAR; total 63. Estados preservados; sem nova declaração de fechamento.

| ID / objetivo | Estado | Evidência datada e pendência (não configuração vigente) |
|---|---|---|
| [YAI-001](docs/criterios-aceite-pulso.md#yai-001) — Runtime reproduzível | PARCIAL | Revalidar runtime e caminho efetivo de TTS antes de migrar voz; mudança de voz conserva seu aceite específico. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-002](docs/criterios-aceite-pulso.md#yai-002) — ESLint | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-003](docs/criterios-aceite-pulso.md#yai-003) — Segurança da API | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-004](docs/criterios-aceite-pulso.md#yai-004) — Orçamento atômico | FECHADO | Reserva/concorrência/dia UTC verificados anteriormente. NVIDIA sem o antigo teto local, conforme autorização posterior; demais orçamentos permanecem. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-005](docs/criterios-aceite-pulso.md#yai-005) — Scheduler e rodízio | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-006](docs/criterios-aceite-pulso.md#yai-006) — Confirmação por destino | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-007](docs/criterios-aceite-pulso.md#yai-007) — Dedupe e recuperação | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-008](docs/criterios-aceite-pulso.md#yai-008) — Retry social e incidente Kwai | PARCIAL | Reconciliar destinos incertos por conta/artefato e corrigir recuperação sem duplicação. Quotas/sessões/PIDs históricos não são estado atual. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-009](docs/criterios-aceite-pulso.md#yai-009) — Paginação de legendas | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-010](docs/criterios-aceite-pulso.md#yai-010) — CI isolada | VALIDAR | CI local possui provas anteriores; comprovar CI remota da revisão publicada. Commit/push no fork e tag/release já autorizados. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-011](docs/criterios-aceite-pulso.md#yai-011) — Cues e seeks | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-012](docs/criterios-aceite-pulso.md#yai-012) — API de voz | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-013](docs/criterios-aceite-pulso.md#yai-013) — Conversa e gravação reais | VALIDAR | Implementação existe; concluir a comprovação específica do critério, sem promover por teste de outra frente. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-014](docs/criterios-aceite-pulso.md#yai-014) — WebLLM e cancelamento | PARCIAL | Concluir os requisitos restantes do critério; consultar evidências anteriores antes de repetir trabalho. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-015](docs/criterios-aceite-pulso.md#yai-015) — QA portátil de voz/tutorial | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-016](docs/criterios-aceite-pulso.md#yai-016) — Runbooks | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-017](docs/criterios-aceite-pulso.md#yai-017) — Backup e rollback | PARCIAL | Comprovar backup/restore operacional em destino adequado e janela coordenada, preservando segredos e writers. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-018](docs/criterios-aceite-pulso.md#yai-018) — Retenção e arquivo | PARCIAL | Reconciliar inventário, hashes e destinos antes da retenção/limpeza; não apagar mídia pendente ou resultado remoto incerto. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-019](docs/criterios-aceite-pulso.md#yai-019) — Consolidar marca e mapa real de contas | PARCIAL | Manter identidade/marca/conta por destino. Revalidar sessões reais; Telegram excluído. Não reutilizar snapshots de login como prova atual. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-020](docs/criterios-aceite-pulso.md#yai-020) — Fontes por tema | PARCIAL | Verificar fontes/atribuição/licenças nos dez temas; feed disponível não comprova adequação editorial ou licença de imagem. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-021](docs/criterios-aceite-pulso.md#yai-021) — Cadência e capacidade | PARCIAL | Meta configurada 60 principais/dia, dez temas, intervalos de 24 min. Comprovar ciclos completos e capacidade com o master atual de pelo menos seis minutos; medições dos antigos roteiros de 450 palavras não bastam. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-022](docs/criterios-aceite-pulso.md#yai-022) — Formatos por rede | PARCIAL | Masters próprios 1920×1080 e 1080×1920, cortes verticais e validação por destino. Seis minutos mínimos no master YouTube, sem impor esse piso aos cortes. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-023](docs/criterios-aceite-pulso.md#yai-023) — Coleta diária e painel | BLOQUEADO | Coleta/coortes reais continuam dependentes de escopos/contas/dados verificáveis; diagnosticar acesso atual, sem presumir OAuth inválido por erro histórico. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-024](docs/criterios-aceite-pulso.md#yai-024) — Experimentos reais | PARCIAL | Executar experimento pré-registrado com dados reais e confirmação aplicável; não confundir autorização de publicação rotineira com alteração de experimento/conta. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-025](docs/criterios-aceite-pulso.md#yai-025) — Aprendizado no scheduler | PARCIAL | Promover aprendizados somente com dados elegíveis, comparação justa e rollback; fixtures não demonstram ganho real. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-026](docs/criterios-aceite-pulso.md#yai-026) — Fronteira dos pipelines | FECHADO | Pulso/JSON e AgentTube/Express/SQLite permanecem separados; somente a unit Pulso publica sua fila. Ver ADR-0001. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-027](docs/criterios-aceite-pulso.md#yai-027) — Tokens visuais | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-028](docs/criterios-aceite-pulso.md#yai-028) — SFX e mixagem | PARCIAL | Concluir os requisitos restantes do critério; consultar evidências anteriores antes de repetir trabalho. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-029](docs/criterios-aceite-pulso.md#yai-029) — Bumper e stinger | ADIADO | Manter a decisão e o gatilho de reconsideração do registro anterior; não tratar como implementação. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-030](docs/criterios-aceite-pulso.md#yai-030) — Componentes visuais | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-031](docs/criterios-aceite-pulso.md#yai-031) — Fotos, prints e recortes | PARCIAL | Concluir os requisitos restantes do critério; consultar evidências anteriores antes de repetir trabalho. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-032](docs/criterios-aceite-pulso.md#yai-032) — Gancho e prosódia | PARCIAL | Concluir os requisitos restantes do critério; consultar evidências anteriores antes de repetir trabalho. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-033](docs/criterios-aceite-pulso.md#yai-033) — Aceite da demo neural | PARCIAL | Concluir os requisitos restantes do critério; consultar evidências anteriores antes de repetir trabalho. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-034](docs/criterios-aceite-pulso.md#yai-034) — Visemas e nomes PT-BR | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-035](docs/criterios-aceite-pulso.md#yai-035) — Gestos e rig | PARCIAL | Concluir os requisitos restantes do critério; consultar evidências anteriores antes de repetir trabalho. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-036](docs/criterios-aceite-pulso.md#yai-036) — Cores dos dez temas | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-037](docs/criterios-aceite-pulso.md#yai-037) — Tutoriais públicos | VALIDAR | Implementação existe; concluir a comprovação específica do critério, sem promover por teste de outra frente. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-038](docs/criterios-aceite-pulso.md#yai-038) — Acessibilidade | PARCIAL | Concluir os requisitos restantes do critério; consultar evidências anteriores antes de repetir trabalho. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-039](docs/criterios-aceite-pulso.md#yai-039) — Qualidade/custo local | PARCIAL | Concluir os requisitos restantes do critério; consultar evidências anteriores antes de repetir trabalho. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-040](docs/criterios-aceite-pulso.md#yai-040) — ASR/TTS no navegador | ADIADO | Manter a decisão e o gatilho de reconsideração do registro anterior; não tratar como implementação. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-041](docs/criterios-aceite-pulso.md#yai-041) — Capacidade compartilhada | PARCIAL | Concluir os requisitos restantes do critério; consultar evidências anteriores antes de repetir trabalho. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-042](docs/criterios-aceite-pulso.md#yai-042) — Proxy e limites distribuídos | ADIADO | Manter a decisão e o gatilho de reconsideração do registro anterior; não tratar como implementação. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-043](docs/criterios-aceite-pulso.md#yai-043) — Observabilidade | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-044](docs/criterios-aceite-pulso.md#yai-044) — Alertas reais | PARCIAL | Concluir os requisitos restantes do critério; consultar evidências anteriores antes de repetir trabalho. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-045](docs/criterios-aceite-pulso.md#yai-045) — Migrar envios sociais para Android | PARCIAL | Concluir os requisitos restantes do critério; consultar evidências anteriores antes de repetir trabalho. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-046](docs/criterios-aceite-pulso.md#yai-046) — Telegram e Facebook | DECIDIDO | Decisão encerrada no escopo registrado; não presumir integração ou autorização de ações adicionais. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-047](docs/criterios-aceite-pulso.md#yai-047) — Recap semanal | PARCIAL | Concluir os requisitos restantes do critério; consultar evidências anteriores antes de repetir trabalho. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-048](docs/criterios-aceite-pulso.md#yai-048) — Pesquisa multirrede | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-049](docs/criterios-aceite-pulso.md#yai-049) — Documentação executável | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-050](docs/criterios-aceite-pulso.md#yai-050) — Dependências/SQLite | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-051](docs/criterios-aceite-pulso.md#yai-051) — Recursos Express | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-052](docs/criterios-aceite-pulso.md#yai-052) — Posts de baixo desempenho | ADIADO | Manter a decisão e o gatilho de reconsideração do registro anterior; não tratar como implementação. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-053](docs/criterios-aceite-pulso.md#yai-053) — Mascote em todo layout | PARCIAL | Concluir os requisitos restantes do critério; consultar evidências anteriores antes de repetir trabalho. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-054](docs/criterios-aceite-pulso.md#yai-054) — Corpo, chat e voz | PARCIAL | Concluir os requisitos restantes do critério; consultar evidências anteriores antes de repetir trabalho. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-055](docs/criterios-aceite-pulso.md#yai-055) — Consumo e estabilidade 3D | PARCIAL | Concluir os requisitos restantes do critério; consultar evidências anteriores antes de repetir trabalho. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-056](docs/criterios-aceite-pulso.md#yai-056) — Mascote com chat fechado | PARCIAL | Concluir os requisitos restantes do critério; consultar evidências anteriores antes de repetir trabalho. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-057](docs/criterios-aceite-pulso.md#yai-057) — Kit copiável e catálogo | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-058](docs/criterios-aceite-pulso.md#yai-058) — Contrato Music AI | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-059](docs/criterios-aceite-pulso.md#yai-059) — Música real integrada | BLOQUEADO | Revalidar a dependência concreta do critério e seguir trabalho independente enquanto persistir. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-060](docs/criterios-aceite-pulso.md#yai-060) — Oclusão pelo canvas | FECHADO | Critério delimitado atendido segundo evidência anterior; não reabrir sem regressão. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-061](docs/criterios-aceite-pulso.md#yai-061) — Produto comercial por tema | ADIADO | Manter a decisão e o gatilho de reconsideração do registro anterior; não tratar como implementação. [Registro anterior](docs/archive/alinhamento-2026-11-02/plan.md). |
| [YAI-062](docs/criterios-aceite-pulso.md#yai-062) — Thumbnails temáticas | PARCIAL | Capas dedicadas 16:9 e 9:16 no Gemini Android, Nano Banana Pro pedido no prompt, texto separado e proveniência por hash. Modelo efetivo segue requested-not-verified. Revisão/liberação delegadas permanentemente; comprovar capas do novo episódio junto à publicação. Ver [decisões vigentes](docs/decisoes-vigentes.md#capas-e-imagens). |
| [YAI-063](docs/criterios-aceite-pulso.md#yai-063) — Variantes por plataforma | PARCIAL | Three.js r187/Remotion, humanos GLB/robô aprovados, masters próprios ≥360 s no YouTube, cortes verticais e capas Android. v2.36–2.38 entregaram blocos recuperáveis, finalização/cortes, revisão, Studio e reconstrução por crítica. v2.39 preserva retomadas operacionais, finaliza reservas sem duplicação, integra X Android/reconciliação e rejeita enquadramento pequeno na autoria; evidência visual nos dois formatos. v2.40 corrige concorrência com retry, progresso do X e retomada da VM Android pausada. Episódios reprovados continuam retidos; autoria de outros jobs e reconstrução seguem pelo serviço, sem novo envio confirmado. Falta comprovar nova mídia aprovada, distribuição por destino e ciclo seguinte. [Evidências atuais](docs/evidencias/autonomia-2026-11-04/README.md); histórico no resumo/releases. |


## 6. Dependências externas: preparar, registrar e seguir

Conferir estado vivo e prova por destino. Não presumir quota ou pausa atual a partir de outubro. X exige sessão/identidade e adaptador válidos; Analytics depende de escopos/dados reais; backup depende de destino adequado/janela; site/voz têm aceites próprios. Preservar resultados incertos e preparar os passos executáveis antes de solicitar informação realmente ausente. Os estados das linhas fora do incremento são evidências herdadas, não nova auditoria.

## 7. Marcos de aceite do projeto

- Produção: cinco dias reais monitorados, geração/QA/publicação por destino e nenhuma duplicação; redes pendentes ficam explícitas.
- Medição/aprendizado: sete dias reais de dados, contas/janelas/coortes conciliadas, experimentos controlados e conclusões sustentadas ou inconclusivas.
- Qualidade: variedade editorial, ações específicas à fala, capas/layouts próprios, áudio e revisão por hash; aprovação do piloto não é aprovação automática de todo artefato.
- Continuidade: recuperação, restore e rollback comprovados; frentes de site/voz/música conservam seus critérios.
- Fechamento integral: todos os 63 IDs e critérios atendidos; nenhum estado foi promovido nesta consolidação.

## 8. Validação e registro mínimo

Documentação: preservar IDs/estados, links, histórico e um único cursor. Código: testes pertinentes, lint e CI em estado isolado. Motion requer revisão real nos dois formatos. Release: commit/push no fork, minor +0.1, tag/release e SHA remoto. Não executar toda a CI por simples mudança de texto.

Acrescentar ao [resumo](resumo.md): data/fuso, entrega, validação/evidência, limites e próximo passo. [Critérios](docs/criterios-aceite-pulso.md) e [arquivo anterior integral](docs/archive/alinhamento-2026-11-02/plan.md) preservam detalhes históricos; não restaurar suas ordens superadas.
