import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TileColorInput } from './TileColorInput';

describe('TileColorInput', () => {
  it('is a native color input named after the choice and its current color, reporting lowercase hex', () => {
    const onChange = vi.fn();
    render(<TileColorInput label="Color de mesa" value="#4f9a8a" onChange={onChange} />);

    const input = screen.getByLabelText('Color de mesa: #4f9a8a');
    expect(input).toHaveAttribute('type', 'color');
    expect(input).toHaveValue('#4f9a8a');
    fireEvent.change(input, { target: { value: '#C0392B' } });
    expect(onChange).toHaveBeenCalledWith('#c0392b');
  });

  it('draws a fixed icon, not the current color, and can be disabled', () => {
    const { container, rerender } = render(<TileColorInput label="Color de mesa" value="#4f9a8a" onChange={() => {}} />);
    const fills = [...container.querySelectorAll('polygon')].map((polygon) => polygon.getAttribute('fill'));
    expect(fills.length).toBeGreaterThan(1);
    expect(new Set(fills).size).toBe(fills.length);

    rerender(<TileColorInput label="Color de mesa" value="#c0392b" onChange={() => {}} disabled />);
    expect([...container.querySelectorAll('polygon')].map((polygon) => polygon.getAttribute('fill'))).toEqual(fills);
    expect(screen.getByLabelText('Color de mesa: #c0392b')).toBeDisabled();
  });
});
