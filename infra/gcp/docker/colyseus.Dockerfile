# Imagen del servidor Colyseus. El contexto de build es la RAIZ del repo:
#
#   docker build -f infra/gcp/docker/colyseus.Dockerfile -t ... .
#
# Se envian los .ts y los ejecuta Node borrando tipos, sin paso de compilacion.
# No es una preferencia: tsconfig.server.json tiene `noEmit: true`, asi que
# `tsc -p tsconfig.server.json` (el que corre `pnpm build`) es una comprobacion
# de tipos y NO produce ningun JavaScript que copiar. El proyecto ya se ejecuta
# asi en local y en los tests (`pnpm server` es `node server/src/main.ts`), y de
# ahi vienen tambien `allowImportingTsExtensions` y los imports con extension
# `.ts` explicita que se ven en server/src.

FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS deps

# Corepack instala exactamente la version del campo `packageManager` de
# package.json (pnpm 11.1.3), en vez de la ultima que hubiera publicada.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

# pnpm-workspace.yaml no es opcional: ahi viven los `overrides` (entre otros, el
# pin de @colyseus/core a 0.16.24 porque la 0.16.25 se publico rota) y en pnpm
# 11 ya no se leen desde package.json.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# `--prod` deja fuera las herramientas de build y de test. Sigue instalando
# dependencias de cliente (Phaser, React) porque en este repo viven en el mismo
# bloque `dependencies`; son unos MB de sobra en la imagen y ningun fichero que
# Node vaya a cargar, asi que no se enreda el package.json para ahorrarlos.
#
# `--ignore-scripts`: ningun paquete de produccion necesita compilar nada aqui
# (msgpackr-extract ya esta desactivado en pnpm-workspace.yaml) y ejecutar
# scripts de terceros durante el build es superficie de ataque gratis.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS runtime

ENV NODE_ENV=production
WORKDIR /app

# node_modules se copia entero, incluido .pnpm: los enlaces que crea pnpm son
# relativos y sobreviven a la copia.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

# Las dos mitades del servidor. server/src importa dos modulos compartidos de
# src/game (officeProtocol.ts y mapData.ts), que no tienen dependencias propias.
COPY server/src ./server/src
COPY src/game ./src/game

# La imagen base ya trae el usuario `node` (uid 1000). El servidor no escribe en
# disco ni abre puertos privilegiados, asi que no hay ninguna razon para que
# corra como root.
USER node

EXPOSE 2567

# Golpea la misma ruta que el chequeo posterior al despliegue
# (server/src/createOfficeServer.ts). Sin `curl` en la imagen: fetch es global
# en Node 24 y asi la base se queda sin herramientas de red extra.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 2567) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/src/main.ts"]
