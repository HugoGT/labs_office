import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MiEspacioPanel } from './MiEspacioPanel';

/**
 * Placeholder inerte (issue de seguimiento tras esta rama): sin funcionalidad
 * real todavia, solo el titulo y el aviso de que llega despues. Disponible
 * tanto para quien administra como para quien no -- este componente no sabe
 * de roles, esa decision vive en `OfficeSidebar`.
 */
describe('MiEspacioPanel: placeholder inerte', () => {
  it('muestra el titulo "Mi espacio"', () => {
    render(<MiEspacioPanel />);

    expect(screen.getByRole('heading', { name: 'Mi espacio' })).toBeInTheDocument();
  });

  it('avisa que todavia no hay nada que hacer aqui', () => {
    render(<MiEspacioPanel />);

    expect(screen.getByText(/próximamente/i)).toBeInTheDocument();
  });
});
