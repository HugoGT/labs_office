import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import type { CollisionAdminPort } from '../dashboard/collisionAdminPort';
import type { OfficeBridge } from '../game/officeBridge';
import type { DecorTileRect } from '../game/officeDecor';
import type { OfficeDecorPort } from '../game/officeDecorPort';
import { DeskEditorSection } from './DeskEditorSection';
import { SpaceEditorSection } from './SpaceEditorSection';
import { TerrainEditorSection } from './TerrainEditorSection';
import { CollisionEditorSection } from './CollisionEditorSection';
import { DecorEditorSection } from './DecorEditorSection';
import styles from './OfficeLayoutEditor.module.css';

/**
 * The sidebar's map editors. `spaces` ("Editar espacios") holds the desks
 * first and the rooms after them, one of the two editing at a time; `decor`
 * ("Decoración", #208) places furniture anywhere on the map.
 */
export type LayoutEditorSection = 'decor' | 'spaces' | 'terrain' | 'collision';

/** The parts of the editor that arbitrate among themselves. */
type EditorPart = 'desk' | 'room' | 'terrain' | 'collision' | 'decor';

export interface OfficeLayoutEditorProps {
  bridge: OfficeBridge;
  desks: DeskAdminPort;
  spaces: SpacesAdminPort;
  terrain?: TerrainAdminPort | null;
  collisions?: CollisionAdminPort | null;
  /** The office decor layer (`POST /admin/decor`): optional like `terrain`. */
  decor?: OfficeDecorPort | null;
  /** Every desk area in tiles, for the desk rules of "Decoración" (`deskDecorRules.ts`). */
  deskAreas?: readonly DecorTileRect[];
  refreshDesks: () => void;
  refreshSpaces: () => void;
  onEditingChange?: (editing: boolean) => void;
  forceExit?: boolean;
  /** Chosen submenu; omitted, retain the standalone editor's section controls. */
  section?: LayoutEditorSection;
  onExit?: () => void;
}

/** The lazy boundary; a section change unmounts its old owner before mounting the next. */
export default function OfficeLayoutEditor(props: OfficeLayoutEditorProps) {
  if (props.section === 'terrain' && !props.terrain) return null;
  if (props.section === 'collision' && !props.collisions) return null;
  if (props.section === 'decor' && !props.decor) return null;
  return <LayoutEditorSections key={props.section ?? 'all'} {...props} />;
}

function LayoutEditorSections({
  bridge, desks, spaces, terrain, collisions, decor, deskAreas, refreshDesks, refreshSpaces,
  onEditingChange, forceExit = false, section, onExit,
}: OfficeLayoutEditorProps) {
  // Standalone consumers and "Editar espacios" arbitrate among their parts; the
  // sidebar supplies every other selection. Spaces opens on the rooms, the
  // desks being one button away.
  const arbitrated = section === undefined || section === 'spaces';
  const [activeSection, setActiveSection] = useState<EditorPart | null>(section === 'spaces' ? 'room' : null);
  /** "Editar salas" holds the panel: the desks step aside, like the rooms for "Editar escritorios". */
  const [roomListView, setRoomListView] = useState(false);
  const editingChangeRef = useRef(onEditingChange);
  editingChangeRef.current = onEditingChange;

  useEffect(() => () => {
    // Desk/room hooks share layoutedit and do not clear it on unmount themselves.
    // Terrain/collision hooks own their own cleanup (including collision debug).
    bridge.emitCommand('layoutedit', null);
    editingChangeRef.current?.(false);
  }, [bridge]);

  const requestActive = useCallback((next: EditorPart) => {
    // The old reducer must emit its null BEFORE the incoming reducer enters.
    flushSync(() => setActiveSection(next));
  }, []);

  function reportEditing(current: EditorPart, editing: boolean): void {
    if (!arbitrated) {
      onEditingChange?.(editing);
    } else if (editing) {
      onEditingChange?.(true);
    } else if (activeSection === current || activeSection === null) {
      setActiveSection(null);
      onEditingChange?.(false);
    }
  }

  const shown = (current: EditorPart): boolean =>
    section === undefined || (section === 'spaces' ? current === 'desk' || current === 'room' : section === current);
  const forced = (current: EditorPart): boolean => forceExit || (arbitrated && activeSection !== null && activeSection !== current);
  const embedded = section === 'spaces';
  const shared = { bridge, desks, spaces, refreshDesks, refreshSpaces, embedded, onExit };
  // The desk view of "Editar espacios" shows no rooms at all. Unmounting them
  // leaves nothing behind: the desk's next layoutedit command replaces the
  // rooms' overlay wholesale, and coming back remounts them already entered.
  const deskView = embedded && activeSection === 'desk';

  const parts = (
    <>
      {shown('decor') && decor !== undefined && decor !== null && (
        <DecorEditorSection bridge={bridge} decor={decor} scope="office" area={null} desks={deskAreas} terrain={terrain}
          initiallyActive={section !== undefined} onExit={onExit}
          onEditingChange={(editing) => reportEditing('decor', editing)}
          forceExit={forced('decor')}
          onRequestActive={() => requestActive('decor')}
        />
      )}
      {shown('desk') && (
        // Concealed rather than unmounted: an off desk editor mounting again
        // would emit its null `layoutedit` over the rooms' overlay.
        <DeskEditorSection {...shared} concealed={embedded && roomListView}
          onEditingChange={(editing) => reportEditing('desk', editing)}
          forceExit={forced('desk')}
          onRequestActive={() => requestActive('desk')}
        />
      )}
      {shown('room') && !deskView && (
        <SpaceEditorSection {...shared}
          initiallyActive={embedded}
          onListViewChange={setRoomListView}
          onEditingChange={(editing) => reportEditing('room', editing)}
          forceExit={forced('room')}
          onRequestActive={() => requestActive('room')}
        />
      )}
      {shown('terrain') && terrain !== undefined && terrain !== null && (
        <TerrainEditorSection bridge={bridge} terrain={terrain}
          initiallyActive={section !== undefined} onExit={onExit}
          onEditingChange={(editing) => reportEditing('terrain', editing)}
          forceExit={forced('terrain')}
          onRequestActive={() => requestActive('terrain')}
        />
      )}
      {shown('collision') && collisions !== undefined && collisions !== null && (
        <CollisionEditorSection bridge={bridge} collisions={collisions}
          initiallyActive={section !== undefined} onExit={onExit}
          onEditingChange={(editing) => reportEditing('collision', editing)}
          forceExit={forced('collision')}
          onRequestActive={() => requestActive('collision')}
        />
      )}
    </>
  );

  if (!embedded) return parts;
  return (
    <div className={styles.spaces}>
      <div className={styles.header}>
        <h2 className={styles.title}>Editar espacios</h2>
        <button type="button" className={styles.exit} onClick={() => onExit?.()}>
          Salir
        </button>
      </div>
      {parts}
    </div>
  );
}
