import { useState } from 'react';
import Floating3DAssistant, { type AssistantMotion } from '../src/Floating3DAssistant';

function ChatPanel({ onClose }: { onClose: () => void }) {
  return (
    <aside
      aria-label="Conversa com o assistente"
      style={{ position: 'fixed', right: 24, bottom: 260, width: 300, padding: 20, background: 'white', borderRadius: 16, boxShadow: '0 8px 32px #0002' }}
    >
      <button type="button" onClick={onClose} aria-label="Fechar conversa">×</button>
      <p>Seu histórico e sua lógica de chat ficam no aplicativo hospedeiro.</p>
    </aside>
  );
}

export default function App() {
  const [open, setOpen] = useState(false);
  const [motion, setMotion] = useState<AssistantMotion>('idle');
  const [reactionKey, setReactionKey] = useState(0);

  const receiveMessage = () => {
    setReactionKey((key) => key + 1);
    setMotion('reaction');
    window.setTimeout(() => setMotion('idle'), 900);
  };

  return (
    <>
      <main style={{ minHeight: '100vh', padding: 32, fontFamily: 'system-ui' }}>
        <h1>Exemplo de integração</h1>
        <p>O robô fica sobre a página mesmo quando a conversa está fechada.</p>
        <button type="button" onClick={receiveMessage}>Simular mensagem recebida</button>
      </main>
      {open && (
        <ChatPanel onClose={() => setOpen(false)} />
      )}
      <Floating3DAssistant
        modelUrl="/pulso-robot-web.glb"
        label={open ? 'Fechar conversa com o assistente' : 'Abrir conversa com o assistente'}
        motion={motion}
        reactionKey={reactionKey}
        onActivate={() => setOpen((value) => !value)}
      />
    </>
  );
}
