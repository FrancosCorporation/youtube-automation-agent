# Robô Pulso gerado de uma referência

Em 12/10/2026, a referência foi criada com o `imagegen` integrado, preservando a identidade do robô procedural moderno. Prompt completo: `prompt-referencia.txt`. A imagem de corpo inteiro e A-pose está em `assets/pulso-robo-referencia-apose.png`.

Essa imagem foi convertida no Tencent Hunyuan 3D V3.1 com 500k faces. A cota observada passou de 20 para 19, sem contratar modalidade paga. O GLB foi baixado a partir da URL retornada pelo download do próprio asset. O acordo consultado é o [termo do provedor](https://rule.tencent.com/rule/202501080004); este experimento não certifica licença comercial ou elegibilidade territorial da conta.

## Arquivos e resultado

- `assets/pulso-robo-hunyuan.glb`: 49.959.816 bytes, uma malha, um material, três texturas incorporadas, 294.213 vértices e 500.000 triângulos. Não depende de texturas remotas.
- `index.html` e `assets/generated.bundle.js`: composição HyperFrames local, com poses de câmera de frente, perfil, costas e close. O vídeo desloca o apresentador entre esquerda, direita e centro.
- `../../renders/pulso-robo-gerado-preview.mp4`: prévia visual sem áudio, H.264, 1920×1080, 24 fps, oito segundos e 192 quadros.
- `../../renders/pulso-robo-gerado-frente.png`, `perfil.png`, `costas.png` e `close.png` com o mesmo prefixo: capturas em Three.js.
- `../../renders/pulso-robo-gerado-video-frame.png`: quadro extraído do MP4 final.
- `asset-manifest.json`: procedência, hash e estado da integração. `mesh-audit.json` registra a integridade estrutural básica; `qa-metrics.json`, o carregamento e a repetibilidade dos seeks.

Preparar o bundle: `node scripts/build-generated-robot-preview.js`, a partir da raiz do piloto. Abrir `http://localhost:3004/#project/robo-gerado` enquanto o preview estiver ativo.

## Validação e limites

O GLB carregou no GLTFLoader do Three.js 0.186.1. A malha tem posições finitas e índices dentro do intervalo, sem triângulos com índices repetidos. HyperFrames 0.8.149 passou no check estrito com zero erros/avisos, layout sem problemas e 51/51 verificações de contraste. Seeks 6.5→0.5→6.5 produziram PNGs idênticos. Foram capturados os quadros anterior e posterior a cada corte de câmera.

O arquivo tem **zero skins e zero animações**. Nesta prévia, a malha gira inteira; braços, cabeça, olhos e boca ainda não têm controles separados. A fonte, UVs e materiais exportados foram preservados. Um teste local reduziu normal mapping e reflexo especular no renderer, mas a mudança não foi adotada.

Antes de substituir o apresentador que fala, preparar articulações/rig e controles faciais, inspecionar deformação em poses amplas e validar seeks com a narrativa. A malha densa também precisa de avaliação de redução de geometria para uso interativo. A prévia confirma que podemos carregar e renderizar esse GLB em vídeo; não aprova animação nem substitui o robô ativo. `src/production-presenter.js` continua usando `presenter-robot.js`.
