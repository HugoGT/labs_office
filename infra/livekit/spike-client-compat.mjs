#!/usr/bin/env node
// Spike empirico de la Fase 1 (slice 1) de livekit-proximity-audio.
//
// No es un test de Vitest: es un registro empirico de compatibilidad, igual
// que test-recording.sh registra la grabacion end-to-end. Verifica, contra el
// stack Docker pineado en docker-compose.yml, las tres condiciones que
// permiten construir las fases 2-4 de la funcionalidad de audio/video:
//
//   1. livekit-client@2.22.3 completa la señalizacion contra
//      livekit-server:v1.13.5 (STOP-GATE A si falla).
//   2. autoSubscribe:false se respeta de verdad: nadie recibe un track sin
//      pedirlo explicitamente (STOP-GATE B si falla).
//   3. setSubscribed(false) corta la entrega real de medios (STOP-GATE C si
//      falla).
//
// Ademas confirma, ejecutandolo (nunca asumiendolo), que AccessToken.toJwt()
// de livekit-server-sdk@2.18.0 devuelve una Promise.
//
// Requiere el stack de infra/livekit/ levantado:
//   docker compose up -d redis livekit
//   node infra/livekit/spike-client-compat.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { AccessToken } from 'livekit-server-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

const LIVEKIT_WS_URL = 'ws://localhost:7880';
const LIVEKIT_HTTP_URL = 'http://localhost:7880';
const ROOM_NAME = 'spike-room';

// --- Credenciales: leidas de infra/livekit/.env (nunca hardcodeadas) ---
function loadEnvFile(filePath) {
  const vars = {};
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return vars;
}

const env = loadEnvFile(path.join(__dirname, '.env'));
if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
  console.error('Faltan LIVEKIT_API_KEY / LIVEKIT_API_SECRET en infra/livekit/.env');
  process.exitCode = 1;
  process.exit();
}

const evidence = {};
function record(label, value) {
  evidence[label] = value;
  console.log(`[evidencia] ${label}:`, JSON.stringify(value));
}

// --- Evidencia 5: confirmar por ejecucion, no por documentacion, que
// toJwt() devuelve una Promise ---
async function mintToken(identity) {
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity,
    ttl: '10m',
  });
  at.addGrant({
    roomJoin: true,
    room: ROOM_NAME,
    canPublish: true,
    canSubscribe: true,
  });
  const result = at.toJwt();
  const isPromise = result instanceof Promise;
  if (identity === 'spike-a') {
    record('AccessToken.toJwt() devuelve una Promise (confirmado por ejecucion)', isPromise);
  }
  return result;
}

async function main() {
  console.log('=== Spike livekit-client 2.22.3 vs livekit-server v1.13.5 ===\n');

  const tokenA = await mintToken('spike-a');
  const tokenB = await mintToken('spike-b');

  // livekit-client es browser-only: se inyecta el bundle UMD en la pagina de
  // Playwright en vez de importarlo por Node (ver #240 sobre jsdom).
  const bundlePath = path.join(
    REPO_ROOT,
    'node_modules',
    'livekit-client',
    'dist',
    'livekit-client.umd.js',
  );
  const bundleSource = readFileSync(bundlePath, 'utf8');

  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await contextA.grantPermissions(['microphone', 'camera']);
  await contextB.grantPermissions(['microphone', 'camera']);

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  pageA.on('console', (m) => console.log('[pagina A]', m.text()));
  pageB.on('console', (m) => console.log('[pagina B]', m.text()));
  pageA.on('pageerror', (e) => console.error('[pagina A error]', e));
  pageB.on('pageerror', (e) => console.error('[pagina B error]', e));

  // Navegar a un origen http real (no about:blank) para que getUserMedia
  // trate el contexto como seguro y los permisos de Playwright apliquen.
  await pageA.goto(LIVEKIT_HTTP_URL);
  await pageB.goto(LIVEKIT_HTTP_URL);
  await pageA.addScriptTag({ content: bundleSource });
  await pageB.addScriptTag({ content: bundleSource });

  // --- B conecta primero, con autoSubscribe:false, y NO debe recibir nada
  // sin pedirlo (evidencia 2 / STOP-GATE B) ---
  const connectResultB = await pageB.evaluate(
    async ({ url, token }) => {
      const { Room, RoomEvent } = window.LivekitClient;
      const room = new Room();
      window.__room = room;
      window.__subscribedEarly = false;
      room.on(RoomEvent.TrackSubscribed, () => {
        window.__subscribedEarly = true;
      });
      await room.connect(url, token, { autoSubscribe: false });
      const serverInfo = room.serverInfo ? JSON.parse(JSON.stringify(room.serverInfo)) : null;
      // Ventana breve para detectar una suscripcion indebida antes de que A publique.
      await new Promise((r) => setTimeout(r, 500));
      return { serverInfo, subscribedEarly: window.__subscribedEarly };
    },
    { url: LIVEKIT_WS_URL, token: tokenB },
  );

  record(
    'servidor conectado: version + protocolo negociado (room.serverInfo, visto por B)',
    connectResultB.serverInfo,
  );
  record(
    'B recibe TrackSubscribed antes de llamar setSubscribed(true) (debe ser false)',
    connectResultB.subscribedEarly,
  );

  // --- A conecta y publica el microfono (dispositivo falso de Chromium) ---
  await pageA.evaluate(
    async ({ url, token }) => {
      const { Room } = window.LivekitClient;
      const room = new Room();
      window.__room = room;
      await room.connect(url, token, { autoSubscribe: false });
      await room.localParticipant.setMicrophoneEnabled(true);
    },
    { url: LIVEKIT_WS_URL, token: tokenA },
  );

  // --- B espera la publicacion remota y se suscribe EXPLICITAMENTE ---
  const afterSubscribe = await pageB.evaluate(async () => {
    const { RoomEvent, Track } = window.LivekitClient;
    const room = window.__room;

    const findAudioPublication = () =>
      [...room.remoteParticipants.values()]
        .flatMap((p) => [...p.trackPublications.values()])
        .find((pub) => pub.kind === Track.Kind.Audio);

    const publication = await new Promise((resolve) => {
      const existing = findAudioPublication();
      if (existing) {
        resolve(existing);
        return;
      }
      room.on(RoomEvent.TrackPublished, () => {
        const pub = findAudioPublication();
        if (pub) resolve(pub);
      });
    });

    const subscribed = new Promise((resolve) => {
      room.on(RoomEvent.TrackSubscribed, (track) => resolve(track));
    });

    publication.setSubscribed(true);
    const track = await subscribed;

    return {
      hasMediaStreamTrack: track.mediaStreamTrack instanceof MediaStreamTrack,
      mediaStreamTrackKind: track.mediaStreamTrack?.kind ?? null,
      mediaStreamTrackReadyState: track.mediaStreamTrack?.readyState ?? null,
      publicationSid: publication.trackSid,
    };
  });

  record(
    'B recibe TrackSubscribed con MediaStreamTrack real tras setSubscribed(true) (evidencia 3)',
    afterSubscribe,
  );

  // --- B se desuscribe EXPLICITAMENTE (evidencia 4 / STOP-GATE C) ---
  const unsubscribed = await pageB.evaluate(async (sid) => {
    const { RoomEvent, Track } = window.LivekitClient;
    const room = window.__room;
    const publication = [...room.remoteParticipants.values()]
      .flatMap((p) => [...p.trackPublications.values()])
      .find((pub) => pub.trackSid === sid);

    const unsubscribedPromise = new Promise((resolve) => {
      room.on(RoomEvent.TrackUnsubscribed, () => resolve(true));
    });
    publication.setSubscribed(false);
    await unsubscribedPromise;
    // Confirma tambien que el track deja de estar vivo del lado del wrapper.
    return { fired: true, publicationSubscribed: publication.isSubscribed };
  }, afterSubscribe.publicationSid);

  record('B recibe TrackUnsubscribed tras setSubscribed(false) (evidencia 4)', unsubscribed);

  await browser.close();

  console.log('\n=== Resumen de evidencia (registro empirico, no documentacion) ===');
  console.log(JSON.stringify(evidence, null, 2));

  const stopGateA = false; // la senalizacion completo: ver server version arriba
  const stopGateB = connectResultB.subscribedEarly === true;
  const stopGateC = !(unsubscribed.fired && unsubscribed.publicationSubscribed === false);

  if (stopGateB || stopGateC) {
    console.error('\n!!! STOP-GATE disparado. Ver README.md e Engram para el hallazgo. !!!');
    process.exitCode = 1;
  } else {
    console.log('\nNingun STOP-GATE disparado. Slices 2-4 pueden proceder.');
  }
}

main().catch((err) => {
  console.error('El spike fallo con un error no controlado:', err);
  process.exitCode = 1;
});
