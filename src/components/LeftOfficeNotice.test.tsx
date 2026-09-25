import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LeftOfficeNotice } from './LeftOfficeNotice';

describe('LeftOfficeNotice (#66)', () => {
  it('is a dialog that says you left the office', () => {
    render(<LeftOfficeNotice onReenter={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Saliste de la oficina' });
    expect(dialog).toHaveTextContent('Saliste de la oficina');
  });

  it('"Volver a ingresar" asks to re-enter', async () => {
    const user = userEvent.setup();
    const onReenter = vi.fn();
    render(<LeftOfficeNotice onReenter={onReenter} />);

    await user.click(screen.getByRole('button', { name: 'Volver a ingresar' }));

    expect(onReenter).toHaveBeenCalledTimes(1);
  });
});

describe('LeftOfficeNotice: replaced by another tab (#78)', () => {
  it('says the office was opened somewhere else', () => {
    render(<LeftOfficeNotice reason="replaced" onReenter={vi.fn()} />);

    expect(
      screen.getByRole('dialog', { name: 'Abriste la oficina en otra pestaña o dispositivo' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Saliste de la oficina')).not.toBeInTheDocument();
  });

  it('"Usar aquí" asks to re-enter, which takes the office back to this tab', async () => {
    const user = userEvent.setup();
    const onReenter = vi.fn();
    render(<LeftOfficeNotice reason="replaced" onReenter={onReenter} />);

    await user.click(screen.getByRole('button', { name: 'Usar aquí' }));

    expect(onReenter).toHaveBeenCalledTimes(1);
  });
});
