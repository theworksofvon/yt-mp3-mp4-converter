/**
 * Custom error types for YouTube converter API
 */

/**
 * Base error class for all YouTube converter errors
 */
export class ConverterError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = "ConverterError";
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      statusCode: this.statusCode,
    };
  }
}

/**
 * Invalid URL error - URL is not a valid YouTube URL
 */
export class InvalidUrlError extends ConverterError {
  constructor(url: string) {
    super(
      `Invalid YouTube URL: ${url}`,
      "INVALID_URL",
      400
    );
    this.name = "InvalidUrlError";
  }
}

/**
 * Video not accessible - private, deleted, or region-restricted
 */
export class VideoNotAccessibleError extends ConverterError {
  constructor(reason: string = "Video is not accessible") {
    super(
      `Video not accessible: ${reason}`,
      "VIDEO_NOT_ACCESSIBLE",
      400
    );
    this.name = "VideoNotAccessibleError";
  }
}

/**
 * Network timeout error
 */
export class NetworkTimeoutError extends ConverterError {
  constructor(timeoutSeconds: number) {
    super(
      `Request timed out after ${timeoutSeconds} seconds`,
      "NETWORK_TIMEOUT",
      504
    );
    this.name = "NetworkTimeoutError";
  }
}

/**
 * Conversion failed error
 */
export class ConversionError extends ConverterError {
  constructor(
    format: "mp3" | "mp4" | "transcript",
    reason: string
  ) {
    super(
      `Failed to convert to ${format.toUpperCase()}: ${reason}`,
      `CONVERSION_FAILED_${format.toUpperCase()}`,
      500
    );
    this.name = "ConversionError";
  }
}

/**
 * File too large error
 */
export class FileSizeError extends ConverterError {
  constructor(maxSizeMB: number, actualSize?: number) {
    super(
      `File size exceeds maximum allowed size of ${maxSizeMB}MB${actualSize ? ` (was ${actualSize}MB)` : ""}`,
      "FILE_TOO_LARGE",
      413
    );
    this.name = "FileSizeError";
  }
}

/**
 * Rate limit error - too many requests
 */
export class RateLimitError extends ConverterError {
  constructor(retryAfter?: number) {
    super(
      "Too many requests, please try again later",
      "RATE_LIMITED",
      429
    );
    this.name = "RateLimitError";
    if (retryAfter) {
      this.retryAfter = retryAfter;
    }
  }

  retryAfter?: number;
}

/**
 * Parse yt-dlp stderr output to determine specific error type
 */
export function parseYtDlpError(stderr: string): Error {
  const error = stderr.toLowerCase();

  // Private video or members-only content
  if (error.includes("private") || error.includes("members-only")) {
    return new VideoNotAccessibleError("Video is private or members-only");
  }

  // Deleted or unavailable video
  if (error.includes("video unavailable") || error.includes("not found") || error.includes("404")) {
    return new VideoNotAccessibleError("Video has been deleted or is unavailable");
  }

  // Age restricted
  if (error.includes("age") && error.includes("restricted")) {
    return new VideoNotAccessibleError("Video is age-restricted and requires sign-in");
  }

  // Region restricted
  if (error.includes("not available in your country")) {
    return new VideoNotAccessibleError("Video is not available in your region");
  }

  // Copyright/blocked content
  if (error.includes("blocked") || error.includes("copyright")) {
    return new VideoNotAccessibleError("Video is blocked due to copyright claims");
  }

  // Network issues
  if (error.includes("timeout") || error.includes("timed out")) {
    return new NetworkTimeoutError(300);
  }

  // Rate limiting
  if (error.includes("too many requests") || error.includes("rate limit")) {
    return new RateLimitError();
  }

  // Generic conversion error
  return new ConverterError(
    `Download failed: ${stderr.slice(0, 200)}`,
    "DOWNLOAD_FAILED",
    500
  );
}
