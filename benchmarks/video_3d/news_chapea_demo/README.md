# Piloto de notícia em Three.js procedural

Vídeo de aproximadamente um minuto sobre a missão análoga CHAPEA 2 da NASA. Cenário e quatro figuras da equipe são geometria 3D construída em Three.js r187; o robô apresentador é o GLB aprovado já usado pelo projeto. As pessoas são modelos estilizados, não retratos dos voluntários.

Fontes, fatos e texto narrado: [noticia.md](noticia.md) e [narracao.txt](narracao.txt). A cena é uma reconstrução explicativa, não uma réplica técnica do habitat.

## Render e revisão

Execute a preparação, renderização segura e QA local com:

```bash
node benchmarks/video_3d/news_chapea_demo/render-and-review.cjs
```

O comando reutiliza áudio e alinhamento já salvos, usa o lock e o gate compartilhados com o scheduler, fixa o bundle em uma única árvore Three.js r187, renderiza H.264/AAC e verifica codec, resolução, fps, duração, quantidade de frames, faixa de áudio, decodificação integral, silêncio, quadros pretos e congelamentos de três segundos ou mais. Também extrai seis quadros para revisão visual, gera `review-contact-sheet.png` e registra duração do pipeline/render, propriedades e SHA-256 em `reports/render-qa.json`. Para reexecutar só as verificações sem renderizar de novo: `node benchmarks/video_3d/news_chapea_demo/render-and-review.cjs --qa-only`.

O resultado esperado é 1920×1080, 30 fps, 60 segundos, com narração PT-BR e legendas por frase. A revisão semântica continua sendo específica da cena: o QA local detecta falhas de arquivo/render, mas não garante que cada gesto, personagem, relação física ou afirmação esteja correta.

Este é um piloto com cenas escritas à mão. Ele comprova que o renderer consegue desenhar esta narrativa quando lhe são dadas uma cena, ações e câmeras definidas; ainda não transforma qualquer notícia arbitrária em uma produção 3D completa automaticamente.

## Assets recuperáveis

A [release v2.15.0](https://github.com/FrancosCorporation/youtube-automation-agent/releases/tag/v2.15.0) fornece o MP4 e um ZIP com narração, alinhamentos, roteiro, prancha, seis frames e relatório QA. Para restaurar os assets do ZIP, extraia-o na raiz do repositório; o `assets-manifest.json` verifica os arquivos contidos. Recrie o pacote com `python3 benchmarks/video_3d/news_chapea_demo/package-assets.py` depois do render e QA.
