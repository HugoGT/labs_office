import styles from './AudioUnblockPrompt.module.css';

export interface AudioUnblockPromptProps {
  /** `true` cuando el navegador bloqueo la reproduccion (politica de autoplay). */
  blocked: boolean;
  onUnblock: () => void;
}

/**
 * Aviso de audio bloqueado por el navegador (#18). Casi todos los navegadores
 * exigen un gesto del usuario antes de reproducir sonido; no hay forma de
 * saltarselo, solo de ofrecerlo. Sin esta superficie el sintoma es silencio
 * con todo lo demas aparentemente correcto.
 *
 * El sintoma cambia solo: encender el microfono llama a `getUserMedia`, que
 * tambien levanta el bloqueo. Por eso el aviso debe desaparecer por evento del
 * SDK y no por haberlo pulsado.
 *
 * Puramente presentacional (D3) y visible/ausente por render condicional (D4):
 * Vitest no procesa CSS bajo jsdom, asi que el estado se comprueba por
 * presencia en el arbol.
 */
export function AudioUnblockPrompt({ blocked, onUnblock }: AudioUnblockPromptProps) {
  if (!blocked) return null;

  return (
    <button type="button" className={styles.prompt} onClick={onUnblock}>
      🔈 Tu navegador bloqueó el audio — pulsa para activar el audio
    </button>
  );
}
