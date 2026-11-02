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

  it('reports a color only once the picker is dismissed, never the steps of a drag', () => {
    const onChange = vi.fn();
    render(<TileColorInput label="Color de mesa" value="#4f9a8a" onChange={onChange} />);
    const input = screen.getByLabelText('Color de mesa: #4f9a8a');

    // Dragging over the picker fires `input` at every step: acting on one would close the picker under the pointer.
    fireEvent.input(input, { target: { value: '#112233' } });
    fireEvent.input(input, { target: { value: '#445566' } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('#445566');
  });

  it('leaves the picker alone while it is open: a render with the old value does not write to the input', () => {
    const { rerender } = render(<TileColorInput label="Color de mesa" value="#4f9a8a" onChange={() => {}} />);
    const input = screen.getByLabelText('Color de mesa: #4f9a8a');

    fireEvent.input(input, { target: { value: '#112233' } });
    rerender(<TileColorInput label="Color de mesa" value="#4f9a8a" onChange={() => {}} />);

    // A controlled input would snap back to #4f9a8a here, resetting the picker the user is dragging in.
    expect(input).toHaveValue('#112233');
  });

  it('follows the value its parent holds, and reports with the latest callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<TileColorInput label="Color de mesa" value="#4f9a8a" onChange={first} />);

    rerender(<TileColorInput label="Color de mesa" value="#c0392b" onChange={second} />);
    const input = screen.getByLabelText('Color de mesa: #c0392b');
    expect(input).toHaveValue('#c0392b');

    fireEvent.change(input, { target: { value: '#2a9d8f' } });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('#2a9d8f');
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
