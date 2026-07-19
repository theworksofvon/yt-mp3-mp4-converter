import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const ROOT_DIR = resolve(import.meta.dir, "..");
const FIXTURE_YT_DLP = resolve(import.meta.dir, "fixtures/bin/yt-dlp");
const URL = "https://www.youtube.com/watch?v=fixture12345";

let outputDir = "";

beforeEach(async () => {
  outputDir = await mkdtemp(resolve(tmpdir(), "yt-converter-cli-e2e-"));
});

afterEach(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

async function runCli(format: "mp3" | "mp4" | "transcript") {
  const child = Bun.spawn([globalThis.process.execPath, "src/cli.ts", format, URL], {
    cwd: ROOT_DIR,
    env: {
      ...globalThis.process.env,
      YT_DLP_PATH: FIXTURE_YT_DLP,
      CLIENT_DOWNLOAD_DIR: outputDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("CLI end to end", () => {
  test.each(["mp3", "mp4", "transcript"] as const)("downloads %s output", async (format) => {
    const result = await runCli(format);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("Fetching video info");
    expect(result.stdout).toContain("Saved:");

    const files = await readdir(outputDir);
    const expectedExtension = format === "transcript" ? ".txt" : `.${format}`;
    expect(files.some((file) => file.endsWith(expectedExtension))).toBe(true);
  });

  test("returns a non-zero exit for inaccessible videos", async () => {
    const process = Bun.spawn([
      globalThis.process.execPath,
      "src/cli.ts",
      "transcript",
      "https://www.youtube.com/watch?v=private-video",
    ], {
      cwd: ROOT_DIR,
      env: {
        ...globalThis.process.env,
        YT_DLP_PATH: FIXTURE_YT_DLP,
        CLIENT_DOWNLOAD_DIR: outputDir,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(process.stderr).text(),
      process.exited,
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("private or members-only");
  });
});
