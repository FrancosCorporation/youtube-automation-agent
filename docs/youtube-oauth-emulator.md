# Reautorizar YouTube pelo emulador Android

O host usa um Redroid 14 em `127.0.0.1:5555`, compartilhado com o Kwai. O Google Play nesse dispositivo mostra que ele não é certificado; não use o Play Store nem um WebView embutido para autenticar.

## Fluxo suportado neste host

1. A janela `scrcpy` apresenta o dispositivo ao operador. Ela não abre Chrome/Firefox do host.
2. Firefox Android para x86_64 foi instalado a partir do [arquivo oficial de versões Mozilla](https://archive.mozilla.org/pub/fenix/releases/158.0/android/fenix-158.0-android-x86_64/) porque o Play Store está bloqueado.
3. `scripts/auth-youtube-emulator.js` cria um callback loopback temporário, usa `adb reverse` para encaminhar a porta do emulador ao host e abre a URL diretamente no Firefox Android.
4. O operador entra na conta Google e conclui consentimento OAuth no emulador. Senha e código de dois fatores nunca são pedidos pelo terminal nem registrados nos logs.
5. O callback exige state aleatório e scopes completos. Antes de gravar tokens, a API oficial compara os canais do usuário autorizado com os canais de vídeos publicados conhecidos (`pRlImBrR6IA` e `_yLTtNlebN8`). Se não houver correspondência, nenhum token é gravado.
6. O arquivo de token é atualizado atomicamente com modo `0600`, preservando os outros providers do JSON. O encaminhamento ADB é removido ao concluir ou falhar.

## Operação

```bash
node scripts/auth-youtube-emulator.js
```

O processo aguarda até dez minutos pelo consentimento. Para usar outro serial, defina `ANDROID_DEVICE`; para comparar vídeos conhecidos diferentes, defina `YOUTUBE_EXPECTED_VIDEO_IDS` com IDs separados por vírgula. Um callback OAuth bem-sucedido confirma somente a autorização e a identidade do canal: ainda é necessário validar Analytics e publicação controlada pelo pipeline.

## Limites

- Este OAuth reautoriza Data API/Analytics do YouTube; não cria uma sessão Gemini Web para o provider visual. Essa é uma autenticação separada e continua necessária à geração atual.
- O login no emulador é interativo e pertence ao titular da conta. O processo não contorna senha, 2FA, consentimento nem avisos de segurança do Google.
- O Kwai permanece instalado no mesmo emulador. O login OAuth abre o Firefox como outra atividade e não toca nos controles do Kwai nem no botão de publicação.
- O serviço scheduler continua em processo independente; nenhuma autorização ativa um upload automaticamente. Geração, revisão do master, política de destino e publicação comprovada permanecem gates separados.

## Testes

```bash
node --test tests/youtube-oauth-emulator.test.js
npm run lint
npm run test:ci
```
