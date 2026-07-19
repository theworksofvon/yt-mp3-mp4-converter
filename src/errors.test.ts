import { describe, expect, test } from "bun:test";
import {
  ConversionError,
  ConverterError,
  FileSizeError,
  InvalidUrlError,
  NetworkTimeoutError,
  RateLimitError,
  VideoNotAccessibleError,
  parseYtDlpError,
} from "./errors";

describe("converter errors", () => {
  test("serialize stable API error fields", () => {
    const error = new ConverterError("broken", "BROKEN", 418);
    expect(error.toJSON()).toEqual({
      error: "broken",
      code: "BROKEN",
      statusCode: 418,
    });
  });

  test("specialized errors expose the expected codes and statuses", () => {
    expect(new InvalidUrlError("bad")).toMatchObject({ code: "INVALID_URL", statusCode: 400 });
    expect(new VideoNotAccessibleError()).toMatchObject({ code: "VIDEO_NOT_ACCESSIBLE", statusCode: 400 });
    expect(new NetworkTimeoutError(5)).toMatchObject({ code: "NETWORK_TIMEOUT", statusCode: 504 });
    expect(new ConversionError("transcript", "missing")).toMatchObject({
      code: "CONVERSION_FAILED_TRANSCRIPT",
      statusCode: 500,
    });
    expect(new FileSizeError(500, 600).message).toContain("was 600MB");
    expect(new FileSizeError(500).message).not.toContain("was");

    const rateLimit = new RateLimitError(30);
    expect(rateLimit).toMatchObject({ code: "RATE_LIMITED", statusCode: 429, retryAfter: 30 });
    expect(new RateLimitError().retryAfter).toBeUndefined();
  });
});

describe("parseYtDlpError", () => {
  test.each([
    ["private video", "VIDEO_NOT_ACCESSIBLE"],
    ["members-only content", "VIDEO_NOT_ACCESSIBLE"],
    ["ERROR: Video unavailable", "VIDEO_NOT_ACCESSIBLE"],
    ["ERROR 404 not found", "VIDEO_NOT_ACCESSIBLE"],
    ["This video is age restricted", "VIDEO_NOT_ACCESSIBLE"],
    ["not available in your country", "VIDEO_NOT_ACCESSIBLE"],
    ["blocked by copyright", "VIDEO_NOT_ACCESSIBLE"],
    ["request timed out", "NETWORK_TIMEOUT"],
    ["too many requests", "RATE_LIMITED"],
    ["rate limit reached", "RATE_LIMITED"],
    ["unexpected downloader failure", "DOWNLOAD_FAILED"],
  ])("maps %s to %s", (stderr, expectedCode) => {
    expect(parseYtDlpError(stderr)).toMatchObject({ code: expectedCode });
  });

  test("bounds generic downloader output", () => {
    const error = parseYtDlpError("x".repeat(500));
    expect(error.message.length).toBeLessThan(250);
  });
});
