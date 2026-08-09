# TypeScript behavior contracts and Rust architecture

This document freezes the externally visible behavior at commit `2205e87` for the incremental `yt-trsc` rewrite. It describes the TypeScript implementation as it exists, including behavior that the Rust product contract will intentionally change. Golden files under `test/golden/` are the byte-level reference after the narrow normalizations documented in `test/golden.e2e.test.ts`.

## Product promise (`PRODUCT-01`)

> Transcripts come from captions already available on YouTube. This project does not perform speech-to-text on videos without captions.

The implementation requests existing English manual captions and automatically generated captions. If neither contains readable English text, the operation fails. No current CLI, MCP, or HTTP path extracts speech from audio. This captions-only promise remains a contract for the initial Rust release; a future speech-to-text fallback must be an explicit new capability rather than an implied behavior.

Migration tests: `TI-ADAPTER-08`, `TI-CLI-04`, `TI-MCP-01`, `TI-GOLDEN-01`.

### Speech-to-text fallback (`STT-01`)

A TypeScript change after this snapshot added the explicit capability the
promise anticipated. When a URL has no usable English captions, or the input is
a local media file, the shared transcript path extracts mono 16 kHz audio with
FFmpeg and transcribes it locally with whisper.cpp (`whisper-cli`). Missing
`whisper-cli` or the model maps to a `component_missing` category; a failed or
empty transcription maps to `transcription_failed`. Caption-first behavior,
filename handling, and the captions-only YouTube MCP tool are unchanged. The
Rust rewrite should reproduce this same fallback rather than regressing to
captions-only.

Migration tests: `TI-ADAPTER-12`–`TI-ADAPTER-14`, `TI-GOLDEN-01`.

## Legacy TypeScript CLI

### Invocation and input (`CLI-01`)

The executable contract is `bun run src/cli.ts <mp3|mp4|transcript> [youtube-url]`, normally reached through `bun run mp3`, `bun run mp4`, or `bun run transcript`. The first positional value is case-sensitive and must be exactly `mp3`, `mp4`, or `transcript`. Missing or unknown formats print the three-line usage/examples block to stdout and exit `1`.

If the URL positional value is missing or trims to empty, the CLI writes `YouTube URL: ` to stdout and reads console lines until it receives a nonempty trimmed line. It repeats the prompt after empty lines. End-of-input without a URL writes `A YouTube URL is required.` to stderr and exits `1`. Extra arguments and all flag-looking arguments after the URL are ignored.

Migration tests: `TI-CLI-01`, `TI-UNIT-01`, `TI-GOLDEN-01`.

### Output, files, and exit behavior (`CLI-02`)

For every accepted format the CLI creates `CLIENT_DOWNLOAD_DIR`, defaulting to `./downloads`, before URL validation. It then writes these status lines to stdout:

```text
Fetching video info...
Downloading transcript...
Saved: /absolute/path/to/Sanitized_Title.txt
```

The middle line is `Downloading MP3...` or `Downloading MP4...` for media. The saved path is absolute because the configured directory is resolved first. A successful transcript is written as UTF-8 text to the `.txt` file; transcript text itself is **not** written to stdout. MP3 pre-checks reported file size, while transcript and MP4 do not. Success exits `0` and leaves stderr empty in the deterministic path.

The title becomes a filename by removing invalid/control characters and traversal markers, replacing whitespace runs with `_`, removing leading dots, and limiting the result to 200 characters. Severe shell characters `;`, `|`, backtick, `$`, or backslash replace the whole title with `sanitized_filename`.

Migration tests: `TI-CLI-01`, `TI-CLI-02`, `TI-CLI-03`, `TI-ADAPTER-02`, `TI-UNIT-03`, `TI-GOLDEN-01`.

### Diagnostics and failures (`CLI-03`)

Progress/status text already emitted remains on stdout when a later step fails. The thrown error message is written to stderr, followed by a newline, and every failure exits `1`; the legacy CLI has no stable category-specific exit codes. Representative byte contracts are in `cli-errors.json`:

- invalid URL: one fetch status line on stdout and `Invalid YouTube URL: <input>` on stderr;
- missing captions: fetch and transcript-download status lines on stdout and the `Failed to convert to TRANSCRIPT: ...` message on stderr;
- downloader failure: fetch status on stdout and a bounded `Download failed: ...` message on stderr. The downloader's retained newline plus `console.error` produces a second newline.

Migration tests: `TI-CLI-04`, `TI-ERROR-03`, `TI-ERROR-04`, `TI-GOLDEN-01`.

### Structured output (`CLI-04`)

There is no legacy `--json` mode, metadata-only mode, output flag, include-metadata flag, shorthand URL command, or stable JSON success/error shape. `--json` in the first position is an invalid format; after a valid URL it is merely an ignored extra argument. These are new Phase 3 contracts, not behavior to infer from TypeScript.

Migration test: `TI-GOLDEN-01` records the only current transcript stdout form; `TI-CLI-01` owns the temporary dual-run CLI boundary.

## HTTP API

All routes pass through permissive CORS middleware (`origin: *`; `GET`, `POST`, and `OPTIONS`; `Content-Type`) and request logging. The process listens on `PORT`, default `3000`, when `src/index.ts` is the entrypoint. Jobs are stored in an unbounded, process-local `Map`; there is no persistence, expiry, cancellation, or cleanup. Static `GET /` and `GET /app.js` serve the current browser assets. Migration tests: `TI-API-01`, `TI-WEB-01`.

### `POST /api/convert` (`HTTP-01`)

The JSON body is:

```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "format": "mp3 | mp4 | transcript",
  "quality": "low | medium | high (optional and ignored)"
}
```

`url` is trimmed, limited to 500 characters, rejected for selected control/shell/traversal characters, and must begin like a supported YouTube watch, shorts, embed, or `youtu.be` URL. Validation only has to find an 11-character ID prefix; trailing URL text is not rejected. A missing protocol is changed to `https://`. Unknown object keys are stripped. `format` is case-sensitive.

Invalid schemas return `400` with `{ "error": "Invalid request", "code": "VALIDATION_ERROR", "details": <Zod issues> }`. Malformed JSON returns `400` with `{ "error": "Invalid JSON in request body", "code": "INVALID_JSON" }`.

A valid request creates a job and immediately returns `202`:

```json
{
  "jobId": "<millisecond timestamp>-<8 UUID characters>",
  "status": "processing",
  "message": "Conversion started",
  "checkUrl": "/api/jobs/<jobId>",
  "pollTimeoutSeconds": 180
}
```

The polling deadline is `360` for MP3, `960` for MP4, and `180` for transcript. Downloader work runs after the response. Therefore inaccessible videos, missing captions, and conversion errors still receive an initial `202` and become failed jobs later.

Migration tests: `TI-SCHEMA-01` through `TI-SCHEMA-08`, `TI-API-02`, `TI-API-04`, `TI-API-05`, `TI-GOLDEN-01`.

### `GET /api/jobs/:job_id` (`HTTP-02`)

Job IDs must be 1–100 ASCII letters, digits, or hyphens. Invalid IDs return `400` with `error`, `code: "VALIDATION_ERROR"`, and Zod `details`; unknown valid IDs return `404` with only `{ "error": "Job not found" }`.

A known job returns `200` with `jobId` plus its stored state:

- processing: `status`, `format`, and numeric `createdAt`;
- completed: `status`, `format`, normalized `videoInfo` (`id`, `title`, `duration`, `thumbnail`, `uploader`, `upload_date`), absolute `outputPath`, download `filename`, and a new completion `createdAt`;
- failed: `status`, `format`, raw safe-facing `error`, uppercase legacy `errorCode`, and a new failure `createdAt`.

The completed response is frozen in `http-convert-job.json`. Migration tests: `TI-SCHEMA-09`, `TI-SCHEMA-10`, `TI-API-02`, `TI-API-05`, `TI-GOLDEN-01`.

### `GET /downloads/:job_id` (`HTTP-03`)

ID validation matches the job route, but its `400` body omits Zod details. Unknown jobs return `404` `Job not found`. Any processing **or failed** job returns `400` `{ "error": "Conversion not complete", "status": <job status> }`; this route does not return the failed job's error code. A completed job without an output path returns `404` `File not available`, and a missing file returns `404` `File not found on server`.

Success returns the file body with `Content-Disposition: attachment; filename="<sanitized title>.<ext>"`. Content type is `audio/mpeg`, `video/mp4`, or `text/plain; charset=utf-8`. An exception while serving returns `500` with `error: "Failed to serve file"` and `details`.

Migration tests: `TI-API-02`, `TI-API-03A`, `TI-API-03B`, `TI-API-05`, `TI-GOLDEN-01`.

### `GET /health` (`HTTP-04`)

The handler spawns `yt-dlp --version` and `ffmpeg -version`, reads the first stdout chunk from each, and returns `200`:

```json
{
  "status": "healthy",
  "ytDlp": { "installed": true, "version": "<stdout or unknown>" },
  "ffmpeg": { "installed": "<boolean based on stdout>", "version": "<first line or not found>" }
}
```

It does not check either subprocess exit code. A spawn/read exception returns `503` with `status: "unhealthy"`, `error: "yt-dlp or ffmpeg not installed"`, and raw `details`.

Migration test: `TI-API-01`.

### Other HTTP error translation (`HTTP-05`)

Synchronous `ConverterError` responses use their legacy HTTP status and `{ error, code }`. A `NetworkTimeoutError` additionally receives `retryAfter: 300`; a `RateLimitError` does not receive that field despite its own optional property. Direct Zod exceptions use `400` `VALIDATION_ERROR`. Other exceptions return `500` `{ error: <message>, code: "INTERNAL_ERROR" }`. Background job failures instead use the job shape described above.

Migration tests: `TI-ERROR-01`, `TI-ERROR-02`, `TI-API-05`.

## MCP stdio server

### Transport and identity (`MCP-01`)

The server uses MCP over stdio. Protocol messages reserve stdout; startup failures are written to stderr and exit `1`. Its legacy identity is `youtube-transcript-context` version `1.0.0`, even though the package/server launcher uses other YouTube-transcript names. Both tools are annotated read-only and open-world because they contact an external service.

Migration test: `TI-MCP-01`.

### `get_youtube_video_info` (`MCP-02`)

Input is an object with required `url: string` of minimum length 1. Success returns one text content item. That text is pretty-printed JSON with keys in this order: `id`, `title`, `uploader`, `duration`, `uploadDate`, `thumbnail`. `uploadDate` is copied from yt-dlp's `upload_date` without format conversion.

Migration tests: `TI-MCP-01`, `TI-GOLDEN-01`.

### `get_youtube_transcript` (`MCP-03`)

Input is required nonempty `url` plus optional `includeMetadata: boolean`, defaulting to `true`. Success returns one text content item. When metadata is disabled it is exactly the cleaned transcript, including the final newline. When enabled it is:

```text
Title: <title>
Uploader: <uploader>
Duration: <duration> seconds
Upload date: <upload_date>
Video ID: <id>
Transcript cache: <absolute path>

<transcript>
```

The successful result therefore exposes the local cache path. Migration tests: `TI-MCP-01`, `TI-MCP-02`, `TI-MCP-03`, `TI-MCP-04`, `TI-GOLDEN-01`.

### Tool errors and cache (`MCP-04`)

Application failures are returned as `{ isError: true, content: [{ type: "text", text: <Error.message> }] }`. There is no structured legacy error code. Input-schema errors are generated by the MCP SDK rather than this helper.

Before transcript work, the cache root is created and forced to mode `0700` on POSIX. Its default is `<OS temp>/yt-transcript-mcp-cache-<uid>` when a UID exists, otherwise `<OS temp>/yt-transcript-mcp-cache`; `MCP_TRANSCRIPT_DIR` overrides it. A non-directory, symlink, or other-owner directory is rejected. Each call creates a private `transcript-*` child, writes `<video id>-<sanitized title>.txt`, and retains that text file. Caption intermediates are isolated and removed. Native Windows does not enforce UID or POSIX mode.

Migration tests: `TI-MCP-01`, `TI-MCP-02`, `TI-MCP-03`, `TI-MCP-04`, `TI-GOLDEN-01`.

## Caption acquisition and cleaning

### Acquisition (`CAPTION-01`)

Each call validates the URL, creates a unique hidden working directory next to the final server-controlled base path, and invokes yt-dlp without a shell using `--skip-download --write-subs --write-auto-subs --sub-langs en.* --sub-format vtt/srt --no-playlist --no-progress`. It scans only that invocation directory for base-name-prefixed `.vtt` or `.srt` files, gives filenames containing `.en`, `.en-`, or `.en.` sort priority, and otherwise accepts directory order. The raw caption directory is always removed; the cleaned `.txt` is published only after readable text exists. Stale caption files beside the requested output cannot be selected.

Migration tests: `TI-ADAPTER-07`, `TI-ADAPTER-08`, `TI-ADAPTER-09`, `TI-MCP-03`.

### VTT/SRT parsing (`CAPTION-02`)

Cleaning removes carriage returns, splits on newline, and trims every line. Empty lines reset metadata-block skipping. Lines beginning case-insensitively with `WEBVTT`, `Kind:`, or `Language:` are removed. A line beginning `NOTE`, `STYLE`, or `REGION` starts a skipped block through the next empty line. Any line containing `-->` is removed.

A digits-only line is removed as an SRT cue index only when the immediately following trimmed line contains `-->`; otherwise it is spoken text and is kept. HTML-like tags (`<...>`) and ASS override blocks matching `{\...}` are removed, remaining whitespace runs collapse to one space, and these five case-sensitive entities decode: `&amp;`, `&lt;`, `&gt;`, `&quot;`, and `&#39;`. Other named, numeric, uppercase, or nested entities remain unchanged.

Migration tests: `TI-UNIT-06`, `TI-UNIT-07`, `TI-UNIT-08`.

### Line and output rules (`CAPTION-03`)

Only adjacent duplicate cleaned lines are collapsed; the same line separated by other text is preserved. Empty cleaned lines are discarded. The result joins lines with `\n` and always appends one final newline. The download operation rejects a result whose trimmed text is empty with the same transcript-conversion error category as missing caption files.

Migration tests: `TI-UNIT-06`, `TI-UNIT-07`, `TI-ADAPTER-08`, `TI-GOLDEN-01`.

## Error-category migration contract (`ERROR-01`)

The Rust core owns the stable lowercase categories from the approved plan. Current uppercase codes/messages map as follows; adapters must preserve the target category even where the TypeScript implementation did not expose one distinctly.

| Current condition and representation | Current HTTP status | Stable Rust category |
| --- | ---: | --- |
| URL validation; `INVALID_URL` | 400 | `invalid_url` |
| Private, members-only, deleted, 404, age/region restricted, blocked/copyright; `VIDEO_NOT_ACCESSIBLE` | 400 | `video_unavailable` |
| No English caption file or no readable caption text; `CONVERSION_FAILED_TRANSCRIPT` | 500 | `captions_unavailable` |
| Downloader rate text; `RATE_LIMITED` | 429 | `rate_limited` |
| Process timer or timeout stderr; `NETWORK_TIMEOUT` | 504 | `network_timeout` |
| Generic bounded stderr `DOWNLOAD_FAILED`, invalid metadata `PARSE_ERROR`, or metadata wrapper `VIDEO_INFO_FAILED` | 500 | `downloader_failed` |
| Executable absent, currently folded into metadata/conversion wrappers | 500 | `component_missing` |
| Known unusable component, not distinguished today | 500 | `component_incompatible` |
| MP3 reported size above limit; `FILE_TOO_LARGE` | 413 | `file_too_large` |
| MP3/MP4 conversion or missing output; `CONVERSION_FAILED_MP3` / `CONVERSION_FAILED_MP4` | 500 | `media_conversion_failed` |
| Unexpected application failure; `INTERNAL_ERROR` or job `UNKNOWN_ERROR` | 500 | `internal` |

The generic downloader message includes at most the first 200 stderr characters but can retain newlines. Private/unavailable matching takes precedence over timeout and rate matching. Stderr `timeout` mapping constructs a 300-second timeout message regardless of the operation's actual budget.

Legacy surface translation remains: CLI text plus exit `1`; MCP text content plus `isError`; HTTP uppercase code/status or asynchronous failed-job fields. The Rust surfaces will introduce documented category-preserving exit codes and JSON errors without pretending those already exist.

Migration tests: `TI-ERROR-01` through `TI-ERROR-04`, `TI-ADAPTER-05`, `TI-ADAPTER-10`, `TI-API-05`, `TI-CLI-04`, `TI-GOLDEN-01`.

## Rust architecture decision

The rewrite uses one domain/library crate (`yt-trsc-core`) and one executable crate (`yt-trsc`). CLI, MCP, and HTTP are delivery adapters that call the same application services. Domain models and transcript services depend on ports, never on Clap, Axum, MCP protocol types, filesystem/process APIs, or a concrete yt-dlp implementation.

```text
CLI ─────┐
MCP ─────┼──> transcript/video services ──> domain models
HTTP/UI ─┘                 │
                           └──> ports <── yt-dlp/filesystem/process adapters
```

The transcript service owns URL validation, requesting a caption artifact, cleaning it, and returning a typed result. The yt-dlp adapter owns argument arrays, process budgets, bounded stdout/stderr, temporary isolation, and error translation. Traits are introduced only at I/O boundaries. The browser remains a small embedded dependency-free UI, and MP3/MP4 stay optional behind FFmpeg availability.

Migration tests are divided into `rust-unit` for domain/pure serialization, `rust-adapter` for process/filesystem boundaries, `rust-protocol` for a canonical Rust interface, and temporary `parity` tests that feed TypeScript and Rust the same golden cases. The complete ownership map is in `test-inventory.md`.
