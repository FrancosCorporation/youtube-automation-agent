# Auditoria dos recursos avançados do fluxo Express

**Data:** 13/10/2026, 16h23 (-03, America/Sao_Paulo)
**Escopo:** matriz estática de endpoints, serviços, provas locais e dependências externas; sete métodos de teste foram executados em banco temporário, com dotenv/credenciais desativados. Não houve uso de conta nem chamada de publicação.

| Recurso | Código/API observado | Teste observado nesta sessão | Natureza da prova e limite |
|---|---|---|---|
| Edição/reparo de cenas | `utils/scene-repair-service.js`; `PATCH /api/content/:productionId/scenes/:sceneId`, ações de reconstrução/regeneração protegidas em `index.js` | `testSceneRepairStudio` — passou | Fixture SQLite em temp; gerador, TTS e renderer injetados/falsos. Um MP3 fake não permitiu medir duração e o teste preservou duração anterior; não houve provider nem render real. |
| Shorts Studio | `utils/shorts-repurposing-service.js`; propor, editar, renderizar e aprovar em `/api/content/:productionId/shorts/...` | `testShortsRepurposingStudio` passou em IMP-20261014-05 | Render vertical em fixture FFmpeg e SQLite temporário; aprovação cria agenda, mas nenhuma publicação ou integração real foi chamada. |
| Engajamento e comentários | `utils/audience-engagement-service.js`; sync, análise, rascunho/edição/aprovação em `/api/engagement/...` | `testAudienceCommentSync`, `testReplyApprovalAndPosting`, `testEngagementAIProviderWiring`, `testEngagementSyncSchedule` — passaram | DB isolado; listagem/insertComment foram stubs, a IA recebeu chave de teste sem request. Aprovação conferiu `confirmed:true`, escopo `youtube.force-ssl`, limite diário e bloqueio de duplicata. Não houve leitura/postagem em YouTube real. |
| Discoverability | `utils/discoverability-service.js` e adapter DarkzSEO; endpoints de auditoria/revisão protegidos | `testDiscoverabilityPreflight` — passou | Adapter fake, auditoria local e HTTP de loopback; fallback bundle verificado quando Python/DarkzSEO externo não está disponível. Não consultou serviço externo. |
| Providers de vídeo | `utils/video-providers.js`, registry e `MediaGenerationService`; fornecedores incluem Seedance/Replicate, MiniMax, Gemini Omni, Kling, Wan e slideshow | `testVideoProviderLayer` passou em IMP-20261014-05 | Clientes fake e FFmpeg sobre MP4 sintético em diretório temporário; nenhum provider pago ou integração real foi exercitado. |
| ROI/objetivos | `ChannelLearningEngine`, `AnalyticsOptimizationAgent` e rotas de outcomes | `testOutcomeROIStudio` — passou | DB temporário e métricas sintéticas; consulta Analytics foi substituída por stub. Verifica meta, ROI e recomendação sem aplicação automática. Não representa métricas próprias do canal. |
| Retenção por cena | `utils/scene-retention-engine.js`, integração com relatório de Analytics | `testSceneAwareRetentionStudio` existe; não executado nesta sessão | Validar fonte atual e execução em DB isolado ainda pendente; esta auditoria não confirma relatório real do YouTube. |

## Proteções e dependências

- Mutations de revisão, edição, agenda, publicação, engagement e discoverability usam o middleware `protect`; com `API_KEY` ausente, o servidor informa restrição ao loopback. O teste de discoverability abriu servidor apenas em `127.0.0.1`.
- A aprovação de resposta exige confirmação explícita e escopo OAuth `youtube.force-ssl`; o teste injeta o escopo e um `insertComment` fake. Portanto ele verifica a regra, não credencial/capacidade da conta.
- `publish-now` é endpoint separado e dispara publicação ao invocar os agentes. Não foi chamado.
- A API de analytics real requer OAuth/YouTube Analytics; os testes ROI e de engajamento usam amostras/stubs.
- Providers podem gerar custo quando acionados. Os testes provider são dependentes de cliente fake, mas parte deles também consome FFmpeg local.

## Verificação executada

Executados com `YOUTUBE_AUTOMATION_DB_PATH` e `STATE_DIR` em diretório temporário, `API_KEY` e chaves de providers removidas, e shim que impede carregar `.env`:

```text
testOutcomeROIStudio                 PASS
testSceneRepairStudio                PASS
testDiscoverabilityPreflight         PASS
testAudienceCommentSync              PASS
testReplyApprovalAndPosting          PASS
testEngagementAIProviderWiring       PASS
testEngagementSyncSchedule           PASS
```

O runner temporário não equivale a `npm test` completo. Shorts/provider incluem FFmpeg; testes de renderer abrem Chromium. Não foram executados enquanto a automação de produção permanecia ativa. O runner CI possui isolamento de DB/estado e desativa dotenv, mas a suíte completa continua pendente em janela segura.

Na fotografia desta auditoria às 16h23, YAI-051 estava **Parcial**: sete verificações isoladas de serviços/API haviam passado; Shorts, provider FFmpeg, retenção por cena, UI/E2E e suite integral ainda precisavam de validação. O adendo abaixo registra as atualizações posteriores.

## Adendo de validação — 13/10/2026, 16h49 (-03)

`testSceneAwareRetentionStudio` foi executado isoladamente após a auditoria inicial e passou. O método usa um banco SQLite em diretório temporário, uma curva sintética com queda de retenção na cena de introdução, e uma resposta mockada do cliente Analytics. A fixture também verifica que recomendações ficam pendentes até aprovação e que dados marcados como simulados não são persistidos como evidência real. Nenhuma credencial foi carregada, nenhuma chamada ao YouTube foi feita e o banco temporário foi removido no `finally`.

O inventário passa a contar oito verificações locais aprovadas. A prova é funcional para o mapeamento e a regra de aprovação, mas não valida retenção obtida de um canal real. Shorts Studio e a camada de providers continuam adiados porque renderizam fixtures com FFmpeg enquanto o scheduler de produção está ativo; interface/E2E e suite integral também permanecem pendentes.

## Adendo de validação — 13/10/2026, IMP-20261014-05

`testVideoProviderLayer` e `testShortsRepurposingStudio` passaram em execução isolada. O runner desativou dotenv, removeu variáveis de credenciais dos providers e suprimiu escrita de log no checkout. As fontes de vídeo e os MP4s foram fixtures curtas criadas por FFmpeg em diretórios temporários; os clientes de providers foram substituídos por fakes. A agenda do Short foi gravada somente no SQLite temporário e os artefatos foram apagados ao fim. Não houve chamadas a providers, YouTube Analytics, publicação ou conta real.

A suíte `npm test`/`test:ci` também passou 49/49 testes de sistema; seu script chama `node test.js`, que inclui os dois métodos de FFmpeg e os oito métodos listados anteriormente. YAI-051 fica **Concluído localmente** porque a matriz de recursos, provas isoladas e limites externos estão registrados e o gate de teste está coberto. Essa conclusão não significa validação visual de UI/E2E ou funcionamento de uma integração externa real; esses limites seguem explícitos para quem for integrar o fluxo no produto.
