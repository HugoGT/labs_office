# Oficina Virtual — Fase 0

Oficina virtual 2D top-down estilo Gather, de uso interno. Documento de referencia:
`PRD-Oficina-Virtual.md` (la arquitectura vive en la sección 6, el roadmap en la 12).

## Requisitos

- Node.js (probado con v24.15.0)
- pnpm (en este equipo `npm` está aliaseado a `pnpm`; el lockfile es `pnpm-lock.yaml`)

## Cómo ejecutar

```sh
pnpm install
pnpm dev        # http://localhost:5173
```

Otros scripts:

| Script | Qué hace |
|---|---|
| `pnpm build` | `tsc -b` + build de producción a `dist/` |
| `pnpm preview` | sirve `dist/` para verificar el build |
| `pnpm typecheck` | solo comprobación de tipos |

## Stack (PRD 6.1)

- **Vite 8** + **React 19** + **TypeScript 7**
- **Phaser 3.90.0** — motor del mapa y avatares. Fijado en la línea 3 a propósito:
  el PRD 6.1 especifica Phaser 3 y el prototipo ya estaba escrito contra 3.90.0,
  así que el port no arrastra además una migración de motor. Phaser 4 existe pero
  no se adopta en Fase 0.

El build separa Phaser en su propio chunk (~1.2 MB) para que el código de la app
(~190 kB) se revalide sin reenviar el motor. El aviso de "chunk > 500 kB" que emite
Vite es esperado y se deja visible: es el tamaño real de Phaser, no un descuido.

## Estructura

```
src/
├── main.tsx              # entrypoint React
├── App.tsx
├── index.css
├── components/
│   └── GameCanvas.tsx    # monta y destruye la instancia de Phaser
└── game/
    ├── createGame.ts     # configuración del juego
    └── BootScene.ts      # escena de humo (rejilla de tiles)

prototype/                # prototipo standalone previo — solo referencia
├── index.html            # UI en español (barra inferior, menú contextual, badges)
└── js/app.js             # motor completo: mapa, NPCs, proximidad, salas

infra/livekit/            # stack self-hosted de audio/vídeo (PRD 6.3)
├── docker-compose.yml    # livekit + egress + minio + redis
├── livekit.yaml
├── test-recording.sh     # prueba end-to-end de grabación
└── README.md             # estado validado, gotchas y decisiones
```

`prototype/` es la implementación de la que se porta el código, no se ejecuta como
parte de la app. Se abre suelta en el navegador (`xdg-open prototype/index.html`):
no carga assets externos, así que `file://` basta.

## Estado

Lo que hay: scaffolding del stack real, con React montando Phaser y su ciclo de vida
resuelto. Lo que el prototipo ya demostraba visualmente (mapa, movimiento WASD,
colisiones, proximidad simulada, salas, minimapa) todavía no está portado.

Lo que falta para cerrar Fase 0 según PRD 12 — y el orden importa: el PRD 13 marca
el WebRTC self-hosted como **riesgo #1 del proyecto**, así que va antes del port
del frontend.

1. ~~LiveKit self-hosted y Egress grabando a MinIO~~ — **hecho y validado**.
   Stack en `infra/livekit/`, grabación real verificada. Ver su README.
2. Colyseus: WebSocket de posición (hoy los NPCs del prototipo son simulados).
3. Port de `prototype/js/app.js` a módulos TypeScript y la UI DOM a React.
4. Conectar el cliente al SDK de LiveKit para audio/vídeo por proximidad real.

El detalle está en `TODOS.md`.
