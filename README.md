# YouTube MP3, MP4, and Transcript Downloader

Download a YouTube video from a browser, the command line, or any AI client that supports local MCP servers.

The project provides three outputs:

- MP3 audio
- MP4 video
- Plain-text English transcripts from manual or auto-generated YouTube captions

> Transcripts come from captions already available on YouTube. This project does not perform speech-to-text on videos without captions.

## Quick start

```bash
git clone https://github.com/theworksofvon/yt-mp3-mp4-converter.git
cd yt-mp3-mp4-converter
./scripts/setup.sh
bun run start
```

Open <http://localhost:3000>, paste a YouTube URL, choose an output, and select **Download**.

`setup.sh` is safe to run again. It detects existing tools, installs only missing requirements, installs the locked Bun dependencies, and runs the local checks. Automatic system-package installation supports:

- macOS with Homebrew
- Debian/Ubuntu with `apt-get`
- Fedora/RHEL with `dnf`
- Arch Linux with `pacman`

Verify an existing machine without installing anything:

```bash
./scripts/setup.sh --check
```

On Windows, use WSL for the same setup command, or manually install [Bun](https://bun.sh), [yt-dlp](https://github.com/yt-dlp/yt-dlp), and [FFmpeg](https://ffmpeg.org/download.html).

## Command line

```bash
bun run transcript "https://www.youtube.com/watch?v=VIDEO_ID"
bun run mp3 "https://www.youtube.com/watch?v=VIDEO_ID"
bun run mp4 "https://www.youtube.com/watch?v=VIDEO_ID"
```

Omit the URL to enter it interactively. Files are saved under `./downloads` unless `CLIENT_DOWNLOAD_DIR` is set:

```bash
CLIENT_DOWNLOAD_DIR=/tmp/youtube-downloads bun run transcript "https://youtu.be/VIDEO_ID"
```

## MCP for Codex, Claude, Cursor, and other clients

The repository includes a local stdio MCP server powered by the same transcript implementation as the web app and CLI. It is model-provider independent; the MCP host only needs to be able to launch a local command.

Run setup first, then register the stable launcher with your client.

Codex:

```bash
codex mcp add youtube-transcript -- "$(pwd)/scripts/run-mcp.sh"
codex mcp list
```

Claude Code:

```bash
claude mcp add --transport stdio --scope user youtube-transcript -- "$(pwd)/scripts/run-mcp.sh"
claude mcp list
```

Generic MCP JSON:

```json
{
  "mcpServers": {
    "youtube-transcript": {
      "command": "/absolute/path/to/yt-mp3-mp4-converter/scripts/run-mcp.sh",
      "args": [],
      "env": {
        "MCP_TRANSCRIPT_DIR": "/tmp/yt-transcript-mcp-cache"
      }
    }
  }
}
```

The server exposes:

| Tool | Purpose |
| --- | --- |
| `get_youtube_video_info` | Return a video's title, uploader, duration, upload date, thumbnail, and ID. |
| `get_youtube_transcript` | Return cleaned English caption text, optionally preceded by video metadata. |

See [docs/MCP.md](docs/MCP.md) for package installation, provider configuration, verification, limitations, and troubleshooting.

## How the shared implementation works

```text
Browser/API ─┐
CLI ─────────┼─→ src/yt-dlp.ts → yt-dlp → YouTube
MCP ─────────┘                     │
                                  └─→ FFmpeg for MP3/MP4 only
```

Transcript downloads ask `yt-dlp` for English manual and auto-generated captions, prefer English caption files, remove VTT/SRT timing and markup, and save plain text. Videos without accessible English captions return a clear error.

## Configuration

| Variable | Default | Used by |
| --- | --- | --- |
| `PORT` | `3000` | Web server port |
| `DOWNLOAD_DIR` | `/tmp/yt-converter-downloads` | Web/API output storage |
| `CLIENT_DOWNLOAD_DIR` | `./downloads` | CLI output storage |
| `MCP_TRANSCRIPT_DIR` | OS temporary directory | MCP transcript cache |
| `MAX_FILE_SIZE_MB` | `500` | MP3 size limit |

## Docker

Docker includes Bun, `yt-dlp`, and FFmpeg:

```bash
docker compose up --build
```

Then open <http://localhost:3000>. The compose file persists downloads in `./downloads`.

## API

Start a job:

```http
POST /api/convert
Content-Type: application/json

{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "format": "transcript"
}
```

`format` accepts `mp3`, `mp4`, or `transcript`. The response contains a `jobId`.

```text
GET /api/jobs/:jobId     Check status
GET /downloads/:jobId    Download a completed output
GET /health              Check yt-dlp and FFmpeg availability
```

## Development

```bash
bun install --frozen-lockfile
bun run check
```

Normal tests are deterministic and do not contact YouTube. Live integration tests download real media and must be enabled explicitly:

```bash
bun run test:integration
```

CI runs typechecking, unit tests, an MCP stdio handshake, shell syntax checks, and an npm package dry run. The npm release workflow runs after changes reach `main`; npm trusted publishing must be configured for `.github/workflows/release.yml` before the first release.

## License

MIT
