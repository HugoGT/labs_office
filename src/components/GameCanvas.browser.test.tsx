import { cleanup, render, screen } from '@testing-library/react';
import Phaser from 'phaser';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOfficeBridge } from '../game/officeBridge';
import { GameCanvas } from './GameCanvas';
import { OfficeEntry } from './OfficeEntry';
import { BUILT_IN_SPACES_CONFIG } from '../game/spacesConfig';
import { SCENE_BOOT_TIMEOUT_MS } from '../test/phaserScene';

/**
 * Integracion real: React monta Phaser sobre WebGL de verdad. La version con
 * mocks (`GameCanvas.test.tsx`) prueba el contrato del efecto; esta prueba que
 * el motor de verdad arranca y se va cuando debe.
 */

const wrappers: HTMLElement[] = [];

/**
 * Testing Library retira su contenedor del DOM al desmontar, asi que un canvas
 * filtrado se iria con el y el test pasaria por el motivo equivocado. Anidando
 * el contenedor dentro de un envoltorio propio, lo que quede queda a la vista.
 */
function nestedContainer(): { wrapper: HTMLElement; container: HTMLElement } {
  const wrapper = document.createElement('div');
  const container = document.createElement('div');
  wrapper.append(container);
  document.body.append(wrapper);
  wrappers.push(wrapper);
  return { wrapper, container };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const wrapper of wrappers.splice(0)) wrapper.remove();
});

describe('GameCanvas con Phaser real', () => {
  it('reveals the real canvas only after current office art has rendered, on the login background', async () => {
    const { container } = nestedContainer();
    container.style.width = '320px';
    container.style.height = '240px';
    const bridge = createOfficeBridge();
    bridge.emitCommand('spacesconfig', BUILT_IN_SPACES_CONFIG);
    bridge.emitCommand('desks', { desks: [] });
    render(<OfficeEntry>{(report) => <GameCanvas bridge={bridge} onEntryState={report} />}</OfficeEntry>, { container });
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Entrando a la oficina…');
    expect(status.closest('form')).toBeNull();
    expect(getComputedStyle(container.firstElementChild!).visibility).toBe('hidden');
    expect(getComputedStyle(status.parentElement!).backgroundColor).toBe('rgb(13, 17, 23)');
    await vi.waitFor(() => {
      const canvas = container.querySelector('canvas');
      expect(canvas).not.toBeNull();
      expect(getComputedStyle(canvas!).visibility).toBe('visible');
      expect(screen.queryByRole('status')).toBeNull();
    }, { timeout: SCENE_BOOT_TIMEOUT_MS });
  });
  it('monta un canvas dentro de su contenedor', async () => {
    const { container } = render(<GameCanvas bridge={createOfficeBridge()} />);

    await vi.waitFor(() => {
      expect(container.querySelectorAll('canvas')).toHaveLength(1);
    });
  });

  it('bajo StrictMode deja un solo canvas, no dos juegos peleandose', async () => {
    const { container } = render(
      <StrictMode>
        <GameCanvas bridge={createOfficeBridge()} />
      </StrictMode>,
    );

    await vi.waitFor(() => {
      expect(container.querySelectorAll('canvas')).toHaveLength(1);
    });

    // Margen para que un segundo juego huerfano alcanzase a insertar su canvas.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('al desmontar destruye el juego, no solo lo saca del DOM', async () => {
    // React se lleva el div anfitrion con el canvas dentro, asi que el DOM se ve
    // limpio incluso con un juego filtrado (RAF, contexto WebGL y listeners
    // vivos). Lo unico que delata la fuga es el destroy del propio Phaser.
    const destroy = vi.spyOn(Phaser.Game.prototype, 'destroy');
    const { wrapper, container } = nestedContainer();

    const { unmount } = render(<GameCanvas bridge={createOfficeBridge()} />, { container });
    await vi.waitFor(() => {
      expect(wrapper.querySelectorAll('canvas')).toHaveLength(1);
    });
    expect(destroy).not.toHaveBeenCalled();

    unmount();

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith(true);
    expect(wrapper.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('monta y desmonta en serie destruyendo un juego por ciclo', async () => {
    const destroy = vi.spyOn(Phaser.Game.prototype, 'destroy');
    const { wrapper } = nestedContainer();

    for (let cycle = 1; cycle <= 3; cycle += 1) {
      // Contenedor nuevo por ciclo: Testing Library cachea la raiz de React por
      // contenedor y reusar uno ya desmontado revienta con "unmounted root".
      const container = document.createElement('div');
      wrapper.append(container);

      const { unmount } = render(<GameCanvas bridge={createOfficeBridge()} />, { container });
      await vi.waitFor(() => {
        expect(wrapper.querySelectorAll('canvas')).toHaveLength(1);
      });

      unmount();

      expect(destroy).toHaveBeenCalledTimes(cycle);
      expect(wrapper.querySelectorAll('canvas')).toHaveLength(0);
    }
  });
});
