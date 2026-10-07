import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OfficeEntry, OFFICE_ENTRY_TIMEOUT_MS } from './OfficeEntry';
import styles from './LoginScreen.module.css';

afterEach(() => vi.useRealTimers());

it('shows a plain status on the login background, hiding the mounted office until ready', () => {
  let report!: (state: 'ready' | 'failed') => void;
  const { container } = render(<OfficeEntry>{(onState) => {
    report = onState;
    return <button>Office controls</button>;
  }}</OfficeEntry>);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Entrando a la oficina…');
  expect(status.closest('form')).toBeNull();
  expect(status.parentElement).toHaveClass(styles.screen);
  expect(status.parentElement).not.toHaveClass(styles.card);
  expect(container.querySelector('form')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Office controls' })).toBeNull();
  act(() => report('ready'));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('button', { name: 'Office controls' })).toBeVisible();
});

it('offers a page reload for a rejected lazy chunk rather than retrying its cached rejection', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  function BrokenChunk(): never { throw new Error('chunk unavailable'); }
  render(<OfficeEntry>{() => <BrokenChunk />}</OfficeEntry>);
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Recargar página' })).toBeInTheDocument();
  consoleError.mockRestore();
});

it('does not leave a blank office if its render boundary fails after entry', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  let report!: (state: 'ready' | 'failed') => void;
  function BrokenOffice(): never { throw new Error('office render failed'); }
  const { rerender } = render(<OfficeEntry>{(next) => { report = next; return <div />; }}</OfficeEntry>);
  act(() => report('ready'));
  rerender(<OfficeEntry>{() => <BrokenOffice />}</OfficeEntry>);
  expect(screen.getByRole('button', { name: 'Recargar página' })).toBeInTheDocument();
  consoleError.mockRestore();
});

it('tears down failed attempts, retries, and ignores a late readiness from the old attempt', () => {
  const reports: ((state: 'ready' | 'failed') => void)[] = [];
  const { container } = render(<OfficeEntry>{(report) => {
    reports.push(report);
    return <div data-testid="office" />;
  }}</OfficeEntry>);
  const oldReport = reports[0]!;
  act(() => oldReport('failed'));
  expect(container.querySelector('[data-testid="office"]')).toBeNull();
  act(() => screen.getByRole('button', { name: 'Reintentar' }).click());
  act(() => oldReport('ready'));
  expect(screen.getByRole('status')).toBeInTheDocument();
  act(() => reports.at(-1)!('ready'));
  expect(screen.queryByRole('status')).toBeNull();
});

it('bounds a stalled load without using a timer for successful readiness, and clears timers on unmount', () => {
  vi.useFakeTimers();
  let report!: (state: 'ready' | 'failed') => void;
  const { unmount } = render(<OfficeEntry>{(next) => { report = next; return <div />; }}</OfficeEntry>);
  act(() => vi.advanceTimersByTime(OFFICE_ENTRY_TIMEOUT_MS));
  expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la oficina');
  act(() => screen.getByRole('button', { name: 'Reintentar' }).click());
  act(() => report('ready'));
  expect(vi.getTimerCount()).toBe(0);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
