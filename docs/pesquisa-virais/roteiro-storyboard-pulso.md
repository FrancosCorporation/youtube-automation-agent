# Roteiro e storyboard originais — Pulso (padrão "pauta quente")

Material próprio, derivado das fichas de referência (`analises/`) por interpretação — não copia texto, estrutura literal nem arte de terceiros. Atualizado em 13/10/2026.

## Contrato do formato (4–5 min, horizontal 16:9; cortes 9:16 derivados)

1. **Cold open (0–8 s):** o artefato da pauta em quadro (print/número/objeto) + primeira frase com afirmação e stakes. **Sem saudação.** O robô Pulso entra já gesticulando moderadamente; boca segue os visemas da narração.
2. **Promessa concreta (8–20 s):** o que o espectador vai entender ao final, em uma frase com número ou consequência.
3. **Evidência (20–90 s):** fonte primária na tela (print de anúncio/papel/documento) com recorte centrado na manchete; legenda karaokê frase a frase.
4. **Explicação em etapas (90 s–3:30):** 3–4 blocos, cada um com UM recurso visual novo (bento, gráfico, imagem editorial) e o robô alternando lado por cena; cutaway de imagem em cenas split, robô escondido (regra do framing determinístico).
5. **Fechamento útil (últimos 20 s):** resposta direta à promessa + UMA pergunta de opinião específica da pauta (gera comentário) + CTA de inscrição atado à promessa do canal.

## Exemplo de trabalho — pauta "chip de IA" (fatos a verificar na fonte primária antes de narrar; o crítico de roteiro do pipeline faz essa checagem)

- **Cold open (frase falada):** "A Microsoft mostrou um chip que ela diz ser mais rápido que 90% do que existe hoje para IA." *(número e afirmação dependem da fonte; nunca inventar)*
- **Promessa:** "Em quatro minutos você entende por que esse chip existe e o que muda para quem usa IA no dia a dia."
- **Etapas:** (1) por que a GPU virou gargalo; (2) o que o Maia 300 faz de diferente; (3) quem concorre; (4) o que chega ao usuário final.
- **Fechamento:** "Se o preço da inferência cair, o que você gostaria que ficasse mais barato: assistente, imagem ou busca? Comenta — e se inscreve para o próximo pulso da IA."

## Storyboard por cena (horizontal; cortes 9:16 = mesmas falas com foto acima do robô)

| Cena | Tipo | Apresentador | Recurso | Legenda |
|---|---|---|---|---|
| 1 | hero | visível (dir.) | artefato em destaque | frase do cold open |
| 2 | bento | visível (esq.) | bento com número-chave | promessa |
| 3 | split | oculto | print da fonte + legenda | evidência (2 frases curtas) |
| 4 | hero | visível (dir.) | imagem editorial etapa 1 | etapa 1 |
| 5 | split | oculto | gráfico comparativo | etapa 1 (continuação) |
| 6 | hero | visível (esq.) | imagem editorial etapa 2 | etapa 2 |
| 7 | split | oculto | segunda imagem/cutaway | etapa 3 |
| 8 | hero | visível (dir.) | imagem editorial etapa 4 | etapa 4 |
| 9 | bento | visível (esq.) | pergunta de fechamento | CTA opinião + inscrição |

Regras: gestos moderados e determinísticos do robô (aceno apenas em abertura/fechamento); boca por visemas fonéticos (Rhubarb); legenda karaokê por word-timing real; marca d'água sempre fora da zona do robô (lado oposto ao `data-presenter-side`); cortes com afirmação+stakes nos 3 s.

## Experimentos — um fator por comparação, métrica definida antes da publicação

| # | Fator | Variação | Métrica (definida antes) | Quando |
|---|---|---|---|---|
| 1 | Gancho | afirmação+stakes vs pergunta do título | retenção média dos 30 s (YouTube Studio) | 2 vídeos seguidos do mesmo tema |
| 2 | Posição do robô | direito vs esquerdo na cena 1 | retenção 30 s | alternância por seed já existente |
| 3 | Legenda | karaokê vs estática nos cortes | % assistido no TikTok/Kwai | 2 cortes do mesmo vídeo |
| 4 | Fechamento | pergunta de opinião vs CTA seco | comentários/1k views | 2 vídeos seguidos |
| 5 | Duração | 4 min vs 7 min no mesmo tema | retenção média + % assistido | par de vídeos no mesmo dia |

Regras: uma variação por vídeo-piloto (o resto idêntico), resultados datados no `docs/pesquisa-virais/experimentos.md` (a criar), nenhuma afirmação de causalidade com n=1, views de terceiros não usadas como evidência dos nossos vídeos.
