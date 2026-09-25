#!/bin/bash
# Despliega (o redespliega) el stack de la oficina virtual en esta VM.
#
#   office-deploy                 usa el tag ya desplegado, o el de la metadata
#   office-deploy <sha>           despliega ese tag de imagen
#
# Lo invocan dos cosas: el script de arranque de la VM y el workflow de
# despliegue por SSH sobre el tunel IAP. Es idempotente a proposito: los dos
# caminos hacen exactamente lo mismo, asi que un reinicio de la maquina
# reconstruye el estado sin intervencion.
#
# Se instala en /usr/local/bin desde la metadata de la instancia; el original
# vive en infra/gcp/scripts/office-deploy.sh.

set -euo pipefail

# Los secretos pasan por este proceso. `umask 077` para que cualquier fichero
# que se cree nazca sin permisos para el resto del sistema, y nunca `set -x`:
# la traza imprimiria las claves en el journal.
umask 077

METADATA="http://metadata.google.internal/computeMetadata/v1"
WORKDIR=/opt/office
ENV_FILE="${WORKDIR}/.env"

metadata() {
  curl -fsS -H 'Metadata-Flavor: Google' "${METADATA}/instance/attributes/$1"
}

log() {
  echo "[office-deploy] $*"
}

if [[ "$(id -u)" != "0" ]]; then
  echo "[office-deploy] tiene que correr como root (escribe ${ENV_FILE} y habla con el socket de Docker)" >&2
  exit 1
fi

# --- Configuracion ---------------------------------------------------------

PROJECT_ID="$(metadata office-project-id)"
REGISTRY="$(metadata office-registry)"
APP_HOST="$(metadata office-app-host)"
LK_HOST="$(metadata office-lk-host)"
# Issue #19. Sin `|| true` a proposito: Caddy no puede levantar el bloque de
# sitio turn.* sin este hostname, y un despliegue a medio configurar es peor
# que uno que aborta con un mensaje claro.
TURN_HOST="$(metadata office-turn-host)"
ACME_EMAIL="$(metadata office-acme-email)"
SECRET_KEY_NAME="$(metadata office-secret-key)"
SECRET_SECRET_NAME="$(metadata office-secret-secret)"
SECRET_DB_PASSWORD_NAME="$(metadata office-secret-db-password)"

# Directory database on Cloud SQL (issue #72). Host, database and user come
# from metadata written by the SAME `terraform apply` that created them, so
# they cannot drift from the instance. No `|| true`: this script and those
# keys travel together in that metadata, and a deploy without a database host
# would bring the server up with a DATABASE_URL pointing nowhere.
DB_HOST="$(metadata office-db-host)"
DB_NAME="$(metadata office-db-name)"
DB_USER="$(metadata office-db-user)"

# Correo que se promociona a superadmin en su primer inicio de sesion (issue
# #24). Sale de la metadata y no de Secret Manager porque no es un secreto: es
# una direccion de correo, exactamente el mismo criterio que AUTH_PROJECT_ID.
# Con `|| true` y vacio por defecto por la misma razon que aquel: que falte no
# puede tumbar el redespliegue de una VM anterior a este cambio.
BOOTSTRAP_SUPERADMIN_EMAIL="$(metadata office-bootstrap-superadmin-email || true)"

# Nombre del secreto con la clave de cuenta de servicio de Identity Platform.
# Opcional de verdad: la funcion de invitar cuentas puede no estar montada.
SECRET_IDENTITY_ADMIN_NAME="$(metadata office-secret-identity-admin || true)"

# El camino sin clave: el servidor pide el token al servidor de metadata con la
# identidad de esta VM. Existe porque la politica de organizacion
# 'constraints/iam.disableServiceAccountKeyCreation' puede impedir crear la
# clave de cuenta de servicio. Con `|| true` y vacio por defecto por lo mismo
# que las demas opcionales: que falte no puede tumbar el redespliegue de una VM
# anterior a este cambio.
IDENTITY_ADMIN_USE_METADATA="$(metadata office-identity-admin-from-metadata || true)"

# Proyecto de Identity Platform que firma los ID tokens (issue #8). Con `|| true`
# y vacio por defecto A PROPOSITO: si faltase y esto abortara, un redespliegue de
# una VM antigua moriria; y si en cambio se rellenase solo con PROJECT_ID, el
# servidor pasaria a exigir autenticacion sin que nadie lo haya pedido y dejaria
# fuera a todo el mundo hasta que existan cuentas. Vacio = como hasta ahora.
AUTH_PROJECT_ID="$(metadata office-auth-project-id || true)"

# Recordings bucket (issues #5, #58). From metadata and not Secret Manager: a
# bucket name is not a secret, the VM service account is what grants access.
# `|| true` and empty by default for the same reason as the optional values
# above: a VM from before this change must still redeploy, and an empty value
# only turns /recordings/* into 503 recording-not-configured.
RECORDING_GCS_BUCKET="$(metadata office-recording-bucket || true)"

# Precedencia del tag: argumento > variable de entorno > metadata > el que ya
# esta desplegado. La ultima opcion es la que hace que un reinicio de la VM no
# retroceda a una version vieja.
IMAGE_TAG="${1:-${IMAGE_TAG:-}}"
if [[ -z "${IMAGE_TAG}" ]]; then
  IMAGE_TAG="$(metadata office-image-tag || true)"
fi
if [[ -z "${IMAGE_TAG}" && -f "${ENV_FILE}" ]]; then
  IMAGE_TAG="$(awk -F= '$1 == "IMAGE_TAG" { print $2 }' "${ENV_FILE}")"
fi

install -d -m 0755 "${WORKDIR}"

metadata office-compose >"${WORKDIR}/docker-compose.yml"
metadata office-caddyfile >"${WORKDIR}/Caddyfile"
chmod 0644 "${WORKDIR}/docker-compose.yml" "${WORKDIR}/Caddyfile"

# CA of the Cloud SQL instance (issue #72), bind-mounted into colyseus as
# DATABASE_SSL_CA_FILE. Public, hence 0644 and not in the .env. Written in
# place, not through a temporary + mv: a single-file bind mount follows the
# inode, and a rename would leave the running container on the old file. An
# empty file would make every connection fail TLS verification, so it aborts
# here with a message that says where to look.
metadata office-db-server-ca >"${WORKDIR}/db-server-ca.pem"
chmod 0644 "${WORKDIR}/db-server-ca.pem"
if ! grep -q 'BEGIN CERTIFICATE' "${WORKDIR}/db-server-ca.pem"; then
  echo "[office-deploy] office-db-server-ca no contiene un certificado. Falta un terraform apply (ver infra/gcp/README.md)." >&2
  exit 1
fi

# Los hostnames salen de la IP, que no se conoce hasta que Terraform la
# reserva: por eso livekit.yaml es una plantilla y no un fichero literal.
#
# The checksum before and after tells the restart step at the end whether
# LiveKit must reread its config (see "LiveKit only reads livekit.yaml").
LIVEKIT_CONFIG_BEFORE="$(sha256sum "${WORKDIR}/livekit.yaml" 2>/dev/null || true)"
metadata office-livekit-config |
  sed -e "s/__LK_HOST__/${LK_HOST}/g" -e "s/__TURN_HOST__/${TURN_HOST}/g" \
    >"${WORKDIR}/livekit.yaml"
chmod 0644 "${WORKDIR}/livekit.yaml"
LIVEKIT_CONFIG_AFTER="$(sha256sum "${WORKDIR}/livekit.yaml")"

# --- Secretos --------------------------------------------------------------

ACCESS_TOKEN="$(
  curl -fsS -H 'Metadata-Flavor: Google' \
    "${METADATA}/instance/service-accounts/default/token" |
    python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin)["access_token"])'
)"

# Se habla con la API REST de Secret Manager en vez de instalar el SDK de
# gcloud entero en la VM: son dos llamadas, el token sale del servidor de
# metadata y asi la imagen de arranque no arrastra ~400 MB de CLI.
#
# Los valores no se exportan, no se imprimen y no pasan por ningun temporal
# aparte del .env que se escribe mas abajo.
secret_value() {
  curl -fsS -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    "https://secretmanager.googleapis.com/v1/projects/${PROJECT_ID}/secrets/$1/versions/latest:access" |
    python3 -c 'import base64,json,sys; sys.stdout.write(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode())'
}

# La lectura va a variables ANTES de escribir nada. Dentro de un `echo` la
# sustitucion de comandos no dispara `set -e` (el estado que cuenta es el del
# echo, siempre 0), asi que un fallo de Secret Manager habria escrito una clave
# vacia y el sintoma habria sido un 503 de /livekit/token horas despues. En una
# asignacion si aborta.
LIVEKIT_API_KEY="$(secret_value "${SECRET_KEY_NAME}")"
LIVEKIT_API_SECRET="$(secret_value "${SECRET_SECRET_NAME}")"
DB_PASSWORD="$(secret_value "${SECRET_DB_PASSWORD_NAME}")"

if [[ -z "${LIVEKIT_API_KEY}" || -z "${LIVEKIT_API_SECRET}" || -z "${DB_PASSWORD}" ]]; then
  echo "[office-deploy] Secret Manager devolvio un valor vacio. Falta anadir la version del secreto (ver infra/gcp/README.md)." >&2
  exit 1
fi

# Esta NO entra en el guardia de arriba, y es deliberado. Las claves de LiveKit
# vacias son siempre un fallo (sin ellas no hay audio para nadie); esta puede
# faltar legitimamente, porque la cuenta de servicio de Identity Platform es
# opcional y mientras no exista lo unico que se degrada es el endpoint que
# crea cuentas, que responde 503. Abortar el despliegue por esto tumbaria toda
# la oficina por una funcion que nadie ha pedido todavia.
#
# Por eso el `|| true`: si el secreto existe pero aun no tiene version, la
# lectura falla y aqui eso es un aviso, no el final del despliegue.
IDENTITY_ADMIN_CREDENTIALS=""
if [[ -n "${SECRET_IDENTITY_ADMIN_NAME}" ]]; then
  IDENTITY_ADMIN_CREDENTIALS="$(secret_value "${SECRET_IDENTITY_ADMIN_NAME}" || true)"
  if [[ -z "${IDENTITY_ADMIN_CREDENTIALS}" ]]; then
    log "aviso: ${SECRET_IDENTITY_ADMIN_NAME} no tiene valor todavia; invitar cuentas devolvera 503"
  else
    # Una clave de cuenta de servicio se descarga como JSON con saltos de linea.
    # Un valor multilinea rompe el .env (el compose leeria solo la primera
    # linea), asi que se compacta a una sola linea. Sigue siendo el MISMO JSON:
    # los saltos que van dentro de la clave privada quedan escapados como \n,
    # que es como el JSON los representa de todas formas.
    IDENTITY_ADMIN_CREDENTIALS="$(
      printf '%s' "${IDENTITY_ADMIN_CREDENTIALS}" |
        python3 -c 'import json,sys; sys.stdout.write(json.dumps(json.load(sys.stdin), separators=(",", ":")))'
    )"
  fi
fi

# La contrasena viaja dentro de una URL, asi que hay que escaparla: un `/`, un
# `@` o un `#` en el valor partirian la cadena de conexion por el sitio
# equivocado y el error seria "host desconocido", que no apunta aqui. El README
# recomienda generarla en hexadecimal (donde esto nunca haria falta), pero el
# valor lo pone un humano en Secret Manager y no se puede dar por supuesto.
#
# The host is the Cloud SQL private IP (issue #72). The same secret is the
# password Terraform set on the Cloud SQL user (password_wo in
# terraform/database.tf), so both sides read one value. Terraform trims it with
# `trimspace`; the strip here keeps both on the same bytes (`$(...)` alone only
# drops trailing newlines).
DB_PASSWORD_ENC="$(
  printf '%s' "${DB_PASSWORD}" |
    python3 -c 'import sys,urllib.parse; sys.stdout.write(urllib.parse.quote(sys.stdin.read().strip(), safe=""))'
)"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD_ENC}@${DB_HOST}:5432/${DB_NAME}"

# Se escribe a un temporal y se mueve: si algo falla a mitad, el .env anterior
# sigue intacto y el stack sigue en pie.
TMP_ENV="$(mktemp "${WORKDIR}/.env.XXXXXX")"
trap 'rm -f "${TMP_ENV}"' EXIT

{
  echo "# Generado por office-deploy. No editar a mano: se reescribe en cada despliegue."
  echo "APP_HOST=${APP_HOST}"
  echo "LK_HOST=${LK_HOST}"
  echo "TURN_HOST=${TURN_HOST}"
  echo "ACME_EMAIL=${ACME_EMAIL}"
  echo "REGISTRY=${REGISTRY}"
  echo "IMAGE_TAG=${IMAGE_TAG}"
  echo "LIVEKIT_API_KEY=${LIVEKIT_API_KEY}"
  echo "LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}"
  # No es un secreto: es el id del proyecto de GCP. No pasa por Secret Manager.
  echo "FIREBASE_PROJECT_ID=${AUTH_PROJECT_ID}"
  # Directorio de usuarios e invitaciones (issues #24, #72). Only the server
  # needs it now: there is no database container on this VM to configure.
  echo "DATABASE_URL=${DATABASE_URL}"
  # Tampoco es un secreto: es una direccion de correo. Mismo criterio que
  # FIREBASE_PROJECT_ID.
  echo "BOOTSTRAP_SUPERADMIN_EMAIL=${BOOTSTRAP_SUPERADMIN_EMAIL}"
  # Vacia mientras no haya cuenta de servicio de Identity Platform. El servidor
  # arranca igual y solo el endpoint de invitar responde 503.
  echo "IDENTITY_ADMIN_CREDENTIALS=${IDENTITY_ADMIN_CREDENTIALS}"
  # La alternativa a la anterior cuando la clave no se puede crear. No es un
  # secreto: es un interruptor. Si estan las dos, el servidor usa la clave.
  echo "IDENTITY_ADMIN_USE_METADATA=${IDENTITY_ADMIN_USE_METADATA}"
  # Not a secret either: the bucket name. Empty disables recording (503).
  echo "RECORDING_GCS_BUCKET=${RECORDING_GCS_BUCKET}"
} >"${TMP_ENV}"

chown root:root "${TMP_ENV}"
chmod 0600 "${TMP_ENV}"
mv "${TMP_ENV}" "${ENV_FILE}"
trap - EXIT

# --- Arranque --------------------------------------------------------------

if [[ -z "${IMAGE_TAG}" ]]; then
  log "sin tag de imagen todavia: configuracion escrita, nada que levantar"
  log "esto es lo normal en el primer arranque, antes del primer despliegue"
  exit 0
fi

# Credenciales de Artifact Registry derivadas del token de la cuenta de servicio
# de la VM. Caducan en una hora, que es justo lo que dura el despliegue: no hay
# ninguna credencial persistente en la maquina.
echo "${ACCESS_TOKEN}" |
  docker login -u oauth2accesstoken --password-stdin "https://${REGISTRY%%/*}" >/dev/null

# La imagen de Caddy la construye este repositorio desde el issue #19. Rodar
# IMAGE_TAG por debajo del commit que anadio ese paso apunta a un tag que nunca
# se publico: `docker compose pull` aborta, y como el resto del script muere con
# el, la "vuelta atras" no ocurre y los contenedores viejos siguen en pie sin
# que nadie lo anuncie. Se comprueba antes para que el fallo diga que hacer.
if ! docker manifest inspect "${REGISTRY}/caddy:${IMAGE_TAG}" >/dev/null 2>&1; then
  echo "[office-deploy] no existe ${REGISTRY}/caddy:${IMAGE_TAG}." >&2
  echo "[office-deploy] volver atras de un cambio de CONFIGURACION no es esto:" >&2
  echo "[office-deploy]   1) terraform apply desde el commit antiguo (reescribe la metadata)" >&2
  echo "[office-deploy]   2) office-deploy <sha-antiguo>" >&2
  exit 1
fi

log "desplegando ${IMAGE_TAG}"
docker compose --project-directory "${WORKDIR}" pull --quiet
docker compose --project-directory "${WORKDIR}" up -d --remove-orphans

# Caddy no vigila su fichero de configuracion. El Caddyfile entra por bind mount
# y la definicion del servicio no cambia entre despliegues, asi que `up -d` no
# recrea el contenedor y Caddy sigue sirviendo la configuracion que leyo al
# arrancar. Sin esta recarga, una ruta nueva del servidor NO existe aunque su
# `handle` ya este escrito en el fichero: cae en el `handle` final, nginx
# responde el index.html y el navegador recibe un 200 con HTML donde esperaba
# JSON. Eso es exactamente lo que dejo `/admin/*` invisible durante dias.
#
# `caddy reload` es en caliente: no corta conexiones vivas ni reemite
# certificados. El `restart` de reserva cubre el caso de que el contenedor este
# parado, donde `exec` no puede entrar; si tampoco eso funciona, el despliegue
# falla, que es mejor que anunciar como desplegada una configuracion que nadie
# esta sirviendo.
log "recargando la configuracion de Caddy"
docker compose --project-directory "${WORKDIR}" exec -T caddy \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile ||
  docker compose --project-directory "${WORKDIR}" restart caddy

# LiveKit only reads livekit.yaml at startup and has no reload. Like the
# Caddyfile, it enters by bind mount, so `up -d` keeps the old process and the
# old config. That is what left recording dead after #5/#58: the new file had
# the `redis` section, LiveKit kept "single-node routing", and every
# StartEgress timed out because Egress listens on Redis. A restart drops every
# live call, so it happens only when the file actually changed.
if [[ "${LIVEKIT_CONFIG_BEFORE}" != "${LIVEKIT_CONFIG_AFTER}" ]]; then
  log "livekit.yaml changed: restarting LiveKit"
  docker compose --project-directory "${WORKDIR}" restart livekit
fi

# Las imagenes viejas se acumulan una por despliegue y el disco son 20 GB.
docker image prune -af --filter "until=168h" >/dev/null || true

log "desplegado ${IMAGE_TAG}"
docker compose --project-directory "${WORKDIR}" ps
