#!/usr/bin/env bash
# Script: Copy backend/common into every backend service folder before deploy
# Purpose: Keep one source of shared code; per-service copies are gitignored
# Usage: ./scripts/sync-common.sh

set -euo pipefail

# Resolve script directory and project root paths
SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 || exit 1; pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." > /dev/null 2>&1 || exit 1; pwd -P)"
BACKEND_DIR="$PROJECT_ROOT/backend"
COMMON_DIR="$BACKEND_DIR/common"

if [ ! -d "$COMMON_DIR" ]; then
    echo "ERROR: $COMMON_DIR not found"
    exit 1
fi

# A service is a direct child of backend/ with function.py, not prefixed with _ or .
shopt -s nullglob
for fn in "$BACKEND_DIR"/*/function.py; do
    svc_dir="$(dirname "$fn")"
    svc_name="$(basename "$svc_dir")"
    case "$svc_name" in
        _*|.*|common) continue ;;
    esac

    # Replace the whole copy so files removed from common are removed here too.
    # Tests and bytecode caches are never copied into a deployable service.
    rm -rf "${svc_dir:?}/common"
    mkdir -p "$svc_dir/common"
    tar -C "$COMMON_DIR" --exclude=tests --exclude=__pycache__ -cf - . \
        | tar -C "$svc_dir/common" -xf -
    echo "  synced common -> backend/$svc_name/common"
done
shopt -u nullglob
