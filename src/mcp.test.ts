import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

describe("MCP server", () => {
  test("completes the stdio handshake and lists provider-neutral tools", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve(import.meta.dir, "mcp.ts")],
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
    } finally {
      await client.close();
    }
  }, 10_000);
});
