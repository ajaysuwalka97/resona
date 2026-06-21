import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const slidesHtml = path.join(root, "slides", "index.html");
const exportDir = path.join(root, "slides", "export");
const pdfPath = path.join(exportDir, "resona-deck.pdf");
const pptxPath = path.join(exportDir, "resona-deck.pptx");

const VIEWPORT = { width: 1920, height: 1080 };

async function showSlide(page: import("@playwright/test").Page, index: number) {
  await page.evaluate((slideIndex) => {
    const slides = [...document.querySelectorAll(".slide")];
    slides.forEach((slide, i) => slide.classList.toggle("active", i === slideIndex));
  }, index);
  await page.waitForTimeout(150);
}

async function exportPdf(page: import("@playwright/test").Page) {
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: pdfPath,
    width: "13.333in",
    height: "7.5in",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
}

async function exportPptx(page: import("@playwright/test").Page, slideCount: number) {
  const pptxModule = await import("pptxgenjs");
  const PptxGenJS =
    typeof pptxModule.default === "function" ? pptxModule.default : pptxModule;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "Resona";
  pptx.title = "Resona Pitch Deck";

  await page.emulateMedia({ media: "screen" });

  for (let i = 0; i < slideCount; i += 1) {
    await showSlide(page, i);
    const png = await page.screenshot({ type: "png" });
    const slide = pptx.addSlide();
    slide.addImage({
      data: `image/png;base64,${png.toString("base64")}`,
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
    });
  }

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  await writeFile(pptxPath, buffer);
}

async function main() {
  await mkdir(exportDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(`file://${slidesHtml}`);

  const slideCount = await page.locator(".slide").count();

  await exportPdf(page);
  await exportPptx(page, slideCount);

  await browser.close();

  console.log(`PDF  → ${pdfPath}`);
  console.log(`PPTX → ${pptxPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
