import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BottomBar } from './BottomBar';

function renderBar(overrides: Partial<ComponentProps<typeof BottomBar>> = {}) {
  const props = {
    micOn: true,
    camOn: true,
    recording: false,
    room: null as string | null,
    nearby: [] as string[],
    onToggleMic: vi.fn(),
    onToggleCam: vi.fn(),
    onToggleRecord: vi.fn(),
    ...overrides,
  };
  render(<BottomBar {...props} />);
  return props;
}

describe('BottomBar', () => {
  it('aria-pressed de mic refleja micOn, independiente de camOn', () => {
    renderBar({ micOn: false, camOn: true });

    expect(screen.getByRole('button', { name: /Mic/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Cámara/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('click en mic llama solo a onToggleMic, no a onToggleCam', async () => {
    const user = userEvent.setup();
    const props = renderBar({ micOn: false, camOn: true });

    await user.click(screen.getByRole('button', { name: /Mic/ }));

    expect(props.onToggleMic).toHaveBeenCalledTimes(1);
    expect(props.onToggleCam).not.toHaveBeenCalled();
  });

  it('el boton de grabar esta deshabilitado fuera de una sala', () => {
    renderBar({ room: null });

    expect(screen.getByRole('button', { name: /Grabar/ })).toBeDisabled();
  });

  it('el boton de grabar esta habilitado dentro de una sala', () => {
    renderBar({ room: 'Sala de Juntas' });

    expect(screen.getByRole('button', { name: /Grabar/ })).toBeEnabled();
  });

  it('muestra el estado de proximidad fuera de una sala y el de sala privada dentro', () => {
    const { rerender } = render(
      <BottomBar
        micOn
        camOn
        recording={false}
        room={null}
        nearby={[]}
        onToggleMic={vi.fn()}
        onToggleCam={vi.fn()}
        onToggleRecord={vi.fn()}
      />,
    );
    expect(screen.getByText('proximidad').tagName).toBe('B');

    rerender(
      <BottomBar
        micOn
        camOn
        recording={false}
        room="Cafeteria"
        nearby={[]}
        onToggleMic={vi.fn()}
        onToggleCam={vi.fn()}
        onToggleRecord={vi.fn()}
      />,
    );
    expect(screen.getByText('Cafeteria').tagName).toBe('B');
  });

  it('seis o menos NPCs cercanos renderizan un chip cada uno sin indicador de desborde', () => {
    renderBar({ nearby: ['Ana', 'Beto', 'Caro', 'Dani', 'Eli', 'Fer'] });

    expect(screen.getAllByText(/^🔊 /)).toHaveLength(6);
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
  });

  it('mas de seis NPCs cercanos colapsan el resto en un indicador "+N"', () => {
    renderBar({ nearby: ['Ana', 'Beto', 'Caro', 'Dani', 'Eli', 'Fer', 'Gus', 'Hugo'] });

    expect(screen.getAllByText(/^🔊 /)).toHaveLength(6);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });
});
