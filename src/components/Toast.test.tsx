import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Toast } from './Toast';

describe('Toast', () => {
  it('renderiza el mensaje recibido', () => {
    render(<Toast message="Grabacion finalizada" />);

    expect(screen.getByText('Grabacion finalizada')).toBeInTheDocument();
  });

  it('no renderiza nada cuando el mensaje es null', () => {
    const { container } = render(<Toast message={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renderiza contenido JSX compuesto sin inyeccion de HTML', () => {
    render(
      <Toast
        message={
          <>
            Entraste a <b>Sala de Juntas</b>
          </>
        }
      />,
    );

    expect(screen.getByText('Sala de Juntas').tagName).toBe('B');
    expect(screen.getByText(/Entraste a/)).toBeInTheDocument();
  });

  it('un nombre con marcado renderiza como texto literal, no como elemento', () => {
    render(<Toast message={'<img src=x onerror=alert(1)>'} />);

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});
