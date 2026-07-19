import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("a user can download a transcript and see actionable failures", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", {
    name: "YouTube to MP3/MP4/Transcript Converter",
  })).toBeVisible();

  await page.getByLabel("YouTube URL").fill(
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

  await page.getByLabel("YouTube URL").fill(
    "https://www.youtube.com/watch?v=private-video",
  );
  await page.getByRole("button", { name: "Download" }).click();
  await expect(status).toHaveClass(/error/);
  await expect(status).toContainText("private");
});
