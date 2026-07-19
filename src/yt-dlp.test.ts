import { test, expect, beforeAll, describe } from "bun:test";
import {
  isValidYouTubeUrl,
  hasCommandInjection,
  getVideoInfo,
  convertToMp3,
  convertToMp4,
  captionsToPlainText,
  sanitizeFilename,
  sanitizeString,
  sanitizeAndValidateYouTubeUrl,
  generateJobId,
  YOUTUBE_REGEX,
} from "./yt-dlp";
import { InvalidUrlError } from "./errors";

// Check if yt-dlp is available in PATH
let hasYtDlp = false;
const RUN_INTEGRATION_TESTS = process.env.RUN_INTEGRATION_TESTS === "1";
const integrationTest = RUN_INTEGRATION_TESTS ? test : test.skip;

async function checkYtDlpAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["yt-dlp", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return true;
  } catch {
    return false;
  }
}

// Before running tests, check for yt-dlp availability
beforeAll(async () => {
  if (!RUN_INTEGRATION_TESTS) {
    console.warn("\nIntegration tests skipped. Run `bun run test:integration` to enable live YouTube downloads.\n");
    return;
  }

  hasYtDlp = await checkYtDlpAvailable();
  if (!hasYtDlp) {
    console.warn("\n⚠️  yt-dlp not found in PATH. Integration tests will be skipped.");
    console.warn("   Install with: pip install yt-dlp\n");
  }
});

// Test URLs for different video types
const TEST_URLS = {
  // Primary test video (~1 minute, public, small file size for fast tests)
  primary: "https://www.youtube.com/watch?v=bLVKTbxPmcg",
  // youtu.be format of primary test video
  shortFormat: "https://youtu.be/bLVKTbxPmcg",
  // Short video (~4 minutes)
  short: "https://www.youtube.com/watch?v=bsL7ZnKIAhs",
  // Medium video (~15 minutes)
  medium: "https://www.youtube.com/watch?v=y76vpLnuT54",
  // Long video (~28 minutes)
  long: "https://www.youtube.com/watch?v=_S3m0V_ZF_Q",
};

// Test directory for downloads
const TEST_DOWNLOAD_DIR = "/tmp/yt-converter-test";

describe("URL Validation", () => {
  test("validates standard YouTube watch URLs", () => {
    expect(isValidYouTubeUrl("https://www.youtube.com/watch?v=jNQXAC9IVRw")).toBe(true);
    expect(isValidYouTubeUrl("http://www.youtube.com/watch?v=jNQXAC9IVRw")).toBe(true);
    expect(isValidYouTubeUrl("https://youtube.com/watch?v=jNQXAC9IVRw")).toBe(true);
    expect(isValidYouTubeUrl("youtube.com/watch?v=jNQXAC9IVRw")).toBe(true);
  });

  test("validates YouTube Shorts URLs", () => {
    expect(isValidYouTubeUrl("https://www.youtube.com/shorts/jNQXAC9IVRw")).toBe(true);
    expect(isValidYouTubeUrl("https://youtube.com/shorts/jNQXAC9IVRw")).toBe(true);
    expect(isValidYouTubeUrl("youtube.com/shorts/jNQXAC9IVRw")).toBe(true);
  });

  test("validates youtu.be short URLs", () => {
    expect(isValidYouTubeUrl("https://youtu.be/jNQXAC9IVRw")).toBe(true);
    expect(isValidYouTubeUrl("http://youtu.be/jNQXAC9IVRw")).toBe(true);
    expect(isValidYouTubeUrl("youtu.be/jNQXAC9IVRw")).toBe(true);
  });

  test("rejects invalid URLs", () => {
    expect(isValidYouTubeUrl("https://example.com")).toBe(false);
    expect(isValidYouTubeUrl("not a url")).toBe(false);
    expect(isValidYouTubeUrl("")).toBe(false);
    expect(isValidYouTubeUrl("https://vimeo.com/123456")).toBe(false);
  });

  test("rejects URLs with command injection attempts", () => {
    expect(isValidYouTubeUrl("https://youtube.com/watch?v=abc; rm -rf /")).toBe(false);
    expect(isValidYouTubeUrl("https://youtube.com/watch?v=abc && cat /etc/passwd")).toBe(false);
    expect(isValidYouTubeUrl("https://youtube.com/watch?v=abc| malicious")).toBe(false);
    expect(isValidYouTubeUrl("https://youtube.com/watch?v=abc`whoami`")).toBe(false);
    expect(isValidYouTubeUrl("https://youtube.com/watch?v=abc$(evil)")).toBe(false);
    expect(isValidYouTubeUrl("https://youtube.com/watch?v=abc../../etc/passwd")).toBe(false);
  });
});

describe("Command Injection Detection", () => {
  test("detects shell metacharacters", () => {
    expect(hasCommandInjection("https://youtube.com/watch?v=abc; rm -rf")).toBe(true);
    expect(hasCommandInjection("https://youtube.com/watch?v=abc && ls")).toBe(true);
    expect(hasCommandInjection("https://youtube.com/watch?v=abc | grep")).toBe(true);
    expect(hasCommandInjection("https://youtube.com/watch?v=abc`whoami`")).toBe(true);
    expect(hasCommandInjection("https://youtube.com/watch?v=abc$(evil)")).toBe(true);
  });

  test("detects directory traversal", () => {
    expect(hasCommandInjection("../../../etc/passwd")).toBe(true);
    expect(hasCommandInjection("..\\..\\windows\\system32")).toBe(true);
  });

  test("allows valid URLs without injection", () => {
    expect(hasCommandInjection("https://youtube.com/watch?v=abc123")).toBe(false);
    expect(hasCommandInjection("https://youtu.be/abc-123_xyz")).toBe(false);
  });
});

describe("Filename Sanitization", () => {
  test("removes invalid characters", () => {
    expect(sanitizeFilename('video<>:?*.mp3')).toBe("video.mp3");
    // The / character is removed, not replaced with underscore (spaces are replaced)
    expect(sanitizeFilename('video/name.mp3')).toBe("videoname.mp3");
    expect(sanitizeFilename('video name.mp3')).toBe("video_name.mp3");
  });

  test("replaces spaces with underscores", () => {
    expect(sanitizeFilename("my video title")).toBe("my_video_title");
    expect(sanitizeFilename("multiple   spaces")).toBe("multiple_spaces");
  });

  test("limits length to 200 characters", () => {
    const longName = "a".repeat(300);
    expect(sanitizeFilename(longName).length).toBe(200);
  });

  test("handles special characters in YouTube titles", () => {
    // :|?* are removed, / is removed, spaces are replaced, brackets are NOT removed
    // Note: | triggers the severe threat check, so it returns sanitized_filename
    expect(sanitizeFilename("Video: Episode 1 - Part 1/2")).toBe("Video_Episode_1_-_Part_12");
    expect(sanitizeFilename("My Video [Official]")).toBe("My_Video_[Official]");
    expect(sanitizeFilename("My Video (Official)")).toBe("My_Video_(Official)");
  });

  test("handles malicious filenames", () => {
    // Filenames with shell metacharacters return safe default
    expect(sanitizeFilename("video; rm -rf /")).toBe("sanitized_filename");
    expect(sanitizeFilename("video`whoami`")).toBe("sanitized_filename");
    expect(sanitizeFilename("video$evil")).toBe("sanitized_filename");
    expect(sanitizeFilename("video\\malicious")).toBe("sanitized_filename");
  });

  test("handles edge cases", () => {
    expect(sanitizeFilename("")).toBe("unnamed");
    expect(sanitizeFilename(null as any)).toBe("unnamed");
    expect(sanitizeFilename(undefined as any)).toBe("unnamed");
    expect(sanitizeFilename(".hidden")).toBe("hidden");
    expect(sanitizeFilename("/absolute/path")).toBe("absolutepath");
    expect(sanitizeFilename("file   with   spaces")).toBe("file_with_spaces");
  });
});

describe("Job ID Generation", () => {
  test("generates unique job IDs", () => {
    const id1 = generateJobId();
    const id2 = generateJobId();

    expect(id1).not.toBe(id2);
    expect(typeof id1).toBe("string");
    expect(id1.length).toBeGreaterThan(10);
  });

  test("job IDs contain timestamp and UUID suffix", () => {
    const id = generateJobId();
    const parts = id.split("-");

    // Should have timestamp and UUID parts
    expect(parts.length).toBeGreaterThanOrEqual(2);
    // First part should be a timestamp (number)
    expect(Number.isNaN(Number.parseInt(parts[0] ?? "", 10))).toBe(false);
  });
});

describe("YouTube Regex Pattern", () => {
  test("matches various YouTube URL formats", () => {
    expect(YOUTUBE_REGEX.test("https://www.youtube.com/watch?v=jNQXAC9IVRw")).toBe(true);
    expect(YOUTUBE_REGEX.test("https://youtube.com/watch?v=jNQXAC9IVRw")).toBe(true);
    expect(YOUTUBE_REGEX.test("http://youtube.com/watch?v=jNQXAC9IVRw")).toBe(true);
    expect(YOUTUBE_REGEX.test("youtube.com/watch?v=jNQXAC9IVRw")).toBe(true);
    expect(YOUTUBE_REGEX.test("https://youtu.be/jNQXAC9IVRw")).toBe(true);
    expect(YOUTUBE_REGEX.test("https://www.youtube.com/shorts/jNQXAC9IVRw")).toBe(true);
  });

  test("does not match non-YouTube URLs", () => {
    expect(YOUTUBE_REGEX.test("https://vimeo.com/123")).toBe(false);
    expect(YOUTUBE_REGEX.test("https://example.com")).toBe(false);
  });
});

describe("Transcript Parsing", () => {
  test("converts VTT captions to readable plain text", () => {
    const captions = `WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:02.000
<c>Hello &amp; welcome</c>

00:00:02.000 --> 00:00:04.000
This is a <b>test</b>.
`;

    expect(captionsToPlainText(captions)).toBe("Hello & welcome\nThis is a test.\n");
  });

  test("removes SRT indexes, timing, metadata blocks, and duplicate lines", () => {
    const captions = `1
00:00:00,000 --> 00:00:01,000
Repeated line

2
00:00:01,000 --> 00:00:02,000
Repeated line

NOTE generated metadata
ignore this

3
00:00:02,000 --> 00:00:03,000
Final line
`;

    expect(captionsToPlainText(captions)).toBe("Repeated line\nFinal line\n");
  });

  test("keeps numeric spoken lines that are not SRT cue indexes", () => {
    const srt = `1
00:00:00,000 --> 00:00:02,000
2026

2
00:00:02,000 --> 00:00:04,000
3
2
1`;

    expect(captionsToPlainText(srt)).toBe("2026\n3\n2\n1\n");

    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
42

00:00:02.000 --> 00:00:04.000
was the answer.
`;

    expect(captionsToPlainText(vtt)).toBe("42\nwas the answer.\n");
  });
});

describe("Video Info Extraction", () => {
  // These tests require actual yt-dlp installation and network access
  integrationTest("fetches video info from a valid URL", async () => {
    if (!hasYtDlp) {
      console.warn("Skipping: yt-dlp not installed");
      return;
    }

    try {
      const info = await getVideoInfo(TEST_URLS.primary);

      expect(info).toBeDefined();
      expect(typeof info.id).toBe("string");
      expect(typeof info.title).toBe("string");
      expect(typeof info.duration).toBe("number");
      expect(info.duration).toBeGreaterThan(0);
      expect(typeof info.thumbnail).toBe("string");
      expect(typeof info.uploader).toBe("string");
      expect(typeof info.upload_date).toBe("string");
    } catch (error) {
      // Network errors are acceptable in test environment
      if (error instanceof Error && (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED"))) {
        console.warn("Skipping: Network unavailable");
        return;
      }
      throw error;
    }
  });

  test("throws InvalidUrlError for invalid URL", () => {
    expect(() => getVideoInfo("https://example.com")).toThrow(InvalidUrlError);
    expect(() => getVideoInfo("not a url")).toThrow(InvalidUrlError);
  });
});

describe("MP3 Conversion", () => {
  beforeAll(async () => {
    // Ensure test download directory exists
    await Bun.write(`${TEST_DOWNLOAD_DIR}/.gitkeep`, "");
  });

  integrationTest("converts YouTube video to MP3", async () => {
    if (!hasYtDlp) {
      console.warn("Skipping: yt-dlp not installed");
      return;
    }

    try {
      const outputPath = `${TEST_DOWNLOAD_DIR}/test-mp3-${Date.now()}`;
      const resultPath = await convertToMp3(TEST_URLS.primary, outputPath);

      expect(resultPath).toBeDefined();
      expect(resultPath.endsWith(".mp3")).toBe(true);

      // Verify file exists and has content
      const file = Bun.file(resultPath);
      expect(await file.exists()).toBe(true);
      expect(file.size).toBeGreaterThan(0);

      // Verify it's a valid MP3 by checking magic bytes
      const buffer = await file.arrayBuffer();
      const header = new Uint8Array(buffer.slice(0, 3));
      // MP3 files typically start with ID3 header (0x49 0x44 0x33) or sync bytes (0xFF)
      const isValidMp3 = (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) ||
                          (header[0] === 0xFF);
      expect(isValidMp3).toBe(true);

      // Clean up
      await Bun.file(resultPath).delete?.();
    } catch (error) {
      // Network errors are acceptable in test environment
      if (error instanceof Error && (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED"))) {
        console.warn("Skipping: Network unavailable");
        return;
      }
      throw error;
    }
  }, 120000); // 2 minute timeout for download

  integrationTest("converts youtu.be short URL to MP3", async () => {
    if (!hasYtDlp) {
      console.warn("Skipping: yt-dlp not installed");
      return;
    }

    try {
      const outputPath = `${TEST_DOWNLOAD_DIR}/test-mp3-shorturl-${Date.now()}`;
      const resultPath = await convertToMp3(TEST_URLS.shortFormat, outputPath);

      expect(resultPath).toBeDefined();
      expect(resultPath.endsWith(".mp3")).toBe(true);

      // Verify file exists and has content
      const file = Bun.file(resultPath);
      expect(await file.exists()).toBe(true);
      expect(file.size).toBeGreaterThan(0);

      // Clean up
      await Bun.file(resultPath).delete?.();
    } catch (error) {
      // Network errors are acceptable in test environment
      if (error instanceof Error && (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED"))) {
        console.warn("Skipping: Network unavailable");
        return;
      }
      throw error;
    }
  }, 120000); // 2 minute timeout for download

  integrationTest("converts short video (~4 min) to MP3", async () => {
    if (!hasYtDlp) {
      console.warn("Skipping: yt-dlp not installed");
      return;
    }

    try {
      const outputPath = `${TEST_DOWNLOAD_DIR}/test-mp3-short-${Date.now()}`;
      const resultPath = await convertToMp3(TEST_URLS.short, outputPath);

      expect(resultPath).toBeDefined();
      expect(resultPath.endsWith(".mp3")).toBe(true);

      const file = Bun.file(resultPath);
      expect(await file.exists()).toBe(true);
      expect(file.size).toBeGreaterThan(0);

      // Clean up
      await Bun.file(resultPath).delete?.();
    } catch (error) {
      if (error instanceof Error && (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED"))) {
        console.warn("Skipping: Network unavailable");
        return;
      }
      throw error;
    }
  }, 180000); // 3 minute timeout

  integrationTest("converts medium video (~15 min) to MP3", async () => {
    if (!hasYtDlp) {
      console.warn("Skipping: yt-dlp not installed");
      return;
    }

    try {
      const outputPath = `${TEST_DOWNLOAD_DIR}/test-mp3-medium-${Date.now()}`;
      const resultPath = await convertToMp3(TEST_URLS.medium, outputPath);

      expect(resultPath).toBeDefined();
      expect(resultPath.endsWith(".mp3")).toBe(true);

      const file = Bun.file(resultPath);
      expect(await file.exists()).toBe(true);
      expect(file.size).toBeGreaterThan(0);

      // Clean up
      await Bun.file(resultPath).delete?.();
    } catch (error) {
      if (error instanceof Error && (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED"))) {
        console.warn("Skipping: Network unavailable");
        return;
      }
      throw error;
    }
  }, 300000); // 5 minute timeout

  integrationTest("converts long video (~28 min) to MP3", async () => {
    if (!hasYtDlp) {
      console.warn("Skipping: yt-dlp not installed");
      return;
    }

    try {
      const outputPath = `${TEST_DOWNLOAD_DIR}/test-mp3-long-${Date.now()}`;
      const resultPath = await convertToMp3(TEST_URLS.long, outputPath);

      expect(resultPath).toBeDefined();
      expect(resultPath.endsWith(".mp3")).toBe(true);

      const file = Bun.file(resultPath);
      expect(await file.exists()).toBe(true);
      expect(file.size).toBeGreaterThan(0);

      // Clean up
      await Bun.file(resultPath).delete?.();
    } catch (error) {
      if (error instanceof Error && (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED"))) {
        console.warn("Skipping: Network unavailable");
        return;
      }
      throw error;
    }
  }, 600000); // 10 minute timeout
});

describe("MP4 Conversion", () => {
  beforeAll(async () => {
    // Ensure test download directory exists
    await Bun.write(`${TEST_DOWNLOAD_DIR}/.gitkeep`, "");
  });

  integrationTest("converts YouTube video to MP4", async () => {
    if (!hasYtDlp) {
      console.warn("Skipping: yt-dlp not installed");
      return;
    }

    try {
      const outputPath = `${TEST_DOWNLOAD_DIR}/test-mp4-${Date.now()}`;
      const resultPath = await convertToMp4(TEST_URLS.primary, outputPath);

      expect(resultPath).toBeDefined();
      expect(resultPath.endsWith(".mp4")).toBe(true);

      // Verify file exists and has content
      const file = Bun.file(resultPath);
      expect(await file.exists()).toBe(true);
      expect(file.size).toBeGreaterThan(0);

      // Verify it's a valid MP4 by checking magic bytes
      const buffer = await file.arrayBuffer();
      const header = new Uint8Array(buffer.slice(4, 8));
      // MP4 files have ftyp box at offset 4 (0x66 0x74 0x79 0x70)
      const isValidMp4 = header[0] === 0x66 && header[1] === 0x74 &&
                         header[2] === 0x79 && header[3] === 0x70;
      expect(isValidMp4).toBe(true);

      // Clean up
      await Bun.file(resultPath).delete?.();
    } catch (error) {
      // Network errors are acceptable in test environment
      if (error instanceof Error && (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED"))) {
        console.warn("Skipping: Network unavailable");
        return;
      }
      throw error;
    }
  }, 180000); // 3 minute timeout for download

  integrationTest("converts youtu.be short URL to MP4", async () => {
    if (!hasYtDlp) {
      console.warn("Skipping: yt-dlp not installed");
      return;
    }

    try {
      const outputPath = `${TEST_DOWNLOAD_DIR}/test-mp4-shorturl-${Date.now()}`;
      const resultPath = await convertToMp4(TEST_URLS.shortFormat, outputPath);

      expect(resultPath).toBeDefined();
      expect(resultPath.endsWith(".mp4")).toBe(true);

      // Verify file exists and has content
      const file = Bun.file(resultPath);
      expect(await file.exists()).toBe(true);
      expect(file.size).toBeGreaterThan(0);

      // Clean up
      await Bun.file(resultPath).delete?.();
    } catch (error) {
      // Network errors are acceptable in test environment
      if (error instanceof Error && (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED"))) {
        console.warn("Skipping: Network unavailable");
        return;
      }
      throw error;
    }
  }, 180000); // 3 minute timeout for download

  integrationTest("converts short video (~4 min) to MP4", async () => {
    if (!hasYtDlp) {
      console.warn("Skipping: yt-dlp not installed");
      return;
    }

    try {
      const outputPath = `${TEST_DOWNLOAD_DIR}/test-mp4-short-${Date.now()}`;
      const resultPath = await convertToMp4(TEST_URLS.short, outputPath);

      expect(resultPath).toBeDefined();
      expect(resultPath.endsWith(".mp4")).toBe(true);

      const file = Bun.file(resultPath);
      expect(await file.exists()).toBe(true);
      expect(file.size).toBeGreaterThan(0);

      // Clean up
      await Bun.file(resultPath).delete?.();
    } catch (error) {
      if (error instanceof Error && (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED"))) {
        console.warn("Skipping: Network unavailable");
        return;
      }
      throw error;
    }
  }, 300000); // 5 minute timeout

  integrationTest("converts medium video (~15 min) to MP4", async () => {
    if (!hasYtDlp) {
      console.warn("Skipping: yt-dlp not installed");
      return;
    }

    try {
      const outputPath = `${TEST_DOWNLOAD_DIR}/test-mp4-medium-${Date.now()}`;
      const resultPath = await convertToMp4(TEST_URLS.medium, outputPath);

      expect(resultPath).toBeDefined();
      expect(resultPath.endsWith(".mp4")).toBe(true);

      const file = Bun.file(resultPath);
      expect(await file.exists()).toBe(true);
      expect(file.size).toBeGreaterThan(0);

      // Clean up
      await Bun.file(resultPath).delete?.();
    } catch (error) {
      if (error instanceof Error && (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED"))) {
        console.warn("Skipping: Network unavailable");
        return;
      }
      throw error;
    }
  }, 600000); // 10 minute timeout

  integrationTest("converts long video (~28 min) to MP4", async () => {
    if (!hasYtDlp) {
      console.warn("Skipping: yt-dlp not installed");
      return;
    }

    try {
      const outputPath = `${TEST_DOWNLOAD_DIR}/test-mp4-long-${Date.now()}`;
      const resultPath = await convertToMp4(TEST_URLS.long, outputPath);

      expect(resultPath).toBeDefined();
      expect(resultPath.endsWith(".mp4")).toBe(true);

      const file = Bun.file(resultPath);
      expect(await file.exists()).toBe(true);
      expect(file.size).toBeGreaterThan(0);

      // Clean up
      await Bun.file(resultPath).delete?.();
    } catch (error) {
      if (error instanceof Error && (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED"))) {
        console.warn("Skipping: Network unavailable");
        return;
      }
      throw error;
    }
  }, 900000); // 15 minute timeout
});

describe("Input Sanitization", () => {
  test("rejects command injection in convertToMp3", () => {
    const maliciousUrl = "https://youtube.com/watch?v=abc; rm -rf /tmp";
    const outputPath = `${TEST_DOWNLOAD_DIR}/test-malicious-${Date.now()}`;

    expect(() => convertToMp3(maliciousUrl, outputPath)).toThrow(InvalidUrlError);
  });

  test("hasCommandInjection detects path traversal attempts", () => {
    expect(hasCommandInjection("../../../etc/passwd")).toBe(true);
    expect(hasCommandInjection("/tmp/test/../../../etc/passwd")).toBe(true);
  });

  test("hasCommandInjection detects enhanced injection patterns", () => {
    // Double pipe (OR operator)
    expect(hasCommandInjection("https://youtube.com/watch?v=abc || rm -rf")).toBe(true);

    // Double ampersand (AND operator)
    expect(hasCommandInjection("https://youtube.com/watch?v=abc && malicious")).toBe(true);

    // Newline injection
    expect(hasCommandInjection("https://youtube.com/watch?v=abc\nrm -rf")).toBe(true);

    // Tab characters
    expect(hasCommandInjection("https://youtube.com/watch?v=abc\tmalicious")).toBe(true);

    // Null byte
    expect(hasCommandInjection("https://youtube.com/watch?v=abc\x00malicious")).toBe(true);

    // Command substitution
    expect(hasCommandInjection("https://youtube.com/watch?v=abc$(whoami)")).toBe(true);
    expect(hasCommandInjection("https://youtube.com/watch?v=abc`ls`")).toBe(true);

    // Variable expansion
    expect(hasCommandInjection("https://youtube.com/watch?v=abc${HOME}")).toBe(true);

    // Hex escape
    expect(hasCommandInjection("https://youtube.com/watch?v=abc\\x2evil")).toBe(true);

    // Unicode escape
    expect(hasCommandInjection("https://youtube.com/watch?v=abc\\u002evil")).toBe(true);

    // File redirects
    expect(hasCommandInjection("https://youtube.com/watch?v=abc >/etc/passwd")).toBe(true);

    // URL-encoded attacks
    expect(hasCommandInjection("https://youtube.com/watch?v=abc%3brm")).toBe(true);
    expect(hasCommandInjection("https://youtube.com/watch?v=abc%7cls")).toBe(true);
  });

  test("hasCommandInjection allows valid YouTube URLs", () => {
    expect(hasCommandInjection("https://www.youtube.com/watch?v=jNQXAC9IVRw")).toBe(false);
    expect(hasCommandInjection("https://youtu.be/jNQXAC9IVRw")).toBe(false);
    expect(hasCommandInjection("https://www.youtube.com/shorts/jNQXAC9IVRw")).toBe(false);
    expect(hasCommandInjection("https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share")).toBe(false);
    expect(hasCommandInjection("https://www.youtube.com/watch?v=abc123-def_456")).toBe(false);
  });

  test("sanitizeString removes control characters", () => {
    expect(sanitizeString("normal text")).toBe("normal text");
    expect(sanitizeString("text\x00with\x01null\x02bytes")).toBe("textwithnullbytes");
    // Note: \r (0x0D) is removed along with other control chars
    // \n (0x0A) and \t (0x09) are preserved for multi-line text inputs
    expect(sanitizeString("text\rwith\rcarriage")).toBe("textwithcarriage");
    expect(sanitizeString("text\nwith\tnewlines")).toBe("text\nwith\tnewlines");
  });

  test("sanitizeString limits length", () => {
    const longString = "a".repeat(2000);
    expect(sanitizeString(longString, 100).length).toBe(100);
    expect(sanitizeString(longString, 500).length).toBe(500);
  });

  test("sanitizeAndValidateYouTubeUrl validates correct URLs", () => {
    const validUrls = [
      "https://www.youtube.com/watch?v=jNQXAC9IVRw",
      "https://youtu.be/jNQXAC9IVRw",
      "https://www.youtube.com/shorts/jNQXAC9IVRw",
      "youtube.com/watch?v=jNQXAC9IVRw",
      "www.youtube.com/watch?v=jNQXAC9IVRw",
    ];

    for (const url of validUrls) {
      const result = sanitizeAndValidateYouTubeUrl(url);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.sanitized).toBeDefined();
    }
  });

  test("sanitizeAndValidateYouTubeUrl rejects invalid URLs", () => {
    const invalidUrls = [
      "", // Empty
      "not a url", // Not a URL
      "https://example.com", // Not YouTube
      "https://youtube.com/watch?v=abc; rm -rf", // Command injection
      "https://youtube.com/watch?v=../../etc/passwd", // Path traversal
      "https://youtube.com/watch?v=abc`whoami`", // Command substitution
    ];

    for (const url of invalidUrls) {
      const result = sanitizeAndValidateYouTubeUrl(url);
      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    }
  });

  test("sanitizeAndValidateYouTubeUrl enforces length limits", () => {
    const tooLongUrl = "https://www.youtube.com/watch?v=" + "a".repeat(500);
    const result = sanitizeAndValidateYouTubeUrl(tooLongUrl);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("URL is too long");
  });

  test("sanitizeAndValidateYouTubeUrl extracts valid video ID", () => {
    // Valid 11-character video ID
    const result = sanitizeAndValidateYouTubeUrl("https://www.youtube.com/watch?v=jNQXAC9IVRw");
    expect(result.isValid).toBe(true);

    // Invalid video ID (too short)
    const invalidResult = sanitizeAndValidateYouTubeUrl("https://www.youtube.com/watch?v=abc");
    expect(invalidResult.isValid).toBe(false);
  });
});
