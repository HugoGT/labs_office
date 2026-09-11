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

# `vite build` solo, no `pnpm build`. Los dos pasos de `tsc` que lleva ese
# script tienen `noEmit: true`: son comprobacion de tipos, no generan nada, y
# esa comprobacion ya la hace .github/workflows/ci.yml en cada push. Repetirla
# aqui alarga el build sin anadir ninguna garantia nueva.
RUN test -n "${VITE_COLYSEUS_URL}" || (echo "VITE_COLYSEUS_URL es obligatoria" >&2 && exit 1) \
  && pnpm exec vite build

FROM nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS runtime

# Caddy es quien termina TLS y comprime; esta capa solo entrega ficheros por la
# red interna del compose y nunca ve una peticion de internet directamente.
COPY infra/gcp/docker/web-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
