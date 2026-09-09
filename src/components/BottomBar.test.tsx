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
    presence: { online: false, peers: 0 },
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
        presence={{ online: false, peers: 0 }}
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
        presence={{ online: false, peers: 0 }}
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

describe('BottomBar: chips de companeros reales (D7)', () => {
  /**
   * Control: demuestra que el spy de `console.error` SI detecta la
   * advertencia real de React por keys duplicadas cuando estas ocurren de
   * verdad, fuera de `BottomBar`. Sin este control, una aserción de ausencia
   * en el siguiente test sería vacía — no probaría que el mecanismo de
   * deteccion funciona.
   */
  it('control: el spy de console.error detecta la advertencia real de React ante keys duplicadas', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <div>
          {['x', 'x'].map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>,
      );

      const sawDuplicateKeyWarning = errorSpy.mock.calls.some((args) =>
        String(args[0]).includes('two children with the same key'),
      );
      expect(sawDuplicateKeyWarning).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('dos companeros reales con el mismo nombre no disparan la advertencia de React por keys duplicadas', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderBar({ nearby: ['HugoGT', 'HugoGT'] });

      const sawDuplicateKeyWarning = errorSpy.mock.calls.some((args) =>
        String(args[0]).includes('two children with the same key'),
      );
      expect(sawDuplicateKeyWarning).toBe(false);
      // Ademas de no advertir, ambos chips deben seguir en el DOM: la
      // regresion prohibida es deduplicar nombres, no solo silenciar el warning.
      expect(screen.getAllByText('🔊 HugoGT')).toHaveLength(2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('los chips de companeros reales se renderizan antes que los de NPCs, en el orden recibido', () => {
    renderBar({ nearby: ['HugoGT', 'Ana'] });

    const chips = screen.getAllByText(/^🔊 /).map((el) => el.textContent);
    expect(chips).toEqual(['🔊 HugoGT', '🔊 Ana']);
  });

  it('el indicador de desborde cuenta la lista fusionada, incluyendo nombres duplicados', () => {
    renderBar({ nearby: ['HugoGT', 'HugoGT', 'Ana', 'Beto', 'Caro', 'Dani', 'Eli'] });

    expect(screen.getAllByText(/^🔊 /)).toHaveLength(6);
    expect(screen.getByText('+1')).toBeInTheDocument();
  });
});

describe('BottomBar: presencia de avatares reales', () => {
  it('muestra cuantos companeros reales hay conectados', () => {
    renderBar({ presence: { online: true, peers: 3 } });

    expect(screen.getByText('🟢 3 en línea')).toBeInTheDocument();
  });

  it('sin servidor lo dice en neutro, no como error', () => {
    renderBar({ presence: { online: false, peers: 0 } });

    // Estar en solitario es un modo valido: la oficina sigue jugable con los
    // NPCs simulados, asi que no se pinta como fallo.
    expect(screen.getByText('⚪ Sin servidor')).toBeInTheDocument();
  });

  it('conectado y solo sigue siendo "en línea", con cero companeros', () => {
    renderBar({ presence: { online: true, peers: 0 } });

    expect(screen.getByText('🟢 0 en línea')).toBeInTheDocument();
  });
});
