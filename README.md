# YouTube to MP3/MP4 Converter

A simple web application to convert YouTube videos to MP3 (audio) or MP4 (video) format. Built with Bun and Hono.

## Quick Start

```bash
# Install dependencies
bun install

# Start the server
bun run src/index.ts
```

Open http://localhost:3000 in your browser.

## Requirements

- [Bun](https://bun.sh) (v1.0+)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - YouTube downloader
- [ffmpeg](https://ffmpeg.org) - Media processing

### Installing Dependencies

**Ubuntu/Debian:**
```bash
# Install yt-dlp
sudo apt install yt-dlp
# or via pip
pip install yt-dlp

# Install ffmpeg
sudo apt install ffmpeg
```

**macOS:**
```bash
brew install yt-dlp ffmpeg
```

**Windows:**
```bash
# Using winget
winget install yt-dlp ffmpeg

# Or download from:
# https://github.com/yt-dlp/yt-dlp/releases
# https://ffmpeg.org/download.html
```

## Usage

1. Start the server: `bun run src/index.ts`
2. Open http://localhost:3000
3. Paste a YouTube URL
4. Select MP3 or MP4 format
5. Click Convert and wait for download

## Docker

```bash
# Build and run with Docker Compose
docker compose up --build

# Or build manually
docker build -t yt-converter .
docker run -p 3000:3000 yt-converter
```

## API Reference

### Health Check
```
GET /health
```
Returns server status and yt-dlp/ffmpeg versions.

### Convert Video
```
POST /api/convert
Content-Type: application/json

{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "format": "mp3"  // or "mp4"
}
```

Response:
```json
{
  "jobId": "1234567890-abcd1234",
  "status": "processing",
  "checkUrl": "/api/jobs/1234567890-abcd1234"
}
```

### Check Job Status
```
GET /api/jobs/:jobId
```

Response:
```json
{
  "jobId": "1234567890-abcd1234",
  "status": "completed",
  "format": "mp3",
  "videoInfo": {
    "title": "Video Title",
    "duration": 180
  },
  "filename": "Video_Title.mp3"
}
```

### Download File
```
GET /downloads/:jobId
```
Returns the converted file for download.

## Configuration

Environment variables (optional):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DOWNLOAD_DIR` | `/tmp/yt-converter-downloads` | Temp file storage |
| `MAX_FILE_SIZE_MB` | `500` | Max file size for MP3 |

Create a `.env` file or set environment variables:
```bash
PORT=8080 bun run src/index.ts
```

## Project Structure

```
yt-mp3-mp4-converter/
├── src/
│   ├── index.ts        # Server and routes
│   ├── yt-dlp.ts       # yt-dlp wrapper
│   ├── errors.ts       # Error classes
│   └── schemas.ts      # Validation schemas
├── public/
│   ├── index.html      # Frontend UI
│   └── app.js          # Frontend logic
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Running Tests

```bash
bun test
```

## License

MIT
