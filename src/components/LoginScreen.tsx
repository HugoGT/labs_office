import { useState } from 'react';
import styles from './LoginScreen.module.css';

/** The "forgot your password" flow (#94), already wired by `AuthGate`. */
export interface PasswordResetProps {
  onSend: (email: string) => void;
  /** Resets the flow when the person goes back to signing in. */
  onClear: () => void;
  pending: boolean;
  /** Show the neutral confirmation. */
  sent: boolean;
  /** Ya traducido (`describePasswordResetError`), nunca el error crudo. */
  error: string | null;
}

export interface LoginScreenProps {
  onSubmit: (email: string, password: string) => void;
  /** `true` mientras el intento anterior sigue en vuelo. */
  pending: boolean;
  /** Ya traducido a texto para la persona (`describeAuthError`), nunca el error crudo. */
  error: string | null;
  /** Without it the "forgot your password" link is not offered. */
  passwordReset?: PasswordResetProps;
}

/**
 * Pantalla de acceso con correo y contrasena (#8). Puramente presentacional
 * (D3): no importa ningun servicio ni conoce el puerto de autenticacion, solo
 * avisa hacia arriba con `onSubmit`. Quien inicia sesion es `AuthGate`.
 *
 * Ocupa el viewport entero a proposito: es lo unico que hay entre quien llega
 * y la oficina, y dejar el canvas asomando detras sugeriria que se puede
 * entrar sin pasar por aqui.
 *
 * Es un `<form>` de verdad, no un `<div>` con un boton: asi Enter envia, el
 * navegador valida los campos obligatorios y el gestor de contrasenas
 * reconoce la pareja correo/contrasena por sus `autoComplete`.
 *
 * Un solo camino de entrada, y es deliberado: no hay registro ni acceso con
 * Google. Las cuentas las crea quien administra desde el panel, una por
 * persona, con el alta por cuenta propia desactivada en el proveedor. Asi la
 * unica via para tener cuenta pasa por alguien que ya esta dentro.
 *
 * Password recovery exists (#94) and does not open a second way in: it only
 * emails a reset link to an account that already exists, and a disabled
 * account cannot use it (Identity Platform enforces that). Its confirmation is
 * the same whether or not the email has an account, so it is not an
 * enumeration oracle.
 */
export function LoginScreen({ onSubmit, pending, error, passwordReset }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  if (resetting && passwordReset) {
    return (
      <div className={styles.screen}>
        <form
          className={styles.card}
          onSubmit={(event) => {
            event.preventDefault();
            if (passwordReset.pending) return;
            passwordReset.onSend(email);
          }}
        >
          <h1 className={styles.title}>Recuperar contraseña</h1>
          <p className={styles.subtitle}>
            Te enviaremos un enlace para crear una contraseña nueva.
          </p>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="reset-email">
              Correo
            </label>
            <input
              className={styles.input}
              id="reset-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          {/* The same text whether or not the account exists (#94): anything
              else would tell a stranger who works here. */}
          {passwordReset.sent && (
            <p className={styles.notice} role="status">
              Si existe una cuenta con ese correo, te enviamos un enlace para crear una
              contraseña nueva. Revisa tu bandeja de entrada.
            </p>
          )}

          {passwordReset.error !== null && (
            <div className={styles.error} role="alert">
              {passwordReset.error}
            </div>
          )}

          <button className={styles.submit} type="submit" disabled={passwordReset.pending}>
            {passwordReset.pending ? 'Enviando…' : 'Enviar enlace'}
          </button>

          <button
            className={styles.link}
            type="button"
            onClick={() => {
              passwordReset.onClear();
              setResetting(false);
            }}
          >
            Volver a entrar
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <form
        className={styles.card}
        onSubmit={(event) => {
          // Sin esto el navegador navegaria a la misma URL con los campos en
          // la query y se perderia todo el estado de React.
          event.preventDefault();
          if (pending) return;
          onSubmit(email, password);
        }}
      >
        <h1 className={styles.title}>Oficina Virtual</h1>
        <p className={styles.subtitle}>Entra con la cuenta que te dieron.</p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="login-email">
            Correo
          </label>
          <input
            className={styles.input}
            id="login-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="login-password">
            Contraseña
          </label>
          <input
            className={styles.input}
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {/* `role="alert"` y no un parrafo cualquiera: el fallo aparece lejos
            del foco (que sigue en el boton) y sin anunciarlo no existe para
            quien usa un lector de pantalla. */}
        {error !== null && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <button className={styles.submit} type="submit" disabled={pending}>
          {pending ? 'Entrando…' : 'Entrar'}
        </button>

        {passwordReset && (
          <button
            className={styles.link}
            type="button"
            onClick={() => {
              passwordReset.onClear();
              setResetting(true);
            }}
          >
            ¿Olvidaste tu contraseña?
          </button>
        )}
      </form>
    </div>
  );
}
