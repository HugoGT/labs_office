import { describe, expect, it } from 'vitest';
import { reduceEditorState, type EditorState } from './layoutEditor';

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
