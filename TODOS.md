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

## 1. Migrar el prototipo al stack real del PRD (sección 6.1)

- [x] Scaffolding con **Vite 8 + React 19 + TypeScript 7**. Hecho a mano: `create-vite@9.1.2` ignora
      `--template` en entorno no interactivo y genera `vanilla-ts` (probadas las dos formas de la flag).
- [x] Instalar **Phaser** como dependencia npm. Fijado en **3.90.0**, no en la 4.2.1 que resuelve
      `latest`: el PRD 6.1 especifica Phaser 3 y `prototype/js/phaser.min.js` ya era 3.90.0, así que
      el port no arrastra encima una migración de motor.
- [x] React montando Phaser con ciclo de vida resuelto (`GameCanvas.tsx` destruye la instancia al
      desmontar — sin eso StrictMode deja dos juegos peleando por el canvas).
- [ ] Portar `prototype/js/app.js` a módulos TypeScript (escena, texturas, datos del mapa separados).
- [ ] Mover la UI DOM (barra inferior, menú contextual, toasts) a componentes React.
- [ ] Reemplazar las texturas generadas por código por **sprites/tilemaps reales** (formato Tiled `.json`, PRD 4.1 y 6.1).
      Alcance acotado por PRD 14 decisión 5: mapa base prediseñado + assets modificables encima, no un editor de tiles completo.

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
      solo simula el flujo (PRD 4.9). Depende del port del frontend (sección 1).

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
