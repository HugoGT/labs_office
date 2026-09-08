# Stack de audio/vídeo self-hosted — PoC Fase 0

Valida lo que el PRD marca como **riesgo #1 del proyecto** (§13): WebRTC self-hosted
con grabación propia. El cierre del PRD pide exactamente esto como siguiente paso.

## Estado: validado end-to-end ✅

Grabación real producida y verificada el 2026-08-23:

| Comprobación | Resultado |
|---|---|
| LiveKit server arranca | v1.13.5, Redis conectado, 0 errores |
| Egress se registra | `service ready`, `cpu available: 16 → max cost: 4` |
| Bucket de grabaciones | `recordings` creado en MinIO |
| Grabación → MinIO | `sala-prueba-*.mp4`, 6.4 MiB + manifiesto JSON |
| El MP4 decodifica | H.264 Main 1280×720 @30fps + AAC 44.1 kHz estéreo, 18.2 s, seekable |

Dato para el dimensionamiento que el PRD §13 pide vigilar: Egress reporta
`max cost: 4` sobre 16 CPUs, es decir ~**4 grabaciones concurrentes** en esta máquina.
Escala por CPU, no por usuarios conectados.

## Servicios

| Servicio | Rol |
|---|---|
| `livekit` | SFU: reparte los streams. No P2P — P2P no pasa de ~6 por sala (PRD 6.3) |
| `egress` | Compone la sala en un Chrome headless y graba a MP4 |
| `minio` | Almacenamiento S3-compatible propio para las grabaciones |
| `redis` | Canal de control entre `livekit` y `egress`. Egress no funciona sin él |

## Uso

```sh
cp .env.example .env        # y regenerar los secretos como indica el archivo
docker compose up -d
docker compose ps
```

| Endpoint | Para qué |
|---|---|
| `http://localhost:7880` | LiveKit: señalización HTTP/WebSocket |
| `http://localhost:9001` | consola web de MinIO (usuario/clave del `.env`) |

Prueba end-to-end de grabación:

```sh
./test-recording.sh                    # sala "sala-prueba", 20 s
DURACION=45 ./test-recording.sh demo   # sala "demo", 45 s
```

Publica vídeo de prueba, graba con Egress, y falla con exit ≠ 0 si el MP4 no
aterriza en MinIO o pesa 0 B.

Bajar todo (`-v` borra también las grabaciones):

```sh
docker compose down          # conserva el volumen de MinIO
docker compose down -v       # borra las grabaciones
```

## Gotchas que costaron tiempo

**1. El bloque `s3` del config de Egress NO es un destino por defecto.**
El más caro de los cinco. Con `s3` configurado en `EGRESS_CONFIG_BODY` pero sin
destino en el request, Egress no sube a S3: intenta una *escritura local* en la raíz
del filesystem y muere con `Local upload failed: open /<archivo>.mp4: permission
denied`. El destino va **en el request, dentro de cada `file_output`**. El síntoma
engaña: la grabación funciona, el MP4 existe en `/home/egress/tmp/<egressID>/`, y
el bucket queda vacío sin ningún error visible hasta que el egress termina.

**2. `lk egress stop` exige `--id`; posicional falla en silencio.**
`lk egress stop EG_xxx` sale con código 1 y un texto de ayuda. Si el script silencia
ese error, la grabación queda corriendo indefinidamente sin subir nada.

**3. Rango UDP pequeño a propósito.**
`livekit.yaml` publica 50000-50019, no el 50000-60000 habitual: publicar 10.000
puertos UDP en Docker hace que el arranque tarde minutos. 20 sobran para una PoC.
Ampliar en producción.

**4. El manifiesto reporta `https://` aunque el endpoint sea `http://`.**
El JSON que Egress sube junto al vídeo trae
`"location": "https://minio:9000/recordings/..."`. La app no debe confiar en ese
esquema para construir URLs de reproducción; hay que derivarlas de la configuración
propia (relevante para PRD 4.9 en Fase 1).

**5. Egress necesita `SYS_ADMIN` y `/dev/shm` grande.**
Corre un Chrome headless dentro. Sin `cap_add: SYS_ADMIN` el sandbox no arranca y
sin `shm_size` suficiente el navegador muere al renderizar. La imagen pesa 4.76 GB
justamente por eso.

## Decisión: coturn queda para producción

El PRD §6.5 pide coturn propio para atravesar NATs corporativos. Aquí el TURN
embebido de LiveKit está **apagado** y coturn **no** se despliega, a propósito: sin
IP pública ni certificados TLS, un TURN local no atraviesa nada y solo mete ruido en
los logs. La travesía de NAT no se puede validar en localhost — es trabajo de Fase 1
con infraestructura real.

Cuando llegue ese momento hay una decisión pendiente: LiveKit trae TURN embebido
(camino documentado por el proveedor, un servicio menos que mantener) frente a coturn
separado como dice el PRD. No la resolvimos porque no toca todavía.

## Lo que esta PoC NO demuestra

- **Travesía de NAT/firewall corporativo** — necesita IP pública y TLS.
- **Escala.** Se validó con un publicador. El PRD apunta a 500 concurrentes; el SFU
  necesita CPU dedicada por participante activo y Egress transcodifica en tiempo real.
- **Política de retención.** El PRD §13 avisa que el vídeo diario acumula varios
  GB/semana. Aquí no hay ninguna regla de borrado.

## Spike de compatibilidad `livekit-client` (slice 1 de `livekit-proximity-audio`, 2026-09-07)

Ejecutado con `node infra/livekit/spike-client-compat.mjs` contra el stack pineado
de esta misma carpeta (`livekit` + `redis`). Registro empírico, no documentación:
cada valor de la tabla proviene de un evento observado en una ejecución real con
dos páginas de Chromium (Playwright) y `livekit-client@2.22.3`.

### Imágenes pineadas (antes flotaban en `:latest`)

| Servicio | Tag | Digest |
|---|---|---|
| `livekit/livekit-server` | `v1.13.5` | `sha256:3497163e15c48fef6e7830c78716f9e9d5edc28abf7aa90b61c86e93bbc306b1` |
| `livekit/egress` | `v1.14.1` | `sha256:bf2b648b947349c3e9ff7aa8c718f00378d5c06af7624652a3653318e00333ce` |
| `minio/minio` | `RELEASE.2025-09-07T16-13-09Z` | `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e` |
| `minio/mc` | `RELEASE.2025-08-13T08-35-41Z` | `sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727` |
| `redis` | `7.4.11-alpine` | `sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf` |

Solo la versión de `livekit-server` estaba en el registro de la validación anterior
(este README, sección "Estado"). Las otras cuatro nunca se anotaron, así que
inventar un número habría falseado la validación: se resolvieron corriendo
`docker compose pull` y luego `docker image inspect --format '{{index
.RepoDigests 0}}'`, y el tag semántico/`RELEASE.*` de cada una se confirmó
haciendo `docker pull <imagen>:<tag>` por separado y comprobando que el digest
resultante es idéntico (sí lo es, para las cuatro).

### Las seis evidencias exigidas por el diseño

| # | Evidencia | Resultado observado |
|---|---|---|
| 1 | Versión de servidor + protocolo negociado | `room.serverInfo` en el cliente: `{"edition":"Standard","version":"1.13.5","protocol":17,"nodeId":"ND_VizRcAFYr2Vo","agentProtocol":1}` — coincide con el pin `v1.13.5` |
| 2 | B no recibe `TrackSubscribed` antes de llamar `setSubscribed(true)` | `false` (ningún evento indebido en una ventana de espera de 500 ms tras publicar A) |
| 3 | B recibe `TrackSubscribed` con `MediaStreamTrack` real tras `setSubscribed(true)` | `{"hasMediaStreamTrack":true,"mediaStreamTrackKind":"audio","mediaStreamTrackReadyState":"live"}` |
| 4 | B recibe `TrackUnsubscribed` tras `setSubscribed(false)` | `{"fired":true,"publicationSubscribed":false}` |
| 5 | Firma real de `AccessToken.toJwt()` | Confirmado por ejecución: devuelve una `Promise<string>` (no se asumió del `.d.ts`, se comprobó `result instanceof Promise === true`) |
| 6 | Digests resueltos de las 5 imágenes | Ver tabla de arriba |

**Ningún STOP-GATE se disparó.** Las fases 2–4 de `livekit-proximity-audio` pueden proceder.

### Hallazgos ADJUST — resultado empírico distinto al asumido en el diseño

El diseño (#323) asumió dos comportamientos sin poder confirmarlos en ese momento.
Este spike los comprobó y **ambos resultaron distintos de lo asumido**:

**a) `livekit-client` bajo jsdom.** Se asumió que el módulo era "hostil a jsdom"
y que por eso `useProximityAudio.ts` necesitaría un `import()` dinámico de
`livekitRoom.ts`. Comprobado con un test real bajo el proyecto `unit` (jsdom):
- `import('livekit-client')` **no lanza** bajo jsdom.
- `new Room()` **no lanza** bajo jsdom.
- Solo `room.connect(...)` lanza, y lo hace con un `Error` normal y capturable:
  `"LiveKit doesn't seem to be supported on this browser. Try to update your
  browser and make sure no browser extensions are disabling webRTC."`

  Es decir: el módulo se puede importar estáticamente sin romper jsdom: el
  único punto de fallo es `connect()`, que ya es exactamente el punto que
  `useProximityAudio.ts` debe envolver en un `try/catch` para degradar a
  `available:false` sin relanzar (ver spec, "Permission denial degrades to
  off"). El `import()` dinámico dejó de ser una necesidad de compatibilidad
  jsdom demostrada; sigue siendo una opción defendible por otras razones
  (aislar el bundle, mantener el seno explícito como con `createGame`), pero
  la fase 4A debe decidirlo sabiendo que la premisa original no se sostuvo.

**b) Flags de dispositivo falso bajo `@vitest/browser-playwright` 4.1.11.** Se
asumió que no eran configurables y que los tests de micrófono/cámara de
`livekitRoom.browser.test.ts` (tarea 4A.5) tendrían que ser manuales. Comprobado
con un test real bajo el proyecto `browser`, agregando temporalmente a
`vite.config.ts`:

```ts
provider: playwright({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  contextOptions: { permissions: ['microphone', 'camera'] },
}),
```

Resultado: `navigator.mediaDevices.enumerateDevices()` sí devolvió dispositivos
falsos (`"Fake Default Audio Input"`, `"fake_device_0"`, etc.) y
`getUserMedia({ audio: true })` entregó un track real con `readyState: "live"`.
**Los flags sí son configurables** vía `PlaywrightProviderOptions.launchOptions`
y `contextOptions.permissions`, expuestos por el propio paquete instalado. El
cambio de configuración se revirtió después de esta comprobación porque no es
tarea del slice 1 — pero la fase 4A ya no tiene que asumir que
`livekitRoom.browser.test.ts` es forzosamente manual; puede intentar correrlo
en `pnpm test:all` con esta configuración antes de resignarse al
`describe.skipIf`.

Ninguno de los dos hallazgos detiene las fases 2–4. Ambos quedan registrados
aquí y en Engram (`sdd/livekit-proximity-audio/apply-progress`) para que la
fase 4A los use al decidir su propio diseño, en vez de heredar una premisa que
este spike refutó.
