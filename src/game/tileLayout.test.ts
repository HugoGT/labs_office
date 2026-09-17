import { describe, expect, it } from 'vitest';
import type { ScreenAnchor } from './anchorChannel';
import { INITIAL_COLLAPSE_STATE, nextCollapseState } from './tileLayout';

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
