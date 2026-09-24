import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RecordingReadyStack } from './RecordingReadyStack';

/** Midday UTC: the same calendar day in every time zone the tests may run in. */
const AVAILABLE_UNTIL = Date.UTC(2026, 9, 23, 12, 0, 0);

describe('RecordingReadyStack (#58)', () => {
  it('renders nothing without notices', () => {
    const { container } = render(
      <RecordingReadyStack notices={[]} onView={vi.fn()} onDownload={vi.fn()} onDismiss={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('one card per ready recording, each with Ver, Descargar and Cerrar for its own id', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    const onDownload = vi.fn();
    const onDismiss = vi.fn();
    render(
      <RecordingReadyStack
        notices={[
          { recordingId: 'rec-1', spaceId: 'a', availableUntil: AVAILABLE_UNTIL },
          { recordingId: 'rec-2', spaceId: 'b', availableUntil: AVAILABLE_UNTIL },
        ]}
        onView={onView}
        onDownload={onDownload}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getAllByText('La grabación está lista')).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: 'Ver' })[1]);
    await user.click(screen.getAllByRole('button', { name: 'Descargar' })[0]);
    await user.click(screen.getAllByRole('button', { name: 'Cerrar' })[1]);

    expect(onView).toHaveBeenCalledWith('rec-2');
    expect(onDownload).toHaveBeenCalledWith('rec-1');
    expect(onDismiss).toHaveBeenCalledWith('rec-2');
  });

  it('says until when the recording is kept, before the bucket deletes it (#5)', () => {
    render(
      <RecordingReadyStack
        notices={[{ recordingId: 'rec-1', spaceId: 'a', availableUntil: AVAILABLE_UNTIL }]}
        onView={vi.fn()}
        onDownload={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText('Disponible hasta el 23/10/2026')).toBeInTheDocument();
  });
});
