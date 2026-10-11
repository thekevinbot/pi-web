#!/usr/bin/env bash
# Mint a fresh study session on a running stack. Usage: study/dev/new-session.sh <state-dir> [base-url]
# Session creation is closed over HTTP, so this talks to sessiond's socket.
set -euo pipefail
STATE=$1 BASE=${2:-http://127.0.0.1:7710}
W=$STATE/workspace
SOCK=(--unix-socket "$STATE/sessiond.sock" -H 'content-type: application/json')
P=$(curl -fsS "$BASE/api/projects" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["id"])')
S=$(curl -fsS "${SOCK[@]}" -X POST -d "{\"cwd\": \"$W\"}" http://sessiond/sessions | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
curl -fsS "${SOCK[@]}" -X POST -d "{\"cwd\": \"$W\", \"text\": \"Continue the task.\"}" "http://sessiond/sessions/$S/prompt" > /dev/null
WS=$(curl -fsS "$BASE/api/projects/$P/workspaces" | python3 -c 'import json,sys; print(json.load(sys.stdin)["workspaces"][0]["id"])')
echo "$BASE/?project=$P&workspace=$WS&session=$S&view=chat"
