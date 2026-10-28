import { act, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CollisionAdminPort } from '../dashboard/collisionAdminPort';
import { createOfficeBridge, type OfficeCommandMap } from '../game/officeBridge';
import { CollisionEditorSection } from './CollisionEditorSection';

const FOOTPRINT = [{ x: -16, y: -32, w: 32, h: 32 }];

function renderSection(overrides: Partial<Parameters<typeof CollisionEditorSection>[0]> = {}) {
  const bridge = overrides.bridge ?? createOfficeBridge();
  const commands: OfficeCommandMap['collisionedit'][] = [];
  bridge.onCommand('collisionedit', (command) => commands.push(command));
  const collisions: CollisionAdminPort = overrides.collisions ?? { saveRects: vi.fn(async () => undefined), reset: vi.fn(async () => undefined) };
  const props = { bridge, collisions, ...overrides };
  return { ...props, commands, ...render(<CollisionEditorSection {...props} />) };
}

async function openOnTree(bridge: ReturnType<typeof createOfficeBridge>, saved = false) {
  await userEvent.click(screen.getByRole('button', { name: 'Editar colisiones' }));
  act(() => bridge.emit('collisionpick', { pieceId: 'tree-oak', rotation: 0, rects: saved ? [] : FOOTPRINT, saved, defaults: FOOTPRINT }));
}

describe('CollisionEditorSection', () => {
  it('has no "Mostrar colisiones" toggle, closed or open: the map outlines them while editing', async () => {
    renderSection();

    expect(screen.queryByRole('checkbox', { name: 'Mostrar colisiones' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Editar colisiones' }));
    expect(screen.queryByRole('checkbox', { name: 'Mostrar colisiones' })).not.toBeInTheDocument();
  });

  it('asks the other editors out before opening, and reports each change of mode', async () => {
    const onRequestActive = vi.fn();
    const onEditingChange = vi.fn();
    renderSection({ onRequestActive, onEditingChange });

    await userEvent.click(screen.getByRole('button', { name: 'Editar colisiones' }));
    expect(onRequestActive).toHaveBeenCalledTimes(1);
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/Toca un objeto en el mapa/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it('shows the piece picked on the map, with its rectangles as numbers', async () => {
    const { bridge } = renderSection();
    await openOnTree(bridge);

    expect(screen.getByText('tree-oak · por defecto')).toBeInTheDocument();
    expect(screen.getByText(/todas las piezas iguales/)).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'X del rectángulo 1' })).toHaveValue(-16);
    expect(screen.getByRole('spinbutton', { name: 'Alto del rectángulo 1' })).toHaveValue(32);
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restablecer' })).toBeDisabled();
  });

  it('edits, adds and deletes rectangles, previewing each change on the map, then saves', async () => {
    const { bridge, commands, collisions } = renderSection();
    await openOnTree(bridge);

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Ancho del rectángulo 1' }), { target: { value: '20' } });
    expect(commands.at(-1)).toMatchObject({ pieceId: 'tree-oak', draft: [{ x: -16, y: -32, w: 20, h: 32 }], selectedRect: 0 });

    await userEvent.click(screen.getByRole('button', { name: 'Añadir rectángulo' }));
    expect(screen.getByRole('spinbutton', { name: 'X del rectángulo 2' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar rectángulo 1' }));
    expect(screen.queryByRole('spinbutton', { name: 'X del rectángulo 2' })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Ajuste' }), '2');
    expect(commands.at(-1)).toMatchObject({ snap: 2 });

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(collisions.saveRects).toHaveBeenCalledWith('tree-oak', [{ x: -8, y: -24, w: 16, h: 16 }]);
    expect(await screen.findByRole('status')).toHaveTextContent('Colisión guardada.');
    expect(screen.getByText('tree-oak · personalizada')).toBeInTheDocument();
  });

  it('says a piece with no rectangles is walk-through, cancels back, and restores the default', async () => {
    const { bridge, collisions } = renderSection();
    await openOnTree(bridge, true);
    expect(screen.getByText(/se puede atravesar/)).toBeInTheDocument();

    act(() => bridge.emit('collisiondraft', { rects: [{ x: 0, y: 0, w: 4, h: 4 }], selectedRect: 0 }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText(/se puede atravesar/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Restablecer' }));
    expect(collisions.reset).toHaveBeenCalledWith('tree-oak');
    expect(await screen.findByRole('status')).toHaveTextContent('Colisión restablecida.');
    expect(screen.getByRole('spinbutton', { name: 'X del rectángulo 1' })).toHaveValue(-16);
  });

  it('closes when another editor takes the map', async () => {
    const onEditingChange = vi.fn();
    const { rerender, bridge, collisions } = renderSection({ onEditingChange });
    await userEvent.click(screen.getByRole('button', { name: 'Editar colisiones' }));

    rerender(<CollisionEditorSection bridge={bridge} collisions={collisions} onEditingChange={onEditingChange} forceExit />);

    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('button', { name: 'Editar colisiones' })).toBeInTheDocument();
  });
});

describe('CollisionEditorSection: Escape, one level per press', () => {
  it('releases the rectangle, then the piece, then leaves like "Salir"', async () => {
    const onExit = vi.fn();
    const { bridge } = renderSection({ onExit });
    await openOnTree(bridge);
    act(() => bridge.emit('collisiondraft', { rects: FOOTPRINT, selectedRect: 0 }));
    expect(screen.getByRole('button', { name: 'Rectángulo 1' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Rectángulo 1' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.keyboard('{Escape}');
    expect(screen.getByText(/Toca un objeto en el mapa/)).toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Editar colisiones' })).toBeInTheDocument();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('keeps an unsaved draft: it never exits over it', async () => {
    const onExit = vi.fn();
    const { bridge } = renderSection({ onExit });
    await openOnTree(bridge);
    act(() => bridge.emit('collisiondraft', { rects: [{ x: 0, y: 0, w: 4, h: 4 }], selectedRect: null }));

    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Escape}');

    expect(screen.getByText('tree-oak · por defecto')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Ancho del rectángulo 1' })).toHaveValue(4);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('is not listening while the editor is closed', async () => {
    const onExit = vi.fn();
    renderSection({ onExit });

    await userEvent.keyboard('{Escape}');

    expect(onExit).not.toHaveBeenCalled();
  });
});

