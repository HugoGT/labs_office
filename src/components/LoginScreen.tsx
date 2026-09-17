import { useState } from 'react';
import styles from './LoginScreen.module.css';

export interface LoginScreenProps {
  onSubmit: (email: string, password: string) => void;
  /** `true` mientras el intento anterior sigue en vuelo. */
  pending: boolean;
  /** Ya traducido a texto para la persona (`describeAuthError`), nunca el error crudo. */
  error: string | null;
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
 * Un solo camino de entrada, y es deliberado: no hay registro, ni recuperacion
 * de contrasena, ni acceso con Google. Las cuentas las crea a mano quien
 * administra el proyecto de Identity Platform, una por persona invitada, con el
 * alta por cuenta propia desactivada en el proveedor. Asi la unica via para
 * tener cuenta pasa por alguien que ya esta dentro, sin lista de invitados que
 * mantener en ningun sitio.
 */
export function LoginScreen({ onSubmit, pending, error }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

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
      </form>
    </div>
  );
}
