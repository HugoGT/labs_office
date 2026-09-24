import { describe, expect, it } from 'vitest';
import { MAP_H, MAP_W, TILE } from './mapData';
import {
  computeObstacles,
  isPlacementValid,
  reduceEditorState,
  snapToTile,
  toLayoutEditCommand,
  type EditorState,
  type LayoutObstacleItem,
} from './layoutEditor';

describe('reduceEditorState', () => {
  it('recorre off -> idle -> selected -> placing -> saving -> idle', () => {
    let state: EditorState = { tag: 'off' };

    state = reduceEditorState(state, { type: 'enter', kind: 'desk' });
    expect(state).toEqual({ tag: 'idle', kind: 'desk' });

    state = reduceEditorState(state, { type: 'select', id: 'desk-1' });
    expect(state).toEqual({ tag: 'selected', kind: 'desk', id: 'desk-1' });

    state = reduceEditorState(state, { type: 'startMove' });
    expect(state).toEqual({ tag: 'placing', kind: 'desk', mode: 'move', id: 'desk-1' });

    state = reduceEditorState(state, { type: 'confirmPlacement' });
    expect(state).toEqual({ tag: 'saving', kind: 'desk' });

    state = reduceEditorState(state, { type: 'saveSucceeded' });
    expect(state).toEqual({ tag: 'idle', kind: 'desk' });
  });

  it('seleccionar un item existente desde idle pasa a selected', () => {
    const idle: EditorState = { tag: 'idle', kind: 'room' };

    expect(reduceEditorState(idle, { type: 'select', id: 'room-9' })).toEqual({
      tag: 'selected',
      kind: 'room',
      id: 'room-9',
    });
  });

  it('crear uno nuevo pasa de idle a placing en modo create', () => {
    const idle: EditorState = { tag: 'idle', kind: 'desk' };

    expect(reduceEditorState(idle, { type: 'startCreate' })).toEqual({
      tag: 'placing',
      kind: 'desk',
      mode: 'create',
    });
  });

  it.each<EditorState>([
    { tag: 'idle', kind: 'desk' },
    { tag: 'selected', kind: 'desk', id: 'x' },
    { tag: 'placing', kind: 'desk', mode: 'create' },
    { tag: 'placing', kind: 'room', mode: 'move', id: 'x' },
    { tag: 'saving', kind: 'room' },
  ])('salir del modo edicion desde cualquier estado vuelve a off sin ghost ni pick: %j', (state) => {
    expect(reduceEditorState(state, { type: 'exit' })).toEqual({ tag: 'off' });
  });

  it('una accion que no aplica al estado actual lo deja sin cambios', () => {
    const idle: EditorState = { tag: 'idle', kind: 'desk' };

    expect(reduceEditorState(idle, { type: 'confirmPlacement' })).toBe(idle);
  });
});

describe('snapToTile', () => {
  it('centra la caja de w x h sobre el puntero', () => {
    // Puntero en el centro exacto de la caja de 3x3 que empieza en (5, 5).
    const worldX = (5 + 1.5) * TILE;
    const worldY = (5 + 1.5) * TILE;

    expect(snapToTile(worldX, worldY, 3, 3)).toEqual({ tx: 5, ty: 5 });
  });

  it('recorta al minimo del mapa cuando el puntero esta fuera por arriba/izquierda', () => {
    expect(snapToTile(0, 0, 3, 3)).toEqual({ tx: 0, ty: 0 });
  });

  it('recorta al maximo del mapa cuando el puntero esta fuera por abajo/derecha', () => {
    const worldX = (MAP_W + 10) * TILE;
    const worldY = (MAP_H + 10) * TILE;

    expect(snapToTile(worldX, worldY, 3, 3)).toEqual({ tx: MAP_W - 3, ty: MAP_H - 3 });
  });

  it('respeta w y h distintos entre si', () => {
    const worldX = (2 + 2) * TILE; // centro de una caja de w=4 en tx=2
    const worldY = (2 + 1) * TILE; // centro de una caja de h=2 en ty=2

    expect(snapToTile(worldX, worldY, 4, 2)).toEqual({ tx: 2, ty: 2 });
  });
});

describe('computeObstacles', () => {
  const room: LayoutObstacleItem = { id: 'room-1', kind: 'room', x: 10, y: 10, w: 5, h: 5 };
  const deskCubicle: LayoutObstacleItem = { id: 'space-of-desk-1', kind: 'desk', x: 2, y: 2, w: 3, h: 3 };
  const otherDeskCubicle: LayoutObstacleItem = {
    id: 'space-of-desk-2',
    kind: 'desk',
    x: 20,
    y: 20,
    w: 3,
    h: 3,
  };

  it('sin item en movimiento, todos los admin spaces son obstaculo', () => {
    expect(computeObstacles([room, deskCubicle], null)).toEqual([
      { x: 10, y: 10, w: 5, h: 5 },
      { x: 2, y: 2, w: 3, h: 3 },
    ]);
  });

  it('moviendo una sala, se excluye la propia por id', () => {
    const obstacles = computeObstacles([room, deskCubicle], { kind: 'room', id: 'room-1' });

    expect(obstacles).toEqual([{ x: 2, y: 2, w: 3, h: 3 }]);
  });

  it('moviendo un escritorio, se excluye el cubiculo que comparte su x/y actual, no por id', () => {
    // El escritorio no comparte id con su fila en /spaces (id-de-desk vs
    // id-de-space son cosas distintas); el emparejamiento es por kind+x/y.
    const obstacles = computeObstacles([room, deskCubicle, otherDeskCubicle], {
      kind: 'desk',
      x: 2,
      y: 2,
    });

    expect(obstacles).toEqual([
      { x: 10, y: 10, w: 5, h: 5 },
      { x: 20, y: 20, w: 3, h: 3 },
    ]);
  });
});

describe('isPlacementValid', () => {
  it('valido cuando no solapa ningun obstaculo', () => {
    const valid = isPlacementValid({ x: 0, y: 0, w: 3, h: 3 }, [{ x0: 10, y0: 10, x1: 12, y1: 12 }]);

    expect(valid).toBe(true);
  });

  it('invalido cuando solapa un obstaculo', () => {
    const valid = isPlacementValid({ x: 0, y: 0, w: 3, h: 3 }, [{ x0: 2, y0: 2, x1: 4, y1: 4 }]);

    expect(valid).toBe(false);
  });
});

describe('toLayoutEditCommand', () => {
  const items: LayoutObstacleItem[] = [
    { id: 'desk-1', kind: 'desk', x: 2, y: 2, w: 3, h: 3 },
    { id: 'room-1', kind: 'room', x: 10, y: 10, w: 5, h: 5 },
  ];

  it('off no produce comando: null es la senal de salir del modo edicion', () => {
    expect(toLayoutEditCommand({ tag: 'off' }, { items })).toBeNull();
  });

  it('idle expone todo lo pickable, sin seleccion ni colocacion', () => {
    expect(toLayoutEditCommand({ tag: 'idle', kind: 'desk' }, { items })).toEqual({
      pickable: [
        { id: 'desk-1', x0: 2, y0: 2, x1: 4, y1: 4 },
        { id: 'room-1', x0: 10, y0: 10, x1: 14, y1: 14 },
      ],
      selectedId: null,
      placing: null,
    });
  });

  it('selected marca selectedId y no expone ghost', () => {
    const command = toLayoutEditCommand({ tag: 'selected', kind: 'room', id: 'room-1' }, { items });

    expect(command?.selectedId).toBe('room-1');
    expect(command?.placing).toBeNull();
  });

  it('placing en modo crear no excluye nada de los obstaculos', () => {
    const command = toLayoutEditCommand(
      { tag: 'placing', kind: 'room', mode: 'create' },
      { items, placingSize: { w: 4, h: 4 } },
    );

    expect(command?.placing).toEqual({
      w: 4,
      h: 4,
      obstacles: [
        { x0: 2, y0: 2, x1: 4, y1: 4 },
        { x0: 10, y0: 10, x1: 14, y1: 14 },
      ],
    });
  });

  it('placing en modo mover excluye el item propio de los obstaculos', () => {
    const command = toLayoutEditCommand(
      { tag: 'placing', kind: 'room', mode: 'move', id: 'room-1' },
      { items, placingSize: { w: 5, h: 5 }, moving: { kind: 'room', id: 'room-1' } },
    );

    expect(command?.placing?.obstacles).toEqual([{ x0: 2, y0: 2, x1: 4, y1: 4 }]);
  });

  it('saving no expone pickable ni ghost: no hay nada que clicar mientras se guarda', () => {
    expect(toLayoutEditCommand({ tag: 'saving', kind: 'room' }, { items })).toEqual({
      pickable: [],
      selectedId: null,
      placing: null,
    });
  });
});
