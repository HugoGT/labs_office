import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LayoutItemList } from './LayoutItemList';

const ITEMS = [
  { id: 'a', name: 'Sala 1' },
  { id: 'b', name: 'Escritorio de Ana' },
];

describe('LayoutItemList', () => {
  it('shows one row per item: its name, a "Mover" and a trash, each named after the item', () => {
    render(<LayoutItemList items={ITEMS} busy={false} onMove={vi.fn()} onRemove={vi.fn()} />);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    for (const [index, { name }] of ITEMS.entries()) {
      const row = within(rows[index]);
      expect(row.getByText(name)).toHaveAttribute('title', name);
      expect(row.getByRole('button', { name: `Mover ${name}` })).toHaveTextContent(/^Mover$/);
      const trash = row.getByRole('button', { name: `Eliminar ${name}` });
      expect(trash).toHaveAttribute('title', 'Eliminar');
      expect(trash).toHaveTextContent('');
    }
  });

  it('each button acts on its own row', async () => {
    const onMove = vi.fn();
    const onRemove = vi.fn();
    render(<LayoutItemList items={ITEMS} busy={false} onMove={onMove} onRemove={onRemove} />);

    await userEvent.click(screen.getByRole('button', { name: 'Mover Escritorio de Ana' }));
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Sala 1' }));

    expect(onMove).toHaveBeenCalledWith('b');
    expect(onRemove).toHaveBeenCalledWith('a');
  });

  it('disables every button while busy', () => {
    render(<LayoutItemList items={ITEMS} busy onMove={vi.fn()} onRemove={vi.fn()} />);

    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });
});

describe('LayoutItemList: meeting mode (#282)', () => {
  it('with onToggleMeeting, each row says whether it is a meeting room and flips it', async () => {
    const onToggleMeeting = vi.fn();
    render(
      <LayoutItemList
        items={[{ id: 'a', name: 'Sala 1', meeting: true }, { id: 'b', name: 'Sala 2' }]}
        busy={false}
        onMove={vi.fn()}
        onRemove={vi.fn()}
        onToggleMeeting={onToggleMeeting}
      />,
    );

    const on = screen.getByRole('button', { name: 'Sala de junta: Sala 1' });
    const off = screen.getByRole('button', { name: 'Sala de junta: Sala 2' });
    expect(on).toHaveAttribute('aria-pressed', 'true');
    expect(off).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(on);
    await userEvent.click(off);

    expect(onToggleMeeting).toHaveBeenNthCalledWith(1, 'a', false);
    expect(onToggleMeeting).toHaveBeenNthCalledWith(2, 'b', true);
  });

  it('without it, no row offers meeting mode (desks)', () => {
    render(<LayoutItemList items={ITEMS} busy={false} onMove={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /Sala de junta/ })).toBeNull();
  });
});
