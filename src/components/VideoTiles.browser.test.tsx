import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vitestBrowser from 'vitest/browser';
import type { AttachableTrack } from '../game/attachableTrack';
import { RAIL_RIGHT, RAIL_WIDTH } from '../game/hudLayout';
import { createOfficeBridge } from '../game/officeBridge';
import type { StageFocus } from '../game/screenShare';
import { VideoTiles } from './VideoTiles';

const { page } = vitestBrowser as unknown as { page: { viewport(width: number, height: number): Promise<void> } };

/**
 * Real layout check (#280): in a 50 person room the cameras sit at the END
 * of the `sessionId` order, and they must still be on screen, fully inside
 * the viewport and not clipped by the bar, in the row and in the side column.
 */

// A 1080p desktop, the screen the issue measured (the default is a phone).
beforeEach(async () => {
  await page.viewport(1920, 1080);
});
afterEach(cleanup);

function fakeVideoTrack(): AttachableTrack {
  return {
    kind: 'video',
    attach: () => document.createElement('video'),
    detach: () => [],
  };
}

const PEERS = Array.from({ length: 49 }, (_, index) => {
  const sessionId = `p${String(index).padStart(2, '0')}`;
  return { sessionId, name: sessionId };
});
const CAMERAS = ['p41', 'p42', 'p43', 'p44', 'p45', 'p46', 'p47', 'p48'];

function renderCrowd(sharing: boolean) {
  const bridge = createOfficeBridge();
  render(
    <VideoTiles
      bridge={bridge}
      videoTracks={new Map(CAMERAS.map((id) => [id, fakeVideoTrack()]))}
      speakers={new Set()}
      localVideoTrack={null}
      screenShareTracks={new Map(sharing ? [['p00', fakeVideoTrack()]] : [])}
      localScreenShareTrack={null}
      activeScreenSharer={sharing ? 'p00' : null}
      stageMinimized={false}
      onMinimizeStage={() => undefined}
      onRestoreStage={() => undefined}
      stageFocus={null}
      onStageFocusChange={() => undefined}
    />,
  );
  act(() => bridge.emit('voice', { selfSessionId: 'yo', selfName: 'HugoGT', peers: PEERS, spaceId: 'sala' }));
}

function expectFullyVisible(element: Element, bar: Element) {
  const rect = element.getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.top).toBeGreaterThanOrEqual(0);
  expect(rect.left).toBeGreaterThanOrEqual(0);
  expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
  expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
  // The column clips with `overflow: hidden`: a tile past its edge is hidden.
  expect(rect.bottom).toBeLessThanOrEqual(barRect.bottom + 0.5);
  expect(rect.right).toBeLessThanOrEqual(barRect.right + 0.5);
}

describe('VideoTiles in a real browser: 50 people (#280)', () => {
  for (const sharing of [false, true]) {
    it(`${sharing ? 'column' : 'row'}: every tile shown, cameras included, fits on screen`, () => {
      renderCrowd(sharing);
      const bar = screen.getByTestId('video-tile-bar');
      expect(bar).toHaveAttribute('data-layout', sharing ? 'column' : 'row');

      const tiles = [...bar.querySelectorAll('[data-session-id]')];
      const shown = tiles.map((tile) => (tile as HTMLElement).dataset.sessionId);
      expect(shown[0]).toBe('yo');
      // Cameras fill the slots after the own tile, as many as fit.
      const cameraSlots = Math.min(CAMERAS.length, tiles.length - 1);
      expect(cameraSlots).toBeGreaterThanOrEqual(sharing ? 4 : 8);
      expect(shown.filter((id) => CAMERAS.includes(id!))).toHaveLength(cameraSlots);
      for (const tile of tiles) expectFullyVisible(tile, bar);

      const overflow = screen.getByTestId('video-tile-overflow');
      expect(overflow).toHaveTextContent(`+${50 - tiles.length} personas`);
      expectFullyVisible(overflow, bar);
    });
  }
});

describe('VideoTiles in a real browser: the stage and the right rail (#304)', () => {
  function renderStage(stageFocus: StageFocus) {
    const bridge = createOfficeBridge();
    render(
      <VideoTiles
        bridge={bridge}
        videoTracks={new Map()}
        speakers={new Set()}
        localVideoTrack={null}
        screenShareTracks={new Map([['p00', fakeVideoTrack()]])}
        localScreenShareTrack={null}
        activeScreenSharer="p00"
        stageMinimized={false}
        onMinimizeStage={() => undefined}
        onRestoreStage={() => undefined}
        stageFocus={stageFocus}
        onStageFocusChange={() => undefined}
      />,
    );
    act(() => bridge.emit('voice', { selfSessionId: 'yo', selfName: 'HugoGT', peers: PEERS.slice(0, 1), spaceId: 'sala' }));
    return screen.getByTestId('screen-share-stage');
  }

  it('leaves the rail free, so the minimap under it shows; focused it takes that room too', async () => {
    await page.viewport(1440, 800);
    const open = renderStage(null).getBoundingClientRect();
    expect(open.right).toBeLessThanOrEqual(1440 - RAIL_RIGHT - RAIL_WIDTH);
    cleanup();

    const focused = renderStage({ kind: 'screen' }).getBoundingClientRect();
    expect(focused.right).toBe(1440 - 12);
    expect(focused.width).toBeGreaterThan(open.width);
  });

  it('takes the pointer over its whole box, so the map under it never sees it', async () => {
    await page.viewport(1440, 800);
    const stage = renderStage(null);
    const rect = stage.getBoundingClientRect();

    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);

    expect(hit).toBe(within(stage).getByRole('button', { name: 'Ampliar pantalla compartida' }));
  });
});
