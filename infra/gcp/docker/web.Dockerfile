# Imagen del SPA ya construido. El contexto de build es la RAIZ del repo:
#
#   docker build -f infra/gcp/docker/web.Dockerfile \
#     --build-arg VITE_COLYSEUS_URL=wss://app.<ip-con-guiones>.sslip.io -t ... .
#
# VITE_COLYSEUS_URL es OBLIGATORIA en este build. Sin ella el cliente deduce el
# endpoint como ws://<host-actual>:2567 (src/game/officeEndpoint.ts), y el 2567
# ni esta publicado en la VM ni pasa por Caddy: el multijugador fallaria en
# silencio y cada usuario acabaria en una oficina para el solo.
#
# VITE_LIVEKIT_URL, en cambio, NO se hornea a proposito. Es solo un override de
# desarrollo; en produccion la URL del SFU la devuelve el servidor dentro de la
# respuesta de /livekit/token y el cliente usa esa
# (src/game/livekitEndpoint.ts). Hornearla duplicaria la fuente de verdad.
#
# VITE_FIREBASE_API_KEY y VITE_FIREBASE_PROJECT_ID (issue #8) tambien son
# OBLIGATORIAS: sin ellas el cliente se construye sin pantalla de login y
# cualquiera que alcance la web entra a la oficina. El servidor las rechazaria
# despues, con su FIREBASE_PROJECT_ID puesto, pero el usuario solo veria una
# oficina rota sin saber por que. Fallar aqui, en el build, es mas barato.
#
# La apiKey no es un secreto: Firebase la publica en el bundle por diseno y no
# autoriza nada por si sola. Quien decide quien entra son las cuentas del
# proyecto y la verificacion del ID token en server/src/verifyIdToken.ts.

FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS builder

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Instalacion completa (no `--prod`): Vite, el plugin de React y TypeScript son
# devDependencies y sin ellas no hay build.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

ARG VITE_COLYSEUS_URL
ENV VITE_COLYSEUS_URL=${VITE_COLYSEUS_URL}

ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY}
ENV VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID}
ENV VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN}

# `vite build` solo, no `pnpm build`. Los dos pasos de `tsc` que lleva ese
# script tienen `noEmit: true`: son comprobacion de tipos, no generan nada, y
# esa comprobacion ya la hace .github/workflows/ci.yml en cada push. Repetirla
# aqui alarga el build sin anadir ninguna garantia nueva.
# Encadenar los `test` con `||`/`&&` en una sola linea imprimiria el mensaje del
# ultimo fallo, no el del primero: `&&` y `||` tienen la misma precedencia y
# asocian a izquierdas. Un `if` por variable dice exactamente cual falta.
#
# Las dos VITE_FIREBASE_* son todo o nada, no obligatorias: ninguna construye el
# SPA sin login (el modo de siempre) y las dos lo construyen con login. Definir
# solo una si es un error, y de los caros: el cliente se quedaria sin poder
# autenticar contra un servidor que quiza si exige token, y el sintoma seria una
# oficina vacia sin ningun mensaje.
RUN set -eu; \
  if [ -z "${VITE_COLYSEUS_URL:-}" ]; then echo "VITE_COLYSEUS_URL es obligatoria" >&2; exit 1; fi; \
  if [ -n "${VITE_FIREBASE_API_KEY:-}" ] && [ -z "${VITE_FIREBASE_PROJECT_ID:-}" ]; then \
    echo "VITE_FIREBASE_API_KEY sin VITE_FIREBASE_PROJECT_ID: define las dos o ninguna" >&2; exit 1; \
  fi; \
  if [ -n "${VITE_FIREBASE_PROJECT_ID:-}" ] && [ -z "${VITE_FIREBASE_API_KEY:-}" ]; then \
    echo "VITE_FIREBASE_PROJECT_ID sin VITE_FIREBASE_API_KEY: define las dos o ninguna" >&2; exit 1; \
  fi; \
  if [ -z "${VITE_FIREBASE_API_KEY:-}" ]; then \
    echo "AVISO: sin VITE_FIREBASE_*, el SPA se construye sin pantalla de login" >&2; \
  fi; \
  pnpm exec vite build

FROM nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS runtime

# Caddy es quien termina TLS y comprime; esta capa solo entrega ficheros por la
# red interna del compose y nunca ve una peticion de internet directamente.
COPY infra/gcp/docker/web-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
