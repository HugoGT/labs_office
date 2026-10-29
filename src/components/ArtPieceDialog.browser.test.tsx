import '../index.css';
import { cleanup, render, screen } from '@testing-library/react';
import * as vitestBrowser from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtOfficeMock } from './ArtOfficeMock';
import { ArtPieceDialog, DialogButton } from './ArtPieceDialog';

// Same cast as `HudLayout.browser.test.tsx`.
const { page } = vitestBrowser as unknown as { page: { viewport(width: number, height: number): Promise<void> } };

/**
 * Real geometry of the review dialog: jsdom lays nothing out, so whether the
 * office mock fits the screen without scrolling can only be asked of a browser.
 */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const IMAGES: Record<string, Record<string, string>> = {
  character: { walk: PIXEL, seated: PIXEL },
  plant: { sheet: PIXEL },
  chair: { sheet: PIXEL },
  desk: { sheet: PIXEL },
};
// Tables (512 x 256 each) and doors (128 x 256, four of them) are bigger than the block that holds them
// at the one scale pixel art allows, so those two views scroll inside the dialog instead of shrinking.

afterEach(cleanup);

describe('the review dialog on a laptop screen', () => {
  it.each(Object.keys(IMAGES))('shows the mock of a %s with no scroll at 1280 x 720', async (kind) => {
    await page.viewport(1280, 720);
    render(
      <ArtPieceDialog title="Prueba" onClose={() => undefined} actions={<DialogButton tone="accept">Aceptar y subir</DialogButton>}>
        <ArtOfficeMock kind={kind} name="Prueba" images={IMAGES[kind] as Record<string, string>} />
      </ArtPieceDialog>,
    );

    const mock = screen.getByRole('group', { name: 'Prueba en la oficina' });
    const body = mock.parentElement as HTMLElement;
    expect(body.scrollHeight, 'vertical scroll').toBeLessThanOrEqual(body.clientHeight);
    expect(body.scrollWidth, 'horizontal scroll').toBeLessThanOrEqual(body.clientWidth);
  });
});
