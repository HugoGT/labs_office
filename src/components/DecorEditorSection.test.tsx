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

  it('explains nothing between its header and «Múltiple», and offers no turn or eraser control of its own (#207, #208)', async () => {
    const { container } = renderSection({ initiallyActive: true });
    const multiple = await screen.findByRole('checkbox', { name: 'Múltiple: varios a la vez' });
    expect(multiple).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(/rueda del mouse/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Elige una pieza/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sin pieza elegida/)).not.toBeInTheDocument();
    expect(screen.queryByText(/muestra de color/)).not.toBeInTheDocument();
    expect(screen.queryByText('Termina con Escape.')).not.toBeInTheDocument();
    // The header's title is followed straight by the checkbox's row.
    const title = screen.getByRole('heading', { name: 'Decoración' });
    expect(title.parentElement?.nextElementSibling).toContainElement(multiple);
    expect(container.textContent).not.toMatch(/gírala/);
    expect(screen.queryByRole('button', { name: 'Girar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Mirando/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Quitar/)).not.toBeInTheDocument();
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

/**
 * "Decoración" for whoever does not administer (#208): the same menu scoped
 * to the desk they claimed, through `POST /me/decor`, with no «Múltiple».
 */
describe('DecorEditorSection: Decoración for one desk', () => {
  const DESK = { x: 10, y: 10, w: 3, h: 3 };
  const NO_DESK_TEXT = 'Reclama un escritorio libre en el mapa para decorarlo.';

  it('is open at once over the desk under the same header, offers only what fits it and no «Múltiple»', async () => {
    const { commands } = renderSection({ scope: 'desk', area: DESK });
    expect(await screen.findByRole('group', { name: 'Sillas' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Decoración' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salir' })).toBeInTheDocument();
    // Of the room tables only the 2x1 oval one fits a 3x3 desk.
    expect(screen.queryByRole('button', { name: 'Mesa de reuniones' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mesa ovalada' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Múltiple/ })).not.toBeInTheDocument();
    expect(commands.at(-1)).toEqual({ brush: null, area: DESK });
  });

  it('places one piece per click and unpicks the brush', async () => {
    const decor: OfficeDecorPort = { setDecor: vi.fn(async () => undefined) };
    const { bridge } = renderSection({ scope: 'desk', area: DESK, decor });
    await userEvent.click(await screen.findByRole('button', { name: 'Ficus' }));
    act(() => bridge.emit('decorpick', { index: at(11, 11) }));
    await vi.waitFor(() => expect(decor.setDecor).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/^Poniendo/)).not.toBeInTheDocument();
  });

  it('without a claimed desk asks to claim one, offers no pieces and leaves with «Salir» or Escape', async () => {
    const onExit = vi.fn();
    const { commands } = renderSection({ scope: 'desk', area: null, onExit });
    expect(screen.getByText(NO_DESK_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Sillas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dejar escritorio' })).not.toBeInTheDocument();
    expect(commands).toEqual([]);

    await userEvent.keyboard('{Escape}');
    expect(onExit).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(onExit).toHaveBeenCalledTimes(2);
  });

  it('with a claimed desk ends with «Dejar escritorio»', async () => {
    const onLeaveDesk = vi.fn();
    renderSection({ scope: 'desk', area: DESK, onLeaveDesk });
    await screen.findByRole('group', { name: 'Sillas' });

    const leave = screen.getByRole('button', { name: 'Dejar escritorio' });
    expect(screen.getAllByRole('button').at(-1)).toBe(leave);
    await userEvent.click(leave);
    expect(onLeaveDesk).toHaveBeenCalledTimes(1);
  });

  it('steps out on Escape like the admin menu: the brush, then the editor itself', async () => {
    const onExit = vi.fn();
    const { commands } = renderSection({ scope: 'desk', area: DESK, onExit });
    await userEvent.click(await screen.findByRole('button', { name: 'Ficus' }));

    await userEvent.keyboard('{Escape}');
    expect(commands.at(-1)).toMatchObject({ brush: null });
    expect(onExit).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(commands.at(-1)).toBeNull();
  });

  it('opens over a desk claimed meanwhile, and closes the map overlay once the desk is gone', async () => {
    const { rerender, bridge, decor, commands } = renderSection({ scope: 'desk', area: null });
    const props = { bridge, decor, scope: 'desk' as const, loadMaterials: async () => catalog, preview: noPreview };
    rerender(<DecorEditorSection {...props} area={DESK} />);
    expect(await screen.findByRole('group', { name: 'Sillas' })).toBeInTheDocument();
    expect(commands.at(-1)).toEqual({ brush: null, area: DESK });

    rerender(<DecorEditorSection {...props} area={null} />);
    expect(commands.at(-1)).toBeNull();
    expect(screen.getByText(NO_DESK_TEXT)).toBeInTheDocument();
  });

  it('refuses a tile outside the desk without asking the server', async () => {
    const decor: OfficeDecorPort = { setDecor: vi.fn(async () => undefined) };
    const { bridge } = renderSection({ scope: 'desk', area: DESK, decor });
    await userEvent.click(await screen.findByRole('button', { name: 'Ficus' }));
    act(() => bridge.emit('decorpick', { index: at(20, 20) }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/dentro de tu escritorio/);
    expect(decor.setDecor).not.toHaveBeenCalled();
  });

  it('passes the desks to the map for the desk rules', async () => {
    const desks = [DESK, { x: 20, y: 10, w: 3, h: 3 }];
    const { commands } = renderSection({ scope: 'desk', area: DESK, desks });
    await screen.findByRole('group', { name: 'Sillas' });
    expect(commands.at(-1)).toEqual({ brush: null, area: DESK, desks });
  });
});
