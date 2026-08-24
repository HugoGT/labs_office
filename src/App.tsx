import { OfficeShell } from './components/OfficeShell';

/**
 * `OfficeShell` es el unico dueno del `OfficeBridge` (D3): `App` solo monta
 * el landmark de la pagina.
 */
export default function App() {
  return (
    <main style={{ position: 'relative', width: '100%', height: '100%' }}>
      <OfficeShell />
    </main>
  );
}
