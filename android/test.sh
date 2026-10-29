#!/usr/bin/env bash
# Verifies the JavaScript bridge and bundled noVNC engine.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/tests/bridge.test.mjs"
node "$SCRIPT_DIR/tests/bundle.test.mjs"
