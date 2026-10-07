import { render, screen } from '@testing-library/react';
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
  it('is one group with the percent between zoom in and zoom out', () => {
    const { zoomIn, zoomOut, label } = renderControls(1);

    const group = screen.getByRole('group', { name: 'Zoom del mapa' });
    expect([...group.querySelectorAll('button')]).toEqual([zoomIn, label, zoomOut]);
    expect(label).toHaveTextContent('100%');
    expect(label).toHaveAccessibleName('Restablecer zoom (100%)');
  });

  it.each([
    { zoom: 0.5, percent: '50%', inEnabled: true, outEnabled: false },
    { zoom: 1.5, percent: '150%', inEnabled: true, outEnabled: true },
    { zoom: 2, percent: '200%', inEnabled: false, outEnabled: true },
  ])('at $percent: zoom in enabled $inEnabled, zoom out enabled $outEnabled', ({ zoom, percent, inEnabled, outEnabled }) => {
    const { zoomIn, zoomOut, label } = renderControls(zoom);

    expect(label).toHaveTextContent(percent);
    expect(zoomIn.matches(':enabled')).toBe(inEnabled);
    expect(zoomOut.matches(':enabled')).toBe(outEnabled);
  });

  it('each button asks for its own action', async () => {
    const user = userEvent.setup();
    const { zoomIn, zoomOut, label, onZoomIn, onZoomOut, onReset } = renderControls(1.5);

    await user.click(zoomIn);
    await user.click(zoomOut);
    await user.click(label);

    expect([onZoomIn, onZoomOut, onReset].map((handler) => handler.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('has nothing to reset at 100%, so the label is disabled but still readable', async () => {
    const user = userEvent.setup();
    const { label, onReset } = renderControls(1);

    await user.click(label);

    expect(label).toBeDisabled();
    expect(label).toHaveTextContent('100%');
    expect(onReset).not.toHaveBeenCalled();
  });
});
