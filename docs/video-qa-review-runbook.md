# Revisão visual de vídeo e capa

**Continuidade em 24/10/2026:** este runbook define a liberação por artefato; agenda, recuperação e estado operacional estão em [workflow-autonomo.md](workflow-autonomo.md). A revisão recorrente deve ser executada pelo código/política delegada, sem pedir que o proprietário ou um assistente programador acompanhe cada job. Os comandos manuais abaixo são ferramentas de diagnóstico/reparo, não uma etapa humana obrigatória do workflow.

O último E2E rejeitou um roteiro com citações ausentes/deslocadas; nenhum MP4 foi produzido. O contrato atual usa `claimEvidence: [{path, quote}]`. O catálogo de fonte com IDs e a compilação local dos caminhos são **melhoria proposta, ainda não implementada**, descrita no guia. Não considerar cobertura por IDs já disponível nem marcar roteiro aprovado para destravar a produção. Após a mudança, evidência/hash incorreto, falta de cobertura e números não sustentados devem continuar bloqueando; alteração de roteiro invalida dependências e revisão anteriores.

Em 18/10/2026, o proprietário dispensou sua revisão individual e delegou a liberação ao agente: “Eu nao preciso de revisão confio em voce”. A política persistente está em `config/publication-review-policy.json`. Ela libera os novos jobs após a gravação no ledger e as verificações de fonte, revisão factual, checks técnicos, master/capa e hashes de todos os ativos. Não exige confirmação humana por vídeo.

O proprietário reafirmou que **todas as capas, em todos os nichos, são revisadas pelo agente ou QA automático, sem sua permissão individual**. Ele acompanha os vídeos depois da publicação. Produzir uma composição 16:9 para o master horizontal e outra 9:16 para a versão vertical; cada uma recebe arte, enquadramento e área segura próprios, sem reaproveitar a horizontal apenas recortada. A capa deve identificar o assunto e, quando central à pauta, o nome exato do modelo/produto; combinar texto PT-BR legível com imagem específica do conteúdo, criada no provider existente, e despertar curiosidade sem promessas falsas. A referência a modelos de IA é um exemplo aplicável aos demais nichos, não uma restrição temática. Defeito reproduzido deve ser corrigido pelo agente; `pending` é trabalho de QA, nunca uma fila de aprovação do proprietário.

O manifesto registra `visualReview.method: owner-delegated-automatic`, o hash/ID da política, horário e cada caminho/hash liberado. Para os novos jobs, `coverVariants.requiredFormats` declara as composições 16:9 e 9:16 que precisam constar da revisão. O status `approved` permite o gate de upload; **não declara revisão estética humana**. Reprovação explícita, cronologia reprovada, hold factual, arquivo alterado ou contrato técnico incompleto continuam retendo publicação. Resultados remotos incertos permanecem sujeitos à reconciliação, sem novo envio automático.

Na produção recorrente, o QA factual é determinístico e local. Cada afirmação no título, gancho, seção e conclusão aponta para uma citação da fonte; o verificador confere que o trecho exista, cobertura, números, termos em comum, negação, incerteza, direção e marcadores de causalidade, e grava hash, erros e histórico. Se algo falhar, o writer pode fazer até dois reparos pontuais; cada versão passa novamente pelo mesmo verificador local. Se ainda faltar evidência, o job para antes do render e o scheduler pode tentar outra pauta. Nenhum modelo de linguagem é chamado como revisor rotineiro. Este método valida proveniência e regras explícitas, mas não é uma prova semântica completa de paráfrases ou traduções; por isso a fonte é exclusiva, o writer recebe instrução conservadora e falha sem evidência mantém o bloqueio. Revisão visual/técnica local continua ligada aos hashes. Capas e adequação visual seguem a política automática delegada do agente.

Para reaplicar a política a um pacote pronto selecionado, use:

```bash
npm run review:video-auto -- data/reports/qa/<videoId>.json
```

O comando não renderiza, não publica e não percorre o arquivo histórico. O scheduler existente decide o envio, a conta e o slot; não crie um segundo uploader. Uma falha de liberação preserva a mídia e a geração concluída, evitando produzir cópias por esse motivo. `enabled: false` suspende novas liberações automáticas e mantém o procedimento manual abaixo; não revoga retrospectivamente arquivos já liberados.

## Registrar uma avaliação manual ou pelo agente

Use o caminho do manifesto do job e informe cada arquivo revisado. Para liberar o master do YouTube, inclua o master e sua capa na mesma revisão:

```bash
npm run review:video-qa -- data/reports/qa/<videoId>.json \
  --reviewer "Nome do avaliador" \
  --approve data/videos/<master>.mp4 \
  --approve data/videos/<thumbnail-horizontal>.png \
  --approve data/videos/<thumbnail-vertical>.png
```

Para uma avaliação manual de variantes sociais, passe também cada variante revisada com outra opção `--approve`. A aprovação do master não libera cortes. Quando o manifesto exigir o par de capas, aprove e inspecione também a versão vertical 1080×1920, incluindo a leitura em escala de tela de celular; a horizontal permanece 1280×720 e deve ser conferida também reduzida a 320×180.

O agente pode aprovar somente o caminho da capa quando ela já foi inspecionada e o vídeo ainda exige correção. O gate por ativo mantém master e cortes retidos; `visualReview.status: approved` nesse caso descreve somente os caminhos em `approvedAssets`. Não usar esse status isolado como liberação do pacote inteiro nem pedir revisão humana da capa novamente.

O comando recusa arquivos que não pertençam ao manifesto, exige todas as capas hash-bound marcadas como obrigatórias quando o master é aprovado, grava reviewer e horário no `visualReview`, e atualiza `qaManifestSha256` na entrada correspondente de `data/state/topics.json` (ou no diretório configurado por `STATE_DIR`). Ele não altera mídia.

O manifesto declara `editorial.visualMode`: `ai-generated-scenes`, `mixed-generated-scenes` ou `graphics-and-source-prints`. Use esse campo para entender a composição e inspecione o MP4 e cada arquivo por conta própria; o campo não aprova nenhum ativo nem muda o gate.

## Registrar uma reprovação

```bash
npm run review:video-qa -- data/reports/qa/<videoId>.json \
  --reviewer "Nome do avaliador" \
  --reject \
  --note "Descreva o problema encontrado"
```

Uma alteração de bytes depois da revisão invalida o manifesto no próximo preflight. Revise novamente o artefato atualizado para emitir novos hashes. O upload exige aprovação explícita por caminho e hash; a CLI de YouTube também exige `--qa-manifest` e aplica o mesmo gate.

### Registrar crítica por cena para reconstrução

O manifesto HyperFrames inclui o hash do plano de cenas e seus IDs. Para transformar uma inspeção visual em instruções verificáveis de correção, crie um JSON vinculado ao manifesto atual:

```json
{
  "schemaVersion": 1,
  "findings": [
    {
      "sceneId": "s1_0",
      "category": "composition",
      "severity": "high",
      "issue": "O robô cobre a informação principal.",
      "recommendedFix": "Reorganizar a cena em composição dividida.",
      "correction": { "operation": "set-layout", "layout": "split" }
    }
  ]
}
```

Registre a reprovação com o SHA-256 atual do manifesto:

```bash
npm run review:video-qa -- data/reports/qa/<videoId>.json \
  --reviewer "QA visual" \
  --critique /path/to/findings.json \
  --manifest-sha256 <sha256-do-manifesto>
```

A CLI valida os IDs contra o plano hash-bound, grava os apontamentos no manifesto, atualiza seu hash no ledger e bloqueia a publicação. Ela **não renderiza nem altera os MP4s**. `recommendedFix` é explicativo; somente `correction`, com operações allowlisted (`set-layout`, `set-presenter-visibility`, `remove-component` decorativo identificado ou `set-reveal-time` visual), é aplicado pelo renderer. Texto de cena, áudio, legendas e duração não podem ser alterados por essa rota.

Para reconstruir, acrescente a crítica à geração. O manifesto restaura tema, pauta, tamanho do roteiro, formato, versão, seed, contexto exato da fonte, roteiro em cache, áudio/alinhamentos, imagens de cena e referências, todos vinculados por hash. O rebuild não consulta novamente a fonte, não sintetiza outra voz nem pede novas imagens; falta ou alteração de qualquer entrada interrompe a execução antes do render. Opções editoriais explícitas só são aceitas se coincidirem com o manifesto. Escolha sempre um `--out` novo, ainda inexistente e distinto do master-fonte:

```bash
node scripts/generate-animated-video.js \
  --visual-critique-manifest data/reports/qa/<videoId>.json \
  --visual-critique-sha256 <sha256-atual-do-manifesto> \
  --out data/videos/<nome-unico-do-rebuild>.mp4
```

Use um nome novo em cada tentativa; não omita `--out` nem reutilize o caminho do master. O renderer recusa caminhos existentes e aliases do master-fonte, inclusive na gravação final. O plano base é recalculado antes das correções: hash ou IDs divergentes abortam o rebuild. O master original permanece preservado, em especial enquanto houver publicação remota incerta. O rebuild recebe manifesto/ledger próprios, fica pendente e exige novo QA visual dos quadros; não é aprovado nem publicado automaticamente.

## Quando o render falha antes do manifesto

O gerador registra `HYPERFRAMES_CHECK_FAILED`, `HYPERFRAMES_BUILD_FAILED`, `HYPERFRAMES_RENDER_FAILED` ou `HYPERFRAMES_TIMEOUT` como motivo estruturado. Uma falha de layout não deve aparecer apenas como `Error` no scheduler.

Antes de remover seu diretório temporário, o renderer grava `<caminho-do-mp4>.render-failure.json` junto da saída pretendida. O arquivo contém horário, etapa, código de saída/sinal quando disponíveis e o relatório JSON do último check, limitado a 2 MiB. Não inclui o stderr do provider. O diagnóstico pode existir sem MP4 e não representa aprovação ou publicação. Se não houver relatório legível, `checkReport` permanece `null`; a falha original continua sendo propagada.

Ao investigar, compare o diagnóstico com o log do mesmo job. Depois de corrigir a causa, uma nova geração precisa de seu próprio QA e hashes; nunca use esse diagnóstico para liberar o artefato anterior.
