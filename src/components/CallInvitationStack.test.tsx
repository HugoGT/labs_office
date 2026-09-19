import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CallInvitationCard as CallInvitationCardData } from '../hooks/useCallInvitations';
import { CallInvitationStack } from './CallInvitationStack';

const CALLS: readonly CallInvitationCardData[] = [
  { from: 'a', name: 'Ana', alerting: true, callerPresent: true },
  { from: 'c', name: 'Carlos', alerting: true, callerPresent: true },
];

describe('CallInvitationStack', () => {
  it('no renderiza nada sin invitaciones', () => {
    const { container } = render(
      <CallInvitationStack invitations={[]} onAccept={vi.fn()} onDismiss={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renderiza una tarjeta por invitacion, en el orden recibido (mas nueva al final, decision humana #305.2)', () => {
    render(<CallInvitationStack invitations={CALLS} onAccept={vi.fn()} onDismiss={vi.fn()} />);

    const names = screen.getAllByText(/Ana|Carlos/).map((el) => el.textContent);
    expect(names).toEqual(['Ana', 'Carlos']);
  });

  it('cada tarjeta usa el sessionId del llamador como clave (D5: unico por llamador)', () => {
    render(<CallInvitationStack invitations={CALLS} onAccept={vi.fn()} onDismiss={vi.fn()} />);

    // Dos tarjetas completas deben existir de forma independiente: si
    // compartiesen clave, React colapsaria una encima de la otra.
    expect(screen.getAllByRole('button', { name: /Pasar/ })).toHaveLength(2);
  });

  it('el contenedor anuncia las llegadas con aria-live assertive (D11)', () => {
    render(<CallInvitationStack invitations={CALLS} onAccept={vi.fn()} onDismiss={vi.fn()} />);

    expect(
      screen.getAllByRole('button', { name: /Pasar/ })[0].closest('[aria-live]'),
    ).toHaveAttribute('aria-live', 'assertive');
  });

  it('reenvia onAccept/onDismiss con el sessionId de la tarjeta correcta', async () => {
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<CallInvitationStack invitations={CALLS} onAccept={onAccept} onDismiss={onDismiss} />);

    const acceptButtons = screen.getAllByRole('button', { name: /Ir con la persona/ });
    await user.click(acceptButtons[1]);
    expect(onAccept).toHaveBeenCalledWith('c');

    const dismissButtons = screen.getAllByRole('button', { name: /Pasar/ });
    await user.click(dismissButtons[0]);
    expect(onDismiss).toHaveBeenCalledWith('a');
  });
});
