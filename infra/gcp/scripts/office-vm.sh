#!/bin/bash
# Manual control of the test VM, which the office-hours schedule stops at
# night and on weekends (see "VM schedule" in infra/gcp/README.md).
#
# Runs on a developer's machine with gcloud (and gh for `deploy`) logged in as
# someone who may start, stop and resize the instance. The decisions shared
# with the nightly job (heavy days, holds) go through tools/vm/vm.ts, so there
# is one implementation of them; this script only adds the interactive parts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
VM_TS="${REPO_ROOT}/tools/vm/vm.ts"

# Same names and defaults as the workflows (repository variables) and the
# Terraform defaults; the project is the one in terraform.tfvars.example.
export GCP_PROJECT_ID="${GCP_PROJECT_ID:-vaulted-channel-505114-f0}"
export GCP_ZONE="${GCP_ZONE:-us-central1-a}"
export GCP_INSTANCE="${GCP_INSTANCE:-labs-office-test}"
HEALTH_TIMEOUT_SECONDS="${OFFICE_VM_HEALTH_TIMEOUT:-600}"
DEFAULT_HOLD=2h
DEPLOY_HOLD=1h

usage() {
  cat <<EOF
usage: $(basename "$0") <command>

  status                          VM status, machine type, hold, heavy days and /health
  start [--for 2h] [--size TYPE]  resize (only while stopped), start, hold the VM
                                  against the nightly stop for --for (default ${DEFAULT_HOLD}),
                                  then wait for /health to answer 200
  stop [-y]                       stop the VM (asks first unless -y)
  heavy list                      upcoming heavy days (America/Lima)
  heavy add YYYY-MM-DD            run that day on e2-standard-8 (set the night before)
  heavy rm YYYY-MM-DD             back to e2-standard-4 that day
  deploy                          start the VM if needed, run deploy-test.yml and follow it

The hold only protects the VM from the nightly job: the schedule still stops
it at 20:00 on weekdays. The nightly job also sets the size of the next office
day, so a --size outlives one night at most.

Environment: GCP_PROJECT_ID (${GCP_PROJECT_ID}), GCP_ZONE (${GCP_ZONE}),
GCP_INSTANCE (${GCP_INSTANCE}), APP_HOST (derived from the static IP),
OFFICE_VM_HEALTH_TIMEOUT seconds (${HEALTH_TIMEOUT_SECONDS}).
EOF
}

die() {
  echo "office-vm: $*" >&2
  exit 1
}

gcloud_instance() {
  local verb="$1"
  shift
  gcloud compute instances "${verb}" "${GCP_INSTANCE}" --zone "${GCP_ZONE}" --project "${GCP_PROJECT_ID}" "$@"
}

vm_ts() {
  command -v node >/dev/null 2>&1 || die "node (24 or newer) is required"
  node "${VM_TS}" "$@"
}

vm_status() {
  gcloud_instance describe --format='value(status)'
}

vm_machine_type() {
  gcloud_instance describe --format='value(machineType.basename())'
}

# Same derivation as Terraform's local.app_host: sslip.io on the static IP.
app_host() {
  if [[ -n "${APP_HOST:-}" ]]; then
    echo "${APP_HOST}"
    return
  fi
  local ip
  ip="$(gcloud_instance describe --format='value(networkInterfaces[0].accessConfigs[0].natIP)')"
  [[ -n "${ip}" ]] || die "the instance has no external IP; set APP_HOST"
  echo "app.${ip//./-}.sslip.io"
}

health_code() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$1/health" 2>/dev/null || echo 000
}

wait_for_health() {
  local host="$1" deadline code
  deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  echo "waiting for https://${host}/health (up to ${HEALTH_TIMEOUT_SECONDS}s)"
  while ((SECONDS < deadline)); do
    code="$(health_code "${host}")"
    if [[ "${code}" == "200" ]]; then
      echo "/health: 200"
      return 0
    fi
    echo "/health: ${code}"
    sleep 10
  done
  die "/health did not answer 200 in ${HEALTH_TIMEOUT_SECONDS}s; see 'Diagnostico' in infra/gcp/README.md"
}

cmd_status() {
  [[ $# -eq 0 ]] || die "status takes no arguments"
  vm_ts status
  local host
  host="$(app_host)"
  echo "health: https://${host}/health -> $(health_code "${host}")"
}

# start_vm <hold> [size]: the hold goes first, so a nightly run between the
# start and the write can never stop the VM; it is harmless on a VM that
# stays stopped.
start_vm() {
  local hold="$1" size="${2:-}" status current=""
  status="$(vm_status)"
  case "${status}" in
    RUNNING | TERMINATED) ;;
    *) die "the VM is ${status}; try again in a minute" ;;
  esac

  if [[ -n "${size}" ]]; then
    current="$(vm_machine_type)"
    if [[ "${current}" != "${size}" ]]; then
      if [[ "${status}" == "RUNNING" ]]; then
        die "the VM is running as ${current}; resizing needs it stopped. Run '$(basename "$0") stop' first (it drops every live call)."
      fi
    fi
  fi

  vm_ts hold "${hold}"

  if [[ -n "${size}" && "${current}" != "${size}" ]]; then
    echo "resizing ${current} -> ${size}"
    gcloud_instance set-machine-type --machine-type "${size}"
  fi

  if [[ "${status}" == "RUNNING" ]]; then
    echo "already running; hold updated"
  else
    echo "starting ${GCP_INSTANCE}"
    gcloud_instance start
  fi
}

cmd_start() {
  local hold="${DEFAULT_HOLD}" size=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --for)
        [[ $# -ge 2 ]] || die "--for needs a duration, like 2h"
        hold="$2"
        shift 2
        ;;
      --size)
        [[ $# -ge 2 ]] || die "--size needs a machine type, like e2-standard-8"
        size="$2"
        shift 2
        ;;
      *) die "unknown argument to start: $1" ;;
    esac
  done
  if [[ -n "${size}" && ! "${size}" =~ ^e2-standard-(4|8)$ ]]; then
    die "--size must be e2-standard-4 or e2-standard-8, not ${size}"
  fi
  start_vm "${hold}" "${size}"
  local host
  host="$(app_host)"
  wait_for_health "${host}"
}

cmd_stop() {
  local yes=""
  case "${1:-}" in
    -y | --yes) yes=1 ;;
    "") ;;
    *) die "unknown argument to stop: $1" ;;
  esac
  if [[ -z "${yes}" ]]; then
    local answer
    read -r -p "Stop ${GCP_INSTANCE}? Every live call drops. [y/N] " answer
    [[ "${answer}" =~ ^[yY]$ ]] || die "not stopped"
  fi
  gcloud_instance stop
}

cmd_heavy() {
  case "${1:-}" in
    list | add | rm) vm_ts heavy "$@" ;;
    *) die "heavy takes list, add YYYY-MM-DD or rm YYYY-MM-DD" ;;
  esac
}

cmd_deploy() {
  [[ $# -eq 0 ]] || die "deploy takes no arguments"
  command -v gh >/dev/null 2>&1 || die "gh is required for deploy"
  # Started here so it boots while the workflow builds the images; the
  # workflow waits for the startup script before it deploys.
  start_vm "${DEPLOY_HOLD}"

  local since run_id=""
  cd "${REPO_ROOT}"
  since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  gh workflow run deploy-test.yml --ref main
  for _ in $(seq 1 30); do
    run_id="$(gh run list --workflow deploy-test.yml --event workflow_dispatch --limit 5 \
      --json databaseId,createdAt --jq "map(select(.createdAt >= \"${since}\")) | .[0].databaseId // empty")"
    [[ -n "${run_id}" ]] && break
    sleep 2
  done
  [[ -n "${run_id}" ]] || die "the workflow run did not show up; check 'gh run list --workflow deploy-test.yml'"
  gh run watch "${run_id}" --exit-status
}

main() {
  local command="${1:-}"
  [[ $# -gt 0 ]] && shift
  case "${command}" in
    status) cmd_status "$@" ;;
    start) cmd_start "$@" ;;
    stop) cmd_stop "$@" ;;
    heavy) cmd_heavy "$@" ;;
    deploy) cmd_deploy "$@" ;;
    -h | --help | help | "") usage ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
}

main "$@"
