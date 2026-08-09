import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  FORMAT_TIMEOUT_SECONDS,
  METADATA_TIMEOUT_SECONDS,
  convertToMp3,
  convertToMp4,
  downloadTranscript,
  getVideoInfo,
  pollTimeoutSeconds,
  sanitizeOutputPath,
} from "./yt-dlp";
import {
  ConversionError,
  ConverterError,
  FileSizeError,
  InvalidUrlError,
  RateLimitError,
  VideoNotAccessibleError,
} from "./errors";

const FIXTURE_YT_DLP = resolve(import.meta.dir, "../test/fixtures/bin/yt-dlp");
const FIXTURE_WHISPER_CLI = resolve(import.meta.dir, "../test/fixtures/bin/whisper-cli");
const FIXTURE_FFMPEG = resolve(import.meta.dir, "../test/fixtures/bin/ffmpeg");
const BASE_URL = "https://www.youtube.com/watch?v=";
const STT_TRANSCRIPT = "This is the local speech-to-text fixture transcript.\nNo captions were needed.\n";

let outputDir = "";
let modelPath = "";
let originalYtDlpPath: string | undefined;
let originalWhisperCliPath: string | undefined;
let originalFfmpegPath: string | undefined;
let originalWhisperModelPath: string | undefined;

beforeAll(async () => {
  originalYtDlpPath = process.env.YT_DLP_PATH;
  originalWhisperCliPath = process.env.WHISPER_CLI_PATH;
  originalFfmpegPath = process.env.FFMPEG_PATH;
  originalWhisperModelPath = process.env.WHISPER_MODEL_PATH;
  process.env.YT_DLP_PATH = FIXTURE_YT_DLP;
  process.env.WHISPER_CLI_PATH = FIXTURE_WHISPER_CLI;
  process.env.FFMPEG_PATH = FIXTURE_FFMPEG;
  outputDir = await mkdtemp(resolve(tmpdir(), "yt-converter-adapter-"));
  modelPath = resolve(outputDir, "fixture-model.bin");
  await Bun.write(modelPath, "fixture-model-bytes");
  process.env.WHISPER_MODEL_PATH = modelPath;
});

afterAll(async () => {
  if (originalYtDlpPath === undefined) delete process.env.YT_DLP_PATH;
  else process.env.YT_DLP_PATH = originalYtDlpPath;
  if (originalWhisperCliPath === undefined) delete process.env.WHISPER_CLI_PATH;
  else process.env.WHISPER_CLI_PATH = originalWhisperCliPath;
  if (originalFfmpegPath === undefined) delete process.env.FFMPEG_PATH;
  else process.env.FFMPEG_PATH = originalFfmpegPath;
  if (originalWhisperModelPath === undefined) delete process.env.WHISPER_MODEL_PATH;
  else process.env.WHISPER_MODEL_PATH = originalWhisperModelPath;
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

  test("reads oversized metadata unless the caller downloads that format", async () => {
    expect(await getVideoInfo(`${BASE_URL}oversized11`)).toMatchObject({
      title: "Fixture Video: E2E Test",
    });
    expect(
      await getVideoInfo(`${BASE_URL}oversized11`, { enforceFileSizeLimit: false })
    ).toMatchObject({ title: "Fixture Video: E2E Test" });

    await expect(
      getVideoInfo(`${BASE_URL}oversized11`, { enforceFileSizeLimit: true })
    ).rejects.toBeInstanceOf(FileSizeError);
  });

  test("keeps oversized transcripts and MP4 downloads reachable", async () => {
    const transcriptPath = await downloadTranscript(
      `${BASE_URL}oversized11`,
      resolve(outputDir, "oversized-transcript")
    );
    expect(await Bun.file(transcriptPath).text()).toContain("shared download path works");

    const mp4Path = await convertToMp4(
      `${BASE_URL}oversized11`,
      resolve(outputDir, "oversized-video")
    );
    expect(await Bun.file(mp4Path).exists()).toBe(true);
  });

  test("derives poll deadlines from the per-format download budgets", () => {
    expect(pollTimeoutSeconds("mp3")).toBe(METADATA_TIMEOUT_SECONDS + FORMAT_TIMEOUT_SECONDS.mp3);
    expect(pollTimeoutSeconds("mp4")).toBe(METADATA_TIMEOUT_SECONDS + FORMAT_TIMEOUT_SECONDS.mp4);
    expect(pollTimeoutSeconds("transcript")).toBe(
      METADATA_TIMEOUT_SECONDS + FORMAT_TIMEOUT_SECONDS.transcript
    );
    // Speech-to-text runs near real time, so the transcript budget is the
    // longest of the three formats rather than the shortest.
    expect(pollTimeoutSeconds("transcript")).toBeGreaterThan(pollTimeoutSeconds("mp3"));
    expect(pollTimeoutSeconds("transcript")).toBeGreaterThan(pollTimeoutSeconds("mp4"));
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
    await expect(
      downloadTranscript(`${BASE_URL}no-captions`, resolve(outputDir, "missing", "transcript"), { sttFallback: false })
    ).rejects.toBeInstanceOf(ConversionError);
    await expect(
      downloadTranscript(`${BASE_URL}empty-captions`, resolve(outputDir, "empty-transcript"), { sttFallback: false })
    ).rejects.toBeInstanceOf(ConversionError);
  });

  test("falls back to speech-to-text when a URL has no captions", async () => {
    let fallbackNotified = false;
    const transcriptPath = await downloadTranscript(
      `${BASE_URL}no-captions`,
      resolve(outputDir, "stt-fallback"),
      { sttFallback: true, onSttFallback: () => { fallbackNotified = true; } },
    );

    expect(fallbackNotified).toBe(true);
    expect(await Bun.file(transcriptPath).text()).toBe(STT_TRANSCRIPT);
  });

  test("transcribes a local video file with speech-to-text", async () => {
    const localVideo = resolve(outputDir, "local-video.mp4");
    await Bun.write(localVideo, "fake-video-bytes");

    const transcriptPath = await downloadTranscript(
      localVideo,
      resolve(outputDir, "local-transcript"),
    );

    expect(await Bun.file(transcriptPath).text()).toBe(STT_TRANSCRIPT);
  });

  test("reads metadata for non-YouTube sources only when allowed", async () => {
    const urlInfo = await getVideoInfo("https://vimeo.com/123", { allowAnySource: true });
    expect(urlInfo).toMatchObject({ title: "Fixture Video: E2E Test" });

    const localVideo = resolve(outputDir, "local-meta.mp4");
    await Bun.write(localVideo, "fake-video-bytes");
    const localInfo = await getVideoInfo(localVideo, { allowAnySource: true });
    expect(localInfo).toMatchObject({ id: "local-meta", title: "local-meta", duration: 0 });

    await expect(getVideoInfo("https://vimeo.com/123")).rejects.toBeInstanceOf(InvalidUrlError);
  });

  test("rejects any-source URLs that target private or loopback hosts", async () => {
    for (const url of [
      "http://10.0.0.5/video.mp4",
      "http://192.168.1.10/video",
      "http://127.0.0.1/secret",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/video",
    ]) {
      await expect(getVideoInfo(url, { allowAnySource: true })).rejects.toBeInstanceOf(InvalidUrlError);
      await expect(downloadTranscript(url, resolve(outputDir, "denied"))).rejects.toBeInstanceOf(
        InvalidUrlError,
      );
    }

    // Public IP-literal hosts remain reachable.
    expect(await getVideoInfo("http://8.8.8.8/video", { allowAnySource: true })).toMatchObject({
      title: "Fixture Video: E2E Test",
    });
  });

  test("accepts local file paths that contain shell metacharacters", async () => {
    const localVideo = resolve(outputDir, "song (ripped) $pecial.mp4");
    await Bun.write(localVideo, "fake-video-bytes");

    const transcriptPath = await downloadTranscript(localVideo, resolve(outputDir, "special-transcript"));
    expect(await Bun.file(transcriptPath).text()).toBe(STT_TRANSCRIPT);
  });

  test("propagates downloader rate limits through the transcript path", async () => {
    await expect(
      downloadTranscript(`${BASE_URL}rate-limited`, resolve(outputDir, "rate-limit"), { sttFallback: false }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  test("never returns captions left behind by an earlier request", async () => {
    const base = resolve(outputDir, "stale");
    await Bun.write(
      `${base}.en.vtt`,
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nLeaked from another request.\n"
    );

    await expect(downloadTranscript(`${BASE_URL}no-captions`, base, { sttFallback: false })).rejects.toBeInstanceOf(
      ConversionError
    );
    expect(await Bun.file(`${base}.en.vtt`).exists()).toBe(true);

    const transcriptPath = await downloadTranscript(`${BASE_URL}fixture12345`, base);
    const transcript = await Bun.file(transcriptPath).text();
    expect(transcript).not.toContain("Leaked from another request.");
    expect(transcript).toContain("shared download path works");
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
