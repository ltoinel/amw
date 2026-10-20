#!/usr/bin/env bash
#
# Single entry point to run Amazon Modern Widgets (AMW).
# Run `./start.sh --help` for the available modes.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT_DIR
readonly REQUIRED_NODE_MAJOR=24
readonly DEV_COMPOSE_FILE="docker/docker-compose.dev.yml"
readonly PROD_COMPOSE_FILE="docker/docker-compose.yml"

# Colors only on a terminal, so that logs and CI output stay readable
if [[ -t 1 ]]; then
  readonly RED=$'\033[0;31m' GREEN=$'\033[0;32m' YELLOW=$'\033[1;33m' BLUE=$'\033[0;34m' NC=$'\033[0m'
else
  readonly RED='' GREEN='' YELLOW='' BLUE='' NC=''
fi

info() { printf '%s==>%s %s\n' "$BLUE" "$NC" "$*"; }
success() { printf '%s✓%s %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%sWarning:%s %s\n' "$YELLOW" "$NC" "$*" >&2; }
die() {
  printf '%sError:%s %s\n' "$RED" "$NC" "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: ./start.sh [MODE] [OPTIONS]

Modes:
  local      Install dependencies if needed, build and start the server with
             Node.js on this machine (default mode).
  dev        Start the development environment in Docker (hot reload + Redis),
             in the foreground: http://localhost:8080/amw
  docker     Build and start the production stack in Docker (AMW + Redis),
             in the background: http://localhost:9080/item
  stop       Stop the dev and production Docker stacks (data volumes are kept).

Options:
  -e, --env NAME   local mode: configuration to load, i.e. config/NAME.yml
                   (sets NODE_ENV, default: production)
  -h, --help       Show this help.

Prerequisites:
  local          Node.js >= ${REQUIRED_NODE_MAJOR} and npm.
  dev, docker    Docker with Compose v2 ("docker compose" or "docker-compose").

Amazon credentials:
  local          In config/NAME.yml (copy config/sample.yml), or through the
                 environment variables listed in .env.example.
  dev, docker    In a .env file at the repository root (copy .env.example).

Examples:
  ./start.sh                     # local mode with config/production.yml
  ./start.sh local --env development
  ./start.sh dev
  ./start.sh docker
  ./start.sh stop
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required but was not found in PATH. $2"
}

check_node() {
  require_command node "Install Node.js ${REQUIRED_NODE_MAJOR} or later: https://nodejs.org/"
  require_command npm "npm is normally installed with Node.js."

  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if ((major < REQUIRED_NODE_MAJOR)); then
    die "Node.js >= ${REQUIRED_NODE_MAJOR} is required, found $(node --version)."
  fi
}

# Fills the COMPOSE array with the Compose v2 command. Compose v1 is rejected:
# the compose files rely on v2-only syntax (top-level `name`, optional env_file).
COMPOSE=()
detect_compose() {
  require_command docker "Install Docker: https://docs.docker.com/get-docker/"
  docker info >/dev/null 2>&1 \
    || die "the Docker daemon is not reachable. Start Docker (or check your permissions) and retry."

  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    local version
    version="$(docker-compose version --short 2>/dev/null || true)"
    [[ "${version#v}" =~ ^[2-9] ]] \
      || die "docker-compose ${version:-(unknown version)} is too old: Compose v2 is required. See https://docs.docker.com/compose/install/"
    COMPOSE=(docker-compose)
  else
    die "Docker Compose v2 is required. See https://docs.docker.com/compose/install/"
  fi
}

warn_if_no_env_file() {
  if [[ ! -f "$ROOT_DIR/.env" ]]; then
    warn "no .env file: the server starts but cannot query Amazon. Run 'cp .env.example .env' and fill in your credentials."
  fi
}

run_local() {
  local env_name="$1"
  check_node

  if [[ ! -f "config/${env_name}.yml" ]]; then
    die "config/${env_name}.yml not found. Create it with 'cp config/sample.yml config/${env_name}.yml' and fill in your settings, or pick another one with --env."
  fi

  # npm writes node_modules/.package-lock.json on install: reinstall only when
  # it is missing or older than the lock file
  if [[ ! -f node_modules/.package-lock.json || package-lock.json -nt node_modules/.package-lock.json ]]; then
    info "Installing dependencies (npm ci)"
    npm ci --no-audit --no-fund
  fi

  info "Building"
  npm run build

  # The widget is served from <projectDir>/dist: default to this checkout so
  # that configurations written for another location (e.g. the dev container)
  # work here; an explicit SERVER_PROJECT_DIR still wins
  export SERVER_PROJECT_DIR="${SERVER_PROJECT_DIR:-$ROOT_DIR/}"
  export NODE_ENV="$env_name"

  info "Starting AMW with config/${env_name}.yml (Ctrl+C to stop)"
  # exec so that Ctrl+C and SIGTERM reach Node.js and trigger its graceful shutdown
  exec node dist/main.js
}

run_dev() {
  detect_compose
  warn_if_no_env_file
  info "Starting the development environment (Ctrl+C to stop)"
  info "AMW will be available on http://localhost:${AMW_DEV_PORT:-8080}/amw/health"
  exec "${COMPOSE[@]}" -f "$DEV_COMPOSE_FILE" up --build
}

run_docker() {
  detect_compose
  warn_if_no_env_file
  info "Building and starting the production stack"
  "${COMPOSE[@]}" -f "$PROD_COMPOSE_FILE" up --build --detach
  "${COMPOSE[@]}" -f "$PROD_COMPOSE_FILE" ps
  success "AMW is starting on http://localhost:9080/item/health"
  printf '  Logs: %s -f %s logs -f\n' "${COMPOSE[*]}" "$PROD_COMPOSE_FILE"
  printf '  Stop: ./start.sh stop\n'
}

run_stop() {
  detect_compose
  info "Stopping the development environment"
  "${COMPOSE[@]}" -f "$DEV_COMPOSE_FILE" down
  info "Stopping the production stack"
  "${COMPOSE[@]}" -f "$PROD_COMPOSE_FILE" down
  success "Stopped (volumes kept; add -v to 'down' to remove them)"
}

main() {
  local mode="local"
  local env_name="production"

  if [[ $# -gt 0 && "$1" != -* ]]; then
    mode="$1"
    shift
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h | --help)
        usage
        exit 0
        ;;
      -e | --env)
        [[ $# -ge 2 && -n "$2" ]] || die "$1 requires a configuration name."
        env_name="$2"
        shift 2
        ;;
      *)
        die "unknown option: $1 (see ./start.sh --help)"
        ;;
    esac
  done

  # Configuration names become a file path and NODE_ENV: keep them simple
  [[ "$env_name" =~ ^[A-Za-z0-9_-]+$ ]] || die "invalid configuration name: $env_name"
  if [[ "$mode" != "local" && "$env_name" != "production" ]]; then
    warn "--env only applies to the local mode, ignored."
  fi

  # Every path in this script is relative to the repository root
  cd "$ROOT_DIR"

  case "$mode" in
    local) run_local "$env_name" ;;
    dev) run_dev ;;
    docker) run_docker ;;
    stop) run_stop ;;
    *) die "unknown mode: $mode (see ./start.sh --help)" ;;
  esac
}

main "$@"
