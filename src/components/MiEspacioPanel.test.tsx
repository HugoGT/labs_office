import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DeskDecorAsset, PlacedDeskItem } from '../game/deskDecorPort';
import { MiEspacioPanel, type MiEspacioPanelProps } from './MiEspacioPanel';

const PLANTA: DeskDecorAsset = { id: 'id-planta', name: 'Planta', kind: 'plant', textureKey: 'plant-small' };
const MESA: DeskDecorAsset = { id: 'id-mesa', name: 'Escritorio de madera', kind: 'furniture', textureKey: 'art:desk-wood:sheet' };

function panel(overrides: Partial<MiEspacioPanelProps> = {}) {
  const props: MiEspacioPanelProps = {
    hasDesk: true,
    phase: 'ready',
    catalog: [PLANTA, MESA],
    items: [] as readonly PlacedDeskItem[],
    onSave: vi.fn().mockResolvedValue('saved'),
    ...overrides,
  };
  render(<MiEspacioPanel {...props} />);
  return props;
}

/**
 * "Mi espacio" is where anyone, admin or not, decorates the desk they claimed
 * (Editar espacios): a table on one edge, chairs and plants. Whether a desk is
 * claimed is the UI's to tell; the server stores decor for the person anyway.
 */
describe('MiEspacioPanel', () => {
  it('shows the title "Mi espacio"', () => {
    panel();

    expect(screen.getByRole('heading', { name: 'Mi espacio' })).toBeInTheDocument();
  });

  it('without a claimed desk asks to claim one and shows no editor', () => {
    panel({ hasDesk: false });

    expect(screen.getByText('Reclama un escritorio para personalizar tu espacio.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Decorar mi escritorio' })).not.toBeInTheDocument();
  });

  it('with a claimed desk hosts the decor editor: the table, the boxes and save', async () => {
    const { onSave } = panel();

    expect(screen.getByRole('region', { name: 'Decorar mi escritorio' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Abajo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onSave).toHaveBeenCalledWith([{ assetId: 'id-mesa', slot: 7, rotation: 0 }]);
  });

  it('says it is loading while the decor is read, and when it cannot be edited', () => {
    panel({ phase: 'loading' });
    expect(screen.getByText(/Cargando/)).toBeInTheDocument();
  });

  it('says when the decor cannot be edited now', () => {
    panel({ phase: 'unavailable' });
    expect(screen.getByText('La decoración no está disponible ahora mismo.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Decorar mi escritorio' })).not.toBeInTheDocument();
  });
});
