# Recuperação do render e sessão Instagram — 03/11/2026

- Job real: `aadd101f-53bd-4eb9-b758-740a42ab4b1a`, 461 s, 11.064 quadros a 24 fps. Horizontal em andamento pelo serviço único; nenhum novo master/publicação confirmado nesta observação.
- Falha antecipada no código: deadline total de três horas para os dois formatos sequenciais. Correção: limites por processo, progresso por contadores Remotion e persistência de blocos de 30 s, com retomada por hash. Áudio muxado apenas uma vez.
- Backup real inicial de 4.320 capturas completas, identidade `fc66d73bf7ccaa7dec7ff0ff9f3659fb47f973884861fd154ea58859ebb04cdf`. O processo ativo e seus arquivos permaneceram intactos. Evidência privada em `data/reports/render-recovery-20261103/`.
- Instagram: tela de postagem sem aba de perfil reproduziu `unknown`; patch retorna uma vez e exige perfil próprio/handle. Conferência real após patch confirmou a conta. TikTok/Kwai confirmados; X falhou em `libyoga.so`, além de faltar identidade/adaptador.
- Testes de recuperação usam subprocessos simulados e arquivos reais; FFmpeg real confere contagem de quadros/áudio na união de segmentos. Não equivalem a render integral do episódio ou postagem. Uma captura horizontal real foi inspecionada; vertical integral ainda pendente.
- Não houve reload, publicação manual nem alteração de recursos/contas/cadência. Alterações anteriores de TTS/apoio/experimentos preservadas fora do commit.
