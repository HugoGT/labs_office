/**
 * Campanilla de invitacion, mejor esfuerzo (issue #2, D11). Vive en
 * `src/game/`, el hogar de este repo para logica ajena a React/Phaser (cf.
 * `livekitEndpoint.ts`, `proximityAudio.ts`): un oscilador WebAudio de unos
 * 120ms, sin asset, sin elemento `<audio>`.
 *
 * Degradacion explicita: si no hay `AudioContext` (jsdom, navegadores
 * viejos) o la politica de autoplay lo dejo en `suspended`, `play()` no hace
 * nada y no lanza. A proposito NO dispara un segundo aviso de "desbloquear
 * audio": `AudioUnblockPrompt` es de LiveKit y lo dispara
 * `RoomEvent.AudioPlaybackStatusChanged`; reutilizarlo aqui le diria al
 * usuario que sus colegas no se oyen cuando si se oyen. La tarjeta visible
 * es la notificacion garantizada; el sonido es aditivo.
 */

const CHIME_DURATION_S = 0.12;
const CHIME_FREQUENCY_HZ = 880;
const CHIME_GAIN = 0.15;

export interface CallChime {
  play(): void;
}

function defaultMakeContext(): AudioContext | undefined {
  const Ctor =
    (globalThis as typeof globalThis & { AudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return Ctor ? new Ctor() : undefined;
}

/**
 * `makeContext` es inyectable para pruebas (fakes deterministicos) y para
 * cubrir el prefijo `webkit` sin ensuciar el caso por defecto.
 */
export function createCallChime(
  makeContext: () => AudioContext | undefined = defaultMakeContext,
): CallChime {
  return {
    play(): void {
      let ctx: AudioContext | undefined;
      try {
        ctx = makeContext();
      } catch {
        // Best-effort real: construir el contexto puede fallar (navegador
        // sin soporte, politica del sitio). Sin sonido, sin excepcion.
        return;
      }
      if (!ctx || ctx.state !== 'running') return;

      try {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.frequency.value = CHIME_FREQUENCY_HZ;
        gain.gain.value = CHIME_GAIN;
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start();
        oscillator.stop(ctx.currentTime + CHIME_DURATION_S);
      } catch {
        // Idem: cualquier fallo al programar el sonido queda silencioso.
      }
    },
  };
}
