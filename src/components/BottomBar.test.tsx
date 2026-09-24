import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_NAME } from '../game/officeProtocol';
import { STATUS_COLOR, statusCssColor } from '../game/presence';
import type { OfficeEventMap } from '../game/officeBridge';
import { BottomBar } from './BottomBar';

/** Modo solitario: sin endpoint configurado, no hay nada que reintentar. */
const OFFLINE_SOLO: OfficeEventMap['presence'] = {
  online: false,
  peers: 0,
  state: 'offline',
  canRetry: false,
};

/** Sesion perdida con servidor configurado: aqui el reintento si significa algo. */
const OFFLINE_RETRYABLE: OfficeEventMap['presence'] = { ...OFFLINE_SOLO, canRetry: true };

function renderBar(overrides: Partial<ComponentProps<typeof BottomBar>> = {}) {
  const props = {
    playerName: DEFAULT_NAME,
    micOn: true,
    camOn: true,
    audioAvailable: true,
    recording: false,
    room: null as string | null,
    presence: OFFLINE_SOLO,
    status: 'g' as const,
    onChangeStatus: vi.fn(),
    onToggleMic: vi.fn(),
    onToggleCam: vi.fn(),
    onToggleRecord: vi.fn(),
    onRetryConnection: vi.fn(),
    screenShareOn: false,
    screenShareAvailable: true,
    onToggleScreenShare: vi.fn(),
    ...overrides,
  };
  render(<BottomBar {...props} />);
  return props;
}

describe('BottomBar: retiro de los chips de cercania (issue #17, D9)', () => {
  it('no renderiza ningun chip: cada companero audible ahora tiene su propia tile de video', () => {
    renderBar();

    expect(screen.queryByText(/^🔊/)).not.toBeInTheDocument();
  });
});

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
        playerName={DEFAULT_NAME}
        micOn
        camOn
        audioAvailable
        recording={false}
        room={null}
        presence={OFFLINE_SOLO}
        status="g"
        onChangeStatus={vi.fn()}
        onToggleMic={vi.fn()}
        onToggleCam={vi.fn()}
        onToggleRecord={vi.fn()}
        onRetryConnection={vi.fn()}
        screenShareOn={false}
        screenShareAvailable={false}
        onToggleScreenShare={vi.fn()}
      />,
    );
    expect(screen.getByText('proximidad').tagName).toBe('B');

    rerender(
      <BottomBar
        playerName={DEFAULT_NAME}
        micOn
        camOn
        audioAvailable
        recording={false}
        room="Cafeteria"
        presence={OFFLINE_SOLO}
        status="g"
        onChangeStatus={vi.fn()}
        onToggleMic={vi.fn()}
        onToggleCam={vi.fn()}
        onToggleRecord={vi.fn()}
        onRetryConnection={vi.fn()}
        screenShareOn={false}
        screenShareAvailable={false}
        onToggleScreenShare={vi.fn()}
      />,
    );
    expect(screen.getByText('Cafeteria').tagName).toBe('B');
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
  it('conectado no muestra recuento: quien esta en linea vive en la barra lateral', () => {
    renderBar({ presence: { online: true, peers: 3, state: 'connected', canRetry: true } });

    expect(screen.queryByText(/en línea/)).not.toBeInTheDocument();
  });

  it('sin servidor lo dice en neutro, no como error', () => {
    renderBar({ presence: OFFLINE_SOLO });

    // Estar en solitario es un modo valido: la oficina sigue jugable con los
    // NPCs simulados, asi que no se pinta como fallo.
    expect(screen.getByText('⚪ Sin servidor')).toBeInTheDocument();
  });

  it('conectado y solo tampoco muestra "0 en línea"', () => {
    renderBar({ presence: { online: true, peers: 0, state: 'connected', canRetry: true } });

    expect(screen.queryByText(/en línea/)).not.toBeInTheDocument();
  });
});

describe('BottomBar: selector de estado de presencia (#1)', () => {
  it('ofrece los tres estados con sus etiquetas', () => {
    renderBar({ status: 'g' });

    const select = screen.getByLabelText('Mi estado');
    expect(select).toHaveValue('g');
    expect(screen.getByRole('option', { name: '🟢 En línea' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '🟡 Ocupado' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '🔴 No molestar' })).toBeInTheDocument();
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
        playerName={DEFAULT_NAME}
        micOn={false}
        camOn={false}
        audioAvailable
        recording={false}
        room={null}
        presence={OFFLINE_SOLO}
        status="g"
        onChangeStatus={vi.fn()}
        onToggleMic={vi.fn()}
        onToggleCam={vi.fn()}
        onToggleRecord={vi.fn()}
        onRetryConnection={vi.fn()}
        screenShareOn={false}
        screenShareAvailable={false}
        onToggleScreenShare={vi.fn()}
      />,
    );
    // El punto es decorativo y no lleva marcado de prueba: se alcanza desde
    // el selector, que si es accesible, porque comparten contenedor.
    const dot = screen.getByLabelText('Mi estado').parentElement?.querySelector('span');
    expect(dot).toHaveStyle({ background: statusCssColor('g') });

    rerender(
      <BottomBar
        playerName={DEFAULT_NAME}
        micOn={false}
        camOn={false}
        audioAvailable
        recording={false}
        room={null}
        presence={OFFLINE_SOLO}
        status="r"
        onChangeStatus={vi.fn()}
        onToggleMic={vi.fn()}
        onToggleCam={vi.fn()}
        onToggleRecord={vi.fn()}
        onRetryConnection={vi.fn()}
        screenShareOn={false}
        screenShareAvailable={false}
        onToggleScreenShare={vi.fn()}
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

describe('BottomBar: nombre real del usuario local (#6)', () => {
  it('muestra el nombre que recibe por prop, no uno decidido aqui', () => {
    renderBar({ playerName: 'Ana Torres' });

    expect(screen.getByText(/Ana Torres/)).toBeInTheDocument();
  });

  it('no queda ningun nombre cableado en la barra', () => {
    renderBar({ playerName: DEFAULT_NAME });

    // `HugoGT` vivio cableado aqui: el nombre de una persona concreta
    // haciendose pasar por el de cualquiera que abriese la oficina.
    expect(screen.queryByText(/HugoGT/)).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(DEFAULT_NAME))).toBeInTheDocument();
  });
});

/**
 * Los tres estados de la sesion (issue #52). Antes eran dos, y ese era el
 * problema: una caida a mitad de sesion se pintaba como "🟢 N en línea" porque
 * la barra no tenia forma de decir otra cosa.
 */
describe('BottomBar: reconexion (issue #52)', () => {
  it('reconectando no se pinta ni como conectado ni como sin servidor', () => {
    renderBar({ presence: { online: false, peers: 2, state: 'reconnecting', canRetry: true } });

    expect(screen.getByText('🟡 Reconectando...')).toBeInTheDocument();
    // Anunciar los pares de antes de la caida seria contar como presente a
    // gente con la que ahora mismo no hay canal.
    expect(screen.queryByText(/en línea/)).not.toBeInTheDocument();
    expect(screen.queryByText('⚪ Sin servidor')).not.toBeInTheDocument();
  });

  it('cada estado trae su propio title: el de reconexion explica que hay algo en curso', () => {
    renderBar({ presence: { online: false, peers: 1, state: 'reconnecting', canRetry: true } });
    const reconectando = screen.getByText('🟡 Reconectando...').getAttribute('title');

    // Un title reciclado dejaria a quien pasa el raton leyendo que no hay
    // servidor mientras la barra dice que se esta recuperando la sesion.
    expect(reconectando).toMatch(/recuperando/i);
    expect(reconectando).not.toBe(
      (() => {
        renderBar({ presence: OFFLINE_SOLO });
        return screen.getByText('⚪ Sin servidor').getAttribute('title');
      })(),
    );
  });

  it('ofrece reintentar solo cuando la sesion se perdio y hay servidor al que volver', () => {
    renderBar({ presence: OFFLINE_RETRYABLE });

    expect(screen.getByRole('button', { name: /Reintentar/ })).toBeInTheDocument();
  });

  it('en modo solitario no ofrece reintentar: no hay nada a lo que volver', () => {
    renderBar({ presence: OFFLINE_SOLO });

    // Un boton que no puede hacer nada es peor que ninguno: invita a pulsarlo.
    expect(screen.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument();
  });

  it('mientras reconecta no ofrece reintentar: ya se esta reintentando solo', () => {
    renderBar({ presence: { online: false, peers: 0, state: 'reconnecting', canRetry: true } });

    expect(screen.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument();
  });

  it('conectado tampoco lo ofrece', () => {
    renderBar({ presence: { online: true, peers: 1, state: 'connected', canRetry: true } });

    expect(screen.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument();
  });

  it('pulsar reintentar avisa hacia arriba: la barra no sabe reconectar nada', async () => {
    const user = userEvent.setup();
    const props = renderBar({ presence: OFFLINE_RETRYABLE });

    await user.click(screen.getByRole('button', { name: /Reintentar/ }));

    expect(props.onRetryConnection).toHaveBeenCalledTimes(1);
  });
});

describe('BottomBar: screen share button (#20)', () => {
  it('reflects screenShareOn and only asks through onToggleScreenShare', async () => {
    const user = userEvent.setup();
    const props = renderBar({ screenShareOn: false });

    const button = screen.getByRole('button', { name: '🖥️ Compartir' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await user.click(button);

    expect(props.onToggleScreenShare).toHaveBeenCalledTimes(1);
    expect(props.onToggleMic).not.toHaveBeenCalled();
  });

  it('while sharing it offers to stop', () => {
    renderBar({ screenShareOn: true });

    expect(screen.getByRole('button', { name: '🖥️ Dejar de compartir' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('without LiveKit it is disabled with the same title as mic and camera', () => {
    renderBar({ audioAvailable: false, screenShareAvailable: false });

    const button = screen.getByRole('button', { name: '🖥️ Compartir' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Audio no disponible: sin conexion a LiveKit');
  });

  it('outside a space it is disabled and says why', () => {
    renderBar({ audioAvailable: true, screenShareAvailable: false });

    const button = screen.getByRole('button', { name: '🖥️ Compartir' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Solo disponible dentro de una sala');
  });

  it('in "No molestar" it is disabled with the reason the user can undo', () => {
    renderBar({ status: 'r' });

    const button = screen.getByRole('button', { name: '🖥️ Compartir' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'No molestar: no compartes pantalla');
  });

  it('inside a space with LiveKit it is enabled, without a title', () => {
    renderBar({ audioAvailable: true, screenShareAvailable: true });

    const button = screen.getByRole('button', { name: '🖥️ Compartir' });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('title');
  });
});

describe('BottomBar: one row when wide, two when narrow (#67 follow-up)', () => {
  const CALL_BUTTONS = [/Mic/, /Cámara/, /Compartir/, /Grabar/];

  it('splits identity, call controls and indicators into three sibling blocks', () => {
    renderBar({ room: 'Sala de Juntas', presence: OFFLINE_RETRYABLE });

    const identity = screen.getByRole('group', { name: 'Identidad' });
    const controls = screen.getByRole('toolbar', { name: 'Controles de llamada' });
    const info = screen.getByRole('group', { name: 'Estado' });
    // Siblings, not nested: the CSS grid places each block on its own (left,
    // center, right when wide; identity and indicators over the controls when
    // narrow), which it can only do with direct children of the bar.
    expect(controls.parentElement).toBe(identity.parentElement);
    expect(info.parentElement).toBe(identity.parentElement);
    expect(within(identity).getByText(DEFAULT_NAME)).toBeInTheDocument();
    expect(within(identity).getByLabelText('Mi estado')).toBeInTheDocument();
    for (const name of CALL_BUTTONS) {
      expect(within(controls).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(info).getByText(/Sala privada/)).toBeInTheDocument();
    expect(within(info).getByText(/Sin servidor/)).toBeInTheDocument();
    // Retrying is about the connection, so it sits next to the connection indicator.
    expect(within(info).getByRole('button', { name: /Reintentar/ })).toBeInTheDocument();
  });

  it('keeps the same blocks in the corridor, only without the private room line', () => {
    renderBar({ room: null });

    expect(screen.getByRole('group', { name: 'Identidad' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Estado' })).getByText(/proximidad/)).toBeInTheDocument();
    const controls = screen.getByRole('toolbar', { name: 'Controles de llamada' });
    for (const name of CALL_BUTTONS) {
      expect(within(controls).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByText(/Sala privada/)).not.toBeInTheDocument();
  });

  it('names the private room without the "audio aislado" suffix', () => {
    renderBar({ room: 'Sala de Juntas' });

    const line = screen.getByText(/Sala privada/);
    expect(line).toHaveTextContent(/^🔒 Sala privada: Sala de Juntas$/);
    expect(screen.queryByText(/audio aislado/)).not.toBeInTheDocument();
  });
});
