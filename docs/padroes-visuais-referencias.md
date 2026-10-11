# Padrões Visuais — Análise Frame a Frame das Referências

Referências analisadas (visão computacional via NVIDIA llama-3.2-90b-vision):
- **hJDETQZi0NM** — "I Built an AI Coding Server with Zero Cloud Costs" (RGSecurityTeam, 8:27)
- **FIi2arm_DWM** — "Adding a Second GPU to My AI Rig" (Codacus, 17:50)

## Padrões identificados (→ implementação no pipeline)

| Padrão das referências | Onde aparece | Implementado como |
|---|---|---|
| Spec callout com glow ("32GB VRAM" em retângulo azul brilhante no fim de um corredor 3D) | ref1 abertura | `spec-chips` — números citados na fala viram badges brilhantes |
| Labels de spec flutuando ("SLOT 1 x8", "LANES") ao redor de ilustrações | ref2 cenas 2D | `spec-chips` + `kinetic-number` |
| Barras de progresso animadas (35%, "6/6" de páginas) | ref1 + ref2 | `progress-bar` (gatilho: % citada na fala) |
| Chapter badge ("S1 - THE BUILD" topo-esquerda) | ref2 | `demo-header` (só o tema à esquerda, sem contador) |
| Print real de interface (Kaggle "Turn on GPU T4 x2", botões, import) | ref1 | `article-print` — screenshot real do G1/veículos |
| Tabela de comparação com veredito (WORKLOAD / ONE 3060 / TWO 3060s / VERDICT) | ref2 | `score-chart` vertical/horizontal (tabela pura = evolução futura) |
| Checklist com checkboxes ("BUYING CHECKLIST": ONE 3060 / 27B-35B MODELS / RAM FIRST) | ref2 | evolução futura — gatilho textual: /checklist|dicas|passo a passo/ |
| Cards neon com cutout + glow + leve perspectiva (CPU/DISK/MEMORY/GPU/VRAM/POWER/TEMP) | ref2 | `bento-card` + `news-card` (perspectiva = evolução futura) |
| Gráfico de linha (roxo) + tabela de specs + logo lado a lado (Qwen product page) | ref2 split | `score-chart` + `spec-chips` no layout split/splitL |
| Cenas 2D flat com personagem + setup tech + status ("RENDER 1:22") | ref2 | imagens Gemini (ângulo isométrico/ilustrado) |
| Render 3D de hardware com iluminação de estúdio + profundidade de campo | ref1 (Tesla T4) | variante "e" dos prompts de imagem (render 3D) |
| Timestamps e contadores ("Friday 1d 2h", "00:46:29") | ref2 | evolução futura (HUD de tempo) |

## Regras de montagem (síntese)

1. **Tudo que é falado aparece**: números → chips/progresso; comparações → gráfico; notícia → print real.
2. **Sincronia absoluta**: o elemento entra na tela NO MOMENTO em que a narração o menciona.
3. **Ritmo de layout**: alternar hero (imagem full) → split (imagem + conteúdo) → split espelhado; nunca 2 cenas seguidas com mesmo layout E mesma imagem.
4. **Paleta**: fundo escuro azul-preto (#0A0A0F), acentos azul/ciano/amarelo, glow suave nos elementos-chave.
5. **Referência real sempre que existir**: print do artigo (G1), cards de manchete de outros veículos, notas de avaliações.
6. **Profundidade**: imagens com Ken Burns; cards com sombra grande; véu escuro para legibilidade de texto sobre imagem.

## Pipeline atual (scripts/generate-animated-video.js)

```
G1 (1ª notícia de IA) → contexto real (2600 chars)
  → roteiro NVIDIA (ultra-550b) com visual score-compare
  → narração edge-tts POR GRUPO + SRT (timings reais palavra-a-palavra)
  → 6 imagens Gemini/seção (plano geral, interface, isométrica, abstrata, render 3D, macro)
  → prints reais (G1 + 2 veículos via Google News)
  → render: cenas = frases reais do áudio; rotação hero/split/splitL;
    spec-chips, progress-bar, score-chart v/h, article-print, news-card,
    bento, node-graph, highlight, legendas sincronizadas
```

## Evoluções futuras (backlog)

- [ ] `compare-table` (tabela com colunas A/B/veredito — dados via campo `visual.type: "table"`)
- [ ] `checklist` (checkboxes animados — gatilho textual)
- [ ] Cards com leve rotação 3D (transform: perspective + rotateY)
- [ ] HUD de timestamp ("DIA 1 · 14:32") nas cenas de processo
- [ ] Skill opencode reaproveitável (gerar vídeo novo = 1 comando)
