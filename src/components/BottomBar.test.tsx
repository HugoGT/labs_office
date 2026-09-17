import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { STATUS_COLOR, statusCssColor } from '../game/presence';
import { BottomBar } from './BottomBar';

function renderBar(overrides: Partial<ComponentProps<typeof BottomBar>> = {}) {
  const props = {
    micOn: true,
    camOn: true,
    audioAvailable: true,
    recording: false,
    room: null as string | null,
    nearby: [] as string[],
    presence: { online: false, peers: 0 },
    status: 'g' as const,
    onChangeStatus: vi.fn(),
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
        audioAvailable
        recording={false}
        room={null}
        nearby={[]}
        presence={{ online: false, peers: 0 }}
        status="g"
        onChangeStatus={vi.fn()}
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
        audioAvailable
        recording={false}
        room="Cafeteria"
        nearby={[]}
        presence={{ online: false, peers: 0 }}
        status="g"
        onChangeStatus={vi.fn()}
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

describe('BottomBar: degradacion cuando LiveKit no esta disponible', () => {
  it('mic y camara se deshabilitan con un title explicativo cuando audioAvailable es false', () => {
    renderBar({ audioAvailable: false });

    const micButton = screen.getByRole('button', { name: /Mic/ });
    const camButton = screen.getByRole('button', { name: /Cámara/ });

    expect(micButton).toBeDisabled();
    expect(camButton).toBeDisabled();
    expect(micButton.getAttribute('title')).toBeTruthy();
    expect(camButton.getAttribute('title')).toBeTruthy();
  });

  it('mic y camara siguen habilitados cuando audioAvailable es true', () => {
    renderBar({ audioAvailable: true });

    expect(screen.getByRole('button', { name: /Mic/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Cámara/ })).toBeEnabled();
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

describe('BottomBar: selector de estado de presencia (#1)', () => {
  it('ofrece los tres estados con sus etiquetas', () => {
    renderBar({ status: 'g' });

    const select = screen.getByLabelText('Mi estado');
    expect(select).toHaveValue('g');
    expect(screen.getByRole('option', { name: 'En línea' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Ocupado' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'No molestar' })).toBeInTheDocument();
  });

  it('elegir un estado avisa con su codigo, no con su etiqueta', async () => {
    const user = userEvent.setup();
    const props = renderBar({ status: 'g' });

    await user.selectOptions(screen.getByLabelText('Mi estado'), 'r');

    // El codigo es lo que entiende el servidor; la etiqueta es solo para leer.
    expect(props.onChangeStatus).toHaveBeenCalledWith('r');
  });

  it('el punto junto al nombre toma el color del estado, no un verde fijo', () => {
    const { rerender } = render(
      <BottomBar
        micOn={false}
        camOn={false}
        audioAvailable
        recording={false}
        room={null}
        nearby={[]}
        presence={{ online: false, peers: 0 }}
        status="g"
        onChangeStatus={vi.fn()}
        onToggleMic={vi.fn()}
        onToggleCam={vi.fn()}
        onToggleRecord={vi.fn()}
      />,
    );
    // El punto es decorativo y no lleva marcado de prueba: se alcanza desde
    // el selector, que si es accesible, porque comparten contenedor.
    const dot = screen.getByLabelText('Mi estado').parentElement?.querySelector('span');
    expect(dot).toHaveStyle({ background: statusCssColor('g') });

    rerender(
      <BottomBar
        micOn={false}
        camOn={false}
        audioAvailable
        recording={false}
        room={null}
        nearby={[]}
        presence={{ online: false, peers: 0 }}
        status="r"
        onChangeStatus={vi.fn()}
        onToggleMic={vi.fn()}
        onToggleCam={vi.fn()}
        onToggleRecord={vi.fn()}
      />,
    );
    expect(dot).toHaveStyle({ background: statusCssColor('r') });
    expect(STATUS_COLOR.r).not.toBe(STATUS_COLOR.g);
  });
});

describe('BottomBar: "No molestar" en el HUD (#1)', () => {
  it('deshabilita mic y camara con un title que explica el porque', () => {
    renderBar({ status: 'r', audioAvailable: true });

    const micButton = screen.getByRole('button', { name: /Mic/ });
    const camButton = screen.getByRole('button', { name: /Cámara/ });
    expect(micButton).toBeDisabled();
    expect(camButton).toBeDisabled();
    expect(micButton.getAttribute('title')).toMatch(/No molestar/);
    expect(camButton.getAttribute('title')).toMatch(/No molestar/);
  });

  it('sin LiveKit el title sigue explicando la falta de conexion, no el estado', () => {
    renderBar({ status: 'g', audioAvailable: false });

    expect(screen.getByRole('button', { name: /Mic/ }).getAttribute('title')).toMatch(/LiveKit/);
  });

  it('"Ocupado" no deshabilita nada: es senal social', () => {
    renderBar({ status: 'y', audioAvailable: true });

    expect(screen.getByRole('button', { name: /Mic/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Cámara/ })).toBeEnabled();
  });

  it('dice que el audio esta cortado en vez de anunciar proximidad', () => {
    renderBar({ status: 'r', room: null });

    // Mostrar "Audio por proximidad" sin que nada sea audible es mentirle al
    // usuario sobre lo unico que la barra existe para contarle.
    expect(screen.queryByText('proximidad')).not.toBeInTheDocument();
    expect(screen.getByText(/aislado del audio de la oficina/)).toBeInTheDocument();
  });

  it('dentro de una sala tambien manda "No molestar", que es el aislamiento mas fuerte', () => {
    renderBar({ status: 'r', room: 'Sala de Juntas' });

    expect(screen.getByText(/aislado del audio de la oficina/)).toBeInTheDocument();
  });
});
