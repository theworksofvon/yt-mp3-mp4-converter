#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export MCP_TRANSCRIPT_DIR="${MCP_TRANSCRIPT_DIR:-${TMPDIR:-/tmp}/yt-transcript-mcp-cache}"

if ! command -v bun >/dev/null 2>&1; then
  printf 'youtube-transcript-mcp: Bun is missing. Run %s/scripts/setup.sh.\n' "$ROOT_DIR" >&2
  exit 1
fi

if ! command -v yt-dlp >/dev/null 2>&1; then
  printf 'youtube-transcript-mcp: yt-dlp is missing. Run %s/scripts/setup.sh.\n' "$ROOT_DIR" >&2
  exit 1
fi

if [ ! -d "$ROOT_DIR/node_modules" ]; then
  printf 'youtube-transcript-mcp: project dependencies are missing. Run %s/scripts/setup.sh.\n' "$ROOT_DIR" >&2
  exit 1
fi

exec bun "$ROOT_DIR/src/mcp.ts"
