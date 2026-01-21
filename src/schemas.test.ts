import { test, expect, describe } from "bun:test";
import {
  convertRequestSchema,
  jobIdSchema,
  Sanitizer,
} from "./schemas";

describe("convertRequestSchema", () => {
  test("accepts valid convert requests", () => {
    const validRequests = [
      { url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", format: "mp3" },
      { url: "https://youtu.be/jNQXAC9IVRw", format: "mp4" },
      { url: "https://www.youtube.com/shorts/jNQXAC9IVRw", format: "mp3" },
      { url: "youtube.com/watch?v=jNQXAC9IVRw", format: "mp4" },
      { url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", format: "mp3", quality: "high" },
    ];

    for (const request of validRequests) {
      const result = convertRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.url).toBeDefined();
        expect(result.data.format).toBeDefined();
      }
    }
  });

  test("rejects invalid URLs", () => {
    const invalidRequests = [
      { url: "", format: "mp3" },
      { url: "not a url", format: "mp3" },
      { url: "https://example.com", format: "mp4" },
      { url: "https://vimeo.com/123", format: "mp3" },
    ];

    for (const request of invalidRequests) {
      const result = convertRequestSchema.safeParse(request);
      expect(result.success).toBe(false);
    }
  });

  test("rejects URLs with command injection attempts", () => {
    const maliciousRequests = [
      { url: "https://youtube.com/watch?v=abc; rm -rf /", format: "mp3" },
      { url: "https://youtube.com/watch?v=abc && malicious", format: "mp4" },
      { url: "https://youtube.com/watch?v=abc`whoami`", format: "mp3" },
      { url: "https://youtube.com/watch?v=abc$(evil)", format: "mp4" },
      { url: "https://youtube.com/watch?v=abc\nmalicious", format: "mp3" },
      { url: "https://youtube.com/watch?v=abc\tmalicious", format: "mp4" },
      { url: "https://youtube.com/watch?v=abc\x00null", format: "mp3" },
    ];

    for (const request of maliciousRequests) {
      const result = convertRequestSchema.safeParse(request);
      expect(result.success).toBe(false);
    }
  });

  test("rejects invalid formats", () => {
    const invalidRequests = [
      { url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", format: "wav" },
      { url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", format: "avi" },
      { url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", format: "" },
      { url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", format: "MP3" }, // Case sensitive
    ];

    for (const request of invalidRequests) {
      const result = convertRequestSchema.safeParse(request);
      expect(result.success).toBe(false);
    }
  });

  test("rejects requests with missing required fields", () => {
    const invalidRequests = [
      { format: "mp3" }, // Missing url
      { url: "https://www.youtube.com/watch?v=jNQXAC9IVRw" }, // Missing format
      {}, // Missing both
    ];

    for (const request of invalidRequests) {
      const result = convertRequestSchema.safeParse(request);
      expect(result.success).toBe(false);
    }
  });

  test("rejects URLs that are too long", () => {
    const tooLongUrl = "https://www.youtube.com/watch?v=" + "a".repeat(500);
    const result = convertRequestSchema.safeParse({
      url: tooLongUrl,
      format: "mp3",
    });
    expect(result.success).toBe(false);
  });

  test("adds https:// protocol to URLs without protocol", () => {
    const result = convertRequestSchema.safeParse({
      url: "youtube.com/watch?v=jNQXAC9IVRw",
      format: "mp3",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toMatch(/^https:\/\//);
    }
  });

  test("validates quality parameter when provided", () => {
    const validQuality = { url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", format: "mp3", quality: "high" };
    const invalidQuality = { url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", format: "mp3", quality: "ultra" };

    expect(convertRequestSchema.safeParse(validQuality).success).toBe(true);
    expect(convertRequestSchema.safeParse(invalidQuality).success).toBe(false);
  });
});

describe("jobIdSchema", () => {
  test("accepts valid job IDs", () => {
    const validJobIds = [
      "1234567890-abc123de",
      "1704067200000-1a2b3c4d",
      "job-123-456",
      "ABC123-xyz-789",
    ];

    for (const jobId of validJobIds) {
      const result = jobIdSchema.safeParse(jobId);
      expect(result.success).toBe(true);
    }
  });

  test("rejects invalid job IDs", () => {
    const invalidJobIds = [
      "", // Empty
      "job;rm-rf", // Command injection
      "job && malicious", // Command injection
      "job\x00null", // Null byte
      "job/../../../etc", // Path traversal
      "a".repeat(101), // Too long
    ];

    for (const jobId of invalidJobIds) {
      const result = jobIdSchema.safeParse(jobId);
      expect(result.success).toBe(false);
    }
  });
});

describe("Sanitizer", () => {
  test("string sanitization works correctly", () => {
    expect(Sanitizer.string("normal text")).toBe("normal text");
    expect(Sanitizer.string("text\x00with\x01control")).toBe("textwithcontrol");
    expect(Sanitizer.string("a".repeat(2000), 100).length).toBe(100);
  });

  test("filename sanitization works correctly", () => {
    expect(Sanitizer.filename("normal.mp3")).toBe("normal.mp3");
    expect(Sanitizer.filename("video<>:\"|?*.mp3")).toBe("video.mp3");
    expect(Sanitizer.filename("../../../etc/passwd")).toBe("etcpasswd");
    expect(Sanitizer.filename("")).toBe("unnamed");
  });

  test("url sanitization works correctly", () => {
    expect(Sanitizer.url("https://youtube.com/watch?v=abc")).toBe("https://youtube.com/watch?v=abc");
    expect(Sanitizer.url("  https://youtube.com/watch?v=abc  ")).toBe("https://youtube.com/watch?v=abc");
    expect(Sanitizer.url("https://youtube.com/watch?v=abc\x00")).toBe("https://youtube.com/watch?v=abc");
    expect(Sanitizer.url("").length).toBe(0);
  });
});
