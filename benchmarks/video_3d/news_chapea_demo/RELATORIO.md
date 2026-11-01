# Piloto CHAPEA 2 — Three.js procedural

## Resultado

Vídeo de 60 segundos, 1920×1080, 30 fps e H.264/AAC. A cena 3D e as quatro pessoas são geometrias procedurais estilizadas em Three.js r187; o robô é o apresentador 3D aprovado do projeto, com gestos e lip-sync ligados à narração. As pessoas são ilustrativas, não retratos dos participantes. O habitat é uma reconstrução explicativa sem pretensão de precisão arquitetônica.

## Notícia e fontes

- [NASA’s Simulated Mars Crew Marks One Year Inside Habitat](https://www.nasa.gov/humans-in-space/nasas-simulated-mars-crew-marks-one-year-inside-habitat/), 19/10/2026.
- [NASA Invites Media to Crew Completion of Yearlong Mars Simulation](https://www.nasa.gov/news-release/nasa-invites-media-to-crew-completion-of-yearlong-mars-simulation/), 27/10/2026.

Quatro voluntários participaram da simulação CHAPEA 2 por 378 dias, dentro do Mars Dune Alpha em Houston. A narração menciona o cultivo, as restrições de recursos, atividades externas simuladas e atraso de comunicação. A NASA anunciou a conclusão e saída planejada para 31/10; o texto não afirma que a equipe chegou a Marte nem transforma o anúncio planejado em confirmação independente da saída.

## Render e revisão

O vídeo final é `../outputs/news_chapea_procedural.mp4`. O manifesto técnico e o SHA-256 estão em [reports/render-qa.json](reports/render-qa.json); a folha com quadros dos segundos 4, 16, 24, 32, 44 e 54 está em `review-contact-sheet.png`.

Na execução final, o processo de render levou **148,476 s**. Do início da preparação — reutilizando o áudio e os alinhamentos existentes — até o fim do QA foram **159,339 s**. Esses tempos incluem o guard, bundling e validação; não incluem pesquisa, escrita do roteiro, autoria/revisão da cena ou a inspeção visual posterior.

FFprobe confirmou H.264/AAC, 1920×1080, 30 fps, 1.800 frames e duração de 60,011 s. FFmpeg decodificou o arquivo inteiro; os scans não acharam quadros pretos nem trechos congelados de três segundos ou mais, e a faixa de voz teve volume médio medido em −24,2 dB. A revisão dos quadros encontrou falhas semânticas que os checks técnicos não detectam: as costelas do teto cruzavam as pessoas e o arco de comunicação ficava oculto; o globo também aparecia cortado em planos sem relação com comunicação. As costelas e o arco foram corrigidos no JSX, a Terra foi enquadrada apenas durante a explicação do sinal, e o MP4 final foi renderizado de novo e inspecionado.

## O que o código faz e o que ainda não faz

`render-and-review.cjs` oferece um comando reproduzível para este piloto: prepara/reutiliza a voz, adquire o lock e passa pelo gate de recursos do produtor, renderiza com uma única árvore Three.js r187, faz as verificações locais de mídia e gera quadros para revisão. `remotion.config.js` alinha Three.js, React Three Fiber, Remotion e React do apresentador aprovado às cópias do benchmark; a prévia não mostrou mais a mensagem de múltiplas instâncias.

O aviso restante é de `THREE.Clock` obsoleto dentro do React Three Fiber 9.8.2. O render terminou; a composição e o apresentador derivam movimento do frame atual do Remotion, não do relógio de parede.

Isto **não** significa que o projeto converte automaticamente qualquer notícia em personagens e cenas corretas. Notícia, seleção dos fatos, modelos humanos, ações, câmera e relação visual com cada fala deste piloto foram escritos para CHAPEA em `noticia.md`, `narracao.txt`, `storyboard.json`, `MarsHabitatScene.jsx` e `index.jsx`. O QA automático detecta falhas técnicas de arquivo e produz evidências; a coerência física/factual e a qualidade da direção ainda exigem revisão específica. A integração desta rota como padrão geral do scheduler não foi feita nem comprovada por este piloto.

Comando para reproduzir a preparação, renderização e revisão:

```bash
node benchmarks/video_3d/news_chapea_demo/render-and-review.cjs
```
