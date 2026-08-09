# Test inventory and migration map

This inventory assigns every current test case to exactly one migration disposition:

| Disposition | Meaning |
| --- | --- |
| `rust-unit` | Port the behavior to a pure Rust domain, parser, validation, error, or serialization test. |
| `rust-adapter` | Port it to a deterministic Rust process/filesystem/component-adapter test. |
| `rust-protocol` | Re-express it against one canonical Rust CLI, MCP, HTTP, or installer interface. |
| `parity` | Keep it temporarily and run TypeScript and Rust against the same normalized expectation until cutover. |
| `retire` | Remove it for the stated reason instead of porting the legacy test. |

Parameterized cases are listed by variant so none are hidden by a single `test.each` declaration. Tests marked `retire` include their replacement or rationale.

## `src/errors.test.ts`

| ID | Current case | Disposition | Rust replacement |
| --- | --- | --- | --- |
| `TI-ERROR-01` | converter errors / serialize stable API error fields | `rust-unit` | Serialize typed core errors and adapter error bodies. |
| `TI-ERROR-02` | converter errors / specialized errors expose expected codes and statuses | `rust-unit` | Assert every stable lowercase category and adapter mapping. |
| `TI-ERROR-03A–K` | parseYtDlpError table: private; members-only; video unavailable; 404/not found; age restricted; country restricted; blocked/copyright; timed out; too many requests; rate limit; unexpected failure | `rust-unit` | Table-test precedence and mapping to `video_unavailable`, `network_timeout`, `rate_limited`, or `downloader_failed`. |
| `TI-ERROR-04` | parseYtDlpError / bounds generic downloader output | `rust-unit` | Assert bounded, redacted downloader detail. |

## `src/schemas.test.ts`

| ID | Current case | Disposition | Rust replacement |
| --- | --- | --- | --- |
| `TI-SCHEMA-01` | convertRequestSchema / accepts valid convert requests | `rust-protocol` | HTTP request decoding for watch, short, shorts, protocol-less, transcript, and ignored quality inputs. |
| `TI-SCHEMA-02` | rejects invalid URLs | `rust-protocol` | `POST /api/convert` invalid-URL table. |
| `TI-SCHEMA-03` | rejects command-injection URLs | `rust-protocol` | HTTP boundary malicious-input table before adapter invocation. |
| `TI-SCHEMA-04` | rejects invalid formats | `rust-protocol` | Case-sensitive format enum response tests. |
| `TI-SCHEMA-05` | rejects missing required fields | `rust-protocol` | Missing URL/format request-body tests. |
| `TI-SCHEMA-06` | rejects overlong URLs | `rust-protocol` | 500-character boundary tests. |
| `TI-SCHEMA-07` | adds HTTPS to protocol-less URLs | `rust-protocol` | Normalized request passed to the fake gateway. |
| `TI-SCHEMA-08` | validates optional quality | `parity` | Preserve the ignored legacy field only while the old UI/API shape is dual-run; remove when the legacy media API is retired. |
| `TI-SCHEMA-09` | jobIdSchema / accepts valid IDs | `rust-protocol` | HTTP job/download parameter acceptance. |
| `TI-SCHEMA-10` | jobIdSchema / rejects invalid IDs | `rust-protocol` | HTTP job/download validation body/status tests. |
| `TI-SCHEMA-11` | Sanitizer / string sanitization | `rust-unit` | Typed string/control-character normalization. |
| `TI-SCHEMA-12` | Sanitizer / filename sanitization | `rust-unit` | Filesystem-safe title fixtures. |
| `TI-SCHEMA-13` | Sanitizer / URL sanitization | `rust-unit` | URL trim/control/length normalization. |

## `src/yt-dlp.adapter.test.ts`

| ID | Current case | Disposition | Rust replacement |
| --- | --- | --- | --- |
| `TI-ADAPTER-01` | reads and normalizes video metadata | `rust-adapter` | Fake yt-dlp JSON to typed `VideoInfo`. |
| `TI-ADAPTER-02` | reads oversized metadata unless caller downloads that format | `rust-adapter` | File-size enforcement enabled only for the downloaded MP3 stream. |
| `TI-ADAPTER-03` | keeps oversized transcripts and MP4 downloads reachable | `rust-adapter` | Oversized metadata does not block transcript/MP4. |
| `TI-ADAPTER-04` | derives poll deadlines from per-format budgets | `rust-unit` | Serialize metadata plus format timeout budgets. |
| `TI-ADAPTER-05` | reports invalid metadata JSON | `rust-adapter` | Malformed stdout maps to `downloader_failed`. |
| `TI-ADAPTER-06` | creates MP3 and MP4 outputs | `rust-adapter` | Fake artifacts and magic-byte checks. |
| `TI-ADAPTER-07` | downloads and cleans an English transcript | `rust-adapter` | Isolated caption artifact through parser to final text. |
| `TI-ADAPTER-08` | reports missing and empty captions | `rust-adapter` | Both paths map to `captions_unavailable`. |
| `TI-ADAPTER-09` | never returns captions left by an earlier request | `rust-adapter` | Per-call temporary isolation and stale-file nonselection. |
| `TI-ADAPTER-10` | preserves accessible downloader error types | `rust-adapter` | Private and rate-limit stderr retain stable categories. |
| `TI-ADAPTER-11` | sanitizes output filenames and rejects traversal | `rust-adapter` | Filesystem adapter rejects unsafe server paths. |
| `TI-ADAPTER-12` | falls back to speech-to-text when a URL has no captions | `rust-adapter` | Caption absence triggers the whisper fallback and notifies the caller. |
| `TI-ADAPTER-13` | transcribes a local video file with speech-to-text | `rust-adapter` | Local file input bypasses captions and produces a transcript. |
| `TI-ADAPTER-14` | reads metadata for non-YouTube sources only when allowed | `rust-adapter` | `allowAnySource` accepts non-YouTube URLs and local files; otherwise rejected. |

## `src/yt-dlp.test.ts`

| ID | Current case | Disposition | Rust replacement or retirement reason |
| --- | --- | --- | --- |
| `TI-UNIT-01A–E` | URL Validation: standard watch; Shorts; youtu.be; invalid URLs; command injection | `rust-unit` | `YoutubeUrl` parsing and rejection table. |
| `TI-UNIT-02A–C` | Command Injection Detection: shell metacharacters; traversal; valid URLs | `rust-unit` | URL parser/security table; do not port regex implementation details that typed parsing replaces. |
| `TI-UNIT-03A–F` | Filename Sanitization: invalid characters; spaces; 200-char limit; title punctuation; malicious filenames; edge cases | `rust-unit` | Safe filename normalization table. |
| `TI-UNIT-04A–B` | Job ID Generation: uniqueness; timestamp/UUID form | `rust-unit` | Job ID generator format and collision tests. |
| `TI-UNIT-05A–B` | YouTube Regex Pattern: accepted formats; rejected hosts | `rust-unit` | Typed URL acceptance table. |
| `TI-UNIT-06` | Transcript Parsing / converts VTT captions | `rust-unit` | VTT markup/entity/timing fixture. |
| `TI-UNIT-07` | removes SRT indexes, timing, metadata blocks, duplicates | `rust-unit` | SRT and metadata-block fixture. |
| `TI-UNIT-08` | keeps numeric spoken lines that are not cue indexes | `rust-unit` | SRT/VTT numeric-line regression fixtures. |
| `TI-LIVE-01` | Video Info Extraction / fetches live video info | `retire` | Replace with the plan's single scheduled, non-blocking metadata-and-caption smoke; normal Rust CI remains offline. |
| `TI-UNIT-09` | Video Info Extraction / invalid URL | `rust-unit` | Gateway is never invoked for invalid typed URLs. |
| `TI-LIVE-02A–E` | MP3 Conversion: primary; short URL; ~4 min; ~15 min; ~28 min | `retire` | Five opt-in network/media-duration cases are redundant and flaky; deterministic adapter artifacts cover conversion, while the scheduled smoke is transcript-focused. |
| `TI-LIVE-03A–E` | MP4 Conversion: primary; short URL; ~4 min; ~15 min; ~28 min | `retire` | Same rationale as MP3; release artifact smoke tests will cover optional media without YouTube in normal CI. |
| `TI-UNIT-10A–J` | Input Sanitization: convert injection; traversal; enhanced patterns; valid URLs; control removal; length; valid URL normalization; invalid URLs; URL length; ID extraction | `rust-unit` | Consolidated typed URL/string boundary tables. |

## `src/mcp.test.ts`

| ID | Current case | Disposition | Rust replacement |
| --- | --- | --- | --- |
| `TI-MCP-01` | handshake, list provider-neutral tools, call both tools, missing-caption error | `parity` | Spawn both stdio servers, handshake, list tools, and compare normalized success/error results until Rust is canonical. |
| `TI-MCP-02` | tightens permissive cache root and child to owner-only | `rust-adapter` | POSIX cache-root ownership/mode adapter test. |
| `TI-MCP-03` | unique cache child per call and ignores predictable symlink | `rust-adapter` | Concurrent per-call isolation and symlink non-overwrite. |
| `TI-MCP-04` | defaults to UID-scoped cache directory | `rust-adapter` | Platform directory resolution and POSIX mode. |

## `test/cli.e2e.test.ts`

| ID | Current case | Disposition | Rust replacement |
| --- | --- | --- | --- |
| `TI-CLI-01` | downloads MP3 output | `parity` | Dual-run legacy and Rust media CLI artifact/exit behavior until optional media cutover. |
| `TI-CLI-02` | downloads MP4 output | `parity` | Same dual-run boundary for MP4. |
| `TI-CLI-03` | downloads transcript output | `parity` | Compare legacy file/status behavior and the explicitly changed Rust stdout contract against approved goldens. |
| `TI-CLI-04` | inaccessible video exits nonzero | `parity` | Compare message/category and document legacy exit `1` versus the new stable exit table. |

## `test/api.e2e.test.ts`

| ID | Current case | Disposition | Rust replacement |
| --- | --- | --- | --- |
| `TI-API-01` | serves frontend and dependency health | `parity` | Run static and health requests against both servers until the Rust UI hosts the assets. |
| `TI-API-02` | transcript job through polling and download | `parity` | Compare normalized `202`, completed job, headers, and transcript body. |
| `TI-API-03A` | MP3 job and media type | `parity` | Dual-run optional media HTTP path and magic bytes. |
| `TI-API-03B` | MP4 job and media type | `parity` | Dual-run optional media HTTP path and magic bytes. |
| `TI-API-04` | poll deadlines outlast each format budget | `rust-protocol` | Rust HTTP serialization for MP3/MP4/transcript deadlines. |
| `TI-API-05` | validation, missing job, incomplete download, failed conversion | `parity` | Compare statuses and normalized error bodies for UI-used paths. |

## `test/setup.e2e.test.ts`

| ID | Current case | Disposition | Retirement reason |
| --- | --- | --- | --- |
| `TI-SETUP-01` | shell syntax and safe sourcing | `retire` | The Bun/source-checkout installer is a legacy product path; the native idempotent installer receives separate release tests. |
| `TI-SETUP-02` | compares Bun versions without external tools | `retire` | Rust installation has no Bun runtime minimum. |
| `TI-SETUP-03` | `--check` fails on outdated Bun without host changes | `retire` | Replaced by `yt-trsc doctor` and native component-version tests. |

## `e2e/web.pw.ts`

| ID | Current case | Disposition | Rust replacement |
| --- | --- | --- | --- |
| `TI-WEB-01` | user downloads transcript and sees actionable failure | `parity` | Run the same browser journey against TypeScript and then Rust-hosted UI through Phase 6. |
| `TI-WEB-02` | UI gives up at server-advertised deadline | `parity` | Preserve the browser deadline behavior while the current UI is reused. |

## `test/golden.e2e.test.ts`

| ID | Current case | Disposition | Rust replacement |
| --- | --- | --- | --- |
| `TI-GOLDEN-01` | CLI, MCP, and HTTP surfaces match checked-in goldens | `parity` | Feed both implementations the deterministic fake yt-dlp, normalize only paths/timestamps/job IDs, and compare the same checked-in bytes. Remove the TypeScript half only after cutover. |

## Contract coverage and required migration assertions

This table is the Phase 0 ownership check. Every externally visible contract section in `contracts.md` has at least one migration test owner; additions to that document must add a row here.

| Contract | Migration owner | Required assertion |
| --- | --- | --- |
| `PRODUCT-01` | `TI-ADAPTER-08`, `TI-GOLDEN-01` | Caption absence fails as `captions_unavailable` when the caller disables the STT fallback. |
| `STT-01` | `TI-ADAPTER-12`–`TI-ADAPTER-14`, `TI-GOLDEN-01` | Caption-less URLs and local files transcribe locally; missing components map to `component_missing`. |
| `CLI-01` | `TI-CLI-01`–`TI-CLI-04` | Accepted commands, usage, prompting, trimming, ignored extras, and exit behavior. Add the missing usage/prompt variants when the Rust CLI begins. |
| `CLI-02` | `TI-CLI-01`–`TI-CLI-03`, `TI-GOLDEN-01` | Exact status streams, artifacts, filenames, and success exit. |
| `CLI-03` | `TI-CLI-04`, `TI-GOLDEN-01` | Invalid URL, missing captions, generic downloader failure, stream separation, and legacy exit `1`. |
| `CLI-04` | `TI-GOLDEN-01` | Freeze the lack of legacy structured output, then add Rust protocol tests for the new versioned JSON shape. |
| HTTP common/static | `TI-API-01`, `TI-WEB-01` | CORS/static assets/process-local behavior used by the browser. Add bounded-job cleanup tests in Phase 6 because cleanup is new. |
| `HTTP-01` | `TI-SCHEMA-01`–`TI-SCHEMA-08`, `TI-API-02`, `TI-API-04`, `TI-GOLDEN-01` | Body validation/normalization plus exact accepted response and deadlines. |
| `HTTP-02` | `TI-SCHEMA-09`, `TI-SCHEMA-10`, `TI-API-02`, `TI-API-05`, `TI-GOLDEN-01` | Invalid/missing and all three job states with normalized nondeterminism. |
| `HTTP-03` | `TI-API-02`, `TI-API-03A`, `TI-API-03B`, `TI-API-05`, `TI-GOLDEN-01` | Validation, incomplete/missing paths, content types, disposition, and bodies. Add otherwise-unreachable missing-output/serve-exception adapter cases in Phase 6. |
| `HTTP-04` | `TI-API-01` | Healthy and spawn-failure shapes; add explicit nonzero-exit regression before changing the legacy behavior. |
| `HTTP-05` | `TI-ERROR-01`, `TI-ERROR-02`, `TI-API-05` | Synchronous, validation, internal, and asynchronous error translations. |
| `MCP-01` | `TI-MCP-01` | Real stdio handshake, identity, clean protocol stdout, tool discovery, and annotations. |
| `MCP-02` | `TI-MCP-01`, `TI-GOLDEN-01` | Input schema and exact metadata text result. |
| `MCP-03` | `TI-MCP-01`, `TI-GOLDEN-01` | Default/false metadata behavior and exact transcript text. |
| `MCP-04` | `TI-MCP-01`–`TI-MCP-04`, `TI-GOLDEN-01` | `isError` shape, cache defaults, permissions, isolation, retained output, and path normalization. |
| `CAPTION-01` | `TI-ADAPTER-07`–`TI-ADAPTER-09`, `TI-MCP-03` | yt-dlp argument intent, English selection, isolation, cleanup, and no stale selection. Add multi-language/manual-vs-auto filename fixtures in Phase 2. |
| `CAPTION-02` | `TI-UNIT-06`–`TI-UNIT-08` | VTT/SRT headers, blocks, timings, tags, overrides, whitespace, five entities, and numeric cue distinction. Extend the ported table for each documented entity. |
| `CAPTION-03` | `TI-UNIT-07`, `TI-ADAPTER-08`, `TI-GOLDEN-01` | Adjacent-only deduplication, final newline, empty rejection. Add a separated-duplicate case to make “adjacent only” explicit. |
| `ERROR-01` | `TI-ERROR-01`–`TI-ERROR-04`, `TI-ADAPTER-05`, `TI-ADAPTER-10`, `TI-GOLDEN-01` | Every current condition maps to one stable category and each delivery adapter preserves it. New component categories require Phase 2/5 fixtures because TypeScript does not distinguish them. |
