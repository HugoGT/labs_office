import { useEffect, useRef } from 'react';
import type Phaser from 'phaser';
import { createGame } from '../game/createGame';

/**
 * Monta Phaser en un contenedor propio y lo destruye al desmontar.
 * La limpieza es obligatoria: StrictMode monta dos veces en desarrollo y sin
 * `destroy` quedarian dos instancias de Phaser compitiendo por el canvas.
 */
export function GameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    gameRef.current = createGame(host);

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />;
}
