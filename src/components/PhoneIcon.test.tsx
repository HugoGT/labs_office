import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CALL_ICON_COLOR, PhoneIcon } from './PhoneIcon';

describe('PhoneIcon (#187)', () => {
  it('is an inline svg painted with currentColor, hidden from assistive tech', () => {
    const { container } = render(<PhoneIcon />);
    const svg = container.querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('fill', 'currentColor');
  });

  it('is green, the same green as the online dot, never the red phone emoji', () => {
    const { container } = render(<PhoneIcon />);

    expect(CALL_ICON_COLOR).toBe('#22c55e');
    expect(container.querySelector('svg')).toHaveStyle({ color: CALL_ICON_COLOR });
    expect(container.textContent).not.toContain('\u{1F4DE}');
  });
});
