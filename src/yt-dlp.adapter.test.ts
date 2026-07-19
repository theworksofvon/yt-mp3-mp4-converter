import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  convertToMp3,
  convertToMp4,
  downloadTranscript,
  getVideoInfo,
  sanitizeOutputPath,
} from "./yt-dlp";
import {
  ConversionError,
  ConverterError,
  FileSizeError,
  RateLimitError,
  VideoNotAccessibleError,
} from "./errors";

const FIXTURE_YT_DLP = resolve(import.meta.dir, "../test/fixtures/bin/yt-dlp");
const BASE_URL = "https://www.youtube.com/watch?v=";

let outputDir = "";
let originalYtDlpPath: string | undefined;

beforeAll(async () => {
  originalYtDlpPath = process.env.YT_DLP_PATH;
  process.env.YT_DLP_PATH = FIXTURE_YT_DLP;
  outputDir = await mkdtemp(resolve(tmpdir(), "yt-converter-adapter-"));
});

afterAll(async () => {
  if (originalYtDlpPath === undefined) {
    delete process.env.YT_DLP_PATH;
  } else {
    process.env.YT_DLP_PATH = originalYtDlpPath;
  }
  await rm(outputDir, { recursive: true, force: true });
});

describe("yt-dlp adapter with a deterministic executable", () => {
  test("reads and normalizes video metadata", async () => {
    expect(await getVideoInfo(`${BASE_URL}fixture12345`)).toEqual({
      id: "fixture12345",
      title: "Fixture Video: E2E Test",
      duration: 42,
      thumbnail: "https://example.test/thumbnail.jpg",
      uploader: "Fixture Channel",
      upload_date: "20260718",
    });
  });

  test("rejects oversized metadata", async () => {
    await expect(getVideoInfo(`${BASE_URL}oversized11`)).rejects.toBeInstanceOf(FileSizeError);
  });

  test("reports invalid metadata JSON", async () => {
    try {
      await getVideoInfo(`${BASE_URL}invalid-json`);
      throw new Error("expected metadata parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConverterError);
      expect((error as ConverterError).code).toBe("PARSE_ERROR");
    }
  });

  test("creates MP3 and MP4 outputs", async () => {
    const mp3Path = await convertToMp3(`${BASE_URL}fixture12345`, resolve(outputDir, "audio"));
    const mp4Path = await convertToMp4(`${BASE_URL}fixture12345`, resolve(outputDir, "video"));

    expect(new Uint8Array(await Bun.file(mp3Path).arrayBuffer()).slice(0, 3)).toEqual(
      new Uint8Array([0x49, 0x44, 0x33])
    );
    expect(new TextDecoder().decode(new Uint8Array(await Bun.file(mp4Path).arrayBuffer()).slice(4, 8))).toBe("ftyp");
  });

  test("downloads and cleans an English transcript", async () => {
    const transcriptPath = await downloadTranscript(
      `${BASE_URL}fixture12345`,
      resolve(outputDir, "transcript")
    );

    expect(await Bun.file(transcriptPath).text()).toBe(
      "Hello & welcome to the fixture transcript.\nThis proves the shared download path works.\n"
    );
  });

  test("reports missing and empty captions", async () => {
    await mkdir(resolve(outputDir, "missing"), { recursive: true });

    await expect(
      downloadTranscript(`${BASE_URL}no-captions`, resolve(outputDir, "missing", "transcript"))
    ).rejects.toBeInstanceOf(ConversionError);
    await expect(
      downloadTranscript(`${BASE_URL}empty-captions`, resolve(outputDir, "empty-transcript"))
    ).rejects.toBeInstanceOf(ConversionError);
  });

  test("preserves accessible downloader error types", async () => {
    await expect(getVideoInfo(`${BASE_URL}private-video`)).rejects.toBeInstanceOf(VideoNotAccessibleError);
    await expect(getVideoInfo(`${BASE_URL}rate-limited`)).rejects.toBeInstanceOf(RateLimitError);
  });

  test("sanitizes output filenames and rejects directory traversal", () => {
    expect(sanitizeOutputPath(resolve(outputDir, "A title?.txt"))).toEndWith("A_title.txt");
    expect(() => sanitizeOutputPath(`${outputDir}/../escape`)).toThrow();
  });
});
