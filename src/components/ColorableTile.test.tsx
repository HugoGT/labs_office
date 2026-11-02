import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColorableTile, LIVE_COLOR_INTERVAL_MS } from './ColorableTile';

type Props = Partial<Parameters<typeof ColorableTile>[0]>;

function tile(props: Props = {}) {
  return (
    <ColorableTile label="Color de mesa" value="#4f9a8a" onChange={() => {}} {...props}>
      <button type="button">Mesa</button>
    </ColorableTile>
  );
}

const colorInput = (name = 'Color de mesa: #4f9a8a'): HTMLInputElement => screen.getByLabelText(name) as HTMLInputElement;

describe('ColorableTile', () => {
  const showPicker = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    showPicker.mockReset();
    // jsdom has no native picker: stand in for the one the browser opens.
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { configurable: true, value: showPicker });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker');
  });

  it('is a native color input named after the choice and its current color, next to the tile it wraps', () => {
    render(tile());

    const input = colorInput();
    expect(input).toHaveAttribute('type', 'color');
    expect(input).toHaveValue('#4f9a8a');
    expect(screen.getByRole('button', { name: 'Mesa' })).toBeInTheDocument();
    // The tile's own button is what a keyboard reaches: the helper input is out of the tab order.
    expect(input).toHaveAttribute('tabindex', '-1');
  });

  it('opens the picker from a click anywhere on the tile, and says so', () => {
    const onPicking = vi.fn();
    render(tile({ onPicking }));

    fireEvent.click(screen.getByRole('button', { name: 'Mesa' }));

    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(onPicking).toHaveBeenCalledWith(true);
  });

  it('falls back to clicking the input where the browser has no showPicker, without reopening itself', () => {
    Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker');
    const onPicking = vi.fn();
    render(tile({ onPicking }));
    const click = vi.spyOn(colorInput(), 'click');

    fireEvent.click(screen.getByRole('button', { name: 'Mesa' }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(onPicking).toHaveBeenCalledTimes(1);
  });

  it('opens nothing while disabled', () => {
    const onPicking = vi.fn();
    render(tile({ onPicking, disabled: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Mesa' }));

    expect(showPicker).not.toHaveBeenCalled();
    expect(onPicking).not.toHaveBeenCalled();
    expect(colorInput()).toBeDisabled();
  });

  it('reports the color live while it is dragged, at most once per interval, always ending on the last one', () => {
    const onChange = vi.fn();
    render(tile({ onChange }));
    fireEvent.click(screen.getByRole('button', { name: 'Mesa' }));
    const input = colorInput();

    fireEvent.input(input, { target: { value: '#112233' } });
    fireEvent.input(input, { target: { value: '#445566' } });
    fireEvent.input(input, { target: { value: '#778899' } });
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(LIVE_COLOR_INTERVAL_MS);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('#778899');

    fireEvent.input(input, { target: { value: '#AABBCC' } });
    act(() => {
      vi.advanceTimersByTime(LIVE_COLOR_INTERVAL_MS);
    });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith('#aabbcc');
  });

  it('settles on the dismissed color at once and says the picker is closed', () => {
    const onChange = vi.fn();
    const onPicking = vi.fn();
    render(tile({ onChange, onPicking }));
    fireEvent.click(screen.getByRole('button', { name: 'Mesa' }));
    const input = colorInput();

    fireEvent.input(input, { target: { value: '#112233' } });
    fireEvent.change(input);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('#112233');
    expect(onPicking).toHaveBeenLastCalledWith(false);
    // Nothing is left to fire late.
    act(() => {
      vi.advanceTimersByTime(LIVE_COLOR_INTERVAL_MS * 3);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('counts a press anywhere else on the page as the picker closing, and Escape too', () => {
    const onPicking = vi.fn();
    render(tile({ onPicking }));

    fireEvent.pointerDown(document.body);
    expect(onPicking).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Mesa' }));
    fireEvent.pointerDown(document.body);
    expect(onPicking.mock.calls).toEqual([[true], [false]]);

    fireEvent.click(screen.getByRole('button', { name: 'Mesa' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onPicking.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  describe("Escape in the browser's picker", () => {
    // Measured in Chromium with a real Escape on its picker: it closes, and the page gets one more `input` with the
    // color it opened with, and no key event or `change`. The choice made is the user's to keep: a second Escape,
    // which the page does get, puts the piece down.
    function open(props: Props = {}) {
      const handlers = { onChange: vi.fn(), onPicking: vi.fn() };
      render(tile({ ...handlers, ...props }));
      fireEvent.click(screen.getByRole('button', { name: 'Mesa' }));
      return { ...handlers, input: colorInput() };
    }

    it('closes it and keeps the last color chosen, never reporting the color it opened with', () => {
      const { onChange, onPicking, input } = open();
      fireEvent.input(input, { target: { value: '#63778c' } });
      fireEvent.input(input, { target: { value: '#152d47' } });
      act(() => {
        vi.advanceTimersByTime(LIVE_COLOR_INTERVAL_MS);
      });
      expect(onChange).toHaveBeenLastCalledWith('#152d47');

      fireEvent.input(input, { target: { value: '#4f9a8a' } });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onPicking.mock.calls).toEqual([[true], [false]]);
      expect(input).toHaveValue('#152d47');
    });

    it('still reports the last step that had not gone out yet, and nothing late after', () => {
      const { onChange, onPicking, input } = open();

      fireEvent.input(input, { target: { value: '#152d47' } });
      fireEvent.input(input, { target: { value: '#4f9a8a' } });
      act(() => {
        vi.advanceTimersByTime(LIVE_COLOR_INTERVAL_MS * 3);
      });

      expect(onChange.mock.calls).toEqual([['#152d47']]);
      expect(onPicking.mock.calls).toEqual([[true], [false]]);
      expect(input).toHaveValue('#152d47');
    });

    it('is nothing before any change: the opening color alone closes nothing', () => {
      const { onChange, onPicking, input } = open();

      fireEvent.input(input, { target: { value: '#4f9a8a' } });
      act(() => {
        vi.advanceTimersByTime(LIVE_COLOR_INTERVAL_MS * 3);
      });

      expect(onChange).not.toHaveBeenCalled();
      expect(onPicking.mock.calls).toEqual([[true]]);
    });

    it('keeps the choice of each open apart: a later pick starts again from the color it has then', () => {
      const { onChange, input } = open();
      fireEvent.input(input, { target: { value: '#152d47' } });
      fireEvent.input(input, { target: { value: '#4f9a8a' } });
      expect(onChange.mock.calls).toEqual([['#152d47']]);

      // Reopened: it opens with the color the input holds now, and what the Escape sends back is that one.
      fireEvent.click(screen.getByRole('button', { name: 'Mesa' }));
      fireEvent.input(input, { target: { value: '#2b445f' } });
      fireEvent.input(input, { target: { value: '#152d47' } });
      act(() => {
        vi.advanceTimersByTime(LIVE_COLOR_INTERVAL_MS);
      });
      expect(input).toHaveValue('#2b445f');
      expect(onChange.mock.calls).toEqual([['#152d47'], ['#2b445f']]);
    });
  });

  it('says the picker is closed when the tile goes away with it open', () => {
    const onPicking = vi.fn();
    const { unmount } = render(tile({ onPicking }));
    fireEvent.click(screen.getByRole('button', { name: 'Mesa' }));

    unmount();

    expect(onPicking).toHaveBeenLastCalledWith(false);
  });

  it('never writes to the input while the picker is open, not even the older color the parent echoes back', () => {
    const { rerender } = render(tile());
    fireEvent.click(screen.getByRole('button', { name: 'Mesa' }));
    const input = colorInput();

    fireEvent.input(input, { target: { value: '#778899' } });
    // The parent still holds the color of an earlier step.
    rerender(tile({ value: '#445566' }));

    expect(input).toHaveValue('#778899');
  });

  it('follows a different value its parent holds when the picker is closed, and keeps following later ones', () => {
    const { rerender } = render(tile());
    fireEvent.click(screen.getByRole('button', { name: 'Mesa' }));
    const input = colorInput();

    fireEvent.input(input, { target: { value: '#112233' } });
    act(() => {
      vi.advanceTimersByTime(LIVE_COLOR_INTERVAL_MS);
    });
    // Its own echo changes nothing.
    rerender(tile({ value: '#112233' }));
    expect(input).toHaveValue('#112233');
    fireEvent.pointerDown(document.body);

    rerender(tile({ value: '#c0392b' }));
    expect(input).toHaveValue('#c0392b');
    // Back to the color it last reported: the input is brought along even so.
    rerender(tile({ value: '#112233' }));
    expect(input).toHaveValue('#112233');
  });

  it('draws a fixed icon, not the current color, that takes no click of its own', () => {
    const { container, rerender } = render(tile());
    const fills = [...container.querySelectorAll('polygon')].map((polygon) => polygon.getAttribute('fill'));
    expect(fills.length).toBeGreaterThan(1);
    expect(new Set(fills).size).toBe(fills.length);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    rerender(tile({ value: '#c0392b' }));
    expect([...container.querySelectorAll('polygon')].map((polygon) => polygon.getAttribute('fill'))).toEqual(fills);
    expect(screen.getByLabelText('Color de mesa: #c0392b')).toBeInTheDocument();
  });
});
