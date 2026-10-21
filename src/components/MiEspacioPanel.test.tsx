import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { materialCatalogFrom } from '../game/artMaterials';
import { createOfficeBridge, type OfficeCommandMap } from '../game/officeBridge';
import { MiEspacioPanel, type MiEspacioPanelProps } from './MiEspacioPanel';

const catalog = materialCatalogFrom(JSON.parse(exportedManifest), 'assets/pack/manifest.json')!;
const DESK = { x: 10, y: 12, w: 3, h: 3 };

function panel(overrides: Partial<MiEspacioPanelProps> = {}) {
  const bridge = createOfficeBridge();
  const commands: OfficeCommandMap['decoredit'][] = [];
  bridge.onCommand('decoredit', (command) => commands.push(command));
  const props: MiEspacioPanelProps = {
    hasDesk: true,
    area: DESK,
    bridge,
    decor: { setDecor: vi.fn(async () => undefined) },
    onLeaveDesk: vi.fn(),
    loadMaterials: async () => catalog,
    preview: { sheet: vi.fn(async () => null) },
    ...overrides,
  };
  return { props, ...props, commands, ...render(<MiEspacioPanel {...props} />) };
}

/**
 * "Mi espacio" is where anyone, admin or not, decorates the desk they claimed
 * (#208): the decor editor scoped to that desk, writing the office decor
 * layer through `POST /me/decor`, and the way to leave the desk.
 */
describe('MiEspacioPanel', () => {
  it('shows the title "Mi espacio"', () => {
    panel();

    expect(screen.getByRole('heading', { name: 'Mi espacio' })).toBeInTheDocument();
  });

  it('without a claimed desk asks to claim a free one on the map, and offers neither decor nor leaving', () => {
    const { commands } = panel({ hasDesk: false, area: null });

    expect(screen.getByText('Reclama un escritorio libre en el mapa para decorarlo.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Sillas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dejar escritorio' })).not.toBeInTheDocument();
    expect(commands).toEqual([]);
  });

  it('with a claimed desk decorates it with the pieces that fit, and ends with «Dejar escritorio»', async () => {
    const { commands, onLeaveDesk } = panel();

    expect(screen.queryByText('Reclama un escritorio libre en el mapa para decorarlo.')).not.toBeInTheDocument();
    expect(await screen.findByRole('group', { name: 'Sillas' })).toBeInTheDocument();
    // Only the room tables that fit a 3x3 desk: the 2x1 oval one.
    expect(screen.queryByRole('button', { name: 'Mesa de reuniones' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mesa ovalada' })).toBeInTheDocument();
    expect(commands.at(-1)).toEqual({ brush: null, area: DESK });

    const buttons = screen.getAllByRole('button');
    const leave = screen.getByRole('button', { name: 'Dejar escritorio' });
    expect(buttons.at(-1)).toBe(leave);
    await userEvent.click(leave);
    expect(onLeaveDesk).toHaveBeenCalledTimes(1);
  });

  it('closes the map overlay once the desk is gone', () => {
    const { commands, rerender, props } = panel();
    rerender(<MiEspacioPanel {...props} hasDesk={false} area={null} />);
    expect(commands.at(-1)).toBeNull();
    expect(screen.getByText('Reclama un escritorio libre en el mapa para decorarlo.')).toBeInTheDocument();
  });
});
