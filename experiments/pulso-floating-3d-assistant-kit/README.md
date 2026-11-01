# Pulso Floating 3D Assistant Kit

Componente copiável de mascote 3D flutuante para aplicações React. O personagem é um modelo GLB real renderizado em WebGL transparente; o painel de conversa pertence ao aplicativo que o hospeda.

## Copiar para outro projeto

1. Copie `src/Floating3DAssistant.tsx` e `src/floating-assistant.css`.
2. Copie o GLB escolhido de `models/` para a pasta pública do seu aplicativo. O kit já inclui duas geometrias diferentes: o mascote Pulso rigged e um robô moderno estático.
3. Instale as peer dependencies compatíveis com o kit: React/React DOM 19+, Three.js 0.185+, React Three Fiber 9+ e Drei 10+.
4. Importe o componente e passe o caminho público do GLB em `modelUrl`.
5. Abra/feche seu chat em `onActivate`; preserve o estado e histórico de mensagens no próprio chat.

```tsx
import { useState } from 'react';
import Floating3DAssistant from './components/Floating3DAssistant';

export function AssistantOnAnySite() {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <>
      {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
      <Floating3DAssistant
        modelUrl="/models/pulso-robot-web.glb"
        label={chatOpen ? 'Fechar conversa' : 'Abrir conversa'}
        motion={chatOpen ? 'speaking' : 'idle'}
        onActivate={() => setChatOpen((open) => !open)}
      />
    </>
  );
}
```

O componente se posiciona no canto inferior direito por padrão. `style` permite usar outro local ou coordenadas. `motion` aceita `idle`, `thinking`, `speaking` ou `reaction`; incremente `reactionKey` para repetir a animação de mensagem. A animação altera a pose do grupo e não deforma a malha. O canvas tem fundo transparente, limita DPR a 1,25, agenda no máximo 24 frames/s, pausa quando a aba fica oculta e respeita `prefers-reduced-motion`. Acessibilidade por teclado é fornecida pelo controle nomeado.

## Catálogo de modelos

`models/catalog.json` diferencia famílias de geometria, rig, tamanho e perfil. Dois GLBs estão incluídos (`status: bundled`) e podem ser escolhidos por `modelUrl` sem caminhos deste workspace. Os modelos alternativos grandes permanecem como `workspace-reference`; copie-os apenas quando necessários e otimize antes do uso em mobile. Variantes estáticas recebem movimento do grupo inteiro, sem gestos articulados. Confirme direitos de redistribuição pública antes de publicar.

| ID | Tamanho | Diferença | Perfil |
|---|---:|---|---|
| `pulso-robot-web` | 8,48 MB | Modelo Pulso, 17 juntas e controles faciais | Incluído; web desktop/mobile |
| `robo-bonito-rigged` | 70,96 MB | Geometria humanoide alternativa, rig compatível | Otimizar antes de usar em mobile |
| `robo-bonito-hunyuan` | 49,82 MB | Geometria Hunyuan distinta, sem skin | Avaliação desktop; falta rig |
| `pulso-robo-hunyuan` | 49,96 MB | Outra geometria Hunyuan, sem skin | Avaliação desktop; falta rig |
| `pulso-robo-moderno` | 7,37 MB | Robô moderno, 91 meshes/12 materiais | Incluído como opção; sem rig |

Trocar cores/material em `robo-bonito-temas-v3` muda a paleta; não conta como uma nova família geométrica.

O robô moderno não tem skin nem clips baked; o componente oferece oscilação/reação do grupo inteiro. O mascote padrão continua sendo `pulso-robot-web`; selecione a geometria alternativa explicitamente por `modelUrl`.

## Fallback e limites

Se WebGL ou o modelo falhar, o componente mostra um estado textual acessível e não quebra a página. Ele não implementa chat, autenticação, microfone, TTS ou visemas; conecte esses recursos ao seu painel e passe um estado em `motion`. Cada instância cria um Canvas; monte só uma por página.

## Validação local

O demo em `demo/App.tsx` mostra alternância do painel e eventos sintéticos de mensagem/fala. `npm test` valida o catálogo e o GLB incluído. O typecheck/build deve ser executado no projeto consumidor com as versões atuais de React/Three/Fiber/Drei; este diretório não fixa uma árvore `node_modules` própria.

## Direitos do asset

O GLB incluído veio de `experiments/hyperframes-pulso-pilot/assets/pulso-robot-web.glb`. Este kit não concede direitos de redistribuição pública para o modelo; confirme a licença e origem antes de publicar ou repassar o arquivo.
