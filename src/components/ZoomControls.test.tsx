import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { zoomView } from '../game/mapZoom';
import { ZoomControls } from './ZoomControls';

function renderControls(zoom: number) {
  const handlers = { onZoomIn: vi.fn(), onZoomOut: vi.fn(), onReset: vi.fn() };
  render(<ZoomControls view={zoomView(zoom)} {...handlers} />);
  return {
    ...handlers,
    zoomIn: screen.getByRole('button', { name: 'Acercar' }),
    zoomOut: screen.getByRole('button', { name: 'Alejar' }),
    label: screen.getByRole('button', { name: /^Restablecer zoom/ }),
  };
}

describe('ZoomControls (map-zoom)', () => {
  it('is one group with the zoom label between zoom in and zoom out', () => {
    const { zoomIn, zoomOut, label } = renderControls(2);

    const group = screen.getByRole('group', { name: 'Zoom del mapa' });
    expect([...group.querySelectorAll('button')]).toEqual([zoomIn, label, zoomOut]);
    expect(label).toHaveTextContent('2x');
    expect(label).toHaveAccessibleName('Restablecer zoom a 2x (ahora 2x)');
  });

  it.each([
    { zoom: 0.5, label: '0.5x', inEnabled: true, outEnabled: false },
    { zoom: 1, label: '1x', inEnabled: true, outEnabled: true },
    { zoom: 2, label: '2x', inEnabled: true, outEnabled: true },
    { zoom: 3, label: '3x', inEnabled: true, outEnabled: true },
    { zoom: 4, label: '4x', inEnabled: false, outEnabled: true },
  ])('at $label: zoom in enabled $inEnabled, zoom out enabled $outEnabled', ({ zoom, label: text, inEnabled, outEnabled }) => {
    const { zoomIn, zoomOut, label } = renderControls(zoom);

    expect(label).toHaveTextContent(text);
    expect(label).toHaveAccessibleName(`Restablecer zoom a 2x (ahora ${text})`);
    expect(label).toHaveAttribute('title', `Restablecer zoom a 2x (ahora ${text})`);
    expect(zoomIn.matches(':enabled')).toBe(inEnabled);
    expect(zoomOut.matches(':enabled')).toBe(outEnabled);
  });

  it('each button asks for its own action', async () => {
    const user = userEvent.setup();
    // The limits each disable one button: 0.5x has no zoom out, 4x no zoom in.
    const atMin = renderControls(0.5);
    await user.click(atMin.zoomIn);
    await user.click(atMin.label);
    cleanup();
    const atMax = renderControls(4);
    await user.click(atMax.zoomOut);
    await user.click(atMax.label);

    expect([atMin.onZoomIn, atMin.onZoomOut, atMin.onReset].map((handler) => handler.mock.calls.length)).toEqual([1, 0, 1]);
    expect([atMax.onZoomIn, atMax.onZoomOut, atMax.onReset].map((handler) => handler.mock.calls.length)).toEqual([0, 1, 1]);
  });

  it('has nothing to reset at the default 2x, so the label is disabled but still readable', async () => {
    const user = userEvent.setup();
    const { label, onReset } = renderControls(2);

    await user.click(label);

    expect(label).toBeDisabled();
    expect(label).toHaveTextContent('2x');
    expect(onReset).not.toHaveBeenCalled();
  });
});
