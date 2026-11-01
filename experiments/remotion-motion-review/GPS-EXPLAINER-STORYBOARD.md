# Storyboard — Como o GPS encontra você?

**Objetivo:** demonstrar um explicador narrativo em que a animação mostra a causa e a transformação de cada beat. A referência é a progressão física de `IceFloatsReview`; o tema GPS usa seus próprios objetos, movimentos e paleta.

**Formato:** 9:16, 1080×1920, 24 fps. Narração Edge Neural em PT-BR. Cena didática vetorial, com um mundo contínuo: satélites enviam sinais, intervalos viram distâncias, as superfícies de alcance se cruzam e uma posição emerge. Sem mascote: o conceito é o protagonista.

## Beats

1. **Não existe coordenada pronta.** A Terra e o receptor aparecem; quatro satélites surgem em sequência no céu.
2. **Cada satélite envia tempo e posição.** O primeiro pulso atravessa o espaço; `T₀` e `T₁` marcam saída e chegada.
3. **O intervalo vira distância.** A fórmula `Δt × velocidade da luz = distância` liga a fala ao percurso do sinal.
4. **Uma distância permite muitos lugares.** Uma esfera de alcance se expande; pontos candidatos aparecem na superfície da Terra.
5. **Outras medições cruzam as esferas.** Novos arcos surgem e eliminam candidatos, mantendo o receptor como ponto visual persistente.
6. **A quarta medida corrige o relógio.** Um relógio no próprio receptor sai do desalinhamento e converge quando chega o quarto sinal.
7. **Resolução.** Os sinais convergem em um ponto; a composição fecha com “tempo + geometria = posição”.

## Guardrails

- Fontes: GPS.gov, FAA e USGS. O sinal transmite horário e dados de órbita/localização; o receptor estima a distância pelo tempo de propagação.
- A quarta medição ajuda a resolver o erro do relógio do receptor junto com latitude, longitude e altitude; não dizer que quatro sinais eliminam todas as fontes de erro.
- As esferas, órbitas e distâncias são uma ilustração simplificada e fora de escala; nenhuma coordenada ou cidade foi inventada.
- Legenda sincronizada por beat, fonte no rodapé, contraste alto e conteúdo central nas margens seguras.
