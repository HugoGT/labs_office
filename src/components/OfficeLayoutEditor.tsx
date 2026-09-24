import { useCallback, useState } from 'react';
import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import type { OfficeBridge } from '../game/officeBridge';
import { DeskEditorSection } from './DeskEditorSection';
import { SpaceEditorSection } from './SpaceEditorSection';

/**
 * Contenedor del editor de layout en el sidebar (#74, PR3c + PR4). Es la
 * FRONTERA `React.lazy` (design decision "Admin code loading"): `OfficeSidebar`
 * lo carga con `import()` diferido para que quien no administra nunca
 * descargue este subarbol. Monta `DeskEditorSection` Y `SpaceEditorSection`
 * juntas -- la una AL LADO de la otra, no reemplazandola (nota de PR3c) --
 * como dos secciones independientes, cada una con su propio "off"/reductor
 * (`useLayoutEditor.ts`/`useSpaceEditor.ts` son instancias separadas: no hay
 * un unico reductor compartido, ver el deviation note de esta PR).
 *
 * Export por defecto a proposito: es lo que `React.lazy` espera, mismo
 * criterio que `DashboardRoute.tsx`.
 */

export interface OfficeLayoutEditorProps {
  bridge: OfficeBridge;
  desks: DeskAdminPort;
  spaces: SpacesAdminPort;
  refreshDesks: () => void;
  refreshSpaces: () => void;
  onEditingChange?: (editing: boolean) => void;
  forceExit?: boolean;
}

export default function OfficeLayoutEditor({
  bridge,
  desks,
  spaces,
  refreshDesks,
  refreshSpaces,
  onEditingChange,
  forceExit,
}: OfficeLayoutEditorProps) {
  // Cada seccion reporta SU PROPIO off<->activo; "editando" para quien nos
  // contiene (mismo consumidor final que "cierra `DeskDecorEditor`") es
  // "cualquiera de las dos lo esta", no solo escritorios.
  const [deskEditing, setDeskEditing] = useState(false);
  const [spaceEditing, setSpaceEditing] = useState(false);

  const handleDeskEditingChange = useCallback(
    (editing: boolean) => {
      setDeskEditing(editing);
      onEditingChange?.(editing || spaceEditing);
    },
    [onEditingChange, spaceEditing],
  );

  const handleSpaceEditingChange = useCallback(
    (editing: boolean) => {
      setSpaceEditing(editing);
      onEditingChange?.(editing || deskEditing);
    },
    [onEditingChange, deskEditing],
  );

  return (
    <>
      <DeskEditorSection
        bridge={bridge}
        desks={desks}
        spaces={spaces}
        refreshDesks={refreshDesks}
        refreshSpaces={refreshSpaces}
        onEditingChange={handleDeskEditingChange}
        forceExit={forceExit}
      />
      <SpaceEditorSection
        bridge={bridge}
        spaces={spaces}
        desks={desks}
        refreshDesks={refreshDesks}
        refreshSpaces={refreshSpaces}
        onEditingChange={handleSpaceEditingChange}
        forceExit={forceExit}
      />
    </>
  );
}
