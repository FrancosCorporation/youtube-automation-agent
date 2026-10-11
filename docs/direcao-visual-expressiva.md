# Direção visual expressiva

O roteiro usa ganchos curtos, exemplos concretos, progressão de ideias e revisão contra repetição ou promessas sem resposta. Cada frase vira uma cena; os cortes preservam a continuidade e o fade fica restrito à abertura e ao encerramento.

## Apresentador 3D aprovado

O mascote oficial é o robô alto e em pé, com braços animados de forma independente, aprovado no vídeo `experiments/hyperframes-pulso-pilot/renders/pulso-ia-bracos-independentes-do-audio-preview.mp4`. A geometria e as animações vêm de `experiments/hyperframes-pulso-pilot/src/presenter-robot.js`; a composição de produção é renderizada pelo HyperFrames através de `utils/hyperframes-video-renderer.js`.

O runtime usa Three.js e uma linha do tempo determinística. O movimento da boca acompanha o envelope da narração. Para mudar o robô, atualize a fonte aprovada do piloto e valide uma renderização HyperFrames antes de promover a mudança.

As imagens de fundo continuam ligadas à pauta e não devem inserir uma segunda pessoa que conflite com o apresentador. Se o Gemini não gerar uma imagem, os componentes gráficos e o robô continuam disponíveis como fallback.

## Cache e operação

Roteiro e narração usam a assinatura visual `retention-emotions-v4-robot3d`; ela impede reutilizar caches produzidos antes do robô. A quantidade de imagens por seção permanece limitada por `IMAGES_PER_GROUP`.

O scheduler inicia cada geração em um processo filho. Cada nova geração carrega o renderer HyperFrames atual.

## Navegador invisível no fluxo automático

O scheduler força o display virtual `:99` antes de iniciar geração ou publicação e confirma que ele responde. Assim, uploads que precisam de Chromium mantêm o fluxo dentro do Xvfb, fora da tela do usuário; os demais providers continuam headless. O scheduler não usa o display gráfico herdado (`:0`) como fallback. Se Xvfb não estiver disponível, interrompe aquela inicialização em vez de abrir uma janela no desktop. São necessários `Xvfb` e `xdpyinfo` instalados.

Os comandos de configuração manual de conta (`social:login` e `gemini-login`) continuam abrindo uma janela quando precisam de login ou CAPTCHA. Eles não fazem parte do ciclo automático recorrente.
