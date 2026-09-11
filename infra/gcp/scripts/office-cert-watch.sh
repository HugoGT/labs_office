#!/bin/bash
# Reinicia LiveKit cuando Caddy renueva el certificado de lk.*.
#
# Caddy renueva solo, pero LiveKit lee `cert_file`/`key_file` una unica vez, al
# arrancar: sin esto el TURN sobre TLS seguiria presentando el certificado
# viejo hasta el siguiente reinicio de la maquina, y el sintoma seria audio que
# no conecta solo para los usuarios detras de NAT simetrico. Un fallo tardio,
# parcial y silencioso, que es el peor tipo.
#
# Lo dispara office-cert-watch.timer cada 15 minutos. Reiniciar LiveKit corta
# las salas en curso, asi que solo se hace cuando el certificado del disco es
# mas nuevo que el proceso que lo tiene cargado.
#
# Se instala en /usr/local/bin desde la metadata de la instancia; el original
# vive en infra/gcp/scripts/office-cert-watch.sh.

set -euo pipefail

WORKDIR=/opt/office

if [[ ! -f "${WORKDIR}/.env" ]]; then
  exit 0
fi

LK_HOST="$(awk -F= '$1 == "LK_HOST" { print $2 }' "${WORKDIR}/.env")"
[[ -n "${LK_HOST}" ]] || exit 0

# El volumen de Caddy es un volumen con nombre; su ruta real en el host la sabe
# Docker, no nosotros. Preguntarsela evita hardcodear /var/lib/docker/volumes,
# que cambia si algun dia se mueve el data-root de Docker.
VOLUME="$(docker compose --project-directory "${WORKDIR}" config --format json 2>/dev/null |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["volumes"]["caddy-data"].get("name","labs-office_caddy-data"))' 2>/dev/null ||
  echo "labs-office_caddy-data")"

MOUNTPOINT="$(docker volume inspect --format '{{.Mountpoint}}' "${VOLUME}" 2>/dev/null || true)"
[[ -n "${MOUNTPOINT}" ]] || exit 0

CERT="${MOUNTPOINT}/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${LK_HOST}/${LK_HOST}.crt"
[[ -f "${CERT}" ]] || exit 0

# La condicion que importa no es "el certificado cambio" sino "LiveKit lleva
# cargado un certificado que ya no es el del disco". Se compara la fecha del
# fichero con la del arranque del contenedor, y eso cubre los dos casos con la
# misma regla:
#
#   - renovacion: Caddy reescribe el fichero y queda mas nuevo que el proceso
#   - primer despliegue: LiveKit arranca ANTES de que Caddy termine de negociar
#     el certificado con Let's Encrypt (tarda decenas de segundos), asi que
#     nace sin el y el fichero aparece despues
#
# El segundo caso es el peligroso porque no da ninguna senal: la aplicacion
# funciona entera y solo falla el audio de quien este detras de un NAT que
# obligue a pasar por TURN sobre TLS.
CONTAINER="$(docker compose --project-directory "${WORKDIR}" ps -q livekit 2>/dev/null || true)"
[[ -n "${CONTAINER}" ]] || exit 0

STARTED_AT="$(docker inspect --format '{{.State.StartedAt}}' "${CONTAINER}" 2>/dev/null || true)"
[[ -n "${STARTED_AT}" ]] || exit 0

started_epoch="$(date -d "${STARTED_AT}" +%s 2>/dev/null || echo 0)"
cert_epoch="$(stat -c %Y "${CERT}")"

# Margen de 30 s: docker inspect y stat no comparten reloj al segundo y un
# empate no debe provocar un reinicio en bucle.
if (( cert_epoch <= started_epoch + 30 )); then
  exit 0
fi

echo "[office-cert-watch] el certificado de ${LK_HOST} es mas reciente que el arranque de LiveKit, reiniciando"
docker compose --project-directory "${WORKDIR}" restart livekit
