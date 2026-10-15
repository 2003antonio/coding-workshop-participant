#!/usr/bin/env bash
# Script: Seed the demo organisation into the CLOUD database
# Purpose: The cloud database only accepts connections from the Lambdas, so the
#          seed runs inside the auth Lambda (direct invoke, never the public URL)
# Usage: ./scripts/seed-cloud.sh [--reset] [--bulk]   (after ./bin/deploy-backend.sh aws)
#        --bulk  also adds the large demo: 500 people, 30 teams, 210 projects
#        --reset first removes ALL demo data and anything made with it (refused if
#                any account is outside the demo domain), then seeds again
#
# Passwords come from DEMO_ADMIN_PASSWORD, DEMO_MANAGER_PASSWORD and
# DEMO_EMPLOYEE_PASSWORD (environment, or the repo's .env.local), each at least
# 12 characters. They are never printed. Idempotent: each demo already present
# is left unchanged.

set -euo pipefail

BULK=false
RESET=false
for arg in "$@"; do
    case "$arg" in
        --bulk) BULK=true ;;
        --reset) RESET=true ;;
        *) echo "Usage: $0 [--reset] [--bulk]" >&2; exit 2 ;;
    esac
done

# Resolve script directory and project root paths
SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 || exit 1; pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." > /dev/null 2>&1 || exit 1; pwd -P)"

# A variable from the environment, else from .env.local (surrounding quotes removed)
value() {
    if [ -n "${!1:-}" ]; then printf '%s' "${!1}"; return; fi
    grep -E "^$1=" "$PROJECT_ROOT/.env.local" 2>/dev/null | head -1 | cut -d= -f2- \
        | sed -e 's/^"//' -e 's/"$//'
}

# Fresh workshop credentials (they expire), as the deploy scripts do
"$PROJECT_ROOT/bin/setup-participant.sh" > /dev/null
source "$PROJECT_ROOT/ENVIRONMENT.config"
export AWS_PAGER=""
export AWS_REGION=${AWS_REGION:-us-east-1}
FUNCTION="coding-workshop-auth-$PARTICIPANT_ID"

PAYLOAD=$(mktemp)
RESULT=$(mktemp)
trap 'rm -f "$PAYLOAD" "$RESULT"' EXIT
chmod 600 "$PAYLOAD"
jq -n --arg a "$(value DEMO_ADMIN_PASSWORD)" --arg m "$(value DEMO_MANAGER_PASSWORD)" \
      --arg e "$(value DEMO_EMPLOYEE_PASSWORD)" --argjson bulk "$BULK" --argjson reset "$RESET" \
      '{action: "seed_demo", passwords: {admin: $a, manager: $m, employee: $e}, bulk: $bulk, reset: $reset}' > "$PAYLOAD"

echo "INFO: Seeding the demo through $FUNCTION..." >&2
aws lambda invoke --function-name "$FUNCTION" --cli-binary-format raw-in-base64-out \
    --payload "fileb://$PAYLOAD" --cli-read-timeout 310 "$RESULT" > /dev/null
jq . "$RESULT"
jq -e '.ok' "$RESULT" > /dev/null
