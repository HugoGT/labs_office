import '../index.css';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import * as vitestBrowser from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BottomBar } from './BottomBar';
import { ExitControls } from './ExitControls';
import { OfficeSidebar } from './OfficeSidebar';
import { ZoomControls } from './ZoomControls';
import { MINIMAP_HEIGHT, MINIMAP_MARGIN, MINIMAP_WIDTH, RAIL_RIGHT, SIDEBAR_TOP } from '../game/hudLayout';
import { zoomView } from '../game/mapZoom';
import { createOfficeBridge } from '../game/officeBridge';

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
/** Below the 720px breakpoint the open sidebar becomes a full-screen overlay. */
const VERY_SMALL = 640;

/** The bar at its widest: long room name plus the offline indicator and retry. */
const WIDEST_BAR = {
  room: 'Sala de reuniones con un nombre larguisimo',
  presence: { online: false, peers: 0, state: 'offline', canRetry: true },
} as const;

afterEach(() => {
  cleanup();
});

function box(element: Element) {
  return element.getBoundingClientRect();
}

/** The sidebar toggle is the width reference of the right rail (#89, #90). */
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

function renderExits({ installable = false } = {}) {
  render(
    <ExitControls onSignOut={vi.fn()} onLeaveOffice={vi.fn()} install={installable ? { kind: 'ios' } : null} />,
  );
  return screen.getByRole('button', { name: /Cerrar sesión/ }).parentElement!;
}

function sidebar() {
  return screen.getByRole('complementary', { name: 'Personas' });
}

/** Whatever a click at the center of `element` would land on. */
function hitAtCenter(element: Element) {
  const { left, top, width, height } = box(element);
  return document.elementFromPoint(left + width / 2, top + height / 2);
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
      recordableMedia
      onToggleScreenShare={vi.fn()}
      cameraFilter="none"
      cameraBlurAvailable
      onChangeCameraFilter={vi.fn()}
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

/**
 * Where a button's icon and label sit inside its border box: the gap on each
 * side. Measured on the text (a Range), not the glyphs, so it holds without
 * an emoji font too.
 */
function contentGaps(button: Element) {
  const range = document.createRange();
  range.selectNodeContents(button);
  const content = range.getBoundingClientRect();
  const outer = box(button);
  return {
    left: content.left - outer.left,
    right: outer.right - content.right,
    top: content.top - outer.top,
    bottom: outer.bottom - content.bottom,
  };
}

describe('HUD layout: camera filter caret', () => {
  it('joins the camera button at its height, and its menu opens above it, on screen', async () => {
    for (const width of [WIDE, NARROW, VERY_SMALL]) {
      await page.viewport(width, 800);
      renderBar();
      const camera = screen.getByRole('button', { name: /Cámara/ });
      const caret = screen.getByRole('button', { name: 'Opciones de cámara' });

      expect(box(caret).height).toBeCloseTo(box(camera).height, 0);
      expect(box(caret).top).toBeCloseTo(box(camera).top, 0);
      expect(box(caret).left).toBeCloseTo(box(camera).right, 0);

      // The caret must not cost the camera its centering: icon and label sit
      // exactly as in "Mic", the plain button next to it.
      const mic = contentGaps(screen.getByRole('button', { name: /Mic/ }));
      const cam = contentGaps(camera);
      expect(cam.left).toBeCloseTo(cam.right, 1);
      expect(cam.top).toBeCloseTo(cam.bottom, 1);
      expect(cam.left).toBeCloseTo(mic.left, 1);
      expect(cam.right).toBeCloseTo(mic.right, 1);

      await userEvent.click(caret);
      const menu = box(screen.getByRole('menu', { name: 'Filtro de cámara' }));
      expect(menu.bottom).toBeLessThanOrEqual(box(caret).top);
      expect(menu.top).toBeGreaterThanOrEqual(0);
      expect(menu.left).toBeGreaterThanOrEqual(0);
      expect(menu.right).toBeLessThanOrEqual(width);
      for (const item of screen.getAllByRole('menuitemradio')) expect(hitAtCenter(item)).toBe(item);
      cleanup();
    }
  });
});

describe('HUD layout: sidebar toggle (#90)', () => {
  it('personalization scrolls inside its card on short viewports without overlapping the people toggle (#147)', async () => {
    for (const width of [720, WIDE, 390]) {
      await page.viewport(width, 450);
      render(<OfficeSidebar self={{ sessionId: 'yo', name: 'Hugo', status: 'g' }} peers={[]}
        role="admin" bridge={createOfficeBridge()} refreshDesks={vi.fn()} refreshSpaces={vi.fn()}
        desks={{ listDesks: vi.fn(), createDesk: vi.fn(), updateDesk: vi.fn(), deleteDesk: vi.fn() }}
        spaces={{ listSpaces: vi.fn(), createSpace: vi.fn(), updateSpace: vi.fn(), deleteSpace: vi.fn() }}
        assets={{ listAssets: vi.fn(async () => []), createAsset: vi.fn(), archiveAsset: vi.fn(), updateAsset: vi.fn() }}
      />);
      await userEvent.click(screen.getByRole('button', { name: /Personalizar/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Catálogo de decoración' }));
      await screen.findByRole('heading', { name: 'Catálogo de decoración' });
      const panel = screen.getByRole('region', { name: 'Personalizar' });
      expect(getComputedStyle(panel).overflowY).toBe('auto');
      expect(getComputedStyle(panel).minHeight).toBe('0px');
      expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
      const people = screen.getByRole('button', { name: /Personas conectadas/ });
      expect(box(panel).bottom).toBeLessThanOrEqual(box(people).top);
      expect(box(people).height).toBe(32);
      panel.scrollTop = panel.scrollHeight;
      expect(panel.scrollTop).toBeGreaterThan(0);
      await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
      expect(screen.getByRole('button', { name: 'Mi espacio' })).toBeInTheDocument();
      cleanup();
    }
  });

  it('the search input sits inset within the panel, narrower than the toggle above it', async () => {
    await page.viewport(WIDE, 800);
    const { toggle, search } = await renderOpenSidebar();

    expect(box(search).width).toBeLessThan(box(toggle).width);
    expect(box(search).left).toBeGreaterThan(box(toggle).left);
    expect(box(search).right).toBeLessThan(box(toggle).right);
  });

  it('keeps the spec width of the sidebar, which the rail is derived from', async () => {
    await page.viewport(WIDE, 800);
    await renderOpenSidebar();

    expect(box(screen.getByRole('complementary', { name: 'Personas' })).width).toBe(280);
  });
});

describe('HUD layout: sidebar panel card matches the rail (#86)', () => {
  it('the open panel card is as wide as the toggle above it', async () => {
    await page.viewport(WIDE, 800);
    const { toggle, search } = await renderOpenSidebar();
    const panel = search.parentElement!;

    // Before #86 the card kept the full 280px sidebar box, 11px wider on
    // each side than the toggle it sits under, which is what made it visibly
    // hang past it. The search input inside stays inset from both on purpose.
    expectSameColumn(panel, toggle);
  });
});

describe('HUD layout: exit controls (#89)', () => {
  it('at full width they are as wide as the sidebar toggle and aligned with it', async () => {
    await page.viewport(WIDE, 800);
    const exits = renderExits();
    const { toggle } = await renderOpenSidebar();

    expectSameColumn(exits, toggle);
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
    for (const width of [360, 390, VERY_SMALL, 719, 720, 800, NARROW, 1024, 1199, 1200, 1280, 1439, WIDE, 1920]) {
      await page.viewport(width, 800);
      const exits = renderExits();
      const { bar } = renderBar(WIDEST_BAR);

      expect(overlaps(box(exits), box(bar)), `at ${width}px`).toBe(false);
      expect(box(bar).left, `at ${width}px`).toBeGreaterThanOrEqual(16);
      cleanup();
    }
  });
});

describe('HUD layout: exit controls with "Instalar app" (#13)', () => {
  const NAMES = ['Instalar app', 'Cerrar sesión', 'Salir'];

  it('three buttons show only the emoji at every width, and none spills out', async () => {
    for (const width of [VERY_SMALL, NARROW, 1439, WIDE, 1920]) {
      await page.viewport(width, 800);
      renderExits({ installable: true });

      for (const name of NAMES) {
        const button = screen.getByRole('button', { name });
        expect(button.innerText.trim(), `${name} at ${width}px`).toMatch(/^\p{Extended_Pictographic}$/u);
        expect(button.scrollWidth, `${name} at ${width}px`).toBeLessThanOrEqual(button.clientWidth);
        // Same 36px emoji buttons as the two-button row, not squeezed into its width.
        expect(box(button).width, `${name} at ${width}px`).toBeGreaterThanOrEqual(35.5);
      }
      cleanup();
    }
  });

  it('at full width they still take the sidebar toggle column', async () => {
    await page.viewport(WIDE, 800);
    const exits = renderExits({ installable: true });
    const { toggle } = await renderOpenSidebar();

    expectSameColumn(exits, toggle);
  });

  it('never overlap the bottom bar, which keeps clear of the wider block', async () => {
    for (const width of [360, 390, VERY_SMALL, 719, 720, 800, NARROW, 1024, 1199, 1200, 1280, 1439, WIDE, 1920]) {
      await page.viewport(width, 800);
      const exits = renderExits({ installable: true });
      const { bar } = renderBar(WIDEST_BAR);

      expect(overlaps(box(exits), box(bar)), `at ${width}px`).toBe(false);
      expect(box(bar).left, `at ${width}px`).toBeGreaterThanOrEqual(16);
      cleanup();
    }
  });

  it('the steps panel opens above the row and stays on screen', async () => {
    for (const width of [360, VERY_SMALL, NARROW, WIDE]) {
      await page.viewport(width, 800);
      const exits = renderExits({ installable: true });
      await userEvent.click(screen.getByRole('button', { name: 'Instalar app' }));

      const panel = box(screen.getByRole('dialog', { name: 'Instalar Labs' }));
      expect(panel.bottom, `at ${width}px`).toBeLessThanOrEqual(box(exits).top);
      expect(panel.left, `at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(panel.right, `at ${width}px`).toBeLessThanOrEqual(width);
      cleanup();
    }
  });
});

describe('HUD layout: open sidebar and the bottom row (#86)', () => {
  it('the open panel stops above the bottom bar and the exit controls, however tall the bar gets', async () => {
    // 720px is the tightest width that still docks the sidebar.
    for (const width of [720, NARROW, 1199, 1200, WIDE, 1920]) {
      await page.viewport(width, 800);
      const exits = renderExits();
      const { bar } = renderBar(WIDEST_BAR);
      await renderOpenSidebar();

      await expect
        .poll(() => box(sidebar()).bottom, { message: `at ${width}px` })
        .toBeLessThanOrEqual(Math.min(box(bar).top, box(exits).top));
      cleanup();
    }
  });

  it('follows the bar when it grows, instead of trusting a fixed height', async () => {
    await page.viewport(NARROW, 800);
    renderExits();
    const { bar } = renderBar();
    await renderOpenSidebar();

    // Stands in for anything that makes the bar taller: fonts, zoom, wrapping.
    bar.style.height = '300px';

    await expect.poll(() => box(sidebar()).bottom).toBeLessThanOrEqual(box(bar).top);
  });

  it('on very small screens the open sidebar covers the whole screen, bottom row included', async () => {
    for (const width of [VERY_SMALL, 390]) {
      await page.viewport(width, 700);
      const { bar } = renderBar();
      const exits = renderExits();
      await renderOpenSidebar();

      const cover = box(sidebar());
      expect([cover.left, cover.top, cover.width, cover.height], `at ${width}px`).toEqual([0, 0, width, 700]);
      // Clicks aimed at the bar or the exits land on the overlay, not behind it.
      expect(sidebar().contains(hitAtCenter(bar)), `bar at ${width}px`).toBe(true);
      expect(sidebar().contains(hitAtCenter(exits)), `exits at ${width}px`).toBe(true);
      cleanup();
    }
  });

  it('on very small screens its close button shuts the overlay', async () => {
    await page.viewport(VERY_SMALL, 700);
    const { toggle } = await renderOpenSidebar();

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('collapsed on very small screens it leaves the bottom row reachable', async () => {
    await page.viewport(VERY_SMALL, 700);
    const { bar } = renderBar();
    render(<OfficeSidebar self={{ sessionId: 'yo', name: 'Hugo', status: 'g' }} peers={[]} />);

    expect(bar.contains(hitAtCenter(bar))).toBe(true);
  });

  it('above very small screens there is no close button: the toggle closes it', async () => {
    await page.viewport(720, 800);
    await renderOpenSidebar();

    expect(screen.queryByRole('button', { name: 'Cerrar' })).not.toBeInTheDocument();
  });
});

describe('HUD layout: map zoom control (map-zoom)', () => {
  const HEIGHT = 800;

  function renderZoom() {
    render(<ZoomControls view={zoomView(2)} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onReset={vi.fn()} />);
    return screen.getByRole('group', { name: 'Zoom del mapa' });
  }

  it('sits left of the minimap, inside its height, and clear of the rail, bar and exits', async () => {
    for (const width of [VERY_SMALL, 720, NARROW, 1439, WIDE]) {
      await page.viewport(width, HEIGHT);
      const zoom = renderZoom();
      const exits = renderExits();
      const { bar } = renderBar(WIDEST_BAR);
      render(<OfficeSidebar self={{ sessionId: 'yo', name: 'Hugo', status: 'g' }} peers={[]} />);
      const rect = box(zoom);

      // The minimap is a Phaser camera, so its rectangle comes from the shared constants.
      expect(rect.right, `left of the minimap at ${width}px`).toBeLessThanOrEqual(width - RAIL_RIGHT - MINIMAP_WIDTH);
      expect(rect.left, `on screen at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(rect.top, `top at ${width}px`).toBeGreaterThanOrEqual(MINIMAP_MARGIN);
      expect(rect.bottom, `bottom at ${width}px`).toBeLessThanOrEqual(MINIMAP_MARGIN + MINIMAP_HEIGHT);
      expect(rect.bottom, `above the rail at ${width}px`).toBeLessThanOrEqual(SIDEBAR_TOP);
      for (const other of [exits, bar, sidebar()]) expect(overlaps(rect, box(other)), `at ${width}px`).toBe(false);
      cleanup();
    }
  });

  it('stays clear of the docked sidebar when it opens', async () => {
    for (const width of [720, WIDE]) {
      await page.viewport(width, HEIGHT);
      const zoom = renderZoom();
      await renderOpenSidebar();

      expect(overlaps(box(zoom), box(sidebar())), `at ${width}px`).toBe(false);
      cleanup();
    }
  });

  it('on very small screens the open sidebar covers it', async () => {
    await page.viewport(VERY_SMALL, 700);
    const zoom = renderZoom();
    await renderOpenSidebar();

    expect(sidebar().contains(hitAtCenter(zoom))).toBe(true);
  });

  it('keeps every button reachable: a click on each lands on it', async () => {
    await page.viewport(WIDE, HEIGHT);
    const zoom = renderZoom();

    for (const button of zoom.querySelectorAll('button')) expect(hitAtCenter(button)).toBe(button);
  });
});
