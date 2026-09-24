#!/usr/bin/env bash
# Prueba end-to-end de grabacion: publica video en una sala, la graba con Egress
# y confirma que el MP4 aterriza en el bucket de GCS de desarrollo (issues #5,
# #58; GCS_BUCKET y GCS_CREDENTIALS_FILE en .env). Es la validacion que el PRD
# pide como siguiente paso (riesgo #1: seccion 13).
#
#   ./test-recording.sh [nombre-de-sala]
#   DURACION=30 ./test-recording.sh
set -euo pipefail

cd "$(dirname "$0")"
[ -f .env ] || { echo "falta .env — copiar de .env.example"; exit 1; }
set -a; . ./.env; set +a
command -v gcloud >/dev/null || { echo "falta gcloud en el host (para comprobar el bucket)"; exit 1; }
[ -n "${GCS_BUCKET:-}" ] || { echo "falta GCS_BUCKET en .env (bucket de GCS de desarrollo)"; exit 1; }
[ -f "${GCS_CREDENTIALS_FILE:-}" ] || { echo "falta GCS_CREDENTIALS_FILE en .env (fichero ADC, ver README.md)"; exit 1; }

ROOM="${1:-sala-prueba}"
DUR="${DURACION:-20}"
CLI="livekit/livekit-cli:latest"
NET="$(docker network ls --format '{{.Name}}' | grep -E 'oficina.*_av$' | head -1)"
[ -n "$NET" ] || { echo "la red de compose no existe — 'docker compose up -d' primero"; exit 1; }

cli() {
  docker run --rm --network "$NET" \
    -e LIVEKIT_URL=http://livekit:7880 \
    -e LIVEKIT_API_KEY="$LIVEKIT_API_KEY" \
    -e LIVEKIT_API_SECRET="$LIVEKIT_API_SECRET" \
    "$CLI" "$@"
}

# Lists the bucket with the host gcloud (the same identity that set up the dev
# bucket). Egress itself uploads with the ADC file mounted by docker-compose.yml.
gcs_ls() {
  gcloud storage ls -l "$1"
}

PUB=""
EGRESS_ID=""
cleanup() {
  [ -n "$EGRESS_ID" ] && cli egress stop --id "$EGRESS_ID" >/dev/null || true
  [ -n "$PUB" ] && docker rm -f "$PUB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> 1/5 publicando video de prueba en la sala '$ROOM'"
PUB="$(docker run -d --network "$NET" \
  -e LIVEKIT_URL=http://livekit:7880 \
  -e LIVEKIT_API_KEY="$LIVEKIT_API_KEY" \
  -e LIVEKIT_API_SECRET="$LIVEKIT_API_SECRET" \
  "$CLI" room join --publish-demo --identity publicador "$ROOM")"

echo "==> 2/5 esperando que la sala tenga un publisher"
for i in $(seq 1 30); do
  if cli room list 2>/dev/null | grep -q "$ROOM"; then echo "    sala activa (${i}s)"; break; fi
  sleep 1
  [ "$i" -eq 30 ] && { echo "    la sala nunca aparecio"; docker logs "$PUB" | tail -20; exit 1; }
done

echo "==> 3/5 arrancando egress room-composite (${DUR}s)"
# El destino de subida va EN EL REQUEST, por cada file_output: la config de
# Egress no aplica un destino por defecto, y sin este bloque Egress intenta una
# "Local upload" a la raiz del filesystem y muere con permission denied.
# Sin `credentials`: Egress usa las Application Default Credentials de su
# contenedor, el fichero montado por docker-compose.yml (como hace el servidor).
# Prefijo `smoke/` para no mezclar estas pruebas con las grabaciones de la app.
REQ=$(ROOM="$ROOM" python3 -c '
import json, os
print(json.dumps({
    "room_name": os.environ["ROOM"],
    "layout": "grid",
    "file_outputs": [{
        "filepath": "smoke/" + os.environ["ROOM"] + "-{time}.mp4",
        "gcp": {"bucket": os.environ["GCS_BUCKET"]},
    }],
}))
')
EGRESS_ID="$(cli egress start --type room-composite "$REQ" 2>&1 | grep -oE 'EG_[A-Za-z0-9]+' | head -1)"
[ -n "$EGRESS_ID" ] || { echo "    egress no arranco"; exit 1; }
echo "    egress: $EGRESS_ID"

sleep "$DUR"

echo "==> 4/5 deteniendo egress"
# "egress stop" exige --id: pasarlo posicional falla, y silenciar ese fallo
# deja la grabacion corriendo para siempre sin subir nada.
cli egress stop --id "$EGRESS_ID"
EGRESS_ID=""
# Egress sube el archivo despues de cerrar el contenedor de grabacion.
sleep 8

echo "==> 5/5 verificando el MP4 en GCS (gs://$GCS_BUCKET/smoke/)"
LISTADO="$(gcs_ls "gs://$GCS_BUCKET/smoke/$ROOM-*")"
echo "$LISTADO"
echo "$LISTADO" | grep -q '\.mp4' || { echo "FALLO: no hay ningun mp4 en el bucket"; exit 1; }
echo "$LISTADO" | grep -qE '^ *0 +.*\.mp4' && { echo "FALLO: el mp4 pesa 0 B"; exit 1; }
echo "OK: grabacion subida a GCS"
