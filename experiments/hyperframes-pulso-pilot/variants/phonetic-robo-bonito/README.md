# Pulso — voz neural Piper e boca fonética Rhubarb

Prévia de produção com narração sintetizada e boca dirigida por reconhecimento fonético. Roteiro próprio (49 palavras, sete grupos) demonstrando conversa, tutorial FranRadar e fallback local; não é notícia publicada nem transcrição de vídeo anterior.

Publicada para avaliação (demonstração técnica identificada na página):

- Página: https://francoscorporation.ddns.net/games/play/pulso-ia/producao-robo-fonemas/
- Horizontal: https://francoscorporation.ddns.net/games/play/pulso-ia/pulso-fonemas-voz-neural.mp4 (1920×1080, 6.630.019 bytes, sha256 a545889d…)
- Vertical: https://francoscorporation.ddns.net/games/play/pulso-ia/pulso-fonemas-voz-neural-vertical.mp4 (1080×1920, 5.461.632 bytes, sha256 25d47723…)

## Procedência

- **Voz**: Piper 1.8.0, voz `pt_BR-faber-medium` (snapshot e9ef9dd), CPU. Modelo em `/media/servidor/nvme_data/pulso/models/piper/`; sha256 do modelo no manifest: `858555e3…`. `lengthScale` 0,96.
- **Áudio**: duração 15,348 s, 22.050 Hz; sha256 da fonte congelado em `assets/voice-manifest.json` (`b779550a…`), junto com tempos por palavra e grupos.
- **Boca**: Rhubarb Lip Sync 1.14.0, recognizer `phonetic` (independente de idioma), shapes A–F/X convertidos em sete formatos estilizados de boca LED por `src/viseme-track.js`; cues por tempo absoluto, retorno ao repouso nos silêncios.
- **Alinhamento**: `scripts/pulso_word_alignments.py` associa grupos fonéticos às palavras, preservando acentos/pontuação/FranRadar como palavra única (49 palavras, 50 grupos, 116 cues).

## Formato e verificações

- 15,375 s, 369 quadros, 24 fps, H.264/AAC 48 kHz estéreo. Decodificação completa sem erros nos dois formatos.
- Correlação PCM fonte/render ≈ 0,99937856 nos dois formatos; velocidade original preservada (diferença de samples por padding AAC).
- HyperFrames 0.8.149 check: horizontal zero erros/avisos, nove amostras de layout, 54/54 contrastes (aviso inicial de render-ready após 3 s registrado no log); vertical aprovado.
- QA determinístico de seeks/visemas, 17 ossos, boca em repouso no silêncio e margens horizontais: aprovado (`/media/servidor/nvme_data/pulso/phonetic-seek-qa.json`).
- Publicação validada: HTTPS 200, `video/mp4`, hash remoto idêntico ao local, Range 206 e reprodução real desktop (1366×900) e mobile (390×844) sem erros de página (`scripts/qa-fonemas-publication.js`).

## Limitações

- Boca fonética é aproximação estilizada em sete formatos LED; não é captura facial nem alinhamento perfeito de português.
- Voz neural em CPU; tempo de geração e naturalidade devem ser avaliados com o usuário antes da operação contínua.
- Prévias anteriores (integração e temas) permanecem publicadas para comparação; não promover sem aprovação visual do usuário.

## Reprodução

Scripts na raiz de `youtube-automation-agent/scripts/`:

1. `prepare-pulso-neural-audio.py` — congela áudio, timing e hashes em `voice-manifest.json`.
2. `prepare-phonetic-bonito.cjs` — constrói cenas, legendas e cues a partir do manifest (variantes `phonetic-robo-bonito` e `phonetic-robo-bonito-vertical`).
3. `npm run check` e render nas variantes; `qa-production-bonito.mjs` para QA de seeks/visemas.
