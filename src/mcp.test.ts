import { describe, expect, test } from "bun:test";
import { chmod, lstat, mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";

const FIXTURE_YT_DLP = resolve(import.meta.dir, "../test/fixtures/bin/yt-dlp");
const FIXTURE_WHISPER_CLI = resolve(import.meta.dir, "../test/fixtures/bin/whisper-cli");
const FIXTURE_FFMPEG = resolve(import.meta.dir, "../test/fixtures/bin/ffmpeg");
const FIXTURE_MODEL = resolve(import.meta.dir, "../test/fixtures/bin/fixture-model.bin");
const FIXTURE_URL = "https://www.youtube.com/watch?v=fixture12345";

async function withClient<T>(
  env: Record<string, string>,
  use: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(import.meta.dir, "mcp.ts")],
    env: {
      ...getDefaultEnvironment(),
      YT_DLP_PATH: FIXTURE_YT_DLP,
      ...env,
    },
    stderr: "pipe",
  });
  const client = new Client({
    name: "youtube-transcript-mcp-test",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);
    return await use(client);
  } finally {
    await client.close();
  }
}

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
        "get_video_transcript",
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

  test("get_video_transcript falls back to speech-to-text for caption-less videos", async () => {
    const cacheDir = await mkdtemp(resolve(tmpdir(), "yt-converter-mcp-stt-"));

    try {
      const transcript = await withClient({
        MCP_TRANSCRIPT_DIR: cacheDir,
        WHISPER_CLI_PATH: FIXTURE_WHISPER_CLI,
        FFMPEG_PATH: FIXTURE_FFMPEG,
        WHISPER_MODEL_PATH: FIXTURE_MODEL,
      }, (client) =>
        client.callTool({
          name: "get_video_transcript",
          arguments: { url: "https://vimeo.com/no-captions-123", includeMetadata: false },
        }),
      );

      expect(transcript.isError).not.toBe(true);
      expect(JSON.stringify(transcript.content)).toContain("No captions were needed");
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  }, 10_000);

  test("tightens a permissive transcript cache directory to owner-only", async () => {
    const cacheDir = await mkdtemp(resolve(tmpdir(), "yt-converter-mcp-perm-"));
    await chmod(cacheDir, 0o777);

    try {
      const transcript = await withClient({ MCP_TRANSCRIPT_DIR: cacheDir }, (client) =>
        client.callTool({
          name: "get_youtube_transcript",
          arguments: { url: FIXTURE_URL, includeMetadata: false },
        }),
      );

      expect(transcript.isError).not.toBe(true);
      expect((await stat(cacheDir)).mode & 0o777).toBe(0o700);
      const [callDirectory] = (await readdir(cacheDir)).filter((entry) => entry.startsWith("transcript-"));
      expect(callDirectory).toBeDefined();
      expect((await stat(resolve(cacheDir, callDirectory!))).mode & 0o777).toBe(0o700);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  }, 10_000);

  test("publishes each transcript in a new cache child and ignores a predictable symlink", async () => {
    if (process.platform === "win32") return;

    const cacheDir = await mkdtemp(resolve(tmpdir(), "yt-converter-mcp-isolation-"));
    const protectedPath = resolve(cacheDir, "protected.txt");
    const predictablePath = resolve(cacheDir, "fixture12345-Fixture_Video_E2E_Test.txt");
    await Bun.write(protectedPath, "do not overwrite\n");
    await symlink(protectedPath, predictablePath);

    try {
      const results = await withClient({
        MCP_TRANSCRIPT_DIR: cacheDir,
        YT_DLP_FIXTURE_ECHO_OUTPUT: "1",
      }, (client) =>
        Promise.all([
          client.callTool({
            name: "get_youtube_transcript",
            arguments: { url: FIXTURE_URL, includeMetadata: false },
          }),
          client.callTool({
            name: "get_youtube_transcript",
            arguments: { url: FIXTURE_URL, includeMetadata: false },
          }),
        ]),
      );

      expect(results.every((result) => result.isError !== true)).toBe(true);
      const payloads = results.map((result) => JSON.stringify(result.content));
      expect(payloads[0]).not.toBe(payloads[1]);
      expect(payloads.every((payload) => payload.includes("transcript-"))).toBe(true);
      expect(await Bun.file(protectedPath).text()).toBe("do not overwrite\n");
      expect((await lstat(predictablePath)).isSymbolicLink()).toBe(true);

      const callDirectories = (await readdir(cacheDir))
        .filter((entry) => entry.startsWith("transcript-"));
      expect(callDirectories).toHaveLength(2);
      expect(callDirectories[0]).not.toBe(callDirectories[1]);
      for (const directory of callDirectories) {
        const files = await readdir(resolve(cacheDir, directory));
        expect(files).toHaveLength(1);
        expect(files[0]).toEndWith(".txt");
      }
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  }, 10_000);

  test("defaults to a UID-scoped cache directory", async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), "yt-converter-mcp-tmp-"));
    const cacheName = `yt-transcript-mcp-cache-${process.getuid?.()}`;

    try {
      const transcript = await withClient({ TMPDIR: tempRoot }, (client) =>
        client.callTool({
          name: "get_youtube_transcript",
          arguments: { url: FIXTURE_URL, includeMetadata: false },
        }),
      );

      expect(transcript.isError).not.toBe(true);
      expect(await readdir(tempRoot)).toEqual([cacheName]);
      expect((await stat(resolve(tempRoot, cacheName))).mode & 0o777).toBe(0o700);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 10_000);
});
