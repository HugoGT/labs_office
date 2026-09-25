import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useHeightCssVar } from './useHeightCssVar';

const NAME = '--test-height';

function Probe({ height, shown = true }: { height: number; shown?: boolean }) {
  const ref = useHeightCssVar(NAME);
  return shown ? <div ref={ref} style={{ height }} /> : null;
}

function published() {
  return document.documentElement.style.getPropertyValue(NAME);
}

afterEach(() => {
  cleanup();
});

describe('useHeightCssVar (#86)', () => {
  it('publishes the element height on the root as a CSS custom property', () => {
    render(<Probe height={42} />);

    expect(published()).toBe('42px');
  });

  it('follows the element when it grows', async () => {
    const { rerender } = render(<Probe height={42} />);

    rerender(<Probe height={120} />);

    await expect.poll(published).toBe('120px');
  });

  it('removes the property once the element is gone, so nothing reserves room for it', () => {
    const { rerender } = render(<Probe height={42} />);

    rerender(<Probe height={42} shown={false} />);

    expect(published()).toBe('');
  });
});
