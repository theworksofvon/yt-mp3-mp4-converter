#!/usr/bin/env bun

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { downloadTranscript, getVideoInfo } from "../src/yt-dlp.js";

const url = process.env.LIVE_TEST_URL
  || "https://www.youtube.com/watch?v=M7lc1UVf-VE";
const outputDir = await mkdtemp(resolve(tmpdir(), "yt-transcript-live-smoke-"));

try {
  const info = await getVideoInfo(url);
  if (!info.id || !info.title) {
    throw new Error("YouTube metadata was incomplete");
  }

  const transcriptPath = await downloadTranscript(url, resolve(outputDir, "transcript"));
  const transcript = await Bun.file(transcriptPath).text();
  if (transcript.trim().length < 20) {
    throw new Error("YouTube transcript was unexpectedly empty");
  }

  console.log(`Live smoke passed for ${info.id}: ${info.title}`);
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
