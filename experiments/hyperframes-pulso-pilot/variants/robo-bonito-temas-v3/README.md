# Pulso — cores distintas por tema (v3)

Pedido: diferenciar melhor os temas porque vários verdes e roxos se confundiam. Cada tema tem uma família principal própria e essa identidade fica fixa nas três variantes; as cores secundárias permanecem na mesma família. Fonte: config/themes.json, visualPalettes.identity e variants[].accents[0].

| Tema | Cor | Hex |
|---|---|---|
| Pulso IA | Ciano | #22D3EE |
| Pulso Curiosidades | Amarelo | #FDE047 |
| Pulso Dinheiro | Verde-esmeralda | #22C55E |
| Pulso Saúde | Branco-gelo | #F1F5F9 |
| Pulso Economia | Laranja | #FB923C |
| Pulso Mente | Violeta | #C084FC |
| Pulso Relações | Rosa | #F472B6 |
| Pulso Fitness | Vermelho | #F87171 |
| Pulso Mistérios | Azul-royal | #60A5FA |
| Pulso Carreira | Cobre | #BFA07A |

A galeria pública permite comparar os dez robôs lado a lado e clicar em um deles para ampliar sua prévia: https://francoscorporation.ddns.net/games/play/pulso-ia/robo-temas-v3/

A comparação v2 está preservada. O vídeo IA v2 é reutilizado: sua cor principal continua #22D3EE. Esta mudança não exigiu novo render de vídeo nem alteração de rig, áudio, gestos ou expressão.

Validação da configuração: dez primárias únicas e estáveis em todas as variantes; todas as outras propriedades de cada tema idênticas ao backup de antes; contraste mínimo das primárias sobre #0c1420 = 6,68:1. A menor distância OKLab entre primárias das primeiras variantes passou de 0,0521 para 0,0969. Esses números orientam a separação; não são garantia de percepção igual em todo dispositivo ou de distinção para todos os tipos de daltonismo. Mais próximos na v3: rosa de Relações e vermelho de Fitness.

HyperFrames 0.8.149 check --strict na composição IA: zero erros/avisos, nove amostras de layout, 27/27 contrastes. Capturas reais dos dez temas sem pageerrors. As miniaturas usam leitura do canvas no mesmo ciclo de render, com confirmação de área visível para evitar PNG vazio. A cor do visor é material nativo, não edição da referência original.

Worker NVIDIA Nemotron conferiu apenas os fatos do palette-audit.json e as contagens/configuração; revisão em worker-reports/. A escolha criativa e inspeção visual ficaram com o orquestrador.

Reprodução no diretório experiments/hyperframes-pulso-pilot:

```bash
node scripts/build-bonito-speaking-preview.js robo-bonito-temas-v3
node scripts/capture-bonito-themes.js robo-bonito-temas-v3
node scripts/build-bonito-theme-gallery.js robo-bonito-temas-v3
node scripts/qa-bonito-theme-publication.js robo-bonito-temas-v3
```

A anotação do futuro mascote interativo fica em docs/mascote-site-corp-interativo.md do repositório principal e em site_corp/docs/PLANO_MASCOTE_PULSO_INTERATIVO.md, indexado em docs/llms.txt do site. Ela inclui chat texto/áudio, guia spotlight, reutilização dos modelos do WhatsApp com prompt pedra separado, rate limit de backend, e fallback com modelo pequeno no navegador após 429. Ainda não implementado; cliente só recebe código/prompt/informações públicas, pois tudo que vai ao navegador é inspecionável.

Publicação final validada em dns-publication.json: 22 assets/hash, Range 206, dez botões e dropdown em desktop/mobile, sem overflow e proporção 16:9. Overview real inspecionado. Testes HTTPS executados deste host, não de rede externa independente.
