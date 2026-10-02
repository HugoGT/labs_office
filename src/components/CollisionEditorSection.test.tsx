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
  const debugCommands: OfficeCommandMap['collisiondebug'][] = [];
  bridge.onCommand('collisionedit', (command) => commands.push(command));
  bridge.onCommand('collisiondebug', (command) => debugCommands.push(command));
  const collisions: CollisionAdminPort = overrides.collisions ?? { saveRects: vi.fn(async () => undefined), reset: vi.fn(async () => undefined) };
  const props = { bridge, collisions, ...overrides };
  return { ...props, commands, debugCommands, ...render(<CollisionEditorSection {...props} />) };
}

async function openOnTree(bridge: ReturnType<typeof createOfficeBridge>, saved = false) {
  await userEvent.click(screen.getByRole('button', { name: 'Editar colisiones' }));
  act(() => bridge.emit('collisionpick', { pieceId: 'tree-oak', rects: saved ? [] : FOOTPRINT, saved, defaults: FOOTPRINT }));
}

describe('CollisionEditorSection', () => {
  it('offers the way in and the debug outlines while closed', async () => {
    const { debugCommands } = renderSection();

    expect(screen.getByRole('button', { name: 'Editar colisiones' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mostrar colisiones' }));
    expect(debugCommands).toEqual([{ show: true }]);
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
