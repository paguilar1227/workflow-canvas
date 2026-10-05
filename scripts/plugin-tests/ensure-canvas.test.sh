#!/usr/bin/env bash
# Regression tests for plugins/workflow-canvas/skills/workflow-canvas/scripts/ensure-canvas.sh with stubbed docker and curl.
#   bash scripts/plugin-tests/ensure-canvas.test.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
script="${ENSURE_SCRIPT:-$here/../../plugins/workflow-canvas/skills/workflow-canvas/scripts/ensure-canvas.sh}"
fails=0

# run <name> <docker stub body> <expected exit> <expected stderr substring>
run() {
  local name="$1" body="$2" want_exit="$3" want_text="$4" dir out code
  dir="$(mktemp -d)"
  mkdir -p "$dir/bin" "$dir/repo"
  touch "$dir/repo/docker-compose.yml"
  printf '#!/usr/bin/env bash\nstate=%q\n%s\n' "$dir" "$body" > "$dir/bin/docker"
  printf '#!/usr/bin/env bash\n[ -f %q/up ]\n' "$dir" > "$dir/bin/curl"
  chmod +x "$dir/bin/docker" "$dir/bin/curl"
  out="$(PATH="$dir/bin:/usr/bin:/bin" WFC_REPO= bash "$script" 2>&1)"; code=$?
  if [ "$code" = "$want_exit" ] && printf '%s' "$out" | grep -qF -- "$want_text"; then echo "ok   $name"
  else echo "FAIL $name (exit $code, want $want_exit; wanted text: $want_text)"; printf '%s\n' "$out" | sed 's/^/     /'; fails=$((fails + 1)); fi
  rm -rf "$dir"
}

run "Docker Desktop reports started but the engine stays down" '
case "$1" in
  info) echo "Error response from daemon: Docker Desktop is unable to start" >&2; exit 1 ;;
  desktop) exit 0 ;;
  inspect) echo "Error response from daemon: Docker Desktop is unable to start" >&2; exit 1 ;;
esac' 1 "Docker Desktop did not start: Error response from daemon: Docker Desktop is unable to start"

run "a stopped container without a compose checkout is started" '
case "$1" in
  info) exit 0 ;;
  inspect) if [ "$2" = "-f" ]; then case "$3" in *working_dir*) echo "";; *) echo "running healthy";; esac; fi; exit 0 ;;
  start) touch "$state/up"; exit 0 ;;
esac' 0 "Workflow Canvas is ready"

run "a container with a compose checkout is started with docker compose" '
case "$1" in
  info) exit 0 ;;
  inspect) if [ "$2" = "-f" ]; then case "$3" in *working_dir*) echo "$state/repo";; *) echo "running healthy";; esac; fi; exit 0 ;;
  compose) touch "$state/up"; exit 0 ;;
esac' 0 "Starting the canvas with docker compose"

run "a container that turns unhealthy is reported, not waited on" '
case "$1" in
  info) exit 0 ;;
  inspect) if [ "$2" = "-f" ]; then case "$3" in *working_dir*) echo "";; *) echo "running unhealthy";; esac; fi; exit 0 ;;
  start) exit 0 ;;
esac' 1 "The canvas did not come up (running unhealthy)"

run "a healthy container on another port is reported, not waited on" '
case "$1" in
  info) exit 0 ;;
  inspect) if [ "$2" = "-f" ]; then case "$3" in *working_dir*) echo "";; *) echo "running healthy";; esac; fi; exit 0 ;;
  start) exit 0 ;;
esac' 1 "is healthy but"

run "no container and no checkout" '
case "$1" in
  info) exit 0 ;;
  inspect) exit 1 ;;
esac' 1 "No workflow-canvas container or checkout found"

[ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
