# Direção visual expressiva

O roteiro usa ganchos curtos, exemplos concretos, progressão de ideias e revisão contra repetição ou promessas sem resposta. Cada frase vira uma cena; os cortes preservam a continuidade e o fade fica restrito à abertura e ao encerramento.

## Apresentador 3D aprovado

O mascote oficial é o robô alto e em pé, com braços animados de forma independente, aprovado no vídeo `experiments/hyperframes-pulso-pilot/renders/pulso-ia-bracos-independentes-do-audio-preview.mp4`. A geometria e as animações vêm de `experiments/hyperframes-pulso-pilot/src/presenter-robot.js`; a composição de produção é renderizada pelo HyperFrames através de `utils/hyperframes-video-renderer.js`.

O runtime usa Three.js e uma linha do tempo determinística. O movimento da boca acompanha o envelope da narração. Para mudar o robô, atualize a fonte aprovada do piloto e valide uma renderização HyperFrames antes de promover a mudança.

As imagens de fundo continuam ligadas à pauta e não devem inserir uma segunda pessoa que conflite com o apresentador. Se o Gemini não gerar uma imagem, os componentes gráficos e o robô continuam disponíveis como fallback.

## Cache e operação

Roteiro e narração usam a assinatura visual `retention-emotions-v4-robot3d`; ela impede reutilizar caches produzidos antes do robô. A quantidade de imagens por seção permanece limitada por `IMAGES_PER_GROUP`.

O scheduler inicia cada geração em um processo filho. Cada nova geração carrega o renderer HyperFrames atual.

As thumbnails são renderizadas depois do MP4 e recebem uma arte própria para a capa: composição dramática, foco grande e contraste legível em tela pequena, baseada na pauta e no roteiro. Cenas e capa compartilham fonte, cores-base e acento do tema; cada formato conserva sua área segura. A chamada curta é validada para preservar negação, dúvida e qualificadores; a arte evita sugerir como real um evento não verificado. O PNG dedicado nunca entra nas cenas nem nos cortes. A capa também recebe realce de cor/contraste próprio; nenhuma alteração é aplicada ao vídeo, ao áudio ou aos cortes. Se a geração dedicada falhar, a thumbnail usa a imagem contextual existente.

## Navegador invisível no fluxo automático

O scheduler força o display virtual `:99` antes de iniciar geração ou publicação e confirma que ele responde. Assim, uploads que precisam de Chromium mantêm o fluxo dentro do Xvfb, fora da tela do usuário; os demais providers continuam headless. O scheduler não usa o display gráfico herdado (`:0`) como fallback. Se Xvfb não estiver disponível, interrompe aquela inicialização em vez de abrir uma janela no desktop. São necessários `Xvfb` e `xdpyinfo` instalados.

O comando `social:login` lança e verifica apps dentro do Redroid por ADB, sem iniciar navegador ou janela no desktop. O uploader agora encaminha as redes sociais ao gate Android; só o Kwai tem handler nativo configurado. Apps ausentes ou sem handler não abrem Playwright. YouTube e Shorts usam a API oficial. O scheduler de longa duração ainda precisa reiniciar em janela segura para carregar a alteração do uploader que está no disco. `gemini-login` é uma configuração independente e pode abrir uma janela para autenticação/CAPTCHA.
