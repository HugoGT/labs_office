import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CallInvitationCard as CallInvitationCardData } from '../hooks/useCallInvitations';
import { CallInvitationCard } from './CallInvitationCard';

const INVITATION: CallInvitationCardData = {
  from: 'sess-1',
  name: 'Ana',
  alerting: true,
  callerPresent: true,
};

describe('CallInvitationCard', () => {
  it('muestra el nombre del llamador', () => {
    render(<CallInvitationCard invitation={INVITATION} onAccept={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it('marca el estado de alerta en un atributo, para el pulso visual de D11', () => {
    const { rerender } = render(
      <CallInvitationCard invitation={INVITATION} onAccept={vi.fn()} onDismiss={vi.fn()} />,
    );

    expect(screen.getByText('Ana').closest('[data-alerting]')).toHaveAttribute(
      'data-alerting',
      'true',
    );

    rerender(
      <CallInvitationCard
        invitation={{ ...INVITATION, alerting: false }}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText('Ana').closest('[data-alerting]')).toHaveAttribute(
      'data-alerting',
      'false',
    );
  });

  it('muestra "Ir con la persona" mientras el llamador sigue presente', () => {
    render(<CallInvitationCard invitation={INVITATION} onAccept={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Ir con la persona/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pasar/ })).toBeInTheDocument();
  });

  it('oculta "Ir con la persona" cuando el llamador se desconecto (D7, tombstone)', () => {
    render(
      <CallInvitationCard
        invitation={{ ...INVITATION, callerPresent: false }}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Ir con la persona/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pasar/ })).toBeInTheDocument();
  });

  it('clic en "Ir con la persona" llama a onAccept con el sessionId del llamador', async () => {
    const onAccept = vi.fn();
    const user = userEvent.setup();
    render(<CallInvitationCard invitation={INVITATION} onAccept={onAccept} onDismiss={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Ir con la persona/ }));

    expect(onAccept).toHaveBeenCalledWith('sess-1');
  });

  it('clic en "Pasar" llama a onDismiss con el sessionId del llamador', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<CallInvitationCard invitation={INVITATION} onAccept={vi.fn()} onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: /Pasar/ }));

    expect(onDismiss).toHaveBeenCalledWith('sess-1');
  });

  it('"Pasar" sigue funcionando sobre un tombstone', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(
      <CallInvitationCard
        invitation={{ ...INVITATION, callerPresent: false }}
        onAccept={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Pasar/ }));

    expect(onDismiss).toHaveBeenCalledWith('sess-1');
  });
});
