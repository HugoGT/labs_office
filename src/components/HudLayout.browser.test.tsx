import '../index.css';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import * as vitestBrowser from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BottomBar } from './BottomBar';
import { ExitControls } from './ExitControls';
import { OfficeSidebar } from './OfficeSidebar';

// Same cast as `livekitRoom.browser.test.ts`: the `vitest/browser` type
// re-export does not resolve with a single provider installed, the runtime
// value does exist.
const { page } = vitestBrowser as unknown as {
  page: { viewport(width: number, height: number): Promise<void> };
};

/**
 * Real geometry of the HUD (#86): jsdom neither loads CSS modules nor lays
 * anything out, so whether two boxes touch can only be asked of a browser.
 */
const WIDE = 1440;
const NARROW = 900;

afterEach(() => {
  cleanup();
});

function box(element: Element) {
  return element.getBoundingClientRect();
}

/** The sidebar search input is the width reference of the right rail (#89, #90). */
async function renderOpenSidebar() {
  render(
    <OfficeSidebar
      self={{ sessionId: 'yo', name: 'Hugo', status: 'g' }}
      peers={[{ sessionId: 'a', name: 'Ana', status: 'g' }]}
    />,
  );
  const toggle = screen.getByRole('button', { name: /Personas conectadas/ });
  await userEvent.click(toggle);
  return { toggle, search: screen.getByRole('searchbox', { name: 'Buscar personas' }) };
}

function expectSameColumn(element: Element, reference: Element) {
  expect(box(element).left).toBeCloseTo(box(reference).left, 0);
  expect(box(element).right).toBeCloseTo(box(reference).right, 0);
}

function renderExits() {
  render(<ExitControls onSignOut={vi.fn()} onLeaveOffice={vi.fn()} />);
  return screen.getByRole('button', { name: /Cerrar sesión/ }).parentElement!;
}

function overlaps(a: DOMRect, b: DOMRect) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function renderBar(overrides: Partial<ComponentProps<typeof BottomBar>> = {}) {
  render(
    <BottomBar
      playerName="Invitado"
      micOn
      camOn
      audioAvailable
      recording={false}
      room={null}
      presence={{ online: true, peers: 0, state: 'connected', canRetry: false }}
      status="g"
      onChangeStatus={vi.fn()}
      onToggleMic={vi.fn()}
      onToggleCam={vi.fn()}
      onToggleRecord={vi.fn()}
      onRetryConnection={vi.fn()}
      screenShareOn={false}
      screenShareAvailable
      onToggleScreenShare={vi.fn()}
      {...overrides}
    />,
  );
  return {
    bar: screen.getByRole('toolbar', { name: 'Controles de llamada' }).parentElement!,
    me: screen.getByRole('group', { name: 'Identidad' }),
    controls: screen.getByRole('toolbar', { name: 'Controles de llamada' }),
    info: screen.getByRole('group', { name: 'Estado' }),
  };
}

describe('HUD layout: bottom bar (#87)', () => {
  it('on wide screens the status block sits right after the controls, no leftover gap', async () => {
    await page.viewport(WIDE, 800);
    const { me, controls, info } = renderBar();

    // One row, and only the grid's column gap between the blocks.
    expect(box(controls).top).toBeLessThan(box(info).bottom);
    expect(box(info).top).toBeLessThan(box(controls).bottom);
    expect(box(controls).left - box(me).right).toBeLessThanOrEqual(16.5);
    expect(box(info).left - box(controls).right).toBeLessThanOrEqual(16.5);
  });

  it('on wide screens the bar height does not depend on the indicator text (#67)', async () => {
    await page.viewport(WIDE, 800);
    const short = box(renderBar().bar).height;
    cleanup();
    const long = box(renderBar({ room: 'Sala de reuniones con un nombre larguisimo' }).bar).height;

    expect(long).toBe(short);
  });

  it('on narrow screens the controls still get their own row below identity and status', async () => {
    await page.viewport(NARROW, 800);
    const { me, controls, info } = renderBar();

    expect(box(controls).top).toBeGreaterThanOrEqual(box(me).bottom);
    expect(box(controls).top).toBeGreaterThanOrEqual(box(info).bottom);
  });
});

describe('HUD layout: sidebar toggle (#90)', () => {
  it('is as wide as the search input and aligned with it', async () => {
    await page.viewport(WIDE, 800);
    const { toggle, search } = await renderOpenSidebar();

    expectSameColumn(toggle, search);
  });

  it('keeps the spec width of the sidebar, which the rail is derived from', async () => {
    await page.viewport(WIDE, 800);
    await renderOpenSidebar();

    expect(box(screen.getByRole('complementary', { name: 'Personas' })).width).toBe(280);
  });
});

describe('HUD layout: exit controls (#89)', () => {
  it('at full width they are as wide as the sidebar search input and aligned with it', async () => {
    await page.viewport(WIDE, 800);
    const exits = renderExits();
    const { search } = await renderOpenSidebar();

    expectSameColumn(exits, search);
  });
});

describe('HUD layout: exit controls on narrow screens (#88)', () => {
  it('show only the emoji, keeping the accessible name', async () => {
    for (const width of [NARROW, 1280]) {
      await page.viewport(width, 800);
      renderExits();

      for (const name of ['Cerrar sesión', 'Salir']) {
        const button = screen.getByRole('button', { name });
        expect(button, `${name} at ${width}px`).toHaveAccessibleName(name);
        expect(button.innerText.trim(), `${name} at ${width}px`).toMatch(/^\p{Extended_Pictographic}$/u);
      }
      cleanup();
    }
  });

  it('show their labels once there is room for them', async () => {
    await page.viewport(WIDE, 800);
    renderExits();

    for (const name of ['Cerrar sesión', 'Salir']) {
      const button = screen.getByRole('button', { name });
      expect(button.innerText).toContain(name);
      // Both labels fit the rail width (#89) without spilling out of the button.
      expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth);
    }
  });

  it('never overlap the bottom bar, even with its widest indicators', async () => {
    for (const width of [640, 800, NARROW, 1024, 1199, 1200, 1280, 1439, WIDE, 1920]) {
      await page.viewport(width, 800);
      const exits = renderExits();
      const { bar } = renderBar({
        room: 'Sala de reuniones con un nombre larguisimo',
        presence: { online: false, peers: 0, state: 'offline', canRetry: true },
      });

      expect(overlaps(box(exits), box(bar)), `at ${width}px`).toBe(false);
      expect(box(bar).left, `at ${width}px`).toBeGreaterThanOrEqual(16);
      cleanup();
    }
  });
});
