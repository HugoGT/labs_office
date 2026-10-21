import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { AdminError } from '../dashboard/adminPort';
import { materialCatalogFrom } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import { MAP_W } from '../game/mapData';
import { createOfficeBridge, type OfficeCommandMap } from '../game/officeBridge';
import type { OfficeDecorPort } from '../game/officeDecorPort';
import { DecorEditorSection } from './DecorEditorSection';

const catalog = materialCatalogFrom(JSON.parse(exportedManifest), 'assets/pack/manifest.json')!;
const noPreview: ArtPreviewCache = { sheet: vi.fn(async () => null) };
const at = (tx: number, ty: number): number => ty * MAP_W + tx;

function renderSection(overrides: Partial<Parameters<typeof DecorEditorSection>[0]> = {}) {
  const bridge = overrides.bridge ?? createOfficeBridge();
  const commands: OfficeCommandMap['decoredit'][] = [];
  bridge.onCommand('decoredit', (command) => commands.push(command));
  const decor: OfficeDecorPort = overrides.decor ?? { setDecor: vi.fn(async () => undefined) };
  const props = { bridge, decor, scope: 'office' as const, area: null, loadMaterials: async () => catalog, preview: noPreview, ...overrides };
  return { ...props, commands, ...render(<DecorEditorSection {...props} />) };
}

describe('DecorEditorSection: Decoración (the whole office)', () => {
  it('offers only the way in while closed, and asks the other editors out before opening', async () => {
    const onRequestActive = vi.fn();
    const onEditingChange = vi.fn();
    renderSection({ onRequestActive, onEditingChange });
    expect(screen.queryByRole('group', { name: 'Sillas' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Decoración' }));
    expect(onRequestActive).toHaveBeenCalledTimes(1);
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    expect(await screen.findByRole('group', { name: 'Sillas' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Mesas de sala' })).toBeInTheDocument();
  });

  it('opens directly from the sidebar, places the picked piece on the clicked tile and says what it places', async () => {
    const decor: OfficeDecorPort = { setDecor: vi.fn(async () => undefined) };
    const { bridge, commands } = renderSection({ decor, initiallyActive: true });

    await userEvent.click(await screen.findByRole('button', { name: 'Silla gamer' }));
    expect(screen.getByText('Poniendo Silla gamer')).toBeInTheDocument();
    expect(commands.at(-1)).toMatchObject({ brush: { kind: 'piece', piece: 'chair-gamer', rotation: 0 }, area: null });

    act(() => bridge.emit('decorpick', { index: at(40, 40) }));
    await vi.waitFor(() => expect(decor.setDecor).toHaveBeenCalledWith([{ index: at(40, 40), item: { piece: 'chair-gamer', rotation: 0 } }]));
  });

  it('says the wheel and R turn the piece, room tables included, and offers no turn or eraser control of its own (#207, #208)', async () => {
    renderSection({ initiallyActive: true });
    expect(await screen.findByText(/gírala con la rueda del mouse o con R sobre el mapa/)).toBeInTheDocument();
    expect(screen.getByText(/las mesas de sala se ponen en horizontal o en vertical/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Girar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Mirando/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Quitar/)).not.toBeInTheDocument();
  });

  it('describes «Múltiple» and how it ends', async () => {
    renderSection({ initiallyActive: true });
    const multiple = await screen.findByRole('checkbox', { name: 'Múltiple: seguir colocando después de cada clic' });
    expect(multiple).toHaveAccessibleDescription('Termina con Escape.');
  });

  it('with «Múltiple» off one click places one piece and the brush is put down; on, it stays picked (#207)', async () => {
    const decor: OfficeDecorPort = { setDecor: vi.fn(async () => undefined) };
    const { bridge, commands } = renderSection({ decor, initiallyActive: true });
    const multiple = await screen.findByRole('checkbox', { name: /^Múltiple/ });
    expect(multiple).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Silla gamer' }));
    act(() => bridge.emit('decorpick', { index: at(40, 40) }));
    expect(commands.at(-1)).toMatchObject({ brush: null });
    expect(screen.getByRole('button', { name: 'Silla gamer' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(multiple);
    await userEvent.click(screen.getByRole('button', { name: 'Silla gamer' }));
    act(() => bridge.emit('decorpick', { index: at(41, 40) }));
    act(() => bridge.emit('decorpick', { index: at(42, 40) }));
    expect(screen.getByRole('button', { name: 'Silla gamer' })).toHaveAttribute('aria-pressed', 'true');
    await vi.waitFor(() => expect(decor.setDecor).toHaveBeenCalledTimes(3));
  });

  it('turns a picked room table with the map, horizontal and vertical', async () => {
    const { bridge, commands } = renderSection({ initiallyActive: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Mesa de reuniones' }));
    act(() => bridge.emit('decorrotate', { step: 1 }));
    expect(commands.at(-1)).toMatchObject({ brush: { piece: 'table-meeting', rotation: 90 } });
    act(() => bridge.emit('decorrotate', { step: 1 }));
    expect(commands.at(-1)).toMatchObject({ brush: { piece: 'table-meeting', rotation: 0 } });
  });

  it('places the painted desk in the color chosen on its tile', async () => {
    const decor: OfficeDecorPort = { setDecor: vi.fn(async () => undefined) };
    const { bridge, commands } = renderSection({ decor, initiallyActive: true });

    await userEvent.click(await screen.findByRole('button', { name: /^Color de Escritorio pintado/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Rojo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Escritorio pintado' }));
    expect(commands.at(-1)).toMatchObject({ brush: { piece: 'desk-painted', color: '#c0392b' } });

    act(() => bridge.emit('decorpick', { index: at(40, 40) }));
    await vi.waitFor(() => expect(decor.setDecor).toHaveBeenCalledWith([{ index: at(40, 40), item: { piece: 'desk-painted', rotation: 0, color: '#c0392b' } }]));
  });

  it('unpicks with «Deseleccionar», and shows why the server refused', async () => {
    const decor: OfficeDecorPort = {
      setDecor: vi.fn(async () => {
        throw new AdminError('terrain-under-placement');
      }),
    };
    const { bridge } = renderSection({ decor, initiallyActive: true });

    await userEvent.click(await screen.findByRole('button', { name: 'Ficus' }));
    act(() => bridge.emit('decorpick', { index: at(40, 40) }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/necesita suelo libre/);
    // One click, one edit: the brush is put down (no «Múltiple»).
    expect(screen.getByRole('button', { name: 'Ficus' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'Ficus' }));
    await userEvent.click(screen.getByRole('button', { name: 'Deseleccionar' }));
    expect(screen.getByRole('button', { name: 'Ficus' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('leaves with «Salir», and on an Escape with nothing picked', async () => {
    const onExit = vi.fn();
    const { commands } = renderSection({ initiallyActive: true, onExit });
    await userEvent.click(await screen.findByRole('button', { name: 'Salir' }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(commands.at(-1)).toBeNull();

    const second = renderSection({ initiallyActive: true, onExit });
    await screen.findAllByRole('button', { name: 'Salir' });
    await userEvent.keyboard('{Escape}');
    expect(onExit).toHaveBeenCalledTimes(2);
    expect(second.commands.at(-1)).toBeNull();
  });

  it('leaves when another editor takes the map', async () => {
    const { rerender, bridge, decor, commands } = renderSection({ initiallyActive: true });
    await screen.findByRole('group', { name: 'Sillas' });
    rerender(<DecorEditorSection bridge={bridge} decor={decor} scope="office" area={null} forceExit loadMaterials={async () => catalog} preview={noPreview} />);
    expect(commands.at(-1)).toBeNull();
    expect(screen.getByRole('button', { name: 'Decoración' })).toBeInTheDocument();
  });
});

describe('DecorEditorSection: Mi espacio (one desk)', () => {
  const DESK = { x: 10, y: 10, w: 3, h: 3 };

  it('is open at once over the desk, offers only what fits it and has no way out of its own', async () => {
    const { commands } = renderSection({ scope: 'desk', area: DESK });
    expect(await screen.findByRole('group', { name: 'Sillas' })).toBeInTheDocument();
    // Of the room tables only the 2x1 oval one fits a 3x3 desk.
    expect(screen.queryByRole('button', { name: 'Mesa de reuniones' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mesa ovalada' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salir' })).not.toBeInTheDocument();
    expect(commands.at(-1)).toEqual({ brush: null, area: DESK });
  });

  it('offers «Múltiple» too', async () => {
    renderSection({ scope: 'desk', area: DESK });
    expect(await screen.findByRole('checkbox', { name: /^Múltiple/ })).not.toBeChecked();
  });

  it('refuses a tile outside the desk without asking the server', async () => {
    const decor: OfficeDecorPort = { setDecor: vi.fn(async () => undefined) };
    const { bridge } = renderSection({ scope: 'desk', area: DESK, decor });
    await userEvent.click(await screen.findByRole('button', { name: 'Ficus' }));
    act(() => bridge.emit('decorpick', { index: at(20, 20) }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/dentro de tu escritorio/);
    expect(decor.setDecor).not.toHaveBeenCalled();
  });
});
