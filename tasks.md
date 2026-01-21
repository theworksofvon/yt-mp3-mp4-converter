# YouTube to MP3/MP4 Converter - Tasks

## Project Setup

- [x] Install core dependencies
  - `yt-dlp` (system package, required for video downloading) - NOTE: Requires manual system installation: `pip install yt-dlp` and `ffmpeg` via apt
  - `hono` (lightweight web framework, great for Bun) - INSTALLED v4.11.4
  - `zod` (input validation for URLs and format selection) - INSTALLED v4.3.5
  - `@hono/node-server` (or use Bun's native server) - Using Bun's native server

- [x] Create Docker environment files
  - `Dockerfile` with Debian/Raspberry base, Python, and yt-dlp installed
  - `docker-compose.yml` for easy local development
  - `.dockerignore` to exclude node_modules and unnecessary files

## Backend API

- [x] Create basic Hono server setup
  - File: `src/index.ts`
  - Configure CORS for frontend access
  - Set up JSON body parsing
  - Define port from environment variable (default 3000)

- [x] Implement health check endpoint
  - Route: `GET /health`
  - Verify yt-dlp is installed and accessible
  - Return service status

- [x] Create download/conversion endpoint
  - Route: `POST /api/convert`
  - Accept: `{ url: string, format: 'mp3' | 'mp4' }`
  - Validate URL is a valid YouTube URL using regex
  - Validate format is either 'mp3' or 'mp4'
  - Return job ID for tracking

- [x] Implement yt-dlp wrapper functions
  - File: `src/yt-dlp.ts`
  - `getVideoInfo(url)` - extract title, duration, thumbnail without downloading
  - `convertToMp3(url, outputPath)` - download and extract audio to MP3
  - `convertToMp4(url, outputPath)` - download video to MP4
  - Use Bun's `Process` or `spawnChildProcess` for async execution

- [x] Add file serving for downloads
  - Route: `GET /downloads/:jobId`
  - Stream the converted file to client
  - Clean up files after download (optional, via TTL)

- [x] Implement error handling
  - Handle invalid URLs
  - Handle restricted/private videos
  - Handle network timeouts
  - Handle yt-dlp failures
  - Return appropriate HTTP status codes (400, 500, etc.)

## Frontend (Simple)

- [x] Create basic HTML interface
  - File: `public/index.html`
  - Input field for YouTube URL
  - Radio buttons or dropdown for MP3/MP4 selection
  - Submit button

- [x] Add client-side JavaScript
  - File: `public/app.js`
  - Fetch API to call `/api/convert`
  - Display progress/loading state
  - Trigger download when conversion complete
  - Show error messages

## Docker & Deployment

- [x] Write Dockerfile
  - Base: `oven/bun:latest` or official `bun` image
  - Install `yt-dlp` via pip
  - Install `ffmpeg` (required for audio extraction)
  - Copy package files and run `bun install`
  - Expose port 3000
  - Set entrypoint to `bun run src/index.ts`

- [x] Create docker-compose.yml
  - Service definition for the app
  - Volume mount for `/tmp` downloads (optional)
  - Port mapping 3000:3000

- [x] Add environment variable handling
  - File: `.env.example`
  - `PORT=3000`
  - `MAX_FILE_SIZE_MB=500`
  - `DOWNLOAD_DIR=/tmp/downloads`

## Testing & Polish

- [x] Ensure all tests pass with full functionality verification
  - yt-dlp is installed, tests run with full functionality (not skipped)
  - Run `bun test` - all 53 tests passing (139s)
  - Fixed: spawnYtDlp now properly reads all stdout using `new Response(proc.stdout).text()`
  - Fixed: sanitizeOutputPath preserves directory paths while sanitizing filenames
  - Fixed: Removed --max-filesize for MP4 (was causing abort on videos >500MB)

- [x] Test MP3 conversion
  - `converts YouTube video to MP3` - verifies MP3 magic bytes (ID3 header or 0xFF sync)
  - `converts youtu.be short URL to MP3` - verifies short URL format works
  - `converts short video (~4 min) to MP3`
  - `converts medium video (~15 min) to MP3`
  - `converts long video (~28 min) to MP3`
  - Files created with valid content and size > 0

- [x] Test MP4 conversion
  - `converts YouTube video to MP4` - verifies MP4 ftyp box header
  - `converts youtu.be short URL to MP4` - verifies short URL format works
  - `converts short video (~4 min) to MP4`
  - `converts medium video (~15 min) to MP4`
  - `converts long video (~28 min) to MP4`
  - Files created with valid content and size > 0
  - Note: Removed --max-filesize for MP4 (videos are legitimately large)

- [x] Add input sanitization
  - Prevent command injection in yt-dlp calls
  - Validate all user inputs with Zod schemas

- [x] Create README.md
  - Project description
  - Quick start instructions (just `bun install` + `bun run src/index.ts`)
  - System requirements (yt-dlp, ffmpeg) with install commands for Linux/macOS/Windows
  - Docker instructions
  - Full API documentation (health, convert, jobs, download endpoints)
  - Configuration environment variables
  - Project structure

### Test Video Reference
- **Primary Test Video** (~1 min): https://www.youtube.com/watch?v=bLVKTbxPmcg
  - Used for quick unit tests and URL format validation
- **Short Video** (~4 min): https://www.youtube.com/watch?v=bsL7ZnKIAhs
- **Medium Video** (~15 min): https://www.youtube.com/watch?v=y76vpLnuT54
- **Long Video** (~28 min): https://www.youtube.com/watch?v=_S3m0V_ZF_Q

All videos are public and suitable for automated testing.

---

## References

### Resources
- **yt-dlp GitHub**: https://github.com/yt-dlp/yt-dlp
- **yt-dlp Documentation**: https://github.com/yt-dlp/yt-dlp#readme
- **yt-dlp Wiki**: https://github.com/yt-dlp/yt-dlp/wiki

### yt-dlp Commands
```bash
# Audio only (best quality MP3)
yt-dlp -x --audio-format mp3 -o "%(title)s.%(ext)s" [URL]

# Video (best quality MP4)
yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" -o "%(title)s.%(ext)s" [URL]

# Get video info only (JSON)
yt-dlp --dump-json [URL]
```

### URL Validation Pattern
```typescript
const YOUTUBE_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]+/
```

### Project Structure
```
yt-mp3-mp4-converter/
├── src/
│   ├── index.ts        # Hono server, routes
│   ├── yt-dlp.ts       # yt-dlp wrapper functions
│   ├── errors.ts       # Custom error classes
│   ├── schemas.ts      # Zod validation schemas
│   ├── yt-dlp.test.ts  # Tests for yt-dlp functions
│   └── schemas.test.ts # Tests for schemas
├── public/
│   ├── index.html      # Frontend UI
│   └── app.js          # Frontend logic
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .dockerignore
├── package.json
├── tsconfig.json
├── tasks.md            # This file
├── CHANGELOG.md        # Version history
└── README.md           # (needs expansion)
```

### Dependencies
- `hono` - Fast, lightweight web framework (works great with Bun)
- `zod` - Schema validation
- `yt-dlp` - YouTube downloader (system package via pip)
- `ffmpeg` - Media processing (system package, required by yt-dlp for conversion)
