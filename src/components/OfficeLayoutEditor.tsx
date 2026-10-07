import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import type { CollisionAdminPort } from '../dashboard/collisionAdminPort';
import type { OfficeBridge } from '../game/officeBridge';
import { DeskEditorSection } from './DeskEditorSection';
import { SpaceEditorSection } from './SpaceEditorSection';
import { TerrainEditorSection } from './TerrainEditorSection';
import { CollisionEditorSection } from './CollisionEditorSection';

export type LayoutEditorSection = 'desk' | 'room' | 'terrain' | 'collision';

export interface OfficeLayoutEditorProps {
  bridge: OfficeBridge;
  desks: DeskAdminPort;
  spaces: SpacesAdminPort;
  terrain?: TerrainAdminPort | null;
  collisions?: CollisionAdminPort | null;
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
  return <LayoutEditorSections key={props.section ?? 'all'} {...props} />;
}

function LayoutEditorSections({
  bridge, desks, spaces, terrain, collisions, refreshDesks, refreshSpaces,
  onEditingChange, forceExit = false, section, onExit,
}: OfficeLayoutEditorProps) {
  // Only standalone consumers need arbitration; the sidebar supplies its selection.
  const [activeSection, setActiveSection] = useState<LayoutEditorSection | null>(null);
  const editingChangeRef = useRef(onEditingChange);
  editingChangeRef.current = onEditingChange;

  useEffect(() => () => {
    // Desk/room hooks share layoutedit and do not clear it on unmount themselves.
    // Terrain/collision hooks own their own cleanup (including collision debug).
    bridge.emitCommand('layoutedit', null);
    editingChangeRef.current?.(false);
  }, [bridge]);

  const requestActive = useCallback((next: LayoutEditorSection) => {
    // The old reducer must emit its null BEFORE the incoming reducer enters.
    flushSync(() => setActiveSection(next));
  }, []);

  function reportEditing(current: LayoutEditorSection, editing: boolean): void {
    if (section !== undefined) {
      onEditingChange?.(editing);
    } else if (editing) {
      onEditingChange?.(true);
    } else if (activeSection === current || activeSection === null) {
      setActiveSection(null);
      onEditingChange?.(false);
    }
  }

  const shown = (current: LayoutEditorSection): boolean => section === undefined || section === current;
  const forced = (current: LayoutEditorSection): boolean => forceExit || (section === undefined && activeSection !== null && activeSection !== current);
  const shared = { bridge, desks, spaces, refreshDesks, refreshSpaces, initiallyActive: section !== undefined, onExit };

  return (
    <>
      {shown('desk') && (
        <DeskEditorSection {...shared}
          onEditingChange={(editing) => reportEditing('desk', editing)}
          forceExit={forced('desk')}
          onRequestActive={() => requestActive('desk')}
        />
      )}
      {shown('room') && (
        <SpaceEditorSection {...shared}
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
}
