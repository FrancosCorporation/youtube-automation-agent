# Direção visual expressiva

O roteiro usa ganchos mais curtos, exemplos concretos, progressão de ideias e revisão contra repetição ou promessas sem resposta. Cada frase vira uma cena; os cortes internos preservam a continuidade e o fade fica restrito à abertura e ao encerramento.

## Mascote apresentador 3D

O renderizador usa um mascote original do canal criado com geometria 3D no Blender: carcaça de cerâmica, visor de vidro e expressão digital em tons de teal e âmbar. O atlas `assets/scenes/presenter-atlas.png` contém sete estados expressivos e quatro formas de boca por estado. A emoção vem da seção do roteiro; a boca muda em cadência com a legenda e o personagem aparece em cerca de metade das cenas longas.

Cada célula é renderizada com luzes, materiais PBR e EEVEE, e depois organizada em sprites transparentes. A boca acompanha a cadência das palavras, mas não é sincronização fonética de captura facial. Para reconstruir o atlas depois de editar o modelo, execute `node scripts/build-presenter-atlas.js`; Blender e `sharp` precisam estar instalados. A revisão do atlas força a atualização automática quando a próxima geração iniciar.

As imagens de fundo agora pedem cenas editoriais 3D com objetos e ambientes ligados à pauta, sem inserir uma segunda pessoa fotorrealista que conflite com o mascote. Se o Gemini não gerar uma imagem, o apresentador e os componentes gráficos continuam disponíveis como fallback.

## Cache e operação

Roteiro e narração usam o namespace `retention-emotions-v4-robot3d`; a nova assinatura visual impede reaproveitar caches feitos antes do mascote 3D. A quantidade de imagens por seção permanece limitada por `IMAGES_PER_GROUP`.

O scheduler inicia cada geração em um processo filho. Um vídeo que já começou termina com o código que carregou; a próxima geração iniciada pelo scheduler lê estas mudanças sem reiniciar o serviço.

## Navegador invisível no fluxo automático

O scheduler força o display virtual `:99` antes de iniciar geração ou publicação e confirma que ele responde. Assim, os uploads que precisam de Chromium com janela (TikTok/X) mantêm o mesmo fluxo dentro do Xvfb, fora da tela do usuário; os outros providers continuam headless. O scheduler não usa o display gráfico herdado (`:0`) como fallback. Se Xvfb não estiver disponível, ele interrompe aquela inicialização em vez de abrir uma janela no desktop. São necessários `Xvfb` e `xdpyinfo` instalados.

Os comandos de configuração manual de conta (`social:login` e `gemini-login`) continuam abrindo uma janela quando precisam que alguém faça login ou resolva um CAPTCHA. Eles não fazem parte do ciclo automático recorrente.
