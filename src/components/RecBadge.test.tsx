import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RecBadge } from './RecBadge';

describe('RecBadge', () => {
  it('esta ausente del arbol cuando visible es false', () => {
    render(<RecBadge visible={false} />);

    expect(screen.queryByText(/REC/)).not.toBeInTheDocument();
  });

  it('esta presente cuando visible es true', () => {
    render(<RecBadge visible={true} />);

    expect(screen.getByText(/REC/)).toBeInTheDocument();
  });
});
