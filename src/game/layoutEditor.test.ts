import { describe, expect, it } from 'vitest';
import { MAP_H, MAP_W, TILE } from './mapData';
import { reduceEditorState, snapToTile, type EditorState } from './layoutEditor';

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
