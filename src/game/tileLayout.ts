import type { ScreenAnchor } from './anchorChannel';

/**
 * Regla de densidad para colapsar tiles a la fila fija (issue #17, D6).
 *
 * Entrar y salir usan umbrales DISTINTOS a proposito (histeresis): un umbral
 * unico haria parpadear los tiles cada vez que dos avatares merodean el
 * borde exacto del umbral. Entrar es agresivo (104px, cluster >=3) porque
 * evitar solapamiento visual es la prioridad; salir es conservador (140px,
 * sostenido 750ms) porque un colapso que se deshace y rehace en el mismo
 * segundo es peor que uno que tarda un poco de mas en restaurarse.
 */
export const COLLAPSE_DISTANCE_PX = 104;
export const RESTORE_DISTANCE_PX = 140;
export const RESTORE_DWELL_MS = 750;
export const MIN_CLUSTER_SIZE = 3;

export interface CollapseState {
  /** Sessions ids actualmente colapsados a la fila fija. */
  readonly collapsedIds: ReadonlySet<string>;
  /**
   * Desde que momento (segun el `now` inyectado) cada id colapsado dejo de
   * estar cerca (<=140px) de cualquier otro id colapsado, de forma continua.
   * Se borra en cuanto vuelve a acercarse -- asi el reloj de espera se
   * reinicia en vez de acumularse entre rachas.
   */
  readonly restoreSince: ReadonlyMap<string, number>;
}

export const INITIAL_COLLAPSE_STATE: CollapseState = {
  collapsedIds: new Set(),
  restoreSince: new Map(),
};

export interface NextCollapseStateInput {
  readonly anchors: ReadonlyMap<string, ScreenAnchor>;
  readonly previous: CollapseState;
  readonly now: number;
}

function distance(a: ScreenAnchor, b: ScreenAnchor): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Agrupa `candidateIds` por enlace simple (single-linkage): dos ids quedan
 * en el mismo grupo si existe una CADENA de pares consecutivos a distancia
 * <= `thresholdPx`, no hace falta que todos esten cerca de todos. Union-Find
 * con compresion de camino, O(n^2) comparaciones -- de sobra para el puñado
 * de tiles que puede haber en pantalla a la vez.
 */
function singleLinkageGroups(
  candidateIds: readonly string[],
  anchors: ReadonlyMap<string, ScreenAnchor>,
  thresholdPx: number,
): Map<string, Set<string>> {
  const parent = new Map<string, string>();
  for (const id of candidateIds) parent.set(id, id);

  function find(id: string): string {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  }
  function union(a: string, b: string): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }

  for (let i = 0; i < candidateIds.length; i++) {
    for (let j = i + 1; j < candidateIds.length; j++) {
      const a = anchors.get(candidateIds[i]);
      const b = anchors.get(candidateIds[j]);
      if (!a || !b) continue;
      if (distance(a, b) <= thresholdPx) union(candidateIds[i], candidateIds[j]);
    }
  }

  const groups = new Map<string, Set<string>>();
  for (const id of candidateIds) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, new Set());
    groups.get(root)!.add(id);
  }
  return groups;
}

/**
 * Decide, cuadro a cuadro, que tiles estan colapsados a la fila fija.
 *
 * Pura y sin Phaser/DOM: toma el snapshot de anclas de este cuadro, el
 * estado anterior y el reloj inyectado, y devuelve el estado siguiente. El
 * llamador (el bucle de rAF de `VideoTiles`) guarda el resultado en una ref y
 * lo vuelve a pasar como `previous` en el proximo cuadro -- el mismo patron
 * que `anchorChannel` ya usa para `generation`.
 */
export function nextCollapseState({ anchors, previous, now }: NextCollapseStateInput): CollapseState {
  const onScreenIds = [...anchors.keys()].filter((id) => anchors.get(id)!.onScreen);
  const collapseGroups = singleLinkageGroups(onScreenIds, anchors, COLLAPSE_DISTANCE_PX);
  const denseIds = new Set<string>();
  for (const group of collapseGroups.values()) {
    if (group.size >= MIN_CLUSTER_SIZE) for (const id of group) denseIds.add(id);
  }

  const collapsedIds = new Set(previous.collapsedIds);
  const restoreSince = new Map(previous.restoreSince);

  // Poda ids sin ancla este cuadro (par que se fue, o anclas aun no publicadas).
  for (const id of collapsedIds) {
    if (!anchors.has(id)) {
      collapsedIds.delete(id);
      restoreSince.delete(id);
    }
  }
  for (const id of restoreSince.keys()) {
    if (!anchors.has(id)) restoreSince.delete(id);
  }

  // Entrada: cualquier id en un cluster denso este cuadro queda (o sigue)
  // colapsado, y su reloj de espera se borra -- sigue claramente agrupado.
  for (const id of denseIds) {
    collapsedIds.add(id);
    restoreSince.delete(id);
  }

  // Salida: solo para ids YA colapsados que no forman parte de un cluster
  // denso este cuadro. Usa el umbral mas laxo (140px) contra los demas ids
  // TODAVIA colapsados; si sigue cerca de al menos uno, no dispersa (reinicia
  // el reloj). Si esta lejos de todos, cuenta cuanto lleva asi de forma
  // continua y solo restaura al superar el tiempo de espera.
  const stillCollapsed = [...collapsedIds].filter((id) => anchors.has(id));
  for (const id of stillCollapsed) {
    if (denseIds.has(id)) continue; // ya resuelto arriba

    const anchor = anchors.get(id)!;
    const nearAnotherCollapsed = stillCollapsed.some((otherId) => {
      if (otherId === id) return false;
      const other = anchors.get(otherId);
      return !!other && distance(anchor, other) <= RESTORE_DISTANCE_PX;
    });

    if (nearAnotherCollapsed) {
      restoreSince.delete(id);
      continue;
    }

    const since = restoreSince.get(id) ?? now;
    if (!restoreSince.has(id)) restoreSince.set(id, since);
    if (now - since >= RESTORE_DWELL_MS) {
      collapsedIds.delete(id);
      restoreSince.delete(id);
    }
  }

  return { collapsedIds, restoreSince };
}

/** Duracion del suavizado de una transicion de `mode` (issue #17, D6). */
export const TRANSITION_DURATION_MS = 150;

const ROW_SLOT_SPACING_PX = 80;
const ROW_BOTTOM_MARGIN_PX = 56;

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export type TileMode = 'anchored' | 'row';

export interface TilePositionState {
  readonly x: number;
  readonly y: number;
  readonly mode: TileMode;
  readonly visible: boolean;
  /**
   * Momento (segun `now`) en que empezo la transicion de modo EN CURSO, o
   * `null` si no hay ninguna -- en ese caso el tile sigue su objetivo en
   * vivo, cuadro a cuadro, sin interpolar.
   */
  readonly transitionStartedAt: number | null;
  /** Posicion desde la que arranco esa transicion (solo valida junto a `transitionStartedAt`). */
  readonly transitionFrom: { readonly x: number; readonly y: number } | null;
}

export interface TileLayoutState {
  readonly positions: ReadonlyMap<string, TilePositionState>;
}

export const INITIAL_TILE_LAYOUT_STATE: TileLayoutState = { positions: new Map() };

export interface TileLayoutInput {
  readonly anchors: ReadonlyMap<string, ScreenAnchor>;
  readonly collapsed: CollapseState;
  readonly viewport: ViewportSize;
  readonly now: number;
  readonly previous: TileLayoutState;
}

/** Slot horizontal de un tile colapsado, centrado en el viewport (issue #17, D6). */
function rowSlot(index: number, total: number, viewport: ViewportSize): { x: number; y: number } {
  const totalWidth = Math.max(total - 1, 0) * ROW_SLOT_SPACING_PX;
  const startX = viewport.width / 2 - totalWidth / 2;
  return { x: startX + index * ROW_SLOT_SPACING_PX, y: viewport.height - ROW_BOTTOM_MARGIN_PX };
}

/**
 * Traduce anclas + estado de colapso a una posicion de pantalla por tile.
 *
 * El suavizado de 150ms vive AQUI, nunca en CSS (D6): una transicion CSS
 * estandar (`transition: transform`) suavizaria tambien el seguimiento
 * anclado continuo -- el bucle de rAF reescribe `transform` cada cuadro
 * incluso cuando nada colapsa, asi que esa transicion de sobra atrasaria
 * visiblemente al sprite que ya se mueve con tween. Por eso la interpolacion
 * solo corre durante los 150ms posteriores a un cambio de `mode`; fuera de
 * esa ventana el tile sigue su objetivo en vivo sin interpolar, cuadro a
 * cuadro (cero smear).
 */
export function tileLayout({ anchors, collapsed, viewport, now, previous }: TileLayoutInput): TileLayoutState {
  const rowIds = [...anchors.keys()].filter((id) => collapsed.collapsedIds.has(id)).sort();
  const rowIndex = new Map(rowIds.map((id, index) => [id, index]));

  const positions = new Map<string, TilePositionState>();

  for (const [id, anchor] of anchors) {
    const mode: TileMode = collapsed.collapsedIds.has(id) ? 'row' : 'anchored';
    const target =
      mode === 'row' ? rowSlot(rowIndex.get(id)!, rowIds.length, viewport) : { x: anchor.x, y: anchor.y };
    const visible = mode === 'row' ? true : anchor.onScreen;

    const prevState = previous.positions.get(id);

    if (!prevState) {
      // Tile nuevo este cuadro: aparece directo en destino, nunca animado
      // desde ningun otro lado.
      positions.set(id, {
        x: target.x,
        y: target.y,
        mode,
        visible,
        transitionStartedAt: null,
        transitionFrom: null,
      });
      continue;
    }

    const modeChanged = prevState.mode !== mode;
    const transitionStartedAt = modeChanged ? now : prevState.transitionStartedAt;
    const transitionFrom = modeChanged ? { x: prevState.x, y: prevState.y } : prevState.transitionFrom;

    if (transitionStartedAt !== null && transitionFrom !== null) {
      const elapsed = now - transitionStartedAt;
      if (elapsed < TRANSITION_DURATION_MS) {
        const t = elapsed / TRANSITION_DURATION_MS;
        positions.set(id, {
          x: transitionFrom.x + (target.x - transitionFrom.x) * t,
          y: transitionFrom.y + (target.y - transitionFrom.y) * t,
          mode,
          visible,
          transitionStartedAt,
          transitionFrom,
        });
        continue;
      }
    }

    // Sin transicion en curso (o ya se cumplieron sus 150ms): sigue el
    // objetivo en vivo, sin interpolar -- el seguimiento anclado continuo
    // nunca se suaviza ni atrasa.
    positions.set(id, {
      x: target.x,
      y: target.y,
      mode,
      visible,
      transitionStartedAt: null,
      transitionFrom: null,
    });
  }

  return { positions };
}
