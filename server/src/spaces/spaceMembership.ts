/**
 * Pertenencia servidor-side: dado una posicion en pixeles (la que guarda
 * `LiveSessionRegistry.positionOf`, ver `liveSessions.ts`) y la lista de
 * `Space` vigente (en TILES, ver la cabecera de `spaceRules.ts`), responde a
 * que espacio pertenece o `null` si no esta dentro de ninguno.
 *
 * D4: reutiliza `detectSpace` (`src/game/proximity.ts`) en vez de copiar la
 * aritmetica de contencion en el servidor. `detectSpace` trabaja en pixeles
 * sobre un `SpaceArea{id,x,y,w,h,name}`; la conversion de tiles a pixeles
 * (`* TILE`) vive solo aqui, no en `detectSpace` ni en `Space`.
 */

import type { SpaceArea } from '../../../src/game/mapData.ts';
import { TILE } from '../../../src/game/mapData.ts';
import { detectSpace, type Point } from '../../../src/game/proximity.ts';
import type { Space } from './spacesPort.ts';

function toSpaceArea(space: Space): SpaceArea {
  return {
    id: space.id,
    name: space.name,
    x: space.x * TILE,
    y: space.y * TILE,
    w: space.w * TILE,
    h: space.h * TILE,
  };
}

/** Id del espacio que contiene `pos` (en pixeles), o `null` si no hay ninguno. */
export function spaceIdAt(pos: Point, spaces: readonly Space[]): string | null {
  const found = detectSpace(
    pos,
    spaces.map(toSpaceArea),
  );
  return found?.id ?? null;
}
