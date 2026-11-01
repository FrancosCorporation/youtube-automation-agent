# Viabilidade de ASR/TTS local no navegador — 17/10/2026

## Escopo

YAI-040 avalia reconhecimento e síntese de fala que rodem no dispositivo do visitante. Ele não substitui o caminho atual de áudio do site, não muda o fallback textual e não autoriza ativar um modelo no navegador.

## Estado e medidas disponíveis

- O estado técnico registrado para o site em 15/10 é ASR Whisper base/int8 em CPU no backend, síntese Piper `pt_BR-faber-medium` no backend e reprodução/fallback `SpeechSynthesis` no browser. A transcrição é revisável. Esses fluxos passaram testes de serviço, mas não demonstram ASR/TTS offline no dispositivo do visitante.
- Os arquivos instalados do runtime neural medem 145.217.532 bytes para o peso Faster-Whisper base e 63.201.294 bytes para Piper `pt_BR-faber-medium.onnx`: 208.418.826 bytes (aprox. 208,4 MB decimais ou 198,8 MiB) somente nos dois pesos. O cache do Whisper também contém tokenizer, vocabulário e configuração, cerca de 2,7 MB adicionais. Essa é uma referência local reproduzível, **não** o tamanho de modelos convertidos para navegador nem uma promessa de download por visitante.
- O smoke documentado sintetizou uma amostra de 15,302 s (49 palavras) e o Faster-Whisper a transcreveu em CPU/int8 em sete segmentos. O teste registrou erros em nome próprio e algumas palavras. Não há medição de tempo de primeira resposta, consumo de RAM ou benchmark em aparelhos/browser para este objetivo.
- Transformers.js documenta tarefas de ASR e TTS no browser e fornece um exemplo de Whisper `tiny.en` com WebGPU. O exemplo oficial demonstra possibilidade técnica, mas é inglês e não prova qualidade PT-BR, suporte universal, nem latência aceitável nos aparelhos do site. [Guia oficial de WebGPU e Whisper](https://huggingface.co/docs/transformers.js/guides/webgpu) · [Tarefas suportadas por Transformers.js](https://huggingface.co/docs/transformers.js/en/index).
- Os artefatos locais em referência para comparação são [Faster-Whisper base (arquivo de 145 MB)](https://huggingface.co/Systran/faster-whisper-base/blob/ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66/model.bin) e [Piper PT-BR Faber médio (63,2 MB)](https://huggingface.co/rhasspy/piper-voices/blob/v1.0.0/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx). São modelos do runtime servidor; Whisper CTranslate2 não é diretamente o asset ONNX do exemplo browser.

## Decisão

**Adiar protótipo de ASR/TTS local no navegador.** O benefício operacional ainda não foi medido; o backend atual fornece áudio quando disponível e mantém texto quando não está, enquanto o browser já tem uma via de síntese do sistema. Um pacote ASR+TTS baseado nos pesos locais de referência começaria perto de 208 MB antes de runtime e metadados, sem evidência de que esses pesos possam ser usados diretamente no browser. O único exemplo de browser encontrado requer uma variante WebGPU e não valida PT-BR nem dispositivos móveis alvo.

Manter a documentação clara: há ASR/TTS no servidor e reprodução/fallback de voz no navegador; **não** afirmar que o áudio completo é local. Nenhum pacote foi instalado, modelo baixado, microfone acionado ou serviço alterado.

Reabrir quando existir necessidade observada de áudio sem rede/sem cota e um conjunto de browsers/dispositivos alvo. Nesse momento medir separadamente o download convertido de ASR/TTS, primeira execução, RAM, WER em fala PT-BR espontânea e qualidade da voz, com fallback textual acessível e consentimento de microfone. Esses dados não existem hoje e não foram presumidos.

## Evidência e limites

As medidas locais vieram do cache externo `~/.cache/pulso/models` e do smoke documentado em `docs/runtime-audio-neural.md`; o estado do frontend/backend vem de `docs/mascote-site-corp-interativo.md` e checkpoints em `resumo.md`. Revisão de fontes técnicas em 17/10/2026. Não houve sessão browser nesta avaliação, por isso compatibilidade, privacidade efetiva de cada engine, desempenho e experiência em aparelho permanecem sem prova.
