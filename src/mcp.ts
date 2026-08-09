#!/usr/bin/env bun

import { chmod, lstat, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import {
  downloadTranscript,
  getVideoInfo,
  sanitizeFilename,
} from "./yt-dlp.js";

// Transcripts are private to whoever ran the server, and the OS temporary
// directory is world-writable, so the default path is scoped to this user
// rather than shared under a predictable name.
function defaultCacheDir(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const name = uid === undefined ? "yt-transcript-mcp-cache" : `yt-transcript-mcp-cache-${uid}`;
  return resolve(tmpdir(), name);
}

const CACHE_DIR = process.env.MCP_TRANSCRIPT_DIR
  ? resolve(process.env.MCP_TRANSCRIPT_DIR)
  : defaultCacheDir();

/**
 * Creates the cache directory and refuses anything another user could have
 * planted there: a symlink, a non-directory, or a directory we do not own.
 */
async function ensureCacheDir(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true, mode: 0o700 });

  const stats = await lstat(CACHE_DIR);
  if (!stats.isDirectory()) {
    throw new Error(`Transcript cache path is not a directory: ${CACHE_DIR}. Set MCP_TRANSCRIPT_DIR to a directory you own.`);
  }

  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid !== undefined && stats.uid !== uid) {
    throw new Error(`Transcript cache directory is owned by another user: ${CACHE_DIR}. Set MCP_TRANSCRIPT_DIR to a directory you own.`);
  }

  if (process.platform !== "win32") {
    await chmod(CACHE_DIR, 0o700);
  }
}

interface TranscriptRequestOptions {
  /** Accept any http(s) URL or local file, not just YouTube. */
  allowAnySource?: boolean;
  /** Fall back to local speech-to-text when no captions exist. */
  sttFallback?: boolean;
}

async function getTranscript(
  url: string,
  options: TranscriptRequestOptions = {},
): Promise<{
  id: string;
  title: string;
  uploader: string;
  duration: number;
  uploadDate: string;
  transcript: string;
  transcriptPath: string;
}> {
  await ensureCacheDir();

  const { allowAnySource = false, sttFallback = false } = options;
  const videoInfo = await getVideoInfo(url, { allowAnySource });
  const callDirectory = await mkdtemp(`${CACHE_DIR}/transcript-`);
  if (process.platform !== "win32") {
    await chmod(callDirectory, 0o700);
  }
  const basePath = `${callDirectory}/${videoInfo.id}-${sanitizeFilename(videoInfo.title)}`;
  const transcriptPath = await downloadTranscript(url, basePath, {
    sttFallback,
    onSttFallback: () => {},
  });
  const transcript = await Bun.file(transcriptPath).text();

  return {
    id: videoInfo.id,
    title: videoInfo.title,
    uploader: videoInfo.uploader,
    duration: videoInfo.duration,
    uploadDate: videoInfo.upload_date,
    transcript,
    transcriptPath,
  };
}

const server = new McpServer({
  name: "youtube-transcript-context",
  version: "1.0.0",
});

function toolError(error: unknown) {
  return {
    isError: true as const,
    content: [{
      type: "text" as const,
      text: error instanceof Error ? error.message : String(error),
    }],
  };
}

server.registerTool(
  "get_youtube_video_info",
  {
    title: "Get YouTube Video Info",
    description: "Fetch metadata for a single YouTube video without downloading media.",
    inputSchema: {
      url: z.string().min(1).describe("YouTube video URL"),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async ({ url }) => {
    try {
      const info = await getVideoInfo(url);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            id: info.id,
            title: info.title,
            uploader: info.uploader,
            duration: info.duration,
            uploadDate: info.upload_date,
            thumbnail: info.thumbnail,
          }, null, 2),
        }],
      };
    } catch (error) {
      return toolError(error);
    }
  }
);

server.registerTool(
  "get_youtube_transcript",
  {
    title: "Get YouTube Transcript",
    description: "Download a YouTube transcript/captions file and return plain text with video metadata.",
    inputSchema: {
      url: z.string().min(1).describe("YouTube video URL"),
      includeMetadata: z.boolean().default(true).describe("Include video metadata before the transcript"),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async ({ url, includeMetadata }) => {
    try {
      const result = await getTranscript(url, { sttFallback: false });
      const metadata = [
        `Title: ${result.title}`,
        `Uploader: ${result.uploader}`,
        `Duration: ${result.duration} seconds`,
        `Upload date: ${result.uploadDate}`,
        `Video ID: ${result.id}`,
        `Transcript cache: ${result.transcriptPath}`,
      ].join("\n");

      return {
        content: [{
          type: "text" as const,
          text: includeMetadata ? `${metadata}\n\n${result.transcript}` : result.transcript,
        }],
      };
    } catch (error) {
      return toolError(error);
    }
  }
);

server.registerTool(
  "get_video_transcript",
  {
    title: "Get Video Transcript",
    description: "Fetch the transcript for any video URL or local media file, using existing captions or falling back to local speech-to-text when none exist. Accepts YouTube, Vimeo, Twitch, and other sites yt-dlp supports.",
    inputSchema: {
      url: z.string().min(1).describe("Video URL"),
      includeMetadata: z.boolean().default(true).describe("Include video metadata before the transcript"),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async ({ url, includeMetadata }) => {
    try {
      const result = await getTranscript(url, { allowAnySource: true, sttFallback: true });
      const metadata = [
        `Title: ${result.title}`,
        `Uploader: ${result.uploader || "(unavailable)"}`,
        `Duration: ${result.duration} seconds`,
        `Upload date: ${result.uploadDate || "(unavailable)"}`,
        `Video ID: ${result.id}`,
        `Transcript cache: ${result.transcriptPath}`,
      ].join("\n");

      return {
        content: [{
          type: "text" as const,
          text: includeMetadata ? `${metadata}\n\n${result.transcript}` : result.transcript,
        }],
      };
    } catch (error) {
      return toolError(error);
    }
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
