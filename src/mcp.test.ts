import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";

describe("MCP server", () => {
  test("completes the stdio handshake and lists provider-neutral tools", async () => {
    const cacheDir = await mkdtemp(resolve(tmpdir(), "yt-converter-mcp-test-"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve(import.meta.dir, "mcp.ts")],
      env: {
        ...getDefaultEnvironment(),
        YT_DLP_PATH: resolve(import.meta.dir, "../test/fixtures/bin/yt-dlp"),
        MCP_TRANSCRIPT_DIR: cacheDir,
      },
      stderr: "pipe",
    });
    const client = new Client({
      name: "youtube-transcript-mcp-test",
      version: "1.0.0",
    });

    try {
      await client.connect(transport);
      const result = await client.listTools();

      expect(result.tools.map((tool) => tool.name).sort()).toEqual([
        "get_youtube_transcript",
        "get_youtube_video_info",
      ]);
      expect(result.tools.every((tool) => tool.inputSchema.type === "object")).toBe(true);

      const info = await client.callTool({
        name: "get_youtube_video_info",
        arguments: { url: "https://www.youtube.com/watch?v=fixture12345" },
      });
      expect(info.isError).not.toBe(true);
      expect(JSON.stringify(info.content)).toContain("Fixture Video: E2E Test");

      const transcript = await client.callTool({
        name: "get_youtube_transcript",
        arguments: {
          url: "https://www.youtube.com/watch?v=fixture12345",
          includeMetadata: false,
        },
      });
      expect(transcript.isError).not.toBe(true);
      expect(JSON.stringify(transcript.content)).toContain("shared download path works");

      const unavailable = await client.callTool({
        name: "get_youtube_transcript",
        arguments: { url: "https://www.youtube.com/watch?v=no-captions" },
      });
      expect(unavailable.isError).toBe(true);
    } finally {
      await client.close();
      await rm(cacheDir, { recursive: true, force: true });
    }
  }, 10_000);
});
