#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK_ONLY=false

usage() {
  cat <<'EOF'
Usage: ./scripts/setup.sh [--check]

Install and verify the local development requirements.

Options:
  --check  Verify the existing installation without installing anything.
  --help   Show this help text.

Supported automatic system package installation:
  - macOS with Homebrew
  - Debian/Ubuntu with apt-get
  - Fedora/RHEL with dnf
  - Arch Linux with pacman
EOF
}

die() {
  printf 'setup: %s\n' "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif have sudo; then
    sudo "$@"
  else
    die "Administrator access is required to install system packages: $*"
  fi
}

install_bun() {
  if have bun; then
    return
  fi

  if [ "$CHECK_ONLY" = true ]; then
    die "Bun is missing. Run ./scripts/setup.sh to install it."
  fi

  have curl || die "curl is required to install Bun."
  printf 'Installing Bun...\n'
  local installer
  installer="$(mktemp)"
  curl -fsSL https://bun.sh/install -o "$installer"
  bash "$installer"
  rm -f "$installer"

  export PATH="${BUN_INSTALL:-$HOME/.bun}/bin:$PATH"
  have bun || die "Bun installed, but its executable is not on PATH. Add ~/.bun/bin to PATH and rerun setup."
}

install_homebrew() {
  if have brew; then
    return
  fi

  have curl || die "curl is required to install Homebrew."
  printf 'Homebrew is required to install yt-dlp and FFmpeg on macOS.\n'
  printf 'The official installer may request your administrator password.\n'

  local installer
  installer="$(mktemp)"
  curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$installer"
  bash "$installer"
  rm -f "$installer"

  if [ -x /opt/homebrew/bin/brew ]; then
    export PATH="/opt/homebrew/bin:$PATH"
  elif [ -x /usr/local/bin/brew ]; then
    export PATH="/usr/local/bin:$PATH"
  fi

  have brew || die "Homebrew installed, but its executable is not on PATH. Follow the installer's shell setup instructions and rerun setup."
}

install_system_tools() {
  local missing=""
  have yt-dlp || missing="$missing yt-dlp"
  have ffmpeg || missing="$missing ffmpeg"
  missing="${missing# }"

  if [ -z "$missing" ]; then
    return
  fi

  if [ "$CHECK_ONLY" = true ]; then
    die "Missing system tools: $missing. Run ./scripts/setup.sh to install them."
  fi

  read -r -a packages <<< "$missing"

  case "$(uname -s)" in
    Darwin)
      install_homebrew
      printf 'Installing system tools with Homebrew: %s\n' "$missing"
      brew install "${packages[@]}" || die "Homebrew could not install packages. Run 'brew doctor', fix the reported permissions, and rerun setup."
      ;;
    Linux)
      if have apt-get; then
        run_privileged apt-get update
        run_privileged apt-get install -y "${packages[@]}"
      elif have dnf; then
        run_privileged dnf install -y "${packages[@]}"
      elif have pacman; then
        run_privileged pacman -S --needed "${packages[@]}"
      else
        die "No supported package manager found. Install yt-dlp and ffmpeg, then rerun setup."
      fi
      ;;
    *)
      die "Automatic setup supports macOS and Linux. On Windows, use WSL or follow README.md."
      ;;
  esac
}

verify_tools() {
  have bun || die "bun is not available on PATH."
  have yt-dlp || die "yt-dlp is not available on PATH."
  have ffmpeg || die "ffmpeg is not available on PATH."

  printf 'Bun: %s\n' "$(bun --version)"
  printf 'yt-dlp: %s\n' "$(yt-dlp --version)"
  printf 'FFmpeg: %s\n' "$(ffmpeg -version 2>/dev/null | sed -n '1p')"
}

for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=true ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $arg" ;;
  esac
done

export PATH="$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

install_bun
install_system_tools
verify_tools

cd "$ROOT_DIR"

if [ "$CHECK_ONLY" = true ]; then
  [ -d node_modules ] || die "Project dependencies are missing. Run ./scripts/setup.sh."
else
  printf 'Installing project dependencies...\n'
  bun install --frozen-lockfile
fi

printf 'Running local checks...\n'
bun run check

cat <<EOF

Setup complete.

Web app:    bun run start
CLI:        bun run transcript "https://www.youtube.com/watch?v=VIDEO_ID"
MCP launch: $ROOT_DIR/scripts/run-mcp.sh

Provider-specific MCP commands are in docs/MCP.md.
EOF
