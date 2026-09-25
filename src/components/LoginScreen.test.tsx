import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoginScreen, type PasswordResetProps } from './LoginScreen';

/** Rellena Nombre/Correo/Contrasena en ese orden, el orden que exige el diseno. */
async function fillLoginForm(
  user: ReturnType<typeof userEvent.setup>,
  { name = 'Ana Lopez', email = 'ana@example.com', password = 'secreta' } = {},
) {
  if (name) await user.type(screen.getByLabelText(/^nombre$/i), name);
  if (email) await user.type(screen.getByLabelText(/correo/i), email);
  if (password) await user.type(screen.getByLabelText(/contraseña/i), password);
}

describe('LoginScreen', () => {
  it('los campos se alcanzan por su etiqueta accesible', () => {
    render(<LoginScreen onSubmit={vi.fn()} pending={false} error={null} />);

    // Si la etiqueta no esta asociada al input, `getByLabelText` no lo
    // encuentra: es la misma comprobacion que hace un lector de pantalla.
    expect(screen.getByLabelText(/^nombre$/i)).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText(/correo/i)).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText(/contraseña/i)).toHaveAttribute('type', 'password');
  });

  it('el orden de los campos es Nombre, Correo, Contrasena (#100)', () => {
    const { container } = render(<LoginScreen onSubmit={vi.fn()} pending={false} error={null} />);

    const order = [...container.querySelectorAll('input')].map((input) => input.id);
    expect(order).toEqual(['login-name', 'login-email', 'login-password']);
  });

  it('el campo Nombre tiene maxLength 24 (#100)', () => {
    render(<LoginScreen onSubmit={vi.fn()} pending={false} error={null} />);

    expect(screen.getByLabelText(/^nombre$/i)).toHaveAttribute('maxlength', '24');
  });

  it('declara autocompletado para que el gestor de contrasenas rellene', () => {
    render(<LoginScreen onSubmit={vi.fn()} pending={false} error={null} />);

    expect(screen.getByLabelText(/correo/i)).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText(/contraseña/i)).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
  });

  it('envia lo que se escribio, con el nombre primero', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LoginScreen onSubmit={onSubmit} pending={false} error={null} />);

    await fillLoginForm(user);
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('Ana Lopez', 'ana@example.com', 'secreta');
  });

  it('la tecla Enter envia el formulario, sin recargar la pagina', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LoginScreen onSubmit={onSubmit} pending={false} error={null} />);

    await user.type(screen.getByLabelText(/^nombre$/i), 'Ana Lopez');
    await user.type(screen.getByLabelText(/correo/i), 'ana@example.com');
    await user.type(screen.getByLabelText(/contraseña/i), 'secreta{Enter}');

    // Un <form> de verdad con `preventDefault`: sin el, Enter navegaria y se
    // perderia todo el estado de React.
    expect(onSubmit).toHaveBeenCalledWith('Ana Lopez', 'ana@example.com', 'secreta');
  });

  it('un nombre vacio o solo espacio bloquea el envio ANTES de cualquier llamada de red (#100)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LoginScreen onSubmit={onSubmit} pending={false} error={null} />);

    await fillLoginForm(user, { name: '   ' });
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('un nombre completamente vacio tambien bloquea el envio', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LoginScreen onSubmit={onSubmit} pending={false} error={null} />);

    await fillLoginForm(user, { name: '' });
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('el campo Nombre se prellena con `initialName` (D8)', () => {
    render(
      <LoginScreen onSubmit={vi.fn()} pending={false} error={null} initialName="Ana Lopez" />,
    );

    expect(screen.getByLabelText(/^nombre$/i)).toHaveValue('Ana Lopez');
  });

  it('sin `initialName` el campo Nombre empieza vacio', () => {
    render(<LoginScreen onSubmit={vi.fn()} pending={false} error={null} />);

    expect(screen.getByLabelText(/^nombre$/i)).toHaveValue('');
  });

  it('no vuelve a enviar mientras el intento anterior esta en vuelo', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LoginScreen onSubmit={onSubmit} pending={true} error={null} />);

    const submit = screen.getByRole('button');
    expect(submit).toBeDisabled();

    await user.click(submit);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('el boton dice que esta ocurriendo algo mientras espera', () => {
    const { rerender } = render(<LoginScreen onSubmit={vi.fn()} pending={false} error={null} />);
    const idle = screen.getByRole('button').textContent;

    rerender(<LoginScreen onSubmit={vi.fn()} pending={true} error={null} />);

    expect(screen.getByRole('button').textContent).not.toBe(idle);
  });

  it('muestra el error como alerta, no como texto suelto', () => {
    render(
      <LoginScreen onSubmit={vi.fn()} pending={false} error="Correo o contraseña incorrectos." />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
  });

  it('sin error no hay alerta en el arbol', () => {
    render(<LoginScreen onSubmit={vi.fn()} pending={false} error={null} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('nombre, correo y contrasena son obligatorios: el navegador corta antes de enviar vacio', () => {
    render(<LoginScreen onSubmit={vi.fn()} pending={false} error={null} />);

    expect(screen.getByLabelText(/^nombre$/i)).toBeRequired();
    expect(screen.getByLabelText(/correo/i)).toBeRequired();
    expect(screen.getByLabelText(/contraseña/i)).toBeRequired();
  });

  it('es puramente presentacional: no conoce ningun servicio', async () => {
    const onSubmit = vi.fn();
    render(<LoginScreen onSubmit={onSubmit} pending={false} error={null} />);

    await userEvent.type(screen.getByLabelText(/^nombre$/i), 'Ana Lopez');
    await userEvent.type(screen.getByLabelText(/correo/i), 'ana@example.com');
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'secreta{Enter}');

    // Todo lo que sabe hacer es avisar hacia arriba (D3): quien inicia sesion
    // de verdad es `AuthGate` a traves del puerto.
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('LoginScreen: forgot password (#94)', () => {
  function reset(overrides: Partial<PasswordResetProps> = {}): PasswordResetProps {
    return {
      onSend: vi.fn(),
      onClear: vi.fn(),
      pending: false,
      sent: false,
      error: null,
      ...overrides,
    };
  }

  it('without reset props the link is not offered', () => {
    render(<LoginScreen onSubmit={vi.fn()} pending={false} error={null} />);

    expect(screen.queryByRole('button', { name: /olvidaste/i })).not.toBeInTheDocument();
  });

  it('the link opens a reset form that keeps the typed email and asks no password', async () => {
    const user = userEvent.setup();
    render(
      <LoginScreen onSubmit={vi.fn()} pending={false} error={null} passwordReset={reset()} />,
    );
    await user.type(screen.getByLabelText(/correo/i), 'ana@example.com');

    await user.click(screen.getByRole('button', { name: /¿olvidaste tu contraseña\?/i }));

    expect(screen.getByRole('heading', { name: /recuperar contraseña/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/correo/i)).toHaveValue('ana@example.com');
    expect(screen.queryByLabelText(/^contraseña$/i)).not.toBeInTheDocument();
  });

  it('submitting sends the email upward', async () => {
    const user = userEvent.setup();
    const passwordReset = reset();
    render(
      <LoginScreen onSubmit={vi.fn()} pending={false} error={null} passwordReset={passwordReset} />,
    );
    await user.click(screen.getByRole('button', { name: /olvidaste/i }));

    await user.type(screen.getByLabelText(/correo/i), 'ana@example.com{Enter}');

    expect(passwordReset.onSend).toHaveBeenCalledWith('ana@example.com');
  });

  it('once sent shows a neutral confirmation that does not say whether the account exists', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <LoginScreen onSubmit={vi.fn()} pending={false} error={null} passwordReset={reset()} />,
    );
    await user.click(screen.getByRole('button', { name: /olvidaste/i }));

    rerender(
      <LoginScreen
        onSubmit={vi.fn()}
        pending={false}
        error={null}
        passwordReset={reset({ sent: true })}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(/si existe una cuenta con ese correo/i);
  });

  it('shows the reset error as an alert, and the button waits while pending', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <LoginScreen onSubmit={vi.fn()} pending={false} error={null} passwordReset={reset()} />,
    );
    await user.click(screen.getByRole('button', { name: /olvidaste/i }));

    rerender(
      <LoginScreen
        onSubmit={vi.fn()}
        pending={false}
        error={null}
        passwordReset={reset({ pending: true, error: 'Demasiados intentos.' })}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Demasiados intentos.');
    expect(screen.getByRole('button', { name: /enviando/i })).toBeDisabled();
  });

  it('going back returns to the sign-in form and clears the reset state', async () => {
    const user = userEvent.setup();
    const passwordReset = reset();
    render(
      <LoginScreen onSubmit={vi.fn()} pending={false} error={null} passwordReset={passwordReset} />,
    );
    await user.click(screen.getByRole('button', { name: /olvidaste/i }));

    await user.click(screen.getByRole('button', { name: /volver/i }));

    expect(screen.getByLabelText(/contraseña/i)).toHaveAttribute('type', 'password');
    expect(passwordReset.onClear).toHaveBeenCalled();
  });
});
