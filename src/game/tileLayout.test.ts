import { describe, expect, it } from 'vitest';
import type { ScreenAnchor } from './anchorChannel';
import {
  INITIAL_COLLAPSE_STATE,
  INITIAL_TILE_LAYOUT_STATE,
  nextCollapseState,
  TRANSITION_DURATION_MS,
  tileLayout,
  type CollapseState,
} from './tileLayout';

/**
 * `nextCollapseState` decide que tiles colapsan a la fila fija cuando el
 * grupo se densifica (issue #17, D6). La regla NO es un umbral unico: entrar
 * usa 104px (single-linkage, cluster >=3), salir exige 140px sostenido 750ms
 * -- la histeresis + espera son deliberadas, existen para que dos avatares
 * rondando el borde del umbral no hagan parpadear los tiles cuadro a cuadro.
 */
function anchor(x: number, y: number, onScreen = true): ScreenAnchor {
  return { x, y, onScreen };
}

describe('nextCollapseState: entrada por densidad (issue #17, D6)', () => {
  it('3 tiles a menos de 104px entre si colapsan todos', () => {
    const anchors = new Map([
      ['a', anchor(0, 0)],
      ['b', anchor(50, 0)],
      ['c', anchor(100, 0)],
    ]);

    const state = nextCollapseState({ anchors, previous: INITIAL_COLLAPSE_STATE, now: 0 });

    expect(state.collapsedIds.has('a')).toBe(true);
    expect(state.collapsedIds.has('b')).toBe(true);
    expect(state.collapsedIds.has('c')).toBe(true);
  });

  it('2 tiles cerca NO colapsan -- el minimo de cluster es 3', () => {
    const anchors = new Map([
      ['a', anchor(0, 0)],
      ['b', anchor(50, 0)],
    ]);

    const state = nextCollapseState({ anchors, previous: INITIAL_COLLAPSE_STATE, now: 0 });

    expect(state.collapsedIds.size).toBe(0);
  });

  it('3 tiles lejos entre si (>104px) no colapsan', () => {
    const anchors = new Map([
      ['a', anchor(0, 0)],
      ['b', anchor(500, 0)],
      ['c', anchor(1000, 0)],
    ]);

    const state = nextCollapseState({ anchors, previous: INITIAL_COLLAPSE_STATE, now: 0 });

    expect(state.collapsedIds.size).toBe(0);
  });

  it('single-linkage: una cadena de pares consecutivos a <104px forma un unico cluster de 3+', () => {
    // a-b y b-c estan a <104px, pero a-c esta a 200px: el enlace simple (no
    // "todos contra todos") es lo que une igual el cluster completo.
    const anchors = new Map([
      ['a', anchor(0, 0)],
      ['b', anchor(100, 0)],
      ['c', anchor(200, 0)],
    ]);

    const state = nextCollapseState({ anchors, previous: INITIAL_COLLAPSE_STATE, now: 0 });

    expect(state.collapsedIds.has('a')).toBe(true);
    expect(state.collapsedIds.has('b')).toBe(true);
    expect(state.collapsedIds.has('c')).toBe(true);
  });

  it('un tile offScreen no cuenta para formar densidad', () => {
    const anchors = new Map([
      ['a', anchor(0, 0)],
      ['b', anchor(50, 0)],
      ['c', anchor(100, 0, false)],
    ]);

    const state = nextCollapseState({ anchors, previous: INITIAL_COLLAPSE_STATE, now: 0 });

    expect(state.collapsedIds.size).toBe(0);
  });
});

describe('nextCollapseState: histeresis de salida, sin parpadeo en el borde (issue #17, D6)', () => {
  it('no hay parpadeo al cruzar justo el borde de 104px ya estando colapsado', () => {
    const closeAnchors = new Map([
      ['a', anchor(0, 0)],
      ['b', anchor(50, 0)],
      ['c', anchor(100, 0)],
    ]);
    const collapsed = nextCollapseState({ anchors: closeAnchors, previous: INITIAL_COLLAPSE_STATE, now: 0 });
    expect(collapsed.collapsedIds.size).toBe(3);

    // Se abren un poco mas alla de 104px (110px) -- cruzan el umbral de
    // ENTRADA, pero siguen bien dentro del umbral de SALIDA (140px): no deben
    // restaurarse de inmediato.
    const justOverEntry = new Map([
      ['a', anchor(0, 0)],
      ['b', anchor(55, 0)],
      ['c', anchor(110, 0)],
    ]);
    const next = nextCollapseState({ anchors: justOverEntry, previous: collapsed, now: 10 });

    expect(next.collapsedIds.size).toBe(3);
  });

  it('restaura solo tras superar 140px Y sostenerlo 750ms continuos', () => {
    const closeAnchors = new Map([
      ['a', anchor(0, 0)],
      ['b', anchor(50, 0)],
      ['c', anchor(100, 0)],
    ]);
    let state = nextCollapseState({ anchors: closeAnchors, previous: INITIAL_COLLAPSE_STATE, now: 0 });
    expect(state.collapsedIds.size).toBe(3);

    // 'c' se aleja mas alla de 140px de TODOS los demas colapsados. El
    // primer cuadro en que se detecta la dispersion (aqui, now=0 mismo) es lo
    // que arranca el reloj de espera.
    const dispersed = new Map([
      ['a', anchor(0, 0)],
      ['b', anchor(50, 0)],
      ['c', anchor(300, 0)],
    ]);
    state = nextCollapseState({ anchors: dispersed, previous: state, now: 0 });
    expect(state.collapsedIds.has('c')).toBe(true);

    // A los 500ms de sostenerlo, todavia no llego a los 750ms: sigue colapsado.
    state = nextCollapseState({ anchors: dispersed, previous: state, now: 500 });
    expect(state.collapsedIds.has('c')).toBe(true);

    // A los 800ms desde que empezo a dispersarse, ya se sostuvo mas de
    // 750ms: restaura.
    state = nextCollapseState({ anchors: dispersed, previous: state, now: 800 });
    expect(state.collapsedIds.has('c')).toBe(false);
    // 'a' y 'b' siguen juntos (<104px): siguen colapsados.
    expect(state.collapsedIds.has('a')).toBe(true);
    expect(state.collapsedIds.has('b')).toBe(true);
  });

  it('si vuelve a acercarse antes de los 750ms, el temporizador de espera se reinicia', () => {
    const closeAnchors = new Map([
      ['a', anchor(0, 0)],
      ['b', anchor(50, 0)],
      ['c', anchor(100, 0)],
    ]);
    let state = nextCollapseState({ anchors: closeAnchors, previous: INITIAL_COLLAPSE_STATE, now: 0 });

    const dispersed = new Map([
      ['a', anchor(0, 0)],
      ['b', anchor(50, 0)],
      ['c', anchor(300, 0)],
    ]);
    state = nextCollapseState({ anchors: dispersed, previous: state, now: 400 });
    expect(state.collapsedIds.has('c')).toBe(true);

    // Vuelve a acercarse (<140px) antes de cumplir los 750ms: el reloj de
    // espera se reinicia.
    state = nextCollapseState({ anchors: closeAnchors, previous: state, now: 500 });
    expect(state.collapsedIds.has('c')).toBe(true);

    // Se dispersa otra vez; aunque ya pasaron 700ms desde now=0, el reloj
    // real arranco recien en el reingreso (now=500), asi que a los 900ms
    // (400ms de espera real) todavia NO debe restaurar.
    state = nextCollapseState({ anchors: dispersed, previous: state, now: 900 });
    expect(state.collapsedIds.has('c')).toBe(true);
  });

  it('un id que ya no tiene ancla (par que se fue) se poda del estado colapsado', () => {
    const closeAnchors = new Map([
      ['a', anchor(0, 0)],
      ['b', anchor(50, 0)],
      ['c', anchor(100, 0)],
    ]);
    let state = nextCollapseState({ anchors: closeAnchors, previous: INITIAL_COLLAPSE_STATE, now: 0 });
    expect(state.collapsedIds.has('c')).toBe(true);

    const withoutC = new Map([
      ['a', anchor(0, 0)],
      ['b', anchor(50, 0)],
    ]);
    state = nextCollapseState({ anchors: withoutC, previous: state, now: 10 });

    expect(state.collapsedIds.has('c')).toBe(false);
  });
});

/**
 * `tileLayout` traduce el estado de colapso a una posicion de pantalla por
 * tile (issue #17, D6). Lo no obvio: el suavizado de 150ms vive DENTRO de
 * esta funcion pura, nunca en CSS -- una transicion CSS estandar suavizaria
 * TAMBIEN el seguimiento anclado continuo (el `transform` se reescribe cada
 * cuadro), atrasando visiblemente al sprite. Por eso solo se interpola
 * durante los 150ms posteriores a un cambio de `mode`; fuera de esa ventana
 * el tile sigue su objetivo en vivo, cuadro a cuadro, sin interpolar.
 */
function anchorFrame(entries: readonly [string, ScreenAnchor][]): Map<string, ScreenAnchor> {
  return new Map(entries);
}

function collapseStateWith(ids: readonly string[]): CollapseState {
  return { collapsedIds: new Set(ids), restoreSince: new Map() };
}

describe('tileLayout: posicion anclada', () => {
  it('en modo anclado, la posicion es exactamente la del ancla', () => {
    const anchors = anchorFrame([['a', { x: 42, y: 17, onScreen: true }]]);

    const state = tileLayout({
      anchors,
      collapsed: INITIAL_COLLAPSE_STATE,
      viewport: { width: 1024, height: 768 },
      now: 0,
      previous: INITIAL_TILE_LAYOUT_STATE,
    });

    const position = state.positions.get('a')!;
    expect(position.x).toBe(42);
    expect(position.y).toBe(17);
    expect(position.mode).toBe('anchored');
  });

  it('oculto cuando el ancla reporta onScreen=false', () => {
    const anchors = anchorFrame([['a', { x: 42, y: 17, onScreen: false }]]);

    const state = tileLayout({
      anchors,
      collapsed: INITIAL_COLLAPSE_STATE,
      viewport: { width: 1024, height: 768 },
      now: 0,
      previous: INITIAL_TILE_LAYOUT_STATE,
    });

    expect(state.positions.get('a')!.visible).toBe(false);
  });

  it('un tile anclado sigue el objetivo en vivo cuadro a cuadro, sin interpolar (nunca se atrasa)', () => {
    let anchors = anchorFrame([['a', { x: 0, y: 0, onScreen: true }]]);
    let state = tileLayout({
      anchors,
      collapsed: INITIAL_COLLAPSE_STATE,
      viewport: { width: 1024, height: 768 },
      now: 0,
      previous: INITIAL_TILE_LAYOUT_STATE,
    });

    anchors = anchorFrame([['a', { x: 500, y: 0, onScreen: true }]]);
    state = tileLayout({
      anchors,
      collapsed: INITIAL_COLLAPSE_STATE,
      viewport: { width: 1024, height: 768 },
      now: 16,
      previous: state,
    });

    // Sin cambio de modo: el salto de 0 a 500 en un solo cuadro se refleja
    // de inmediato, no se suaviza -- esa suavizacion es exactamente el
    // "smear" que el diseno rechaza para el seguimiento continuo.
    expect(state.positions.get('a')!.x).toBe(500);
  });
});

describe('tileLayout: fila colapsada', () => {
  it('los tiles colapsados reciben un slot fijo en la fila, ordenados de forma estable', () => {
    const anchors = anchorFrame([
      ['b', { x: 10, y: 10, onScreen: true }],
      ['a', { x: 20, y: 20, onScreen: true }],
      ['c', { x: 30, y: 30, onScreen: true }],
    ]);

    const state = tileLayout({
      anchors,
      collapsed: collapseStateWith(['a', 'b', 'c']),
      viewport: { width: 1024, height: 768 },
      now: 0,
      previous: INITIAL_TILE_LAYOUT_STATE,
    });

    const a = state.positions.get('a')!;
    const b = state.positions.get('b')!;
    const c = state.positions.get('c')!;
    expect(a.mode).toBe('row');
    expect(b.mode).toBe('row');
    expect(c.mode).toBe('row');
    // Misma fila: comparten y. Orden estable (alfabetico) -> a esta a la
    // izquierda de b, y b a la izquierda de c.
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y);
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
  });
});

describe('tileLayout: suavizado de 150ms SOLO en la transicion de modo (issue #17, D6)', () => {
  it('una posicion nueva (sin estado previo) aparece directo en destino, sin animar', () => {
    const anchors = anchorFrame([['a', { x: 42, y: 17, onScreen: true }]]);

    const state = tileLayout({
      anchors,
      collapsed: INITIAL_COLLAPSE_STATE,
      viewport: { width: 1024, height: 768 },
      now: 0,
      previous: INITIAL_TILE_LAYOUT_STATE,
    });

    expect(state.positions.get('a')).toMatchObject({ x: 42, y: 17 });
  });

  it('a mitad de los 150ms de una transicion anclado->fila, la posicion esta a mitad de camino', () => {
    const anchoredAnchors = anchorFrame([['a', { x: 0, y: 100, onScreen: true }]]);
    const anchoredState = tileLayout({
      anchors: anchoredAnchors,
      collapsed: INITIAL_COLLAPSE_STATE,
      viewport: { width: 200, height: 300 },
      now: 0,
      previous: INITIAL_TILE_LAYOUT_STATE,
    });
    expect(anchoredState.positions.get('a')!.mode).toBe('anchored');

    // Colapsa a fila unica (solo 'a' en `collapsed`, para tener un slot
    // determinista): destino = { x: viewport.width/2, y: viewport.height - 56 } = (100, 244).
    const collapsed = collapseStateWith(['a']);
    // El cuadro en que se DETECTA el cambio de modo es el que arranca la
    // transicion (elapsed=0 ahi mismo, como en un bucle de rAF real).
    const transitionStarted = tileLayout({
      anchors: anchoredAnchors,
      collapsed,
      viewport: { width: 200, height: 300 },
      now: 0,
      previous: anchoredState,
    });

    const halfway = TRANSITION_DURATION_MS / 2;
    const midState = tileLayout({
      anchors: anchoredAnchors,
      collapsed,
      viewport: { width: 200, height: 300 },
      now: halfway,
      previous: transitionStarted,
    });

    const position = midState.positions.get('a')!;
    expect(position.mode).toBe('row');
    // A mitad de camino entre (0, 100) y (100, 244): (50, 172).
    expect(position.x).toBeCloseTo(50);
    expect(position.y).toBeCloseTo(172);
  });

  it('tras completarse los 150ms, la posicion queda exactamente en destino y deja de interpolar', () => {
    const anchoredAnchors = anchorFrame([['a', { x: 0, y: 100, onScreen: true }]]);
    const anchoredState = tileLayout({
      anchors: anchoredAnchors,
      collapsed: INITIAL_COLLAPSE_STATE,
      viewport: { width: 200, height: 300 },
      now: 0,
      previous: INITIAL_TILE_LAYOUT_STATE,
    });

    const collapsed = collapseStateWith(['a']);
    const transitionStarted = tileLayout({
      anchors: anchoredAnchors,
      collapsed,
      viewport: { width: 200, height: 300 },
      now: 0,
      previous: anchoredState,
    });

    let state = tileLayout({
      anchors: anchoredAnchors,
      collapsed,
      viewport: { width: 200, height: 300 },
      now: TRANSITION_DURATION_MS,
      previous: transitionStarted,
    });
    expect(state.positions.get('a')).toMatchObject({ x: 100, y: 244 });

    // Un cuadro mas, mucho despues: sigue exactamente en el slot de fila, sin
    // arrastrar ninguna interpolacion vieja.
    state = tileLayout({
      anchors: anchoredAnchors,
      collapsed,
      viewport: { width: 200, height: 300 },
      now: TRANSITION_DURATION_MS + 1000,
      previous: state,
    });
    expect(state.positions.get('a')).toMatchObject({ x: 100, y: 244 });
  });
});
