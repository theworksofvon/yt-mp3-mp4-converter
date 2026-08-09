# `yt-trsc` Rust Rewrite Plan

## 1. Decision

Rewrite the product-facing CLI and MCP server in Rust and make the Rust implementation the canonical application core.

The product command will be:

```text
yt-trsc
```

The existing browser UI will remain intentionally small. It will be served by the same Rust executable and will call the same Rust application services as the CLI and MCP server. It will not have a separate backend or duplicate YouTube logic.

The TypeScript implementation remains in place until the Rust implementation reaches tested feature parity. This is an incremental migration, not a big-bang replacement.

## 2. Product goals

The finished product should let a new user install one command and immediately use it from a terminal, an AI agent, or a browser:

```bash
# Human- and agent-friendly CLI
yt-trsc "https://www.youtube.com/watch?v=VIDEO_ID"

# Local MCP stdio server
yt-trsc mcp

# Minimal local browser UI
yt-trsc serve --open
```

Primary goals:

- Make the CLI and MCP server the primary product surfaces.
- Ship one native Rust executable with no Bun, Node, or Python requirement for our application.
- Manage `yt-dlp` and Deno as private companion components.
- Return cleaned YouTube captions as plain text or structured JSON.
- Keep the existing MP3 and MP4 features available as optional media capabilities.
- Keep the current UI simple and embed it in the Rust executable.
- Support Codex, Claude Code, Cursor, and any other stdio MCP client without provider-specific core logic.
- Provide predictable installation, diagnostics, upgrades, and rollback.
- Preserve or improve the current security, test coverage, and CI guarantees.

## 3. Explicit non-goals for the rewrite

- Do not redesign the browser UI into a large frontend application.
- Do not add React, a frontend build pipeline, Electron, or a database.
- Do not rewrite YouTube extraction itself; invoke the official `yt-dlp` executable.
- Do not promise speech-to-text for videos without captions in the first Rust release.
- Do not remove the TypeScript implementation before parity tests pass.
- Do not combine unrelated behavior in large `main.rs`, `lib.rs`, `utils.rs`, or handler files.
- Do not make npm the primary distribution channel.

The initial product retrieves manual or automatically generated captions that already exist on YouTube. The core should leave room for a future speech-to-text fallback without implying that it exists today.

## 4. Naming

Use `yt-trsc` consistently for the new product:

| Item | Name |
| --- | --- |
| Executable | `yt-trsc` |
| Main Rust crate | `yt-trsc` |
| Core library crate | `yt-trsc-core` |
| MCP server name | `yt-trsc` |
| Release assets | `yt-trsc-<version>-<target>` |
| User data directory | `yt-trsc` |

Use the full phrase “YouTube transcript” in descriptions, help text, metadata, and documentation so the shortened command remains discoverable.

Keep the current repository name during the migration. Consider renaming the repository only after the Rust release becomes the default installation path.

## 5. User-facing command contract

The command contract should be stable before the TypeScript implementation is retired.

### Transcript commands

```bash
# Preferred shorthand: plain transcript on stdout
yt-trsc "YOUTUBE_URL"

# Explicit form
yt-trsc transcript "YOUTUBE_URL"

# Structured output for agents and scripts
yt-trsc transcript "YOUTUBE_URL" --json

# Save without mixing status messages into stdout
yt-trsc transcript "YOUTUBE_URL" --output transcript.txt

# Include video metadata
yt-trsc transcript "YOUTUBE_URL" --include-metadata

# Metadata only
yt-trsc info "YOUTUBE_URL" --json
```

Rules:

- Plain transcript output goes to stdout.
- Diagnostics and progress go to stderr.
- `--json` produces a documented, versioned JSON shape.
- Non-zero exit codes represent stable error categories.
- No progress spinner is emitted when stdout is not a TTY.
- CLI output must be usable directly by shell-capable agents.

### MCP commands

```bash
# Run the provider-neutral stdio MCP server
yt-trsc mcp

# Print generic MCP JSON configuration
yt-trsc mcp config

# Print or apply provider-specific registration instructions
yt-trsc mcp install codex
yt-trsc mcp install claude
yt-trsc mcp install cursor
```

Initial MCP tools:

| Tool | Behavior |
| --- | --- |
| `get_youtube_video_info` | Return normalized video metadata. |
| `get_youtube_transcript` | Return cleaned caption text with optional metadata. |

MCP stdout is reserved exclusively for protocol messages. All logs and downloader diagnostics must be captured or written to stderr.

### UI commands

```bash
yt-trsc serve
yt-trsc serve --open
yt-trsc serve --port 8080
```

The server binds to `127.0.0.1` by default. Listening on another interface requires an explicit `--host` option and a warning.

### Maintenance commands

```bash
yt-trsc doctor
yt-trsc version --components
yt-trsc update
yt-trsc components install ffmpeg
yt-trsc components remove ffmpeg
```

## 6. Architecture

Use a small workspace with one domain/library crate and one executable crate. More crates should be added only when an independently reusable boundary is demonstrated.

```text
Cargo.toml
crates/
├── yt-trsc-core/
│   └── src/
│       ├── lib.rs
│       ├── domain/
│       │   ├── video.rs
│       │   ├── transcript.rs
│       │   └── error.rs
│       ├── ports/
│       │   ├── youtube_gateway.rs
│       │   └── clock.rs
│       ├── services/
│       │   ├── video_service.rs
│       │   └── transcript_service.rs
│       └── captions/
│           ├── mod.rs
│           ├── parser.rs
│           └── entities.rs
│
└── yt-trsc/
    └── src/
        ├── main.rs
        ├── app.rs
        ├── cli/
        │   ├── mod.rs
        │   ├── args.rs
        │   ├── transcript.rs
        │   ├── info.rs
        │   ├── doctor.rs
        │   ├── update.rs
        │   ├── mcp.rs
        │   └── serve.rs
        ├── adapters/
        │   ├── mod.rs
        │   ├── yt_dlp.rs
        │   ├── filesystem.rs
        │   └── process.rs
        ├── components/
        │   ├── mod.rs
        │   ├── manager.rs
        │   ├── manifest.rs
        │   ├── downloader.rs
        │   └── paths.rs
        ├── mcp/
        │   ├── mod.rs
        │   ├── server.rs
        │   └── tools.rs
        └── http/
            ├── mod.rs
            ├── server.rs
            ├── routes.rs
            ├── jobs.rs
            └── responses.rs

assets/
├── index.html
├── app.js
└── styles.css
```

This layout is directional rather than mandatory. Split a module when it gains a second responsibility; do not create empty abstractions solely to match the tree.

### Dependency direction

```text
CLI ─────┐
MCP ─────┼──> application services ──> domain models
HTTP/UI ─┘              │
                        └──> ports <── yt-dlp/filesystem adapters
```

The domain and application services must not import Clap, Axum, MCP protocol types, filesystem implementations, or process APIs.

### Core abstractions

Introduce traits only at real external boundaries. Avoid creating interfaces for every function.

```rust
trait YoutubeGateway {
    async fn video_info(&self, url: &YoutubeUrl) -> Result<VideoInfo, CoreError>;
    async fn captions(&self, url: &YoutubeUrl) -> Result<CaptionArtifact, CoreError>;
}
```

The transcript service owns application behavior:

```text
validate URL
  -> request caption artifact through the gateway
  -> parse and normalize captions
  -> return typed transcript result
```

The `yt-dlp` adapter owns command arguments, process timeouts, exit-code mapping, and temporary files. UI, CLI, and MCP code must never build `yt-dlp` arguments directly.

## 7. Rust dependencies

Use a conservative dependency set:

| Concern | Crate |
| --- | --- |
| CLI parsing | `clap` |
| Async runtime and subprocesses | `tokio` |
| MCP | official `rmcp` SDK |
| HTTP server | `axum` |
| HTTP middleware/static service | `tower-http` or a small embedded Tower service |
| Serialization | `serde`, `serde_json` |
| Typed errors | `thiserror` |
| Temporary isolation | `tempfile` |
| Platform data directories | `directories` |
| Component downloads | `reqwest` with `rustls` |
| Checksums | `sha2` |
| Structured diagnostics | `tracing`, `tracing-subscriber` |

Do not add a dependency when a small standard-library implementation is clearer and safer. Pin MCP behavior with protocol tests because the official Rust SDK has a faster-moving compatibility surface than the TypeScript SDK.

## 8. `yt-dlp`, Deno, and FFmpeg

Rust communicates with `yt-dlp` through its command-line interface. Do not link to internal Python modules or attempt to reimplement YouTube extraction.

Managed installation layout:

```text
~/.local/share/yt-trsc/                # Linux default
~/Library/Application Support/yt-trsc/ # macOS default
%LOCALAPPDATA%\yt-trsc\                 # Windows default

components/
├── yt-dlp
├── deno
└── ffmpeg            # optional
```

Requirements:

- `yt-dlp` is required for metadata and captions.
- Deno is required for reliable current YouTube challenge handling.
- FFmpeg is optional and required only for MP3/MP4 operations.
- The component manager may use compatible executables already on `PATH`, but managed components take precedence after installation.
- Every managed download is pinned by a release manifest and verified by checksum.
- Updates are atomic and retain the previous working component for rollback.
- The application reports its own version and all resolved component versions through `doctor` and `version --components`.

The default installer is transcript-focused and does not install FFmpeg unless media support is requested.

## 9. Minimal UI

Preserve the current UI’s simplicity and visual direction. Reuse the current HTML/CSS/JavaScript where practical.

The release binary embeds the static files and serves them from memory. Development mode may serve `assets/` from disk for quick iteration.

Keep the UI dependency-free:

- One URL input.
- Transcript, MP3, and MP4 choices.
- One action button.
- A small status/result area.
- Clear errors and a download link.
- No frontend framework or client-side router.

The Rust HTTP adapter calls the same application services used by the CLI and MCP server. Preserve the existing API shape initially to minimize frontend churn:

```text
POST /api/convert
GET  /api/jobs/:job_id
GET  /downloads/:job_id
GET  /health
```

Use bounded in-memory jobs with expiry and cleanup. Do not add persistent storage for the local UI.

When FFmpeg is unavailable, the UI should keep transcript functionality enabled and show an actionable message for MP3/MP4 instead of failing application startup.

## 10. Errors and output contracts

Define stable error categories in the core:

```text
invalid_url
video_unavailable
captions_unavailable
rate_limited
network_timeout
downloader_failed
component_missing
component_incompatible
file_too_large
media_conversion_failed
internal
```

Adapters translate these errors without losing the stable category:

- CLI: message on stderr and documented exit code.
- `--json`: structured error object.
- MCP: `isError` tool result with safe detail.
- HTTP: appropriate status and JSON error code.

Never return raw unbounded downloader output. Redact local paths where they do not help the user.

## 11. Security requirements

- Pass subprocess arguments as arrays; never construct a shell command from user input.
- Validate YouTube URLs before invoking external tools.
- Capture child stdout and stderr, especially in MCP mode.
- Use a unique private temporary directory for every transcript or media operation.
- Reject unsafe cache roots, symlinks, and wrong-owner directories on POSIX.
- Bind the UI to localhost by default.
- Verify component checksums before replacing executables.
- Use HTTPS with bounded downloads, timeouts, and maximum artifact sizes.
- Do not run automatic component updates during a transcript request.
- Do not log full transcripts by default.
- Keep temporary caption files out of shared predictable paths.
- Document native Windows ACL limitations until equivalent enforcement is implemented.

## 12. Clean-code rules

These rules apply throughout the rewrite:

- Keep the domain independent from delivery mechanisms and infrastructure.
- Prefer cohesive modules with one clear responsibility.
- Keep `main.rs` limited to argument parsing, dependency construction, and dispatch.
- Avoid catch-all files named `utils.rs`, `helpers.rs`, or `common.rs`.
- Introduce traits at I/O and substitution boundaries, not around pure functions.
- Prefer typed domain values such as `YoutubeUrl`, `VideoId`, and `Transcript` over repeated raw strings where validation matters.
- Use explicit data structures instead of loosely shaped JSON inside the core.
- Avoid global mutable state; share application services through explicit ownership or `Arc`.
- Do not use `unwrap()` or `expect()` in production request paths.
- Keep functions short enough to read as one operation; extract behavior when names add clarity.
- Comment why a constraint exists, not what an obvious line does.
- Treat file size as a warning signal, not a mechanical metric: split files when responsibilities diverge.
- Keep public APIs documented and minimize their surface area.
- Prefer composition over deep inheritance-like trait hierarchies.
- Do not generalize until a second real use case demonstrates the abstraction.

## 13. Testing strategy

Retain the current deterministic testing philosophy. The Rust suite should not contact YouTube during normal CI.

### Unit tests

- URL validation and normalization.
- VTT and SRT parsing.
- HTML entity decoding and markup cleanup.
- Numeric spoken lines versus SRT cue indexes.
- Duplicate-line behavior.
- Error mapping.
- Component manifest and version comparison.
- Output serialization.

### Adapter tests

Provide a deterministic fake `yt-dlp` executable that supports:

- Metadata output.
- Manual and automatic captions.
- Missing and empty captions.
- Private videos and rate limiting.
- Invalid JSON.
- Timeouts and cancellation.
- Oversized metadata.
- MP3/MP4 fixture files.
- Concurrent calls and stale-file isolation.

### Protocol and interface tests

- Spawn `yt-trsc mcp`, complete a real MCP stdio handshake, list tools, and call both tools.
- Confirm MCP stdout contains protocol messages only.
- Exercise CLI text, JSON, file output, and stable exit codes.
- Start `yt-trsc serve` on an ephemeral port and test the API and download path.
- Run the browser journey against the Rust server with Playwright during migration; replace it only if a smaller equivalent remains genuinely end-to-end.

### Parity tests

Run the TypeScript and Rust implementations against the same fixture cases and compare normalized outputs. Parity is required for:

- Video metadata.
- Transcript text.
- Error categories.
- CLI exit behavior.
- MCP tool results.
- HTTP status/result behavior used by the UI.

### Live tests

Keep a scheduled, non-blocking live smoke workflow for one stable public video. It verifies metadata and captions with the managed component versions and alerts on upstream YouTube or `yt-dlp` changes.

## 14. CI quality gates

Required Rust checks:

```bash
cargo fmt --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
```

Also require:

- At least the current 90% line/function coverage standard for core behavior.
- MCP protocol integration tests.
- HTTP and browser end-to-end tests.
- Installer shell syntax and idempotency tests.
- Release artifact smoke tests on each supported target.
- Dependency vulnerability and license reporting.
- Checksum manifest verification.
- A production release build before merge.

Keep branch protection tied to named required jobs throughout the migration so the rewrite cannot reduce the existing merge safety.

## 15. Packaging and installation

Primary distribution is through GitHub Releases.

Initial targets:

```text
x86_64-apple-darwin
aarch64-apple-darwin
x86_64-unknown-linux-gnu
aarch64-unknown-linux-gnu
```

Add native Windows after cache ACL behavior and installer coverage are ready. WSL remains supported through the Linux build.

Each release publishes:

```text
yt-trsc-<version>-<target>.tar.gz
yt-trsc-<version>-<target>.sha256
components.json
install.sh
install.ps1                 # when native Windows is supported
```

The idempotent installer:

1. Detects OS and architecture.
2. Downloads the matching `yt-trsc` release.
3. Verifies its checksum.
4. Installs into a user-writable application directory.
5. Installs pinned `yt-dlp` and Deno components if compatible copies are unavailable.
6. Optionally installs FFmpeg with `--with-media`.
7. Creates or updates the `~/.local/bin/yt-trsc` link.
8. Runs `yt-trsc doctor`.
9. Prints CLI, MCP, and UI next steps.

Re-running the installer upgrades safely. A failed installation must leave the previously working version intact.

Homebrew may be added after release artifacts are stable. npm remains available only for the legacy TypeScript package until it is intentionally retired or repurposed.

## 16. Migration phases

### Phase 0 — Freeze behavior and record decisions

Deliverables:

- Approve this plan and the `yt-trsc` name.
- Document existing CLI, MCP, HTTP, and transcript contracts as golden fixtures.
- Record the “captions first, no speech-to-text yet” product promise.
- Inventory every current test and map it to a Rust replacement or temporary parity test.

Exit criteria:

- Every externally visible behavior has an owner and a migration test.
- No rewrite work depends on an undocumented TypeScript behavior.

### Phase 1 — Rust workspace and domain core

Deliverables:

- Add the Cargo workspace and CI jobs.
- Implement typed domain models and stable core errors.
- Port URL validation, caption parsing, sanitization, and metadata normalization.
- Port deterministic unit fixtures.

Exit criteria:

- Core unit tests match TypeScript golden outputs.
- Domain crate has no CLI, MCP, HTTP, filesystem, or process dependencies.

### Phase 2 — `yt-dlp` adapter

Deliverables:

- Implement async process execution with cancellation and timeouts.
- Implement metadata and caption argument builders.
- Use isolated temporary directories.
- Map bounded downloader errors into core errors.
- Port the deterministic fake downloader tests.

Exit criteria:

- Rust transcript and metadata outputs match the TypeScript implementation.
- Concurrent and stale-file tests pass.

### Phase 3 — CLI product

Deliverables:

- Implement transcript, info, doctor, version, and component commands.
- Support text, JSON, and file output.
- Define documented exit codes.
- Add CLI end-to-end tests.

Exit criteria:

- `yt-trsc URL` works without the TypeScript runtime.
- Output is safe for interactive users and shell agents.

### Phase 4 — MCP product

Deliverables:

- Implement the stdio server with the official Rust MCP SDK.
- Implement both current tools through the shared application service.
- Add generic config output and provider helpers.
- Add real protocol handshake/tool tests.

Exit criteria:

- Codex, Claude Code, and a generic MCP test client can use the same executable.
- Protocol stdout remains clean under success and failure.

### Phase 5 — Component manager and installer

Deliverables:

- Define the signed/checksummed component manifest.
- Install and resolve pinned `yt-dlp` and Deno.
- Add atomic update and rollback.
- Add the idempotent installer and `doctor` remediation messages.

Exit criteria:

- A clean supported machine can install and retrieve a transcript without Bun, Node, Python, or FFmpeg.

### Phase 6 — Rust-hosted UI and optional media

Deliverables:

- Embed the existing minimal assets.
- Port the required HTTP routes to Axum.
- Add bounded jobs and cleanup.
- Port MP3/MP4 adapters behind optional FFmpeg availability.
- Run the browser end-to-end test against Rust.

Exit criteria:

- `yt-trsc serve --open` provides the current simple experience.
- Transcript mode works without FFmpeg.
- MP3/MP4 either work or show a precise installation action.

### Phase 7 — Release pipeline and cutover

Deliverables:

- Build and smoke-test the target matrix.
- Publish checksums and component manifests.
- Make Rust installation the README quick start.
- Mark the TypeScript CLI/MCP as deprecated.
- Keep the TypeScript web implementation temporarily only if required for rollback.

Exit criteria:

- Release installation succeeds on clean target machines.
- CLI, MCP, UI, and security parity gates pass.
- No default user path requires Bun or a repository checkout.

### Phase 8 — Remove legacy product paths

Deliverables:

- Remove TypeScript CLI/MCP/server code after at least one stable Rust release.
- Retain useful frontend assets and migration fixtures.
- Remove npm publishing if it no longer serves a deliberate purpose.
- Archive migration-only parity tests after equivalent Rust coverage exists.

Exit criteria:

- Rust is the only canonical implementation.
- Documentation and CI contain no accidental legacy path.

## 17. Suggested pull-request sequence

Keep review units small and independently verifiable:

1. `docs: define yt-trsc contracts and Rust architecture`
2. `build: add Rust workspace and quality gates`
3. `feat(core): port URL and caption parsing`
4. `feat(core): add yt-dlp metadata and transcript adapter`
5. `feat(cli): add transcript and info commands`
6. `feat(mcp): add Rust stdio tools and protocol tests`
7. `feat(components): manage yt-dlp and Deno`
8. `feat(installer): add release installation and doctor flow`
9. `feat(ui): serve embedded UI from Rust`
10. `feat(media): port optional MP3 and MP4 paths`
11. `release: publish native yt-trsc artifacts`
12. `chore: retire legacy TypeScript product paths`

Do not mix broad formatting changes, dependency upgrades, and behavior ports in the same PR.

## 18. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Rust behavior diverges from the tested TypeScript implementation | Golden parity fixtures and dual-run integration tests. |
| MCP Rust SDK changes | Pin the SDK, wrap it in the MCP adapter, and test the protocol over stdio. |
| YouTube changes break extraction | Keep `yt-dlp` replaceable and run scheduled live smoke tests. |
| Managed components become stale or compromised | Pinned manifests, checksum verification, atomic updates, and rollback. |
| Rewrite stalls while two implementations coexist | Phase exit criteria, small PRs, and no new TypeScript product features without a Rust migration decision. |
| UI work expands scope | Reuse the current static assets and prohibit a frontend framework during the rewrite. |
| Native Windows permissions differ | Ship WSL first; add native Windows only with ACL and installer tests. |
| MP3/MP4 delays the core product | Make transcript/MCP release independent of optional FFmpeg media parity. |
| Users interpret “transcript” as speech-to-text | State caption-only behavior clearly and model transcript sources for a later fallback. |

## 19. Definition of done

The Rust rewrite is complete when:

- `yt-trsc URL` returns clean transcript text on a supported clean machine.
- `yt-trsc mcp` works with Codex, Claude Code, and the protocol integration client.
- `yt-trsc serve --open` serves the embedded minimal UI.
- Metadata and caption results match approved TypeScript golden fixtures.
- The default installation does not require Bun, Node, Python, or FFmpeg.
- Managed `yt-dlp` and Deno versions are verified and diagnosable.
- FFmpeg is optional and media failures do not affect transcript use.
- All required Rust formatting, lint, unit, integration, MCP, HTTP, browser, security, and release checks pass.
- Installation and upgrades are idempotent and recoverable.
- Documentation uses `yt-trsc` as the primary command.
- The TypeScript product implementation is removed or explicitly retained only as a documented rollback artifact.

## 20. First implementation milestone

The first milestone should stop after a real vertical slice:

```text
yt-trsc transcript <fixture URL>
  -> Rust CLI
  -> Rust transcript service
  -> Rust yt-dlp adapter
  -> deterministic fake yt-dlp
  -> cleaned text on stdout
```

That milestone must include formatting, Clippy, unit tests, adapter tests, and parity with the current transcript fixture. Do not begin MCP, UI, installers, or component downloads until this slice is clean and reviewable.
