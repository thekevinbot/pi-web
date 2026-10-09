#!/usr/bin/env bash
# Local study UI: the built fork, Laith's checkpoint extension, and a stub model.
# Usage: study/dev/run.sh   (run `pnpm build` first). Prints the landing link.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
IH_REPO=${IH_REPO:-$ROOT/../invisible-hands}
IH_REF=${IH_REF:-origin/feat/session-recording-harness}
STATE=${STATE:-$(mktemp -d /tmp/claude/ih-dev.XXXXXX)}
HOST=${HOST:-127.0.0.1}
PORT=${PORT:-7710}
STUB_PORT=${STUB_PORT:-4011}
API=http://$HOST:$PORT/api

mkdir -p "$STATE"/{agent/extensions,data,config,workspace}
cp -r "$HERE/workspace/." "$STATE/workspace/"

git -C "$IH_REPO" archive "$IH_REF" session-recording/pi-extension-checkpoint/src session-recording/pi-extension-checkpoint/package.json \
  | tar -x -C "$STATE" --strip-components=1
mv "$STATE/pi-extension-checkpoint" "$STATE/agent/extensions/checkpoint"
patch -s -d "$STATE/agent/extensions/checkpoint" -p1 < "$HERE/pick-by-id.patch"

cat > "$STATE/agent/models.json" <<EOF
{"providers": {"study": {"baseUrl": "http://127.0.0.1:$STUB_PORT/v1", "api": "openai-completions", "apiKey": "none",
  "models": [{"id": "stub", "name": "Agent", "contextWindow": 200000, "maxTokens": 8192}]}}}
EOF
cat > "$STATE/agent/settings.json" <<EOF
{"defaultProvider": "study", "defaultModel": "stub", "defaultThinkingLevel": "off", "compaction": {"enabled": false}}
EOF
cat > "$STATE/data/pi-package-dismissals.json" <<EOF
{"dismissals": [{"profileDir": "$STATE/agent", "packageId": "@jmfederico/pi-relay", "dismissedAt": "2026-10-09T00:00:00.000Z"}]}
EOF
cat > "$STATE/config/config.json" <<EOF
{"spawnSessions": false, "askUser": false, "extensionDialogsTimeoutMs": 0,
  "plugins": {"git": {"enabled": false}, "info": {"enabled": false}, "updates": {"enabled": false}, "workspace-tasks": {"enabled": false}},
  "serverPlugins": {"safeStart": "none"}}
EOF

export PI_CODING_AGENT_DIR=$STATE/agent PI_WEB_DATA_DIR=$STATE/data PI_WEB_CONFIG=$STATE/config/config.json \
  PI_WEB_HOST=$HOST PI_WEB_PORT=$PORT PI_WEB_SESSIOND_SOCKET=$STATE/sessiond.sock PI_WEB_SKIP_VERSION_CHECK=1 PI_WEB_OFFLINE=1

trap 'kill 0' EXIT
STUB_PORT=$STUB_PORT python3 -u "$HERE/stub-backend.py" > "$STATE/stub.log" 2>&1 &
node "$ROOT/dist/server/sessiond.js" > "$STATE/sessiond.log" 2>&1 &
node "$ROOT/dist/server/index.js" > "$STATE/web.log" 2>&1 &
until curl -fsS "$API/sessiond/health" > /dev/null 2>&1; do sleep 0.5; done

W=$STATE/workspace
project=$(curl -fsS -X POST -H 'content-type: application/json' -d "{\"path\": \"$W\"}" "$API/projects")
session=$(curl -fsS -X POST -H 'content-type: application/json' -d "{\"cwd\": \"$W\"}" "$API/sessions")
P=$(sed 's/.*"id":"\([^"]*\)".*/\1/' <<< "$project")
S=$(sed 's/^{"id":"\([^"]*\)".*/\1/' <<< "$session")
curl -fsS -X POST -H 'content-type: application/json' -d "{\"cwd\": \"$W\", \"text\": \"Continue the task.\"}" \
  "$API/machines/local/sessions/$S/prompt" > /dev/null
WS=$(curl -fsS "$API/projects/$P/workspaces" | sed 's/.*"workspaces":\[{"id":"\([^"]*\)".*/\1/')
echo "http://$HOST:$PORT/?project=$P&workspace=$WS&session=$S&view=chat"
wait
