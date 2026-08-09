#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

WHISPER_MODEL="${WHISPER_MODEL:-base.en}"
WHISPER_MODEL_DIR="${WHISPER_MODEL_DIR:-$ROOT_DIR/models}"

die() {
  printf 'download-whisper-model: %s\n' "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

main() {
  local target tmp
  target="${WHISPER_MODEL_DIR}/ggml-${WHISPER_MODEL}.bin"

  if [ -f "$target" ]; then
    printf 'Whisper model already present: %s\n' "$target"
    exit 0
  fi

  have curl || die "curl is required to download the Whisper model."
  mkdir -p "$WHISPER_MODEL_DIR"

  printf 'Downloading Whisper model %s...\n' "$WHISPER_MODEL"
  tmp="$(mktemp "${WHISPER_MODEL_DIR}/ggml-${WHISPER_MODEL}.XXXXXX")"
  if curl -fL "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin" -o "$tmp"; then
    mv "$tmp" "$target"
    printf 'Whisper model downloaded to %s\n' "$target"
  else
    rm -f "$tmp"
    die "Download of model ${WHISPER_MODEL} failed. Check your connection and WHISPER_MODEL."
  fi
}

main "$@"
