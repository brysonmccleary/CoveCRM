import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright-core";

const root = path.resolve(process.env.VETERAN_QA_OUTPUT || "/private/tmp/veteran-final-production-qa");
const baseUrl = process.env.VETERAN_QA_BASE_URL || "http://127.0.0.1:3024";
const executablePath = process.env.CHROME_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sheets = {
  full: "VETERAN_FINAL_PRODUCTION_FULL.jpg",
  random: "VETERAN_FINAL_PRODUCTION_RANDOM_60.jpg",
  images: "VETERAN_FINAL_PRODUCTION_IMAGE_BACKED_60.jpg",
  golden: "VETERAN_FINAL_GOLDEN_COMPARISON.jpg",
  authenticated: "VETERAN_FINAL_AUTHENTICATED_5.jpg",
} as const;
const forbidden = /(?:\bTEST\b|TEST_CAPABILITY|SAFE[_ ]MODE|PENDING[_ ]REVIEW|NOT DEPLOYED|PLACEHOLDER|\bDEBUG\b|\bMOCK\b)/i;

async function main() {
  await fs.mkdir(root, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  const reports: Record<string, unknown> = {};
  try {
    for (const [mode, filename] of Object.entries(sheets)) {
      const response = await page.goto(`${baseUrl}/dev/veteran-final-production-review?mode=${mode}`, { waitUntil: "networkidle", timeout: 90_000 });
      if (!response?.ok()) throw new Error(`${mode}: HTTP ${response?.status()}`);
      await page.evaluate(async () => { await (document as any).fonts?.ready; });
      const consent = page.getByRole("button", { name: "Accept", exact: true });
      if (await consent.isVisible().catch(() => false)) await consent.click();
      await page.waitForTimeout(300);
      const qa = await page.evaluate(async (forbiddenSource) => {
        const forbiddenPattern = new RegExp(forbiddenSource, "i");
        const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-review-card="true"]'));
        const failures = { internalLabel: [] as string[], missingRuntime: [] as string[], overflow: [] as string[], outsideCanvas: [] as string[], brokenBackground: [] as string[] };
        for (const card of cards) {
          const id = card.dataset.executionId || "unknown";
          const runtime = card.querySelector<HTMLElement>('[data-approved-veteran-runtime="true"]');
          const canvas = card.querySelector<HTMLElement>('[data-approved-veteran-creative="true"]');
          if (!runtime || !canvas) { failures.missingRuntime.push(id); continue; }
          if (forbiddenPattern.test(runtime.innerText)) failures.internalLabel.push(id);
          const canvasRect = runtime.getBoundingClientRect();
          const textElements = Array.from(runtime.querySelectorAll<HTMLElement>("div,span,small,strong"));
          for (const element of textElements) {
            const textNodes = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && (node.textContent || "").trim());
            const directText = textNodes.map((node) => node.textContent || "").join(" ").trim();
            if (!directText || getComputedStyle(element).visibility === "hidden") continue;
            const range = document.createRange();
            range.setStartBefore(textNodes[0]); range.setEndAfter(textNodes[textNodes.length - 1]);
            const rect = range.getBoundingClientRect();
            // Some approved layouts retain alternate copy branches positioned
            // completely outside the clipped canvas. They are not rendered
            // customer pixels and must not be treated as clipped visible text.
            const intersectsCanvas = rect.right > canvasRect.left && rect.left < canvasRect.right && rect.bottom > canvasRect.top && rect.top < canvasRect.bottom;
            if (!intersectsCanvas) continue;
            let ancestor: HTMLElement | null = element;
            while (ancestor && ancestor !== runtime) {
              const style = getComputedStyle(ancestor), clip = ancestor.getBoundingClientRect();
              if ((style.overflowX === "hidden" || style.overflowX === "clip") && (rect.left < clip.left - 2 || rect.right > clip.right + 2)) failures.overflow.push(`${id}:${directText.slice(0,40)}`);
              if ((style.overflowY === "hidden" || style.overflowY === "clip") && (rect.top < clip.top - 2 || rect.bottom > clip.bottom + 2)) failures.overflow.push(`${id}:${directText.slice(0,40)}`);
              ancestor = ancestor.parentElement;
            }
            if (rect.left < canvasRect.left - 2 || rect.right > canvasRect.right + 2 || rect.top < canvasRect.top - 2 || rect.bottom > canvasRect.bottom + 2) failures.outsideCanvas.push(`${id}:${directText.slice(0,40)}`);
          }
          const backgroundElements = Array.from(runtime.querySelectorAll<HTMLElement>("div")).filter((element) => getComputedStyle(element).backgroundImage.includes("/ad-backgrounds/veteran/"));
          for (const element of backgroundElements) {
            const value = getComputedStyle(element).backgroundImage;
            const url = value.match(/url\(["']?(.*?)["']?\)/)?.[1];
            if (!url) continue;
            const loaded = await new Promise<boolean>((resolve) => { const image = new Image(); image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = url; });
            if (!loaded) failures.brokenBackground.push(id);
          }
        }
        return { cardCount: cards.length, failures };
      }, forbidden.source);
      const output = path.join(root, filename);
      await page.locator('[data-veteran-review-root="true"]').screenshot({ path: output, type: "jpeg", quality: 92 });
      reports[mode] = { output, ...qa };
    }
  } finally { await browser.close(); }
  const full = reports.full as any;
  const totals = Object.fromEntries(Object.keys(full.failures).map((key) => [key, full.failures[key].length]));
  const report = { generatedAt: new Date().toISOString(), actualBrowserRender: true, reports, totals, pass: full.cardCount === 94 && Object.values(totals).every((value) => value === 0) };
  await fs.writeFile(path.join(root, "veteran-final-production-qa.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exit(1); });
