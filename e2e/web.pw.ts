import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("a user can download a transcript and see actionable failures", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", {
    name: "YouTube to MP3/MP4/Transcript Converter",
  })).toBeVisible();

  await page.getByLabel("Video URL").fill(
    "https://www.youtube.com/watch?v=fixture12345",
  );
  await page.locator('label[for="transcript"]').click();
  await expect(page.getByLabel("Transcript", { exact: true })).toBeChecked();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();

  const status = page.locator("#status");
  await expect(status).toContainText("Transcript ready!", { timeout: 10_000 });
  await expect(status.getByRole("link", { name: "Download Transcript" })).toBeVisible();

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Fixture_Video_E2E_Test.txt");
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  expect(await readFile(downloadPath!, "utf8")).toContain(
    "shared download path works",
  );

  await page.getByLabel("Video URL").fill(
    "https://www.youtube.com/watch?v=private-video",
  );
  await page.getByRole("button", { name: "Download" }).click();
  await expect(status).toHaveClass(/error/);
  await expect(status).toContainText("private");
});

test("a user can transcribe a caption-less video via local speech-to-text", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Video URL").fill(
    "https://www.youtube.com/watch?v=no-captions",
  );
  await page.locator('label[for="transcript"]').click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();

  const status = page.locator("#status");
  await expect(status).toContainText("Transcript ready!", { timeout: 10_000 });

  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  expect(await readFile(downloadPath!, "utf8")).toContain("No captions were needed");
});

test("gives up at the deadline the server advertises", async ({ page }) => {
  const jobId = "1700000000000-abcdef12";
  let jobStatusRequested = false;

  await page.route("**/api/convert", (route) =>
    route.fulfill({
      status: 202,
      json: {
        jobId,
        status: "processing",
        message: "Conversion started",
        checkUrl: `/api/jobs/${jobId}`,
        pollTimeoutSeconds: 1,
      },
    }),
  );
  await page.route(`**/api/jobs/${jobId}`, async (route) => {
    jobStatusRequested = true;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.fulfill({ json: { jobId, status: "processing" } }).catch(() => {});
  });

  await page.goto("/");
  await page.getByLabel("Video URL").fill(
    "https://www.youtube.com/watch?v=fixture12345",
  );
  await page.getByRole("button", { name: "Download" }).click();

  const status = page.locator("#status");
  await expect(status).toContainText("Conversion timed out", { timeout: 15_000 });
  await expect(status).toHaveClass(/error/);
  expect(jobStatusRequested).toBe(true);
});
