#!/bin/bash
# Friday meeting load test against the deployed LiveKit (#274, #287).
#
# Scenario (docs/labs-vm-capacity.md, "Planned stress test"): 60 people in one
# space. 1 presenter (camera, microphone, screen), 4 speakers (camera,
# microphone), 5 camera only, 50 viewers. Bots from `lk perf load-test` carry
# the volume; 2 or 3 real browsers in the same space add what bots cannot
# (a real 1080p screen share, TURN/TLS through Caddy).
#
# Bots generate the load from a temporary GCE VM, never from a laptop: a
# saturated generator or home uplink would look like a LiveKit failure. The
# VM and its firewall rule exist only between `generator up` and
# `generator down`.
#
# Credentials are read from Secret Manager on each call and reach the
# generator through ssh stdin, so they never sit on its disk or in its
# process arguments.

set -euo pipefail

export GCP_PROJECT_ID="${GCP_PROJECT_ID:-vaulted-channel-505114-f0}"
export GCP_ZONE="${GCP_ZONE:-us-central1-a}"
export GCP_INSTANCE="${GCP_INSTANCE:-labs-office-test}"
SECRET_PREFIX="${SECRET_PREFIX:-labs-office-test}"
GENERATOR="${LOADTEST_GENERATOR:-labs-loadtest-gen}"
GENERATOR_TYPE="${LOADTEST_GENERATOR_TYPE:-e2-standard-8}"
GENERATOR_TAG=labs-loadtest
GENERATOR_RULE=labs-loadtest-ssh-iap
LK_VERSION=2.19.0
OUT_DIR="${LOADTEST_OUT:-${HOME}/labs-loadtest}"

# Bot groups. lk makes the first --audio-publishers of the video publishers
# publish both; publishers are their own participants and subscribe to
# nothing (checked against a local LiveKit with lk 2.19.0), so 60
# subscribers stand for the 60 people receiving, the 10 who publish included.
VIDEO_PUBLISHERS=11 # presenter camera + screen stand-in, 4 speakers, 5 camera only
AUDIO_PUBLISHERS=5  # presenter + 4 speakers
SUBSCRIBERS=60

usage() {
  cat <<EOF
usage: $(basename "$0") <command>

  rooms                       active LiveKit rooms and their participants; a
                              space's room is office-livekit-space-<id>
  generator up                create the generator VM (${GENERATOR_TYPE}) and its IAP ssh rule
  generator down              delete both
  run --room NAME --phase P   run the bots from the generator for one phase
      [--duration 15m]        P is "no-recording" or "recording" (start the
      [--real-share]          recording from the app first); --real-share
                              drops the bot standing in for the screen share
                              because a real browser shares it
  sample --phase P            sample the office VM (CPU, load, docker stats)
      [--duration 15m]        every 10s; run it next to "run"

Results go to ${OUT_DIR} (LOADTEST_OUT).
Environment: GCP_PROJECT_ID (${GCP_PROJECT_ID}), GCP_ZONE (${GCP_ZONE}),
GCP_INSTANCE (${GCP_INSTANCE}), SECRET_PREFIX (${SECRET_PREFIX}).
EOF
}

die() {
  echo "meeting-load: $*" >&2
  exit 1
}

gc() {
  gcloud "$@" --project "${GCP_PROJECT_ID}"
}

secret() {
  gc secrets versions access latest --secret "${SECRET_PREFIX}-$1"
}

# Same derivation as Terraform: sslip.io on the office VM's static IP.
livekit_url() {
  local ip
  ip="$(gc compute instances describe "${GCP_INSTANCE}" --zone "${GCP_ZONE}" \
    --format='value(networkInterfaces[0].accessConfigs[0].natIP)')"
  [[ -n "${ip}" ]] || die "the office VM has no external IP"
  echo "https://lk.${ip//./-}.sslip.io"
}

# Parses --room/--phase/--duration/--real-share into globals.
parse_args() {
  ROOM="" PHASE="" DURATION=15m REAL_SHARE=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --room) ROOM="${2:-}"; shift 2 ;;
      --phase) PHASE="${2:-}"; shift 2 ;;
      --duration) DURATION="${2:-}"; shift 2 ;;
      --real-share) REAL_SHARE=1; shift ;;
      *) die "unknown option $1" ;;
    esac
  done
  case "${PHASE}" in
    no-recording | recording) ;;
    *) die "--phase must be no-recording or recording" ;;
  esac
}

result_file() {
  mkdir -p "${OUT_DIR}"
  echo "${OUT_DIR}/$(TZ=America/Lima date +%Y%m%d-%H%M)-${PHASE}-$1"
}

cmd_rooms() {
  LIVEKIT_URL="$(livekit_url)" LIVEKIT_API_KEY="$(secret livekit-api-key)" \
    LIVEKIT_API_SECRET="$(secret livekit-api-secret)" lk room list
}

cmd_generator_up() {
  # Its own tag, so the office VM's web and RTC rules never apply to it.
  if ! gc compute firewall-rules describe "${GENERATOR_RULE}" >/dev/null 2>&1; then
    gc compute firewall-rules create "${GENERATOR_RULE}" --network default \
      --direction INGRESS --allow tcp:22 --source-ranges 35.235.240.0/20 \
      --target-tags "${GENERATOR_TAG}"
  fi
  gc compute instances create "${GENERATOR}" --zone "${GCP_ZONE}" \
    --machine-type "${GENERATOR_TYPE}" --tags "${GENERATOR_TAG}" \
    --image-family debian-12 --image-project debian-cloud \
    --metadata startup-script="#!/bin/bash
set -e
cd /tmp
curl -fsSL -o lk.tgz https://github.com/livekit/livekit-cli/releases/download/v${LK_VERSION}/lk_${LK_VERSION}_linux_amd64.tar.gz
tar -xzf lk.tgz lk
install -m 0755 lk /usr/local/bin/lk"
  echo "waiting for lk on ${GENERATOR}"
  local tries=0
  until gc compute ssh "${GENERATOR}" --zone "${GCP_ZONE}" --tunnel-through-iap \
    --command 'lk --version' 2>/dev/null; do
    ((++tries < 30)) || die "lk did not appear on ${GENERATOR}; check its serial output"
    sleep 10
  done
}

cmd_generator_down() {
  gc compute instances delete "${GENERATOR}" --zone "${GCP_ZONE}" --quiet || true
  gc compute firewall-rules delete "${GENERATOR_RULE}" --quiet || true
}

cmd_run() {
  parse_args "$@"
  [[ -n "${ROOM}" ]] || die "--room is required; see 'rooms'"
  local video="${VIDEO_PUBLISHERS}" url out
  ((REAL_SHARE)) && video=$((video - 1))
  url="$(livekit_url)"
  out="$(result_file lk.log)"
  echo "bots: ${video} video, ${AUDIO_PUBLISHERS} audio, ${SUBSCRIBERS} subscribers in ${ROOM} for ${DURATION}"
  echo "log: ${out}"
  # vmstat in the background shows whether the generator itself saturated.
  # Secret values carry no trailing newline, so each gets one for `read`.
  printf '%s\n%s\n' "$(secret livekit-api-key)" "$(secret livekit-api-secret)" |
    gc compute ssh "${GENERATOR}" --zone "${GCP_ZONE}" --tunnel-through-iap --command "
set -e
read -r key; read -r sec
vmstat -n 10 > /tmp/vmstat.log & vm=\$!
LIVEKIT_URL='${url}' LIVEKIT_API_KEY=\"\$key\" LIVEKIT_API_SECRET=\"\$sec\" \
  lk perf load-test --room '${ROOM}' --identity-prefix 'load-${PHASE}' \
  --video-publishers ${video} --audio-publishers ${AUDIO_PUBLISHERS} \
  --subscribers ${SUBSCRIBERS} --video-resolution high --layout 4x4 \
  --simulate-speakers --num-per-second 2 --duration '${DURATION}'
kill \$vm
echo; echo 'Generator vmstat (us+sy is its CPU; keep it well under 100):'
cat /tmp/vmstat.log" 2>&1 | tee "${out}"
}

cmd_sample() {
  parse_args "$@"
  local out seconds
  out="$(result_file office-vm.log)"
  case "${DURATION}" in
    *m) seconds=$((${DURATION%m} * 60)) ;;
    *s) seconds="${DURATION%s}" ;;
    *) die "--duration takes minutes (15m) or seconds (90s)" ;;
  esac
  echo "sampling ${GCP_INSTANCE} for ${DURATION} into ${out}"
  gc compute ssh "${GCP_INSTANCE}" --zone "${GCP_ZONE}" --tunnel-through-iap --command "
end=\$((SECONDS + ${seconds}))
while ((SECONDS < end)); do
  echo \"== \$(TZ=America/Lima date +%H:%M:%S) load \$(cut -d' ' -f1-3 /proc/loadavg) \$(vmstat 1 2 | tail -1 | awk '{print \"idle \" \$15 \"%\"}')\"
  sudo docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}} net={{.NetIO}}'
  sleep 8
done" 2>&1 | tee "${out}"
}

command -v gcloud >/dev/null || die "gcloud is required"
case "${1:-}" in
  rooms) shift; command -v lk >/dev/null || die "lk is required locally"; cmd_rooms "$@" ;;
  generator)
    case "${2:-}" in
      up) cmd_generator_up ;;
      down) cmd_generator_down ;;
      *) usage; exit 1 ;;
    esac
    ;;
  run) shift; cmd_run "$@" ;;
  sample) shift; cmd_sample "$@" ;;
  -h | --help | help) usage ;;
  *) usage; exit 1 ;;
esac
