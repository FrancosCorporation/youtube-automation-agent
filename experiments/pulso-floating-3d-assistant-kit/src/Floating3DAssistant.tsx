import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  Canvas,
  events,
  useFrame,
  useThree,
  type DomEvent,
  type RootState,
  type RootStore,
} from '@react-three/fiber';
import { Bounds, Html, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import './floating-assistant.css';

export type AssistantMotion = 'idle' | 'thinking' | 'speaking' | 'reaction';

export type Floating3DAssistantProps = {
  /** URL served by the host application, for example /models/pulso-robot-web.glb. */
  modelUrl?: string;
  /** Accessible name for the keyboard activation control. */
  label?: string;
  /** Set to reaction when a new assistant message arrives. */
  motion?: AssistantMotion;
  /** Increment for repeated reaction events that use the same motion value. */
  reactionKey?: number;
  /** Called when the visible model or keyboard control is activated. */
  onActivate?: () => void;
  /** Optional wrapper styles; position defaults to fixed. */
  style?: CSSProperties;
  className?: string;
};

const DEFAULT_MODEL_URL = '/models/pulso-robot-web.glb';

function LoadingMark({ children }: { children: ReactNode }) {
  return <Html center><span className="pulso-kit-status">{children}</span></Html>;
}

class ModelErrorBoundary extends Component<{
  children: ReactNode;
  fallback: ReactNode;
  onError: () => void;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ContextGuard({ onLost }: { onLost: () => void }) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const handleLost = (event: Event) => {
      event.preventDefault();
      onLost();
    };
    gl.domElement.addEventListener('webglcontextlost', handleLost);
    return () => gl.domElement.removeEventListener('webglcontextlost', handleLost);
  }, [gl, onLost]);

  return null;
}

function Model({
  modelUrl,
  motion,
  reactionKey,
  reducedMotion,
  onActivate,
  onLoaded,
}: {
  modelUrl: string;
  motion: AssistantMotion;
  reactionKey: number;
  reducedMotion: boolean;
  onActivate?: () => void;
  onLoaded: () => void;
}) {
  const { scene } = useGLTF(modelUrl);
  const root = useRef<THREE.Group>(null);
  const elapsed = useRef(0);
  const reactionStarted = useRef(-10);
  const hovering = useRef(false);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    reactionStarted.current = elapsed.current;
    invalidate();
  }, [reactionKey, motion, invalidate]);

  useEffect(() => {
    onLoaded();
  }, [onLoaded]);

  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    const delay = reducedMotion ? (motion === 'idle' ? 0 : 100) : 1000 / 24;

    const tick = () => {
      if (stopped || delay === 0 || document.visibilityState !== 'visible') return;
      invalidate();
      timer = window.setTimeout(tick, delay);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') tick();
      else if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };

    if (document.visibilityState === 'visible') tick();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [invalidate, motion, reducedMotion]);

  useFrame((state, delta) => {
    const group = root.current;
    if (!group) return;

    elapsed.current += Math.min(delta, 0.08);
    const t = elapsed.current;
    const reducedFactor = reducedMotion ? 0 : 1;
    const reaction = Math.max(0, 1 - (t - reactionStarted.current) / 0.8);
    const talk = motion === 'speaking' ? 1 : 0;
    const think = motion === 'thinking' ? 1 : 0;
    const pointerX = hovering.current ? state.pointer.x : 0;
    const pointerY = hovering.current ? state.pointer.y : 0;

    group.position.y = Math.sin(t * 1.5) * 0.055 * reducedFactor;
    group.rotation.y = Math.sin(t * 0.55) * 0.035 * reducedFactor + pointerX * 0.07;
    group.rotation.x = pointerY * 0.045 + Math.sin(t * 2.4) * 0.012 * talk * reducedFactor;
    group.rotation.z = Math.sin(t * 3.2) * 0.02 * reaction * reducedFactor;
    group.scale.setScalar(1 + Math.sin(t * 10) * 0.006 * talk * reducedFactor);
    if (think && !reducedMotion) group.rotation.y += Math.sin(t * 2.4) * 0.025;
  });

  return (
    <group
      ref={root}
      onClick={(event) => {
        event.stopPropagation();
        onActivate?.();
      }}
      onPointerOver={() => { hovering.current = true; invalidate(); }}
      onPointerOut={() => { hovering.current = false; invalidate(); }}
      onPointerMove={() => invalidate()}
    >
      <primitive object={scene} dispose={null} />
    </group>
  );
}

/**
 * A floating, transparent 3D character. It owns only the mascot scene; mount a
 * chat panel beside it and toggle that panel from onActivate.
 */
export default function Floating3DAssistant({
  modelUrl = DEFAULT_MODEL_URL,
  label = 'Abrir conversa com o assistente',
  motion = 'idle',
  reactionKey = 0,
  onActivate,
  style,
  className,
}: Floating3DAssistantProps) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [failedModelUrl, setFailedModelUrl] = useState<string | null>(null);
  const available = failedModelUrl !== modelUrl;
  const handleUnavailable = useCallback(() => setFailedModelUrl(modelUrl), [modelUrl]);
  const handleLoaded = useCallback(() => {
    setFailedModelUrl((failedUrl) => failedUrl === modelUrl ? null : failedUrl);
  }, [modelUrl]);
  const assistantEvents = useCallback((store: RootStore) => ({
    ...events(store),
    compute: (event: DomEvent, state: RootState) => {
      const rect = state.gl.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const pointer = event as PointerEvent;
      state.pointer.set(
        ((pointer.clientX - rect.left) / rect.width) * 2 - 1,
        -((pointer.clientY - rect.top) / rect.height) * 2 + 1,
      );
      state.raycaster.setFromCamera(state.pointer, state.camera);
    },
  }), []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  const handleCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 0.98;
  }, []);

  const canvas = useMemo(() => (
    <Canvas
      className="pulso-kit-canvas"
      aria-hidden="true"
      eventSource={typeof document === 'undefined' ? undefined : document.body}
      events={assistantEvents}
      frameloop="demand"
      dpr={[1, 1.25]}
      camera={{ position: [0, 0, 7], fov: 35, near: 0.1, far: 100 }}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
      fallback={<span className="pulso-kit-status" role="status">Assistente 3D indisponível</span>}
      onCreated={handleCreated}
    >
      <ContextGuard onLost={handleUnavailable} />
      <ambientLight intensity={1.4} />
      <hemisphereLight args={[0xf1f8ff, 0x394c64, 1.2]} />
      <directionalLight color={0xfff4e8} intensity={1.8} position={[3, 6, 5]} />
      <directionalLight color={0xb8e6ff} intensity={1.1} position={[-4, 3, 4]} />
      <ModelErrorBoundary
        onError={handleUnavailable}
        fallback={<LoadingMark>Não foi possível carregar o assistente 3D</LoadingMark>}
      >
        <Suspense fallback={<LoadingMark>Carregando assistente…</LoadingMark>}>
          <Bounds fit clip observe margin={1.15}>
            <Model
              modelUrl={modelUrl}
              motion={motion}
              reactionKey={reactionKey}
              reducedMotion={reducedMotion}
              onActivate={onActivate}
              onLoaded={handleLoaded}
            />
          </Bounds>
        </Suspense>
      </ModelErrorBoundary>
    </Canvas>
  ), [assistantEvents, handleCreated, handleLoaded, handleUnavailable, modelUrl, motion, onActivate, reactionKey, reducedMotion]);

  return (
    <div
      className={['pulso-floating-assistant', className].filter(Boolean).join(' ')}
      style={style}
      data-assistant-state={available ? 'ready' : 'unavailable'}
    >
      {available ? canvas : <span className="pulso-kit-status" role="status">Assistente 3D indisponível</span>}
      <button
        type="button"
        className="pulso-kit-keyboard-trigger"
        aria-label={label}
        onClick={onActivate}
      />
    </div>
  );
}
