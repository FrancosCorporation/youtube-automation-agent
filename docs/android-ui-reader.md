# Leitura da hierarquia Android

`utils/android-ui-hierarchy.js` é o leitor compartilhado pela inspeção de sessão e pelo Kwai. O contrato retorna XML da leitura atual ou vazio quando indisponível. O chamador mantém os gates de conta, tela, mídia, legenda, privacidade e confirmação. O leitor não toca controles nem publica.

## Backends e instalação

Sem `ANDROID_UI_PYTHON`, usa ADB com `uiautomator dump --compressed`, arquivo remoto exclusivo, timeout no Android e prazo total no host. Não aceita stdout parcial de um comando que falhou e não reutiliza XML anterior.

Com `ANDROID_UI_PYTHON` apontando para um Python isolado, usa o helper `scripts/read-android-hierarchy.py` e UIAutomator2 3.7.0. A configuração de espera por idle é zero, para ler um editor que continua animando. A árvore pertence à janela ativa; o processo não inicia nem reinicia o app. O servidor de instrumentação iniciado pelo helper é encerrado ao terminar a leitura. Não há fallback automático para outro backend.

Dependências separadas da voz neural:

```bash
python3 -m venv /home/servidor/Git/youtube_ai/.venv-android-ui
/home/servidor/Git/youtube_ai/.venv-android-ui/bin/python -m pip install -r requirements-android-ui.lock
```

No host atual, o editor e o compositor foram validados em 16/10/2026. A configuração foi gravada; a recarga do serviço exige uma janela sem upload:

```dotenv
ANDROID_UI_PYTHON=/home/servidor/Git/youtube_ai/.venv-android-ui/bin/python
KWAI_NDK_TRANSLATION_MODE=light-translate-or-interpret
```

O helper usa o mesmo ADB configurado pelo processo (`ADBUTILS_ADB_PATH` é passado internamente) e o mesmo serial. Não lê credenciais nem grava XML em disco. O backend ADB exige o comando Android `timeout`, presente no Redroid 14 deste projeto; ausência resulta em leitura indisponível.

## Crash nativo do editor e recuperação

A tentativa 13 caiu às 17:07:51 UTC / 14:07:51 BRT dentro de `libndk_translation.so`, em `OptimizeLoop`/`HeavyOptimizeRegion`, com SIGABRT e mensagem `Cannot process signal 11`. O Android confirmou `APP CRASH(NATIVE)`. O registro sanitizado está em `data/reports/diagnostics/kwai-native-crash-2026-10-16.json`; não copiar o tombstone inteiro, que contém memória do processo.

O binário instalado contém a opção `light-translate-or-interpret`. Após confirmação de não envio, foi aplicada temporariamente e somente o app Kwai foi reaberto. O mesmo arquivo de 293,933 s, sem recodificação e com hashes local/Android conferidos, chegou ao editor e ao compositor; o teste não tocou em Post. Evidências: `logs/snaps/kwai_u2_verified_editor_1792171532382.png` e `logs/snaps/kwai_translation_fixed_composer_1792171535844.png`.

Com `KWAI_NDK_TRANSLATION_MODE` configurado, `up()` aplica/verifica a propriedade sob o lock Android depois do boot. O valor é allowlisted; não força parada do app nem descarta um rascunho. A propriedade vale para novos processos traduzidos; se houver um app já inicializado com outra configuração, preparar uma janela sem envio e reconciliar o rascunho antes de reabri-lo. Não reiniciar o Android enquanto existir compositor válido.

A alteração evita o caminho do otimizador que caiu; não muda resolução, codec, fonte, áudio ou conteúdo do vídeo. Pode aumentar custo de CPU no emulador. Monitorar latência e estabilidade nas próximas publicações; uma recuperação do compositor ainda não prova publicação concluída nem estabilidade de vários dias.

Um [relato primário no projeto Waydroid](https://github.com/waydroid/waydroid/issues/2446) descreve esse modo para outro app. A decisão neste host se baseia também no tombstone, nas opções do binário local e no teste do próprio Kwai; não presume que sintomas de outro app sejam idênticos.

O leitor UIAutomator2 omite o antigo `selected_des`, cujo retângulo observado tinha altura negativa; a opção de compactação não recuperou esse rótulo. `findKwaiSelectedDuration` usa a duração da única miniatura no container explícito `picked_recycler_view`, junto de `OK (1)`. Duração da grade geral, dois itens, dois rótulos ou conflito com o rótulo legado são rejeitados. O retorno persistente à galeria durante transcodificação agora interrompe a espera antes dos seis minutos, com evidência de não envio.

## Operação e rollback

- Manter o lock `android-social-upload.lock` durante qualquer diagnóstico que dispute a interface. Conferir o PID vivo antes de mexer no dispositivo.
- O prazo total é passado ao subprocesso; alarm Python e timeout remoto encerram a operação antes do limite do host. O waiter externo decide retry/backoff.
- O parser é compartilhado, independe da ordem dos atributos e decodifica entidades. No Kwai, nós invisíveis são descartados e controles desabilitados não são clicáveis.
- Um campo vazio significa indisponível; nunca autoriza toque por coordenada presumida.
- Para rollback do leitor, remover somente `ANDROID_UI_PYTHON` e recarregar o scheduler em janela segura. O leitor legado continua disponível com deadline corrigido. Para reverter a tradução, remover `KWAI_NDK_TRANSLATION_MODE`, aguardar janela segura e recriar o container normalmente (a propriedade é transitória); não apagar o volume. Não remover o venv neural, tokens ou mídias.
- A alteração de ambiente só vale no processo recarregado. Não reiniciar um scheduler que esteja renderizando, enviando ou mantendo checkpoint em voo.

## Validação

```bash
node --test tests/android-ui-hierarchy.test.js tests/android-emulator-control.test.js tests/kwai-ui-wait.test.js tests/kwai-upload-flow.test.js tests/kwai-upload-resume.test.js
python3 -m unittest discover -s tests -p test_android_hierarchy.py
npm run lint
npm run test:ci
```

As fixtures cobrem timeout, falha sem fallback, XML incompleto, atributos em ordem diferente, entidades, controles desabilitados/invisíveis, validação do serial, limpeza da instrumentação e configuração sem idle. A prova operacional exige ler o editor do arquivo aprovado e reconciliar a tentativa subsequente; leitura do launcher sozinha não comprova o reparo do editor.

Referência primária: [UIAutomator2 — configuração e hierarquia](https://github.com/openatx/uiautomator2). O pacote é fixado no lock; atualizar exige nova validação do parser, do timeout e do fluxo real.

## Preservação do compositor e legenda vazia

A pré-checagem de sessão preserva a atividade do pacote Kwai já em primeiro plano; não relança TinyLaunchActivity sobre ShareActivity. Um compositor continua classificado como sessão unknown, e somente o handler com marcador/arquivo/caption correspondentes pode retomá-lo.

UIAutomator2 expõe o placeholder do EditText também no campo text. O parser preserva hint, e o campo vazio só é reconhecido por texto vazio ou igualdade com hint no EditText de ID exato do compositor. Texto diferente permanece rascunho existente e é rejeitado se não corresponder ao job. Essa distinção foi validada por leitura real, sem preencher ou publicar.
