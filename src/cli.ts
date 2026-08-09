import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  convertToMp3,
  convertToMp4,
  downloadTranscript,
  getVideoInfo,
  sanitizeFilename,
  type OutputFormat,
} from "./yt-dlp.js";

const VALID_FORMATS: OutputFormat[] = ["mp3", "mp4", "transcript"];

function printUsage(): void {
  console.log("Usage: bun run src/cli.ts <mp3|mp4|transcript> [url-or-file]");
  console.log("Examples:");
  console.log("  bun run transcript");
  console.log("  bun run transcript https://www.youtube.com/watch?v=VIDEO_ID");
  console.log("  bun run transcript https://vimeo.com/123");
  console.log("  bun run transcript /path/to/video.mp4");
  console.log("  bun run mp3 https://youtu.be/VIDEO_ID");
}

async function promptForUrl(): Promise<string> {
  process.stdout.write("Video URL: ");

  for await (const line of console) {
    const url = line.trim();
    if (url) return url;
    process.stdout.write("Video URL: ");
  }

  return "";
}

async function main(): Promise<void> {
  const [formatArg, urlArg] = Bun.argv.slice(2);
  const format = formatArg as OutputFormat | undefined;

  if (!format || !VALID_FORMATS.includes(format)) {
    printUsage();
    process.exit(1);
  }

  const url = urlArg?.trim() || await promptForUrl();
  if (!url) {
    console.error("A video URL or file path is required.");
    process.exit(1);
  }

  const outputDir = resolve(process.env.CLIENT_DOWNLOAD_DIR || "downloads");
  await mkdir(outputDir, { recursive: true });

  console.log("Fetching video info...");
  const videoInfo = await getVideoInfo(url, {
    enforceFileSizeLimit: format === "mp3",
    allowAnySource: format === "transcript",
  });
  const basePath = `${outputDir}/${sanitizeFilename(videoInfo.title)}`;

  console.log(`${format === "transcript" ? "Downloading transcript" : `Downloading ${format.toUpperCase()}`}...`);

  const outputPath = format === "mp3"
    ? await convertToMp3(url, basePath)
    : format === "mp4"
      ? await convertToMp4(url, basePath)
      : await downloadTranscript(url, basePath, {
          sttFallback: true,
          onSttFallback: () => console.log("No captions found. Transcribing audio locally..."),
        });

  console.log(`Saved: ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
