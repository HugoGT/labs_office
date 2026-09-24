import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { OfficeBridge } from '../game/officeBridge';
import { DeskEditorSection } from './DeskEditorSection';

/**
 * Contenedor del editor de layout en el sidebar (#74, PR3c). Es la FRONTERA
 * `React.lazy` (design decision "Admin code loading"): `OfficeSidebar` lo
 * carga con `import()` diferido para que quien no administra nunca descargue
 * este subarbol. Hoy solo monta `DeskEditorSection`; `SpaceEditorSection`
 * (PR4) se anade aqui al lado, no reemplazandolo.
 *
 * Export por defecto a proposito: es lo que `React.lazy` espera, mismo
 * criterio que `DashboardRoute.tsx`.
 */

export interface OfficeLayoutEditorProps {
  bridge: OfficeBridge;
  desks: DeskAdminPort;
  refreshDesks: () => void;
  refreshSpaces: () => void;
  onEditingChange?: (editing: boolean) => void;
  forceExit?: boolean;
}

export default function OfficeLayoutEditor(props: OfficeLayoutEditorProps) {
  return <DeskEditorSection {...props} />;
}
