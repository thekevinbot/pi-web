#!/usr/bin/env bash
# Adversarial e2e for the study UI against a running study/dev/run.sh stack.
# Usage: study/dev/e2e/run.sh <landing-url> [chromium|firefox|webkit|all] [case,case]
# Session files are read from disk, so the stack's state dir is mounted at its own path.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
URL=$1 BROWSERS=${2:-all} CASES=${3:-}
STATE=$(dirname "$(curl -fsS "${URL%%/\?*}/api/projects" | sed 's/.*"path":"\([^"]*\)".*/\1/')")
OUT=${OUT:-/tmp/claude/ih-e2e-shots}
mkdir -p "$OUT"
docker build -q -t ih-study-e2e "$HERE" > /dev/null
[ "$BROWSERS" = all ] && BROWSERS="chromium firefox webkit"
for b in $BROWSERS; do
  docker run --rm --network host -v "$HERE:/e2e:ro" -v "$OUT:/out" -v "$STATE:$STATE:ro" \
    ih-study-e2e uv run -q --no-project --with playwright==1.47.0 python /e2e/suite.py "$URL" "$b" $CASES
done
