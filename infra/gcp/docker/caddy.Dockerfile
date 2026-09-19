# Imagen de Caddy con el modulo layer4 (issue #19). El contexto de build es la
# RAIZ del repo, igual que las otras dos:
#
#   docker build -f infra/gcp/docker/caddy.Dockerfile -t ... .
#
# Hasta el #19 este servicio usaba la imagen oficial `caddy:2.11-alpine`
# directamente. El multiplexado de TURN/TLS sobre el 443 necesita el modulo
# caddy-l4, que no viene en ninguna imagen oficial, y la alternativa publicada
# (livekit/caddyl4) no acepta Caddyfile: solo JSON/YAML. Adoptarla obligaria a
# traducir todo el enrutado comentado a mano de infra/gcp/Caddyfile a la
# configuracion nativa, sin ganar nada a cambio.
#
# Las tres versiones van CLAVADAS a proposito. `@master` en xcaddy haria que
# dos builds del mismo commit produjeran binarios distintos, que es justo lo
# que el etiquetado por SHA existe para impedir.

# 2.11.4 y no una version menor: caddy-l4@v0.1.2 declara en su propio go.mod
# que necesita caddy/v2@v2.11.4 (comprobado al escribir este fichero
# intentando construir con 2.11.2 primero: xcaddy fallo con "requires
# github.com/caddyserver/caddy/v2@v2.11.4, but v2.11.2 is requested"). Bajar
# esta version sin bajar tambien la de caddy-l4 rompe el build, no en
# silencio: el propio `go get` de xcaddy lo rechaza.
ARG CADDY_VERSION=2.11.4

FROM caddy:${CADDY_VERSION}-builder-alpine@sha256:7a05631b5e68fa24cfda0d4392b9c8577715c855b9b9da84b1b59be87e535405 AS builder

# caddy-l4 SI publica tags semver (verificado en el propio repositorio al
# escribir este fichero: v0.1.2 es la ultima, exactamente en el commit mas
# reciente de main). Se fija el tag y no un commit suelto porque un tag es
# mas facil de leer y de auditar en una revision, y sigue siendo tan
# reproducible como un hash: git no permite mover un tag sin que el sha
# cambie de sitio de forma visible.
RUN xcaddy build \
    --with github.com/mholt/caddy-l4@v0.1.2

FROM caddy:${CADDY_VERSION}-alpine@sha256:040e9f7480b80b6d4a7e5013a21159b950a63dcbdb956e38abe2387fb28d9ec0

# Solo el binario. El resto de la imagen oficial (entrypoint, /etc/caddy,
# usuario) se queda tal cual, asi que el contenedor arranca exactamente igual
# que antes de este cambio.
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
