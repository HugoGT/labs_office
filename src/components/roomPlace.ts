import type { OfficeDesk } from '../game/desksPort';
import type { SpaceArea } from '../game/mapData';

/**
 * Where the local player stands, as the HUD names it: a room by its name, or
 * a desk by whoever claimed it. A desk's cubicle is the space with the desk's
 * origin (`pgDesks.syncDeskSpace`), so it is told apart by its rectangle;
 * the cubicle's own name is the desk label, which the HUD does not show.
 */
export type RoomPlace = { kind: 'room'; name: string } | { kind: 'desk'; owner: string | null };

export function placeOf(
  spaceId: string | null,
  name: string | null,
  spaces: readonly SpaceArea[],
  desks: readonly OfficeDesk[],
): RoomPlace | null {
  if (spaceId === null || name === null) return null;
  const space = spaces.find((candidate) => candidate.id === spaceId);
  const desk = space === undefined ? undefined : desks.find((candidate) => candidate.x === space.x && candidate.y === space.y);
  if (desk === undefined) return { kind: 'room', name };
  return { kind: 'desk', owner: desk.occupant?.displayName ?? null };
}

/** The bottom bar's name for a place: "Sala 1", "Escritorio de Hugo", or "Escritorio" for one nobody claimed. */
export function placeLabel(place: RoomPlace): string {
  if (place.kind === 'room') return place.name;
  return place.owner === null ? 'Escritorio' : `Escritorio de ${place.owner}`;
}
