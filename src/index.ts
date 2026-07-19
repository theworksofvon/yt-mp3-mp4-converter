import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { z } from "zod";
import {
  isValidYouTubeUrl,
  getVideoInfo,
  convertToMp3,
  convertToMp4,
  downloadTranscript,
  generateJobId,
  sanitizeFilename,
  type OutputFormat,
  type VideoInfo,
} from "./yt-dlp.js";
import {
  convertRequestSchema,
  jobIdSchema,
  Sanitizer,
} from "./schemas.js";
import {
  ConverterError,
  InvalidUrlError,
  VideoNotAccessibleError,
  NetworkTimeoutError,
  FileSizeError,
  ConversionError,
} from "./errors.js";

/**
 * Converts an error to an appropriate HTTP response
 */
function handleError(error: unknown): Response {
  // Custom converter errors
  if (error instanceof ConverterError) {
    const statusCode = error.statusCode;
    const response = {
      error: error.message,
      code: error.code,
    };

    // Add retry-after for rate limit errors
    if (error instanceof NetworkTimeoutError) {
      Object.assign(response, { retryAfter: 300 });
    }

    return new Response(JSON.stringify(response), { status: statusCode });
  }

  // Zod validation errors
  if (error instanceof Error && error.name === "ZodError") {
    return new Response(
      JSON.stringify({
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: JSON.parse(error.message),
      }),
      { status: 400 }
    );
  }

  // Generic errors
  const message = error instanceof Error ? error.message : "Unknown error occurred";
  return new Response(
    JSON.stringify({
      error: message,
      code: "INTERNAL_ERROR",
    }),
    { status: 500 }
  );
}

// Create Hono app
export const app = new Hono();

// Configure CORS for frontend access
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type"],
}));

// Logger middleware for development
app.use("*", logger());

// Serve static frontend files
app.get("/app.js", async (c) => {
  const file = Bun.file("./public/app.js");
  return new Response(file, {
    headers: { "Content-Type": "application/javascript" },
  });
});

// Root route - serve the HTML interface
app.get("/", async (c) => {
  const file = Bun.file("./public/index.html");
  return new Response(file, {
    headers: { "Content-Type": "text/html" },
  });
});

// Health check endpoint - verify yt-dlp is installed
app.get("/health", async (c) => {
  try {
    // Check if yt-dlp is available
    const ytDlpCheck = Bun.spawn(["yt-dlp", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = ytDlpCheck.stdout.getReader();
    const { value } = await reader.read();
    const ytDlpVersion = new TextDecoder().decode(value).trim();

    // Check if ffmpeg is available (required for audio extraction)
    const ffmpegCheck = Bun.spawn(["ffmpeg", "-version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const ffmpegReader = ffmpegCheck.stdout.getReader();
    const { value: ffmpegValue } = await ffmpegReader.read();
    const ffmpegVersion = new TextDecoder().decode(ffmpegValue).split("\n")[0]?.trim() || "";

    return c.json({
      status: "healthy",
      ytDlp: {
        installed: true,
        version: ytDlpVersion || "unknown",
      },
      ffmpeg: {
        installed: !!ffmpegVersion,
        version: ffmpegVersion || "not found",
      },
    });
  } catch (error) {
    return c.json({
      status: "unhealthy",
      error: "yt-dlp or ffmpeg not installed",
      details: error instanceof Error ? error.message : String(error),
    }, 503);
  }
});

// Validation schema for convert request - imported from schemas.ts
// Uses enhanced Zod schema with comprehensive security validation
const convertSchema = convertRequestSchema;

// In-memory job storage (in production, use a proper database/Redis)
const jobs = new Map<string, {
  status: "processing" | "completed" | "failed";
  format: OutputFormat;
  videoInfo?: VideoInfo;
  outputPath?: string;
  filename?: string;
  error?: string;
  errorCode?: string;
  createdAt: number;
}>();

// Download directory from environment or default
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || "/tmp/yt-converter-downloads";

// Ensure download directory exists
await Bun.file(DOWNLOAD_DIR).exists() || Bun.write(`${DOWNLOAD_DIR}/.gitkeep`, "");

// Convert endpoint - accepts URL and format, returns job ID
app.post("/api/convert", async (c) => {
  try {
    const body = await c.req.json();

    // Validate request body
    const result = convertSchema.safeParse(body);
    if (!result.success) {
      return c.json({
        error: "Invalid request",
        code: "VALIDATION_ERROR",
        details: result.error.issues,
      }, 400);
    }

    const { url, format } = result.data;

    // Generate unique job ID
    const jobId = generateJobId();

    // Initialize job status
    jobs.set(jobId, {
      status: "processing",
      format,
      createdAt: Date.now(),
    });

    // Process conversion asynchronously
    (async () => {
      try {
        // Get video info first
        const videoInfo = await getVideoInfo(url);

        // Sanitize filename
        const safeFilename = sanitizeFilename(videoInfo.title);
        const outputPath = `${DOWNLOAD_DIR}/${jobId}-${safeFilename}`;

        let finalPath: string;
        if (format === "mp3") {
          finalPath = await convertToMp3(url, outputPath);
        } else if (format === "mp4") {
          finalPath = await convertToMp4(url, outputPath);
        } else {
          finalPath = await downloadTranscript(url, outputPath);
        }

        const extension = format === "mp3" ? ".mp3" : format === "mp4" ? ".mp4" : ".txt";

        // Update job with completion
        jobs.set(jobId, {
          status: "completed",
          format,
          videoInfo,
          outputPath: finalPath,
          filename: safeFilename + extension,
          createdAt: Date.now(),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorCode = error instanceof ConverterError ? error.code : "UNKNOWN_ERROR";

        jobs.set(jobId, {
          status: "failed",
          format,
          error: errorMessage,
          errorCode,
          createdAt: Date.now(),
        });
      }
    })();

    return c.json({
      jobId,
      status: "processing",
      message: "Conversion started",
      checkUrl: `/api/jobs/${jobId}`,
    }, 202);
  } catch (error) {
    // Handle JSON parse errors or other request issues
    if (error instanceof SyntaxError) {
      return c.json({
        error: "Invalid JSON in request body",
        code: "INVALID_JSON",
      }, 400);
    }

    return handleError(error);
  }
});

// Job status endpoint - check conversion progress
app.get("/api/jobs/:jobId", (c) => {
  const rawJobId = c.req.param("jobId");

  // Validate job ID using Zod schema
  const validationResult = jobIdSchema.safeParse(rawJobId);
  if (!validationResult.success) {
    return c.json({
      error: "Invalid job ID format",
      code: "VALIDATION_ERROR",
      details: validationResult.error.issues,
    }, 400);
  }

  const jobId = validationResult.data;
  const job = jobs.get(jobId);

  if (!job) {
    return c.json({
      error: "Job not found",
    }, 404);
  }

  return c.json({
    jobId,
    ...job,
  });
});

// Download endpoint - serve the converted file
app.get("/downloads/:jobId", async (c) => {
  const rawJobId = c.req.param("jobId");

  // Validate job ID using Zod schema
  const validationResult = jobIdSchema.safeParse(rawJobId);
  if (!validationResult.success) {
    return c.json({
      error: "Invalid job ID format",
      code: "VALIDATION_ERROR",
    }, 400);
  }

  const jobId = validationResult.data;
  const job = jobs.get(jobId);

  if (!job) {
    return c.json({
      error: "Job not found",
    }, 404);
  }

  if (job.status !== "completed") {
    return c.json({
      error: "Conversion not complete",
      status: job.status,
    }, 400);
  }

  if (!job.outputPath) {
    return c.json({
      error: "File not available",
    }, 404);
  }

  try {
    const file = Bun.file(job.outputPath);
    const exists = await file.exists();

    if (!exists) {
      return c.json({
        error: "File not found on server",
      }, 404);
    }

    const contentType = job.format === "mp3"
      ? "audio/mpeg"
      : job.format === "mp4"
        ? "video/mp4"
        : "text/plain; charset=utf-8";

    // Return file with appropriate headers
    return new Response(file, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${job.filename}"`,
      },
    });
  } catch (error) {
    return c.json({
      error: "Failed to serve file",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Get port from environment variable (default 3000)
const port = parseInt(process.env.PORT || "3000", 10);

if (import.meta.main) {
  Bun.serve({
    port,
    fetch: app.fetch,
  });
  console.log(`Server started on http://localhost:${port}`);
}
