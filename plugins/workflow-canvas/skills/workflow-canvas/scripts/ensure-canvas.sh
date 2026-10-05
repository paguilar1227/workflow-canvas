#!/usr/bin/env bash
# Make sure the Workflow Canvas server answers at $WFC_URL (default http://localhost:8790).
# Starts Docker Desktop and the workflow-canvas container when needed, then waits until /health answers.
# Progress goes to stderr; exits 0 when the canvas is ready and 1 (with the reason) when it cannot be started.
# Health probes use the 3 s timeout of the image's own HEALTHCHECK; the wait for the server ends on Docker's own verdicts
# (container unhealthy or stopped, or healthy while $WFC_URL still does not answer).
set -u
URL="${WFC_URL:-http://localhost:8790}"
NAME="${WFC_CONTAINER:-workflow-canvas}"
log() { printf '[workflow-canvas] %s\n' "$*" >&2; }
healthy() { curl -fsS --max-time 3 "$URL/health" >/dev/null 2>&1; }

healthy && exit 0

if ! command -v docker >/dev/null 2>&1; then
  log "Docker is not installed. Install Docker Desktop, then: git clone https://github.com/paguilar1227/workflow-canvas && cd workflow-canvas && docker compose up -d"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  log "Docker is not running; starting Docker Desktop (waits until it is ready)..."
  docker desktop start >/dev/null 2>&1
  if ! err="$(docker info 2>&1 >/dev/null)"; then
    log "Docker Desktop did not start: $(printf '%s\n' "$err" | grep -m 1 -i 'error' | sed 's/^ERROR: //')"
    log "Open Docker Desktop and resolve its error (quitting and reopening it often helps), then try again."
    exit 1
  fi
fi

repo="${WFC_REPO:-}"
if [ -z "$repo" ] && docker inspect "$NAME" >/dev/null 2>&1; then
  repo="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$NAME" 2>/dev/null)"
fi

if [ -n "$repo" ] && [ -f "$repo/docker-compose.yml" ]; then
  log "Starting the canvas with docker compose in $repo (waits for its healthcheck)..."
  docker compose -f "$repo/docker-compose.yml" up -d --wait >&2 || { log "docker compose up failed in $repo."; exit 1; }
elif docker inspect "$NAME" >/dev/null 2>&1; then
  log "Starting the $NAME container..."
  docker start "$NAME" >/dev/null || { log "docker start $NAME failed."; exit 1; }
else
  log "No $NAME container or checkout found. Clone https://github.com/paguilar1227/workflow-canvas and run docker compose up -d in it (or set WFC_REPO to your checkout)."
  exit 1
fi

until healthy; do
  state="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$NAME" 2>/dev/null || echo missing)"
  case "$state" in
    "running unhealthy"|exited*|dead*|missing) log "The canvas did not come up ($state). See: docker logs $NAME"; exit 1 ;;
    "running healthy") healthy && break; log "The $NAME container is healthy but $URL does not answer. Check WFC_URL (and WFC_PORT in docker-compose)."; exit 1 ;;
  esac
  sleep 1
done
log "Workflow Canvas is ready at $URL"
