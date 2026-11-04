# Autonomia — 03/11/2026

## Falhas reproduzidas e correções

- Capa/cortes falhos podiam cair em `catch` e terminar o job como concluído. A finalização exige capas e partes completas; erros próprios mantêm o checkpoint para retry/adiamento.
- Extração de partes repetia todos os cortes e apagava os anteriores após falha na variante. Checkpoints vinculam master, receita, hash e duração, preservando progresso.
- Crash depois de promover um MP4 e antes de gravar o estado causava colisão permanente. Intenção persistida permite adotar somente os bytes previamente verificados.
- O consumer descartava da fila um pacote com revisão delegada pendente. Agora tenta a mesma recuperação por hash usada no retry antes de aplicar os gates.
- Retries sociais aguardavam toda a geração mesmo no perfil compartilhado. Podem executar nesse perfil com serialização de publicação e lock do dispositivo.
- Studio reconciliava somente dentro da chamada de upload. ID remoto e conta são persistidos no resultado incerto; worker periódico verifica o ID público/publicado no canal correto. Nenhum upload é realizado pelo reconciliador.
- Atualização do coordenador dependia de intervenção em janela ociosa. O guard existente processa pedido explícito de reload, com rechecagem atômica de ociosidade e retomada pelo systemd.

## Provas e limites

Testes de regressão usam arquivos temporários, interrupções simuladas e mocks para rede/render; não equivalem a postagem real. Testes anteriores de segmentos e intervalos usam FFmpeg real. Validação integrada registrada no resumo.

Conferência real durante esta entrega: job `aadd101f-53bd-4eb9-b758-740a42ab4b1a`; master horizontal com 461,013 s, 71.329.716 bytes, SHA-256 `9f24f95a03beccd2a5d7a469cd5fe2cea1b3d73c0c004d05c63d9e481bf160bb`. O serviço retomou o vertical após o timeout antigo e usa blocos de 720 quadros. O scheduler registrou cinco reconciliações Instagram às 01:53:55Z de 04/11; são publicações anteriores, não o novo episódio.

Nenhum restart durante o render. A atualização do coordenador aguarda o guard comprovar ociosidade. Ainda não há evidência do novo par completo publicado nem do ciclo seguinte. X está sem identidade/adaptador operacional; resultados antigos sem ID remoto continuam incertos e não são reenviados.

## Retomada após troca de conta

Checkpoint `01a1a448-c68e-7dd3-989a-21963a52b31c-1793759092139.json` recuperado (`previous: null`). A entrega anterior não tinha commit/push nem pedido de reload; esses estados foram conferidos antes de continuar.

Corrigida a corrida entre enviar SIGSTOP e efetivamente parar o coordenador: o guard aguarda o estado T do Linux antes de repetir a conferência de filhos/locks. Timeout/erro retoma o coordenador sem solicitar término. Testado também com processo filho real isolado; nenhum sinal foi enviado ao scheduler ocupado.

Validação final local: `npm run test:ci` passou com 1.251 testes Node, 40 testes Python e verificações de browser/enquadramento. `npm run lint` passou sem erros, com um aviso preexistente no benchmark CHAPEA. Logs privados em `/tmp/pulso-autonomy-T0HIV4/{ci-relay-final,lint-relay-final}.log`.

Pedido de reload gravado por PID/hash em `data/state/scheduler-reload-request.json`; guard existente ativo a cada dois minutos. Execução inicial adiou corretamente: PID 3856644 continua ativo com o render. Vertical concluiu os dois primeiros blocos (1.440 quadros) e iniciou 1440–2159. Não há envio novo desse episódio confirmado.

O proprietário orientou entrar no X pelo Google no emulador. Abertura real reproduziu o crash `libyoga.so` em 03/11 às 23:30 BRT; Play Store ofereceu atualização, iniciada preservando os dados. Acesso/login e adaptador ainda não comprovados. Auditoria NVIDIA solicitada em snapshot isolado; seu relatório será revisto antes de aceitar conclusões.

Resultado posterior: Play Store bloqueou a atualização por armazenamento interno insuficiente; limpeza de caches descartáveis pelo Android recuperou apenas cerca de 6 MB, sem apagar apps/contas/mídia. Login Google no Chrome do próprio emulador concluiu em `x.com/home`; menu e perfil próprio, incluindo “Edit profile”, confirmaram Pulso IA `@RodolfoFrancod1`. Captura privada: `/tmp/pulso-autonomy-T0HIV4/x-google-profile.png`. Isso não comprova login do app nativo nem envio pelo adaptador X, que continua ausente.

Defeito adicional reproduzido: 9223 ocupada por Chrome do host, ausente da lista ADB; Studio falhava em `forward --no-rebind`. Resolver agora trata somente colisões reconhecidas, reutiliza um encaminhamento do mesmo aparelho/socket ou aloca `tcp:0` com conferência exata; erros de dispositivo/autenticação continuam propagados. Integração Studio/Gemini: 55 testes focados passaram (`cdp-final.log`), lint focado passou. Conexão real pedindo 9223 recuperou 9235, expondo apenas as abas Gemini/X do Android; nenhum navegador do host foi utilizado.

NVIDIA/OpenCode fez revisão estática do snapshot e entregou `audit.md` após correção do primeiro retorno, sem defeito adicional comprovado. Sua primeira proposta de código CDP não atendia ao contrato de validação; o orquestrador implementou/revisou a correção e executou os testes acima. Artefatos privados em `/tmp/pulso-nvidia-audit-RDEe9p/`; nenhum resultado do worker equivale a prova de publicação.
