import { useEffect, useRef } from 'react';
import type Phaser from 'phaser';
import type { OfficeSession } from '../auth/authPort';
import { createGame } from '../game/createGame';
import type { OfficeBridge } from '../game/officeBridge';

export interface GameCanvasProps {
  bridge: OfficeBridge;
  /** `null` corre la oficina en solitario, sin avatares reales. */
  endpoint?: string | null;
  /**
   * Sesion autenticada (#8), o `null` sin autenticacion. Su identidad importa:
   * cambiarla recrea Phaser entero, igual que cambiar el endpoint. Quien la
   * entrega (`AuthGate`) la mantiene estable con `useMemo`.
   */
  session?: OfficeSession | null;
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
export function GameCanvas({ bridge, endpoint = null, session = null }: GameCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Sin sesion no se anaden claves: el camino sin autenticacion tiene que
    // llegar a la escena exactamente como antes de #8, no con un par de
    // `undefined` que la escena tenga que interpretar.
    gameRef.current = createGame(host, bridge, {
      endpoint,
      ...(session
        ? { playerName: session.displayName, getIdToken: () => session.getIdToken() }
        : {}),
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [bridge, endpoint, session]);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />;
}
