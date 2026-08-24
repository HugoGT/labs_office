import { useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { createOfficeBridge } from './game/officeBridge';

/**
 * `App` es duenio provisional del puente hasta que `OfficeShell` (slice 8s,
 * D3) lo absorba junto con el HUD. Ningun estado global: `useState` mantiene
 * una unica instancia estable por montaje, igual que hara `OfficeShell`.
 */
export default function App() {
  const [bridge] = useState(createOfficeBridge);

  return (
    <main style={{ position: 'relative', width: '100%', height: '100%' }}>
      <GameCanvas bridge={bridge} />
    </main>
  );
}
