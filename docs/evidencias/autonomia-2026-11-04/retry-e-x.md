# Recuperação de retry e composer X — 04/11/2026

A retomada confirmou `v2.39.0` publicada em `a1a9d66`, sem repetir push/release, e o mesmo job Curiosidades preservado. Não há episódio novo publicado nesta observação.

## Falhas reproduzidas e correções

- O perfil compartilhado autorizava retry durante geração, mas o gate inverso bloqueava o produtor durante qualquer retry, inclusive a varredura inicial. O helper agora aplica a mesma permissão nos dois sentidos. Fila de um item, publicador serial, lock Android e gate de recursos permanecem obrigatórios.
- Inspeção somente de leitura do composer X no Chrome Android mostrou dois elementos `role=progressbar`: barra superior ociosa em zero e contador de caracteres `countdown-circle` em 75. O adaptador anterior tratava qualquer progressbar como upload ativo. A leitura diferencia esses elementos de progresso real de mídia e continua exigindo vídeo, botão habilitado e ausência de processamento/erro.
- Texto digitado no editor deixa de ser interpretado como mensagem de processamento (por exemplo, uma legenda sobre “uploading”). Erros anteriores ao clique registram a etapa, sem expor conteúdo de exceções. Clique incerto permanece `unknown` e exige reconciliação.

## Verificação e limites

51 testes focados passaram, incluindo DOM real local, rascunhos, contador de caracteres, upload ativo, botão desabilitado, identidade, clique incerto e concorrência. ESLint focal passou após usar `window.getComputedStyle` no contexto de browser. A primeira execução concorrente do teste de DOM teve timeout; a repetição isolada e a suíte focal sequencial passaram. CI integral da árvore isolada em `/tmp/pulso-v240-ci.log`.

O worker NVIDIA produziu uma auditoria, não código integrado. A proposta de usar apenas vínculo criptográfico da crítica para liberar uma reconstrução foi rejeitada: hash não demonstra correção visual. A retenção `visual_rebuild_requires_fresh_review` permanece até existir evidência de revisão da mídia corrigida.

O serviço tentou X em dois cortes anteriores; ambos falharam antes do clique, sem postagem confirmada. Esses resultados não demonstram envio de episódio novo. Captura privada do composer: `/tmp/pulso-x-live-composer.png`.

Às 19:07 UTC o gate registrou cerca de 1,68 GiB disponíveis e carga 57,37. Não foram alterados limites de recursos nem interrompidos trabalhos externos. O pedido de recarga usa o helper de janela ociosa existente. Reconstrução visual, QA da nova mídia, confirmação por destino e ciclo seguinte continuam pendentes.


## Continuação — recuperação do Android (04/11, noite BRT)

A cadeia de checkpoints foi lida, incluindo `previous`; v2.39 já existia no fork. A CI isolada anterior passou após copiar os assets exigidos pelas fixtures; a nova alteração Android foi acrescentada ao mesmo snapshot e está sendo validada novamente.

A unit Android estava ativa, mas `adb -s emulator-5560 emu avd status` retornava `virtual device is stopped`. `systemctl start` sobre a unit ativa não recuperava a VM. Sob o lock compartilhado, a retomada `emu avd start` teve timeout de resposta; a consulta seguinte comprovou `running` e `sys.boot_completed=1`, sem repetir o comando. O helper comum passa a fazer essa recuperação apenas diante de estado parado inequívoco, revalidado sob o lock. Timeout após start exige confirmação de running; estado desconhecido não autoriza resume. Probes getprop agora têm timeout de cinco segundos. Não há reboot ou descarte de sessão nesse caminho.

30 testes focados e 97 de integração passaram (incluindo bootstrap, publicadores, reconciliação, X, Studio e Gemini). Worker NVIDIA Nemotron Lightning excedeu quatro minutos e deixou código/testes incompletos no scratch; nada dele foi integrado. A implementação e os testes finais são do orquestrador, reutilizando o controle Android e o lock existentes, sem dependências novas.

O Chrome estava na configuração inicial, bloqueado por ANRs. Foram tratados sob lock; a tela inicial avançou sem habilitar sincronização da conta. A conexão CDP voltou, mas a sessão X ainda exige verificação. Nenhum upload de teste foi feito.

A pausa de `llama-cpp` foi executada pela sessão anterior às 23:40 UTC, com religação automática pelo timer `pulso-llama-restore-v240` em 90 minutos. O treinamento continua ativo. O serviço retomou autoria e adiou Psicologia após falha de provider, preservando o job; depois retomou Saúde. A fila de publicação segue vazia e a reconstrução visual/fresh review continua pendente. Esses estados não comprovam conclusão do ciclo autônomo.

CI final e lint concluídos com exit 0 no snapshot isolado. Incluíram testes Node, 40 Python, acessibilidade em navegador e enquadramento horizontal/vertical. Logs privados em `/tmp/pulso-avd-recovery/ci-final.log` e `lint-final.log`. Nenhuma alteração de produção foi feita pelos testes.
