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
- [ ] Envolver `infra/livekit/test-recording.sh` en una suite con asserts y código
      de salida (bats o similar). Hoy valida a mano y necesita Docker, así que
      quedó fuera de la suite ejecutable.
- [ ] Tests del servidor Colyseus cuando exista (sección 2).
- [ ] E2E de proximidad con dos clientes en el mismo mapa, cuando el cliente hable
      con LiveKit de verdad (depende de 2.4).
- [x] CI en `.github/workflows/ci.yml`: un job secuencial con typecheck, ambas capas
      de test y build, sobre push y PR a `main`. Un solo job a propósito: separarlo en
      jobs paralelos pagaría la instalación de Chromium más de una vez, que es el paso
      caro. Instala Chromium explícitamente porque sin navegador la capa `browser` no
      existe. Todavía **no ha corrido en GitHub Actions** (nada pusheado).

Comandos: `pnpm test` (jsdom, rápido), `pnpm test:browser`, `pnpm test:all`,
`pnpm test:coverage`, `pnpm test:watch`.

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
- [ ] Reemplazar las texturas generadas por código por **sprites/tilemaps reales** (formato Tiled `.json`, PRD 4.1 y 6.1).
      Alcance acotado por PRD 14 decisión 5: mapa base prediseñado + assets modificables encima, no un editor de tiles completo.
      **Bloqueado por adquisición de arte, no por código**: no hay un solo asset en el repo (`public/` está vacío, no existe
      `src/assets/`). Decisión pendiente: quién produce el mapa base y el tileset. Hasta entonces las texturas siguen siendo
      procedurales, que es exactamente lo que hacía el prototipo.

## 2. Completar Fase 0 del PRD — prototipo técnico ← **en curso**

- [x] **LiveKit self-hosted** (Docker): server v1.13.5 + Redis arriba en `infra/livekit/`.
      coturn NO se despliega a propósito — sin IP pública ni TLS un TURN local no atraviesa
      nada. La travesía de NAT es trabajo de Fase 1; ver `infra/livekit/README.md`.
- [x] **LiveKit Egress + MinIO**: grabación real validada end-to-end. MP4 en MinIO,
      decodificado y verificado: H.264 Main 1280×720 @30fps + AAC 44.1 kHz, seekable.
      Reproducible con `infra/livekit/test-recording.sh`.
      Capacidad medida: `max cost 4` sobre 16 CPUs → ~4 grabaciones concurrentes.
- [ ] **Colyseus** (servidor Node): sincronizar posición de avatares reales por WebSocket — hoy los NPCs son simulados (PRD 6.2).
- [ ] Conectar el cliente al stack: audio/vídeo real por proximidad con el SDK de LiveKit
      — hoy los anillos de "hablando" y el mute son visuales (PRD 6.3), y el botón ⏺ Grabar
      solo simula el flujo (PRD 4.9). **Ya desbloqueado**: dependía del port de la sección 1,
      que está hecho. El HUD emite y recibe por el bridge, así que conectar LiveKit es
      sustituir el simulacro detrás de esos eventos, no rehacer la UI.

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
