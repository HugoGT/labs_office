import { useEffect, useRef } from 'react';
import type Phaser from 'phaser';
import { createGame } from '../game/createGame';
import type { OfficeBridge } from '../game/officeBridge';

export interface GameCanvasProps {
  bridge: OfficeBridge;
}

/**
 * Monta Phaser en un contenedor propio y lo destruye al desmontar.
 * La limpieza es obligatoria: StrictMode monta dos veces en desarrollo y sin
 * `destroy` quedarian dos instancias de Phaser compitiendo por el canvas.
 *
 * `bridge` lo recibe por prop, no lo crea: el dueno del puente es quien monta
 * este componente (D3). Aun no es `OfficeShell` (slice 8s) — ver nota en
 * `App.tsx`.
 */
export function GameCanvas({ bridge }: GameCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    gameRef.current = createGame(host, bridge);

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [bridge]);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />;
}
