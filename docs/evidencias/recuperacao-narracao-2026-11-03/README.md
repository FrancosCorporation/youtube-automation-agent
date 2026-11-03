# Recuperação da narração e autoria — 03/11/2026

## Falha reproduzida

Job `53814e09-9d82-4a3b-8c81-6f1f6af612c2`, pauta sobre lavar a louça enquanto cozinha. Na retomada, mais de 110 tentativas e fila vazia. Dois tokens `-` isolados no nome “SSM - Population Health” eram considerados palavras: 1169 tokens do texto contra 1167 palavras nos eventos corretos do Edge TTS. A reprodução local encontrou exatamente esses dois separadores, sem palavras faltantes. O caminho alternativo da CLI retornava uma transcrição longa truncada/repetida; essa resposta continua reprovada.

A tokenização distingue palavras e pontuação, preservando os tempos medidos e o texto das legendas. Aspas isoladas não criam frases de duração zero. Trechos combinados do provedor continuam explicitamente marcados como alinhamento misto. Negação/palavra ausente continua sendo erro, com regressão automatizada.

## Prova pelo serviço

`logs/gen_2026-11-03T20-53-25-738Z.log`: oito grupos, 61 frases, voz `pt-BR-FranciscaNeural`, 504,864 segundos medidos por ffprobe. SHA-256 do áudio: `196f5e1a54f370751f6d07b42f574ecbb7ae9ac75ecdb905e01928551ec4f19f`, coincidente com o manifesto do cache. Duas capas Gemini Android prontas; Nano Banana Pro solicitado, modelo efetivo não verificado. Quinze imagens disponíveis em cinco dos oito grupos; falhas de abertura/download Android preservaram o cache e suspenderam novas gerações nessa tentativa.

A produção chegou à autoria 3D, onde houve tubos com lista de pontos vazia e notas `explanation` acima de 600 caracteres. O schema de saída agora distingue primitivas e curvas/perfis; o diagnóstico informa o caminho exato da peça. Notas internas extensas são limitadas somente na autoria, sem editar fala, evidências, rótulos, geometria ou gates. A validação direta de caches/publicação permanece estrita. Isso não comprova aprovação estética ou conclusão de cenas.

## Recuperação e preservação

Reutilizados `utils/narration-timing.js`, `utils/narration-cache.js` e a fila de adiamento existente. Resposta TTS com texto incorreto não promove novos bytes ao checkpoint. `NARRATION_ALIGNMENT_FAILED` distingue erro local de indisponibilidade do provedor. Após três tentativas, erros de narração e autoria podem ser adiados para permitir outra pauta, mantendo fonte, seed, job e arquivos.

Reload às 21:03:27 UTC, com producer em `backoff`, retry inativo, fila vazia e cgroup contendo apenas o PID principal; nova checagem imediatamente antes do restart confirmou a janela. PID novo observado: `3856644` (evidência datada, não estado permanente). Nenhum reenvio manual, conta ou privacidade foi alterado. As alterações locais anteriores ficaram fora do commit.

## Limite da comprovação

Ainda não existe master novo deste job, QA final ou publicação confirmada. Restam autoria/encenação e disponibilidade remota. X continua sem identidade e publicador operacional. A suíte técnica está registrada em `verification.json`; testes não equivalem a vídeo renderizado ou envio.
