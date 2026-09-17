import { useCallback, useEffect, useState } from 'react';
import type { OfficeBridge, OfficeEventMap } from '../game/officeBridge';

export interface UseOfficeBridgeResult {
  room: string | null;
  menu: OfficeEventMap['npcmenu'] | null;
  presence: OfficeEventMap['presence'];
  closeMenu: () => void;
}

/** Antes de que la escena diga nada, se asume solitario, no conectado. */
const INITIAL_PRESENCE: OfficeEventMap['presence'] = { online: false, peers: 0 };

/**
 * Suscribe el arbol de React a un `OfficeBridge` ya creado (D3: el puente lo
 * crea y posee `OfficeShell`, nunca este hook). Cada evento de Phaser
 * actualiza estado local; al desmontar se llaman todas las desuscripciones.
 */
export function useOfficeBridge(bridge: OfficeBridge): UseOfficeBridgeResult {
  const [room, setRoom] = useState<string | null>(null);
  const [menu, setMenu] = useState<OfficeEventMap['npcmenu'] | null>(null);
  const [presence, setPresence] = useState<OfficeEventMap['presence']>(INITIAL_PRESENCE);

  useEffect(() => {
    const unsubscribeRoom = bridge.on('room', (payload) => setRoom(payload.room));
    const unsubscribeNpcMenu = bridge.on('npcmenu', (payload) => setMenu(payload));
    const unsubscribeCloseMenu = bridge.on('closemenu', () => setMenu(null));
    const unsubscribePresence = bridge.on('presence', (payload) => setPresence(payload));

    return () => {
      unsubscribeRoom();
      unsubscribeNpcMenu();
      unsubscribeCloseMenu();
      unsubscribePresence();
    };
  }, [bridge]);

  const closeMenu = useCallback(() => setMenu(null), []);

  return { room, menu, presence, closeMenu };
}
