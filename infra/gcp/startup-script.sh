#!/bin/bash
# Script de arranque de la VM. Lo ejecuta el agente de invitado de GCE como
# root en CADA arranque, asi que todo lo de aqui tiene que ser idempotente.
#
# Su unica responsabilidad es dejar la maquina en condiciones de correr
# `office-deploy`: instalar Docker, bajar los scripts que viajan en la metadata
# de la instancia y programar el vigilante del certificado. El despliegue en si
# lo hace `office-deploy`, que tambien invoca el workflow de CI por SSH.
#
# Los ficheros de configuracion viajan por metadata en vez de clonarse desde
# git para que la VM no necesite credenciales de git ni acceso de salida a
# GitHub, y para que cambiarlos sea un `terraform apply`.

set -euo pipefail

METADATA="http://metadata.google.internal/computeMetadata/v1/instance/attributes"

metadata() {
  curl -fsS -H 'Metadata-Flavor: Google' "${METADATA}/$1"
}

log() {
  echo "[office-startup] $*"
}

# --- Dependencias del propio despliegue ------------------------------------

# `office-deploy` decodifica con python3 las respuestas JSON del servidor de
# metadata y de Secret Manager. Va suelto y no dentro del bloque de Docker
# porque ese bloque solo corre en el primer arranque.
if ! command -v python3 >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq python3
fi

# --- Docker ----------------------------------------------------------------

# El repositorio oficial de Docker y no el `docker.io` de Debian 12: aquel
# paquete se quedo en una version sin el plugin `compose` v2, y este stack se
# describe entero con un fichero compose.
if ! command -v docker >/dev/null 2>&1; then
  log "instalando Docker desde el repositorio oficial"

  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg python3

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    >/etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

systemctl enable --now docker

# --- Scripts de operacion --------------------------------------------------

install -d -m 0755 /opt/office

metadata office-deploy-script >/usr/local/bin/office-deploy
chmod 0755 /usr/local/bin/office-deploy

metadata office-cert-script >/usr/local/bin/office-cert-watch
chmod 0755 /usr/local/bin/office-cert-watch

# Caddy renueva los certificados solo, pero LiveKit lee el suyo del disco una
# vez al arrancar: sin este vigilante el TURN sobre TLS empezaria a servir un
# certificado caducado a los ~60 dias, en silencio. El temporizador compara el
# fichero con la copia que LiveKit tiene cargada y solo reinicia si cambio.
cat >/etc/systemd/system/office-cert-watch.service <<'UNIT'
[Unit]
Description=Reinicia LiveKit cuando Caddy renueva su certificado
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/office-cert-watch
UNIT

cat >/etc/systemd/system/office-cert-watch.timer <<'UNIT'
[Unit]
Description=Comprobacion periodica del certificado de LiveKit

# Cada 15 minutos y no una vez al dia. La renovacion sola se conformaria con
# una comprobacion diaria, pero el caso urgente es el primer despliegue:
# LiveKit arranca antes de que Caddy termine de emitir el certificado, y hasta
# que no se le reinicie el TURN sobre TLS esta caido sin dar ninguna senal.
# Con cadencia diaria eso duraria hasta 24 horas.
[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now office-cert-watch.timer

# --- Despliegue ------------------------------------------------------------

# Sin `set -e` sobre esta llamada: en el primer arranque todavia no hay
# imagenes publicadas y `office-deploy` termina sin levantar nada. Que eso
# marque el arranque como fallido solo generaria ruido en los logs.
log "ejecutando office-deploy"
/usr/local/bin/office-deploy || log "office-deploy termino con error; revisar con: journalctl -u google-startup-scripts"

log "arranque completado"
