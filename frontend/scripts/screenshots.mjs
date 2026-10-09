// Captures every main screen at desktop, tablet and phone sizes for visual QA and portfolio media.
// Usage: node scripts/screenshots.mjs [baseUrl] [outDir] [--pages=/pos,/orders]
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const flags = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith("--")).map((arg) => arg.slice(2).split("=")));
const baseUrl = args[0] ?? "http://localhost:5174";
const outDir = args[1] ?? "screenshots";
const email = flags.email ?? "owner@retailopsbd.com";
const password = flags.password ?? "RetailOps123!";
const pages = (flags.pages ?? "/dashboard,/pos,/products,/inventory,/customers,/orders,/purchases,/reports,/sync,/activity,/settings").split(",");
const viewports = { desktop: { width: 1440, height: 900 }, tablet: { width: 900, height: 1180 }, phone: { width: 390, height: 844 } };
const only = flags.viewports ? flags.viewports.split(",") : Object.keys(viewports);

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const name of only) {
    const context = await browser.newContext({ viewport: viewports[name], deviceScaleFactor: 1, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/login`);
    await page.screenshot({ path: path.join(outDir, `${name}-login.png`), fullPage: true });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard/);
    for (const route of pages) {
      await page.goto(`${baseUrl}${route}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      const file = `${name}${route.replaceAll(/[^a-z0-9]+/gi, "-")}.png`;
      await page.screenshot({ path: path.join(outDir, file), fullPage: true });
      console.log(`captured ${file}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
