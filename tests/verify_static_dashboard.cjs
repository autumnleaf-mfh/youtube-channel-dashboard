const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("http://127.0.0.1:8787/index.html?v=14", { waitUntil: "networkidle" });
  const updateButton = page.locator('#trendMetric button[data-value="uploadCount"]');
  await page.locator('#comparisonChannel button[data-value="UCZNlDT4tKgZS8R6sDuJWwMA"]').click();
  await updateButton.click();
  const canvas = page.locator(".trend-canvas");
  await canvas.evaluate((element) => {
    const box = element.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: box.left + box.width * 0.62,
      clientY: box.top + box.height * 0.5,
    }));
  });
  const result = {
    uploadButtonPressed: await updateButton.getAttribute("aria-pressed"),
    pointCount: await page.locator(".trend-point").count(),
    legend: await page.locator("#trendLegend").innerText(),
    tooltipVisible: await page.locator(".trend-tooltip").isVisible(),
    tooltip: await page.locator(".trend-tooltip").innerText(),
    tooltipImages: await page.locator(".trend-tooltip img").count(),
    loadErrorVisible: await page.locator("#loadError").isVisible(),
    errors,
  };
  await page.screenshot({ path: path.resolve("logs/dashboard-v14.png"), fullPage: true });
  console.log(JSON.stringify(result));
  await browser.close();
  if (result.uploadButtonPressed !== "true" || result.pointCount !== 60 || !result.tooltipVisible || !result.tooltip.includes("更新数量") || result.tooltipImages !== 2 || result.loadErrorVisible || errors.length) {
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
