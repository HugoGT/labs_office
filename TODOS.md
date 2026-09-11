# TODOS — Roadmap del prototipo al stack real

> Contexto: sigue el roadmap del PRD (`PRD-Oficina-Virtual.md`, sección 12). El prototipo standalone
> original vive en `prototype/` como referencia de la que se porta el código.
>
> Entorno: Linux, Node v24.15.0, pnpm 11.1.3 (`npm` está aliaseado a `pnpm`).
>
> **Orden revisado:** el PRD 13 marca el WebRTC self-hosted como *riesgo #1 del proyecto* y el cierre
> del documento pide validar LiveKit + Egress como siguiente paso. Por eso la sección 2 va antes de
> terminar la 1: el scaffolding de la 1 solo se completó hasta donde desbloquea dependencias npm.

## 0. Preparación del entorno

- [x] Instalar Node.js LTS — ya presente en Linux vía nvm (`node --version` → v24.15.0, `npm --version` → 11.1.3).
      Para reproducir en otra máquina Linux: `nvm install --lts` (o el paquete de la distro).
- [x] Inicializar git en el proyecto — repositorio creado, rama `main`, sin commits todavía.

## Testing (transversal) ← **base montada**

> Regla desde aquí en adelante: código nuevo entra con su test. La suite ya
> mata mutantes reales (efecto sin limpieza, borde de rejilla exclusivo), no
> solo cuenta líneas.

**Dos capas deliberadas.** Phaser no se puede ni *importar* bajo jsdom:
`CanvasFeatures.js` llama a `getContext('2d')` al cargar el módulo y jsdom
devuelve `null`. Por eso todo lo que toca el motor vive en la capa de navegador,
contra Chromium y WebGL de verdad; mockearlo en jsdom solo probaría el mock.

- [x] Vitest 4 con dos proyectos en `vite.config.ts`: `unit` (jsdom) y `browser`
      (Chromium headless vía `@vitest/browser-playwright`).
- [x] Capa jsdom (10 tests) — lo que no toca Phaser, con `createGame` mockeado en
      el borde del módulo: ciclo de vida de `GameCanvas` (el bug de StrictMode),
      composición de `App`, guarda de `#root` en `main.tsx`.
- [x] Capa navegador — `createGame` (AUTO resuelve a WebGL, `pixelArt` sin
      antialias, escala al contenedor, `destroy(true)` retira el canvas) y
      `GameCanvas` integrado con Phaser real. `BootScene` y sus 8 tests se
      retiraron en `076ee3d` al entrar `OfficeScene`: no es cobertura perdida,
      `createGame.browser.test.ts` ejercita el mismo arranque contra la escena real.
- [x] Cobertura combinada de ambas capas: 100% de líneas, 97% de sentencias.
      Único hueco: la guarda defensiva `if (!host)` de `GameCanvas`, inalcanzable
      en la práctica porque el ref siempre está montado cuando corre el efecto.
- [x] Suite tras el port del prototipo: **120 tests en 21 ficheros** (jsdom + Chromium),
      typecheck y build limpios. Todo el código del port entró en RED→GREEN.
- [x] Tercera capa `server` (Node) en `vite.config.ts`: levanta un Colyseus real en un puerto
      efímero y habla con él usando el cliente real. No es ceremonia: el fallo caro de este
      stack está en el protocolo por cable (schema 3 contra schema 4), y un doble lo pasaría
      por alto. Incluye `src/**/*.node.test.ts`, que es donde vive el test del envoltorio de
      cliente.
- [x] Tests del servidor Colyseus: 10 de integración sobre presencia, movimiento y validación
      («el cliente no es de fiar»: recorte a los límites del mundo, descarte de `move` no
      numérico, nombre acotado).
- [x] E2E de proximidad con dos clientes en el mismo mapa, contra el bundle real. Arnés
      `node:test` + `playwright` en `e2e/`: levanta un Colyseus real y un `vite preview` real
      del build instrumentado, y conduce dos contextos de Chromium independientes.
      Cubre presencia y chips al spawnear, aislamiento mutuo al entrar/salir de una sala
      privada (Cafetería), caída de chip al cerrar un contexto, y degradación con LiveKit
      caído (mic/cámara deshabilitados con el título correcto, cero `pageerror`). Corre
      sin Docker y está cableado en `ci.yml` tras el `Build` (`pnpm build:e2e` +
      `pnpm test:e2e`). Lo que queda fuera: comprobar que el audio LiveKit real se
      escucha entre clientes (no solo que se conecta), que sigue siendo manual y
      requiere Docker levantado en local.
- [x] CI en `.github/workflows/ci.yml`: un job secuencial con typecheck, ambas capas
      de test y build, sobre push y PR a `main`. Un solo job a propósito: separarlo en
      jobs paralelos pagaría la instalación de Chromium más de una vez, que es el paso
      caro. Instala Chromium explícitamente porque sin navegador la capa `browser` no
      existe. `pnpm test:all` cubre ya las tres capas (jsdom, Node y Chromium).
      Todavía **no ha corrido en GitHub Actions** (nada pusheado).

Comandos: `pnpm test` (jsdom, rápido), `pnpm test:server`, `pnpm test:browser`,
`pnpm test:all`, `pnpm test:coverage`, `pnpm test:watch`.
Para levantar la oficina completa en local: `pnpm server` y `pnpm dev` en paralelo.

## 1. Migrar el prototipo al stack real del PRD (sección 6.1)

- [x] Scaffolding con **Vite 8 + React 19 + TypeScript 7**. Hecho a mano: `create-vite@9.1.2` ignora
      `--template` en entorno no interactivo y genera `vanilla-ts` (probadas las dos formas de la flag).
- [x] Instalar **Phaser** como dependencia npm. Fijado en **3.90.0**, no en la 4.2.1 que resuelve
      `latest`: el PRD 6.1 especifica Phaser 3 y `prototype/js/phaser.min.js` ya era 3.90.0, así que
      el port no arrastra encima una migración de motor.
- [x] React montando Phaser con ciclo de vida resuelto (`GameCanvas.tsx` destruye la instancia al
      desmontar — sin eso StrictMode deja dos juegos peleando por el canvas).
- [x] Portar `prototype/js/app.js` a módulos TypeScript. Partido por un solo eje: **¿el
      módulo importa `phaser` en runtime?** Lo que no lo importa (`mapData`, `npcData`,
      `terrainGrid`, `colliderMerge`, `proximity`, `officeBridge`) se prueba en jsdom; lo
      que sí (`textures`, `mapBuilder`, `characters`, `OfficeScene`) solo en Chromium.
- [x] Mover la UI DOM a componentes React: `BottomBar`, `ContextMenu`, `Toast`, `RecBadge`,
      compuestos por `OfficeShell`, que es el único dueño del bridge. El `window.officeAPI`
      global del prototipo desaparece: se sustituye por un bridge tipado por instancia sobre
      `EventTarget`, donde cada suscriptor posee su propio cierre de baja. Sin
      `dangerouslySetInnerHTML`: el prototipo concatenaba nombres dentro de `innerHTML`.
- [x] **Assets open source como relleno provisional** (Kenney, CC0 / dominio público) en
      `public/assets/kenney/`, con sus licencias originales al lado. El suelo, el mobiliario y
      la naturaleza son ahora frames de dos hojas reales (`roguelike-rpg`, `roguelike-indoors`)
      en vez de rectángulos de color generados por código. Los índices de frame están
      verificados uno a uno: buena parte del pack son autotiles 3x3, así que el tile de relleno
      es el **centro** del bloque, no su esquina — coger la esquina mete bordillos de piedra en
      mitad del césped.
- [x] Avatares con **orientación en 4 direcciones**. Siguen siendo procedurales, y es una
      decisión, no una deuda: ningún pack CC0 de Kenney trae personas de cuerpo entero en vista
      3/4 (los de `roguelike-characters` son bustos frontales), y la alternativa con animación
      real (LPC) es CC-BY-SA, licencia vírica que no encaja en un producto comercial.
- [ ] **Tilemap Tiled `.json` propio y arte definitivo** (PRD 4.1 y 6.1). Lo de arriba es
      relleno «por mientras»: el layout sigue generándose por código en `terrainGrid.ts`, no se
      carga de un `.json` de Tiled. Sigue **bloqueado por adquisición de arte**: decisión
      pendiente de quién produce el mapa base y el tileset definitivos. Cambiar de arte no
      debería tocar lógica, solo `assets.ts`.

## 2. Completar Fase 0 del PRD — prototipo técnico ← **en curso**

- [x] **LiveKit self-hosted** (Docker): server v1.13.5 + Redis arriba en `infra/livekit/`.
      coturn NO se despliega a propósito — sin IP pública ni TLS un TURN local no atraviesa
      nada. La travesía de NAT es trabajo de Fase 1; ver `infra/livekit/README.md`.
- [x] **LiveKit Egress + MinIO**: grabación real validada end-to-end. MP4 en MinIO,
      decodificado y verificado: H.264 Main 1280×720 @30fps + AAC 44.1 kHz, seekable.
      Reproducible con `infra/livekit/test-recording.sh`.
      Capacidad medida: `max cost 4` sobre 16 CPUs → ~4 grabaciones concurrentes.
- [x] **Colyseus** (servidor Node) en `server/`: sincroniza por WebSocket la posición de los
      avatares reales (PRD 6.2). Dos clientes se ven, se mueven y se dan de baja; verificado
      con dos pestañas reales de Chromium, no solo en test. Si el servidor no está levantado la
      oficina **no se rompe**: cae a modo solitario y la barra lo indica (`⚪ Sin servidor`).
      Las tres trampas de versiones de este stack están documentadas en `server/README.md`.
- [x] Los **NPCs simulados se quedan** para que la oficina no se vea vacía, pero pierden el
      deambular aleatorio. Su único comportamiento es acudir cuando se les llama desde el menú
      contextual: «📞 Llamar» hace que el NPC camine hasta una tile libre junto al jugador.
      Es el reflejo de «🚶 Ir a su escritorio», que mueve al jugador en vez de al NPC.
- [x] Conectar el cliente al stack: audio/vídeo real por proximidad con el SDK de LiveKit
      (PRD 6.3). Cableado en `useProximityAudio` + `BottomBar` (commit `3eaa371`): mic/cámara
      reales por sesión de Colyseus, y degradación explícita cuando LiveKit no responde
      (botones deshabilitados con título, en vez de fallar en silencio o quedarse en el
      simulacro). Probado end-to-end con dos clientes reales de Chromium, incluida la caída
      de LiveKit (sección Testing, ítem E2E de proximidad).
- [ ] Grabación real desde el HUD: el botón ⏺ Grabar solo simula el flujo (PRD 4.9); no
      dispara una grabación de Egress real todavía. **No es cuestión de cablear el botón**:
      Egress graba a nivel de sala de LiveKit y esta app usa una sola sala compartida
      (`LIVEKIT_ROOM_NAME = 'office-livekit'`, `src/game/officeProtocol.ts:19`). La privacidad
      por espacio la impone solo el cliente filtrando suscripciones, así que
      `startRoomCompositeEgress` grabaría toda la oficina, incluida gente que nunca entró en
      el espacio que se quería grabar: incumple el PRD 4.9. Hueco colateral del mismo
      requisito: `recording` es un `useState` local de `OfficeShell`, no vive en
      `OfficeState`, así que el ⏺ solo lo ve quien lo pulsa y el «aviso a todos los
      participantes» del PRD 4.9 está incumplido al margen de Egress. Diferido a la Fase 1
      junto con el backend, donde se decide la topología de salas.
- [ ] **Nombre e identidad reales**: hoy los dos clientes entran como `HugoGT` porque el nombre
      está fijo en `characters.ts`. El servidor ya acepta y sanea un nombre por sesión, así que
      el hueco es de UI/auth, no de protocolo. Se cierra de verdad con Google OAuth (sección 3).

## 3. Fase 1 — MVP (después de validar Fase 0)

- [ ] Backend **NestJS + PostgreSQL + Redis**: usuarios, roles (Admin/Empleado/Invitado), invitaciones (PRD 6.4, modelo de datos sección 7).
- [ ] Autenticación con **Google OAuth 2.0** (PRD sección 10).
- [ ] Espacios delimitados configurables por Admin sobre el mapa base (PRD 4.5).
- [ ] Decoración drag & drop del escritorio propio (PRD 4.4).
- [ ] Videollamada 1:1 real desde el menú "📞 Llamar" (hoy solo muestra un toast).
- [ ] **PWA instalable**: manifest, service worker (Vite PWA plugin), notificaciones push (PRD sección 9).

## 4. Fase 2 — pendientes posteriores

- [ ] Integración con **Google Calendar** para reserva de salas (PRD 4.10).
- [ ] Catálogo de assets ampliado, analíticas para Admin, estados avanzados.
