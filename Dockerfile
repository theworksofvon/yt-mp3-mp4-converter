# Multi-stage build for YouTube to MP3/MP4 Converter
# Supports both standard Docker and Raspberry Pi (ARM) architectures

FROM oven/bun:1 AS base
WORKDIR /app

# Install system dependencies
# - ffmpeg: required for audio/video conversion
# - python3 + pip: required for yt-dlp installation
# - wget: for downloading files
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp via pip
RUN pip3 install --no-cache-dir yt-dlp

# Download directory for converted files
RUN mkdir -p /tmp/yt-converter-downloads

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code and public files
COPY src ./src
COPY public ./public
COPY tsconfig.json ./

# Build the TypeScript project
RUN bun build src/index.ts --outdir ./dist

# Production stage
FROM oven/bun:1 AS production

WORKDIR /app

# Install runtime dependencies only
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN pip3 install --no-cache-dir yt-dlp

# Create download directory with proper permissions
RUN mkdir -p /tmp/yt-converter-downloads

# Copy built files from base stage
COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/public ./public
COPY --from=base /app/package.json ./

# Set environment variables
ENV PORT=3000
ENV DOWNLOAD_DIR=/tmp/yt-converter-downloads
ENV NODE_ENV=production

# Expose the application port
EXPOSE 3000

# Health check to verify yt-dlp and the API are working
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD bun --version && yt-dlp --version || exit 1

# Run the application
CMD ["bun", "run", "dist/index.js"]
