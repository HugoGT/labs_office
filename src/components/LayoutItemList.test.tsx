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
