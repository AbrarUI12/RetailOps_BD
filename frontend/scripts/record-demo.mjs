// Records a deterministic 2–4 minute portfolio walkthrough against the seeded demo.
// Usage: node scripts/record-demo.mjs [baseUrl] [outDir]
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const baseUrl = process.argv[2] ?? "http://localhost:5174";
const outDir = path.resolve(process.argv[3] ?? "../docs/media");
const pause = Number(process.env.DEMO_SCENE_MS ?? 9000);

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: outDir, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const video = page.video();

async function scene(route, delay = pause) {
  await page.goto(`${baseUrl}${route}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(delay);
}

try {
  await scene("/login", 7000);
  await page.getByLabel("Email").fill("owner@demo.local");
  await page.getByLabel("Password").fill("RetailOps123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/dashboard/);
  await page.waitForTimeout(pause);

  await page.keyboard.press("Control+K");
  await page.waitForTimeout(2500);
  const commandSearch = page.getByPlaceholder(/search products/i);
  if (await commandSearch.isVisible()) {
    await commandSearch.fill("cotton");
    await page.waitForTimeout(4500);
  }
  await page.keyboard.press("Escape");

  await scene("/pos", 11_000);
  const catalogSearch = page.getByPlaceholder(/scan barcode/i);
  if (await catalogSearch.isVisible()) {
    await catalogSearch.fill("cotton");
    await page.waitForTimeout(4000);
  }

  await scene("/products");
  await scene("/inventory");
  await scene("/customers");
  await scene("/orders", 11_000);
  await scene("/reports", 11_000);
  await scene("/sync");
  await scene("/activity");
  await scene("/dashboard", 9000);

  // OpenAPI is part of the story even though it lives on the API origin.
  await page.goto("http://127.0.0.1:8000/docs");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(12_000);
} finally {
  await context.close();
  await browser.close();
}

const source = await video.path();
const target = path.join(outDir, "retailops-demo.webm");
await rm(target, { force: true });
await rename(source, target);
console.log(`recorded ${target}`);
