#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}
CONFIG_DIR=${TANDOOR_MCP_CONFIG_DIR:-/config}

if [ "$(id -u)" = "0" ]; then
    mkdir -p "$CONFIG_DIR"
    chown -R "$PUID:$PGID" "$CONFIG_DIR"
    exec gosu "$PUID:$PGID" "$@"
fi

mkdir -p "$CONFIG_DIR" 2>/dev/null || true
if [ ! -w "$CONFIG_DIR" ]; then
    echo "tandoor-mcp: $CONFIG_DIR is not writable by uid $(id -u)." >&2
    echo "  Running with --user means the container cannot fix this itself." >&2
    echo "  Either chown the directory on the host:" >&2
    echo "      chown -R $(id -u):$(id -g) <your config dir>" >&2
    echo "  or drop --user and set PUID/PGID instead." >&2
    exit 1
fi

exec "$@"
