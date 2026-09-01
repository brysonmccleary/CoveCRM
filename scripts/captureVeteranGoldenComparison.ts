import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import sharp from "sharp";
import { VETERAN_AUG29_GOLDEN_VISUALS } from "../lib/facebook/veteranGoldenVisualAuthority";

const candidateUrl = process.env.VETERAN_QA_BASE_URL || "http://127.0.0.1:3024";
const historicalUrl = process.env.VETERAN_HISTORICAL_QA_BASE_URL || "http://127.0.0.1:3023";
const output = path.resolve(process.env.VETERAN_GOLDEN_OUTPUT || "/private/tmp/veteran-final-production-qa/VETERAN_FINAL_GOLDEN_COMPARISON.jpg");
const executablePath = process.env.CHROME_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const historicalSheets = ["hero", "images", "graphic", "customers"] as const;

async function load(page: Page, url: string) {
  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
  if (!response?.ok()) throw new Error(`${url}: HTTP ${response?.status()}`);
  await page.evaluate(async () => { await (document as any).fonts?.ready; });
}

async function main() {
  await fs.mkdir(path.dirname(output), { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => localStorage.setItem("cove.cookieConsent.accepted", "true"));
  const historical = await context.newPage();
  const candidate = await context.newPage();
  const historicalPixels = new Map<string, Buffer>();
  try {
    for (const sheet of historicalSheets) {
      await load(historical, `${historicalUrl}/dev/background-treatment-final-review?sheet=${sheet}`);
      for (const golden of VETERAN_AUG29_GOLDEN_VISUALS) {
        if (historicalPixels.has(golden.executionId)) continue;
        const card = historical.locator(`[data-execution-id="${golden.executionId}"]`).first();
        if (!await card.isVisible().catch(() => false)) continue;
        const clip = card.locator("xpath=ancestor::article[contains(@class,'thumb')]//div[contains(@class,'clip')]").first();
        historicalPixels.set(golden.executionId, await clip.screenshot({ type: "png" }));
      }
    }
    await load(candidate, `${candidateUrl}/dev/veteran-final-production-review?mode=golden`);
    const pairWidth = 1_104;
    const pairHeight = 730;
    const columns = 2;
    const rows = Math.ceil(VETERAN_AUG29_GOLDEN_VISUALS.length / columns);
    const canvasWidth = pairWidth * columns + 60;
    const canvasHeight = rows * pairHeight + 110;
    const layers: sharp.OverlayOptions[] = [];
    for (const [index, golden] of VETERAN_AUG29_GOLDEN_VISUALS.entries()) {
      const historicalPng = historicalPixels.get(golden.executionId);
      if (!historicalPng) throw new Error(`Historical pixels not found for ${golden.executionId}`);
      const candidateCard = candidate.locator(`[data-execution-id="${golden.executionId}"] .creative`).first();
      if (!await candidateCard.isVisible()) throw new Error(`Candidate pixels not found for ${golden.executionId}`);
      const candidatePng = await candidateCard.screenshot({ type: "png" });
      const left = 30 + (index % columns) * pairWidth;
      const top = 85 + Math.floor(index / columns) * pairHeight;
      const [historical2x, candidate2x] = await Promise.all([
        sharp(historicalPng).resize(540, 675, { fit: "fill" }).png().toBuffer(),
        sharp(candidatePng).resize(540, 675, { fit: "fill" }).png().toBuffer(),
      ]);
      const label = Buffer.from(`<svg width="1080" height="46" xmlns="http://www.w3.org/2000/svg"><rect width="1080" height="46" fill="#0d2945"/><text x="540" y="19" fill="#f2c14e" text-anchor="middle" font-family="Arial" font-size="17" font-weight="700">${golden.executionId}</text><text x="270" y="39" fill="#ffffff" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700">HISTORICAL AUG 29</text><text x="810" y="39" fill="#ffffff" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700">CANDIDATE</text></svg>`);
      layers.push({ input: label, left, top }, { input: historical2x, left, top: top + 46 }, { input: candidate2x, left: left + 540, top: top + 46 });
    }
    const header = Buffer.from(`<svg width="${canvasWidth}" height="72" xmlns="http://www.w3.org/2000/svg"><rect width="${canvasWidth}" height="72" fill="#0d2945" stroke="#f2c14e" stroke-width="3"/><text x="${canvasWidth / 2}" y="30" fill="#f2c14e" text-anchor="middle" font-family="Arial" font-size="25" font-weight="800">VETERAN GOLDEN PIXEL COMPARISON</text><text x="${canvasWidth / 2}" y="55" fill="#ffffff" text-anchor="middle" font-family="Arial" font-size="14" font-weight="700">ACTUAL AUGUST 29 RENDER LEFT · PRODUCTION CANDIDATE RIGHT · NO REGENERATION</text></svg>`);
    layers.unshift({ input: header, left: 0, top: 0 });
    await sharp({ create: { width: canvasWidth, height: canvasHeight, channels: 3, background: "#071426" } })
      .composite(layers)
      .jpeg({ quality: 92 })
      .toFile(output);
    console.log(JSON.stringify({ output, comparisons: VETERAN_AUG29_GOLDEN_VISUALS.length, historicalSheets, pass: true }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
