# Robô bonito — voz e movimento

Primeira prévia animada do candidato que o usuário avaliou como “legalzinho”. O GLB original foi preservado em `../robo-bonito/assets/robo-bonito-hunyuan.glb`.

## Assistir

- Horizontal: https://francoscorporation.ddns.net/games/play/pulso-ia/robo-bonito-fala-gestos.mp4
- Vertical: https://francoscorporation.ddns.net/games/play/pulso-ia/robo-bonito-fala-gestos-vertical.mp4
- Studio local: http://localhost:3006/#project/robo-bonito-animado

Vídeos locais em `../../renders/pulso-robo-bonito-fala-gestos-preview.mp4` e `../../renders/pulso-robo-bonito-fala-gestos-vertical.mp4`. Ambos têm 27,625 s, 663 quadros a 24 fps e H.264/AAC; horizontal 1920×1080 e vertical 1080×1920. MP4s com moov no início para streaming. A narração fonte tem 27,616 s.

## Implementação

O arquivo `assets/robo-bonito-rigged.glb` tem **um skin e 17 joints**. Placas usam pesos rígidos, com blends restritos às bandas de juntas. Head, braços, antebraços, mãos e pernas têm controles próprios. Os pés permanecem estáveis; a animação do tronco e da cabeça acompanha gestos independentes dos braços. O corpo-fonte, UVs, orientação dos triângulos e bytes das três texturas foram preservados, com rotação de posições/normals para Y-up.

O visor recebeu material separado e quatro meshes nativas ligadas ao Head: `FaceEye_L`, `FaceEye_R`, `FaceSmile` e `FaceMouth`. Os gráficos estáticos da textura foram substituídos no visor, preservando a moldura branca. O runtime controla escala de olhos para piscar, sorriso e abertura de boca.

A fala é original em português e está em `narracao.txt`. Edge-TTS 7.2.8 retornou 403; foi usado gTTS já instalado (`pt`, `com.br`), sem API paga. Durações de cada frase foram medidas com ffprobe e os silêncios inseridos explicitamente. [Documentação primária gTTS](https://github.com/pndurette/gTTS/blob/main/docs/module.rst). Áudio final local: `assets/narracao.wav`; frases/timing em `assets/speech.json`. O envelope real usa passos de 10 ms e gate de silêncio.

A animação usa tempo absoluto no HyperFrames 0.8.149 / Three.js 0.186.1. Runtime: `../../src/bonito-speaking-preview.js`; pose/envelope/cues: `../../src/bonito-motion.js`. **O GLB possui rig e controles faciais, mas não contém clips baked**: o movimento desta prévia é produzido pelo runtime seekable.

## Validação

- Auditoria do GLB serializado: índices de joints válidos, pesos normalizados, Rest × inverse-bind com erro máximo 2,50e-8; UVs/texturas/winding/geometria-fonte preservados.
- Gate anatômico: zero triângulos com influências simultâneas de braço e perna. A primeira segmentação atribuía pontas dos dedos à coxa; isso foi corrigido antes da entrega, preservando a amplitude do gesto.
- QA de navegador nos dois formatos: 17 poses, oito provas de áudio/boca, fechamento de olhos, distância entre amostras rigidamente ponderadas preservada (erro máximo 1,33e-15), coordenadas finitas e pontos amostrados contidos nos planos abertos.
- Seek 22→2,4→22: PNGs do canvas idênticos.
- HyperFrames check estrito: zero erros/avisos; horizontal 32/32 contraste, vertical 20/20.
- MP4 horizontal: envelope da voz decodificada com correlação 0,999991 em relação à fonte, deslocamento medido 0 ms (resolução do teste: 10 ms), pico abaixo de clipping.
- Inspecionados quadros reais do MP4: fala, pausa/sorriso, blink, aceno, explicação e ambos os lados dos cinco cortes. Contatos `../../renders/pulso-robo-bonito-animado-contact.png`, `...-cortes.png`, `...-vertical-contact.png`.
- URLs: HTTPS 200, MIME video/mp4, SHA-256 idêntico ao arquivo renderizado, Range 206 e reprodução real em Chromium. Evidência em `dns-publication.json`. Cópias persistentes no bind mount existente do Caddy, sem alterar handlers ou catálogo de jogos.

## Limites desta versão

O lip sync é **abertura pela energia do áudio**, com fechamento nos silêncios; não é alinhamento fonético de visemas humanos. Os dedos conservam a forma e seguem a mão; falanges ainda não têm controles individuais. Não há certificação de auto-interseções em poses extremas arbitrárias. A prévia valida as poses e as amplitudes aqui usadas e permanece separada do apresentador de produção.

Dois workers NVIDIA extraíram contrato de rig e tempos de prova. O contrato foi conferido; os tempos de áudio foram rejeitados porque o worker retornou durações em vez de posições absolutas. O orquestrador calculou os tempos reais diretamente. Evidências em `worker-reports/`, com revisão explícita; nenhuma aprovação foi inferida do status candidate.

## Reprodução

A partir da raiz do piloto, nesta ordem, parando em caso de falha:

```bash
python3 scripts/prepare-bonito-speech.py
python3 scripts/rig-bonito-robot.py
node scripts/build-bonito-speaking-preview.js
python3 scripts/audit-bonito-rig.py
env -u DISPLAY -u XAUTHORITY node scripts/qa-bonito-speaking-preview.js
env -u DISPLAY -u XAUTHORITY node scripts/qa-bonito-speaking-preview.js robo-bonito-animado-vertical
env -u DISPLAY -u XAUTHORITY HYPERFRAMES_NO_TELEMETRY=1 npx --yes hyperframes@0.8.149 check variants/robo-bonito-animado --strict --snapshots --timeout 30000
```

Após rebuild, sincronizar GLB e bundle para a variante vertical antes de seu QA/render. Os MP4s aprovados deste experimento já estão congelados nas URLs acima.

## Revisão posterior — braços e cores

O usuário apontou um defeito visual dos braços após esta entrega. A auditoria completa revelou faces do antebraço presas ao Chest; testes de pares rígidos não detectavam esse problema. Esta prévia continua preservada para comparação. A correção e novos materiais por tema estão em ../robo-bonito-temas/README.md. Não promover o rig desta versão antiga à produção.
