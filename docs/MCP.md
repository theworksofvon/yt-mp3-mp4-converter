# MCP setup and usage

This project ships a local [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio. It uses the official TypeScript MCP SDK and contains no Claude-, OpenAI-, or model-specific logic. Codex, Claude Code, Cursor, Claude Desktop, and other MCP hosts can all launch the same server.

## What the MCP server does

The MCP entrypoint is `src/mcp.ts`. It calls the same `getVideoInfo()` and `downloadTranscript()` functions used by the web API and CLI.

| Tool | Inputs | Result |
| --- | --- | --- |
| `get_youtube_video_info` | `url` | JSON-formatted video metadata |
| `get_youtube_transcript` | `url`, optional `includeMetadata` | Cleaned English caption text |

The tools are declared read-only, but they contact YouTube and cache caption files locally. No API key is required.

## Install from a source checkout

From the repository root:

```bash
./scripts/setup.sh
```

The script installs or verifies Bun, `yt-dlp`, FFmpeg, and project dependencies. It is idempotent, so rerunning it is the normal way to repair or verify a development machine.

The recommended MCP command is the absolute path to:

```text
scripts/run-mcp.sh
```

That launcher:

- resolves the repository path without relying on the client's working directory;
- adds common Bun, Homebrew, and user-local binary directories to `PATH`;
- chooses a portable temporary transcript-cache directory;
- reports missing setup on stderr so MCP stdout remains valid JSON-RPC; and
- replaces itself with the MCP process for clean lifecycle handling.

Get the launcher path from the repository root:

```bash
printf '%s/scripts/run-mcp.sh\n' "$(pwd)"
```

## Codex

Register the server globally for your Codex installation:

```bash
codex mcp add youtube-transcript -- "$(pwd)/scripts/run-mcp.sh"
codex mcp list
```

To set a custom cache directory:

```bash
codex mcp add --env MCP_TRANSCRIPT_DIR=/tmp/yt-transcript-mcp-cache youtube-transcript -- "$(pwd)/scripts/run-mcp.sh"
```

Start a new Codex session after adding the server. Use `/mcp` in supported Codex interfaces to inspect the connection and tools. Codex stores stdio MCP configuration under the `mcp_servers` section of its configuration.

Official reference: [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp)

## Claude Code

Register the server for your user account:

```bash
claude mcp add --transport stdio --scope user youtube-transcript -- "$(pwd)/scripts/run-mcp.sh"
claude mcp list
```

Use `/mcp` inside Claude Code to inspect its status. For a project-scoped entry that can be shared with a team, use `--scope project`; Claude Code writes that configuration to `.mcp.json` and asks each user to approve it.

Official reference: [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp)

## Cursor, Claude Desktop, and generic MCP clients

Open the client's MCP configuration and add a stdio server using an absolute launcher path:

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

Configuration file locations vary by client and operating system. The portable contract is simply:

- transport: stdio;
- command: the absolute `scripts/run-mcp.sh` path;
- arguments: none; and
- environment: optional `MCP_TRANSCRIPT_DIR`.

Restart the client or open a new session after changing MCP configuration.

## Install from npm

Once `yt-video-transcript-mcp` has a published release, a source checkout is optional. Bun and `yt-dlp` are still runtime requirements.

```bash
npm install --global yt-video-transcript-mcp
yt-video-transcript-mcp
```

Use `yt-video-transcript-mcp` as the MCP `command`, with no arguments. A global installation is preferable to `npx` or `bunx` because it avoids first-run installation messages interfering with stdio startup.

Check whether a release is available before configuring the package command:

```bash
npm view yt-video-transcript-mcp version
```

## Example requests

After the tools appear in your client:

```text
Use the YouTube transcript tool to summarize https://www.youtube.com/watch?v=VIDEO_ID.
```

```text
Get the video metadata first, then extract the transcript and list the main claims.
```

```text
Return only the transcript for this video; do not include metadata.
```

## Verification

The unit suite starts the MCP process, completes the protocol handshake, and verifies both tools are discoverable:

```bash
bun test src/mcp.test.ts
```

To verify a real YouTube transcript from the same shared implementation:

```bash
bun run transcript "https://www.youtube.com/watch?v=VIDEO_ID"
```

## Limits and behavior

- Only English caption tracks matching `en.*` are requested.
- Manual captions are used when available; auto-generated captions are also supported.
- Videos without accessible English captions cannot be transcribed from their audio.
- Private, deleted, age-restricted, region-blocked, and rate-limited videos may fail.
- Long transcripts can consume substantial model context.
- Cached caption and text files remain in `MCP_TRANSCRIPT_DIR` until the operating system or user removes them.
- The server makes outbound requests through `yt-dlp`; clients may request approval according to their own MCP and sandbox policies.

## Troubleshooting

### The server is disconnected or exposes no tools

Run these commands in a terminal:

```bash
./scripts/setup.sh --check
bun test src/mcp.test.ts
```

Confirm the MCP configuration uses an absolute launcher path. Relative paths are commonly resolved from the client's startup directory rather than this repository.

### `bun` or `yt-dlp` is not found

Use `scripts/run-mcp.sh`, which adds common user-local paths before starting. If it still fails, rerun:

```bash
./scripts/setup.sh
```

### The transcript is unavailable

Check the URL in the CLI to separate client configuration from YouTube availability:

```bash
bun run transcript "https://www.youtube.com/watch?v=VIDEO_ID"
```

If the CLI reports that no English captions were found, the MCP server will return the same result because both use the same implementation.

### Debug output corrupts MCP messages

MCP stdio reserves stdout for JSON-RPC. Launch `scripts/run-mcp.sh` or the package binary directly; do not wrap it in a package script that prints status text to stdout.
