# Publicação Android e recorte do Instagram

Verificação inicial em 12/10/2026; política de duração revisada em 14/10/2026. Resultados de interface não equivalem a auditoria de um post público.

## Continuação YAI-045 — controle Android sem browser

`scripts/social-login.js` agora abre e verifica apps dentro do Redroid por ADB, sem importar Playwright, iniciar Chromium ou abrir janela no desktop. A sessão só é registrada depois de reconhecer uma tela autenticada; as evidências locais não contêm credenciais, usam permissões restritas e expiram em 24 horas. App ausente, login necessário e estado desconhecido são reportados separadamente. O texto da UI é normalizado para reconhecer rótulos em português com acentos.

`utils/android-social-publisher.js` prepara o gate comum: aceita plataformas mapeadas e MP4 existente, serializa o uso do aparelho, confere app e sessão e exige handler Android específico. Sem handler, falha com diagnóstico claro e não tenta browser. A migração ainda não está conectada a `scripts/upload-to-socials.js`; TikTok, Instagram, X e Telegram precisam de adaptadores e QA nos apps disponíveis antes de considerar os envios migrados.

Validação de código: 15 testes direcionados passaram cobrindo parser ADB/UI, sessões acentuadas, lock compartilhado, permissões/expiração da evidência, app ausente, login não confirmado e handler nativo ausente. ESLint direcionado e `git diff --check` passaram. Nenhuma sessão real foi verificada e nenhuma postagem foi feita nesta etapa.

## Atualização YAI-045 — uploader Android conectado

Em 13/10/2026, `scripts/upload-to-socials.js` passou a encaminhar as redes sociais pelo gate Android, usando a mesma validação de sessão e o lock do aparelho. O estado de login vem de uma inspeção recente do app no emulador; cookies de perfis Chromium antigos não habilitam envios. Kwai é o único destino com handler Android configurado. TikTok, Instagram, X e Telegram falham explicitamente por falta de app/handler Android e não tentam abrir Playwright. YouTube e Shorts continuam usando a API oficial.

O processo de scheduler já estava em execução quando essa mudança foi feita e mantém o módulo antigo carregado na memória. A alteração do uploader no disco só passa a valer após o scheduler reiniciar em uma janela segura. A integração foi validada por testes com sessão Android, cookies legados e falha fechada, mas ainda falta executar login e publicação de teste no emulador após o ciclo automático liberar o dispositivo.

## Correção aplicada ao uploader web

O MP4 inspecionado é H.264/yuv420p, 1080×1920, SAR 1:1 e DAR 9:16. O Instagram abre a criação com recorte quadrado: o vídeo ocupa 681×1210,86 pixels, dentro de uma janela de 681×681, removendo aproximadamente 43,8% da altura. O uploader avançava sem mudar esse recorte.

`utils/instagram-video-framing.js` seleciona **Original** e verifica os limites reais do vídeo, incluindo `object-fit` e ancestrais que recortam. Na interface autenticada, o vídeo passou a ocupar 383×681 pixels, com mais de 99,9% do quadro visível. Essa seleção foi mantida nas telas Editar e Novo reel. O teste foi encerrado antes de Compartilhar.

O uploader verifica novamente o quadro antes de compartilhar. Se o enquadramento estiver cortado, distorcido ou não puder ser verificado, falha explicitamente. As capturas automáticas incluem `instagram_enquadramento_original_*`. O scheduler foi reiniciado em período ocioso para carregar o módulo novo; posts antigos não são alterados.

Validação: `node tests/instagram-video-framing.js`, 12 checks de `node tests/pipeline-smoke.js`, sintaxe e ESLint sem erros. A advertência preexistente de `timeoutMs` não utilizado no uploader permanece. Captura real: `logs/snaps/instagram_original_vertical_validado.png`.

## Estado real do emulador

- Infraestrutura: Redroid Android 14, volume persistente `kwai-data14`, ADB em `127.0.0.1:5555`, tela 720×1280, limite de memória de 3 GB.
- Kwai Lite (`kwai.lite.video`) e Play Store estão instalados. Instagram e TikTok não apareceram no inventário de pacotes.
- A abertura da página oficial do Instagram na Play Store retornou **This device isn’t Play Protect certified**, bloqueando o fluxo de instalação. Evidência: `logs/snaps/android_play_protect_bloqueio.png`.
- O emulador foi desligado após a inspeção, preservando o volume. Nenhum post foi feito nesse teste.
- A presença de uma flag local de login do Kwai não confirma que o app continua autenticado. O código atual também registra sucesso após tocar Publicar e esperar; a confirmação pública precisa ser fortalecida.

A Google explica que certificação do dispositivo e varredura Play Protect são coisas diferentes; desativar a varredura não corrige esse erro: [documentação oficial](https://support.google.com/googleplay/answer/7165974?hl=pt-BR). Uma alternativa a avaliar é um AVD com imagem oficial Google Play; essas imagens possuem assinatura de lançamento e não oferecem root, conforme a [documentação Android](https://developer.android.com/studio/run/managing-avds). A compatibilidade dos apps ainda precisa ser demonstrada. Este host tem `/dev/kvm`, mas não foi encontrado `emulator`/`sdkmanager` no PATH nem um SDK nos diretórios convencionais inspecionados.

## Processo de migração, sem parar o envio existente

1. Preparar um dispositivo separado que permita instalar os apps oficiais: AVD Google Play ou aparelho Android certificado conectado por ADB. Preservar o volume e login atuais do Kwai; não substituir sua infraestrutura durante o teste.
2. Instalar Instagram e TikTok pela fonte oficial e verificar inicialização, permissões de mídia e decodificação de um MP4 real. Não marcar suporte como concluído somente porque o pacote foi instalado.
3. Autenticar a conta correta em cada aplicativo, com o titular completando senha/2FA quando solicitado. Conferir o perfil ativo antes de cada envio; não migrar cookies do navegador nem tratar login de um app como login dos demais.
4. Extrair uma camada comum de ADB a partir das funções atuais: inicialização/encerramento, push de mídia, media scan, captura e leitura de UI. Usar chamadas com argumentos (`execFile`), sem interpolação de caminhos em shell. Acrescentar um mutex entre processos: refcount local não impede dois processos de disputarem o mesmo aparelho.
5. Criar adaptadores separados de Instagram e TikTok com seletores extraídos da UI real. Selecionar o arquivo enviado pelo nome/URI, não pela suposição de que a primeira miniatura é o corte correto. Validar conta, 9:16, título, legenda e áudio na tela anterior a Publicar.
6. Testar até a tela final, capturar evidências e sair sem publicar. Depois, na primeira publicação autorizada, aguardar processamento, obter ID/URL ou verificar o item no próprio perfil. Toque no botão ou fechamento do editor, isoladamente, não bastam como confirmação.
7. Persistir resultado por plataforma e identificador de vídeo para evitar duplicação em timeout/retry. Se houver publicação possivelmente concluída, reconciliar antes de tentar outra vez. Remover do aparelho somente a mídia comprovadamente concluída.
8. Adicionar seleção explícita de transporte por plataforma/conta e ativar somente handlers Android validados. App ausente, login inválido ou falha do app não deve abrir browser nem disparar publicação duplicada. Manter o código legado desconectado durante a migração e removê-lo depois da validação; promover uma plataforma por vez e medir duração, uso de RAM e taxa de sucesso.

## Trabalho paralelo NVIDIA

Foram executados dois OpenCode workers NVIDIA, com arquivos congelados e saídas separadas, para inventariar o Android e extrair o contrato do apresentador. O relatório Android trouxe referências a nomes de arquivos incorretos; o relatório GLB veio com JSON inválido e requisitos não demonstrados. Ambos foram tratados como candidatos, sem integração automática. O estado acima foi conferido diretamente pelo orquestrador. Artefatos da rodada: `/media/servidor/nvme_data/scratch/tmp/pulso-fleet-i45xxx4w`.

## Atualização YAI-045 — teste privado de publicação no Kwai (13/10/2026)

O login foi novamente reconhecido na tela inicial do Kwai Lite dentro do Redroid Android 14. Para testar a legenda em português, foi instalado no emulador o [ADBKeyBoard v2.5-dev do repositório oficial](https://github.com/senzhk/ADBKeyBoard/releases/tag/v2.5-dev), após conferir o SHA-256 publicado pelo GitHub (`41a8a0996d7397a2390d1ca16a75cb66c4a7bdaa89cf4e63600a4d3fb346fbbb`). O Play Protect mostrou o aviso de compatibilidade com Android antigo; a instalação foi permitida somente no emulador de teste. `kwai-emulator.js` agora habilita essa IME quando instalada, falha claramente quando ela não está ativa e substitui o texto já preenchido antes de inserir a legenda Unicode.

O Kwai apresentou uma confirmação adicional ao escolher a privacidade: a opção “Private” abre um aviso que recomenda tornar o post público. O fluxo agora responde “Not now”, retorna à tela de publicação e exige que “Private” e a legenda continuem visíveis antes de tocar em “Post”.

O teste usou somente o clipe sintético `/tmp/pulso-android-qa-20261013.mp4` (5 s), com a legenda `Teste técnico privado Pulso IA — publicação de validação no emulador Android.`. O Kwai voltou ao feed após o envio. A confirmação foi feita no perfil: a aba com cadeado exibiu o clipe de QA e, ao abrir o item, a interface mostrou a legenda exata e a data/hora `2026-10-13 09:16 PM`. O post foi privado; nenhum vídeo de produção foi publicado neste teste. O resultado inicial do uploader era `submitted` porque o app não mostrou toast de sucesso. Foi acrescentada uma reconciliação pelo perfil que procura o post mais recente na aba de privacidade correspondente e compara a legenda e o horário. Essa verificação foi exercitada contra o post já criado, sem publicar um segundo clipe.

Validação de código: 7 testes Android/Kwai direcionados, ESLint nos arquivos alterados, `node --check` e `git diff --check` passaram. TikTok, Instagram, X e Telegram continuam sem handler Android; falham fechados e não abrem Playwright.

O processo antigo ficou pausado enquanto terminava o ciclo iniciado antes da alteração do uploader. O master (340,2 s), a thumbnail, três cortes e o registro do tema foram gravados; a fila de publicação permaneceu vazia. Em 13/10 às 18:24 (-03), o serviço systemd foi reiniciado, o processo antigo e seu filho encerraram, e o scheduler carregou o código atual. O display virtual `:99` respondeu; o novo produtor começou outra geração às 18:25, enquanto o consumer aguardava o próximo slot. Nenhuma publicação desse novo ciclo foi iniciada até essa verificação. O Redroid foi desligado e iniciado novamente: o pacote ADBKeyBoard permaneceu instalado, a IME foi ativada pelo `up()` e `social-login.js` confirmou que a sessão Kwai continuava autenticada. Nenhuma janela do navegador do host foi aberta.

## Atualização YAI-063 — estabilidade visual e partes para Instagram (14/10/2026)

A inspeção de `data/videos/clips/fundat_o_segredo_por_tr_s_das_300_vagas__corte1.mp4` confirmou que, em 8,6 segundos, o mascote alternava de lado entre quatro enquadramentos. A causa era a escolha de lado pela paridade da cena, somada ao ritmo de uma nova cena por trecho de legenda. Os renders verticais agora mantêm o mascote à direita, usam cadência de legenda maior, no máximo duas imagens nos cortes curtos e 30 fps.

O pipeline também prepara uma variante narrativa completa exclusiva para Instagram. Parte vídeos longos em limites de seção, preserva offsets de áudio/narração, reaproveita imagens existentes e identifica as partes dentro do vídeo e na legenda. O padrão agora mantém um Reel narrativo inteiro até 1200 segundos; `SOCIAL_INSTAGRAM_PART_SECONDS=180` pode ser usado como alvo editorial de descoberta. Se um bloco ultrapassar o limite configurado ou não houver limites seguros, a geração falha sem cortar frases. O limite real do compositor Android no perfil continua sem validação.

Validação local até aqui: seis testes de política narrativa e dez testes selecionados de retry/estado de publicação passaram; `node --check` e lint dos módulos modificados passaram. Ainda falta renderizar e revisar a saída pós-correção. Instagram e TikTok não estão instalados no Redroid e não têm handler Android; nenhum login, envio ou postagem foi feito. As partes de Instagram não entram em YouTube Shorts nem em outra rede.

## Política narrativa de 2m55s e destino TikTok — IMP-20261014-64

O relato do usuário identificou um Reel publicado com apenas nove segundos. O `logs/scheduler.log` histórico confirmou que, antes da regra de roteamento narrativo, cortes sociais genéricos (`*_corte1.mp4`, inclusive o caso `apple_homeview_casa_inteligente`) foram enviados ao Instagram. Esses registros mostram a confirmação da interface usada na época, não uma verificação independente da URL pública. O código atualizado bloqueia cortes genéricos e entradas antigas sem metadados para Instagram; também deixa de direcionar cortes genéricos ao TikTok.

Cada explicação é agora segmentada em limites de seção, em até 175 s (2m55s), com `Parte n/N` no quadro e legenda. Partes abaixo de 60 s não são geradas para Instagram; para TikTok, cada parte precisa ser maior que 60 s para adequação ao requisito temporal do Creator Rewards. Assim, um vídeo contextual de 5m40s com as quebras narrativas testadas vira duas partes de aproximadamente 2m50s. O limite de upload do app Instagram (20 min, ainda provisório para o perfil) segue separado desse teto editorial.

**Atualização IMP-20261015-69:** atendendo ao alvo confirmado pelo usuário, o teto foi ajustado de 175 s para 179 s (2m59s). A montagem preserva o conteúdo e divide seis minutos em três partes quando duas partes excederiam esse máximo.

O usuário pediu incluir oportunidades de monetização. As partes narrativas também são marcadas para TikTok; o programa Creator Rewards requer conteúdo original/de alta qualidade com mais de um minuto e a elegibilidade da conta não foi verificada. Facebook Content Monetization foi registrado em YAI-046 como oportunidade condicionada a convite e integração. TikTok/Instagram seguem sem handler Android e sem aparelho ADB nesta sessão; a rota falha fechada sem abrir navegador.

**Validação desta implementação:** 23 testes focados passaram; ainda falta o preview audiovisual e QA de conta/app. O checkout não iniciou geração ou upload.
