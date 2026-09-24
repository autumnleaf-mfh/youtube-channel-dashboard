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
  await page.goto("http://127.0.0.1:8787/index.html?v=15", { waitUntil: "networkidle" });
  const updateButton = page.locator('#trendMetric button[data-value="uploadCount"]');
  await page.locator('#comparisonChannel button[data-value="UCZNlDT4tKgZS8R6sDuJWwMA"]').click();
  await updateButton.click();
  const uploadPointCounts = {};
  for (const period of ["7", "30", "90", "all"]) {
    await page.locator(`#trendPeriod button[data-value="${period}"]`).click();
    uploadPointCounts[period] = await page.locator(".trend-point").count();
  }
  const metricPointCounts = {};
  for (const metric of ["viewCount", "durationSeconds", "likeCount", "commentCount"]) {
    await page.locator(`#trendMetric button[data-value="${metric}"]`).click();
    metricPointCounts[metric] = {};
    for (const period of ["7", "30", "90", "all"]) {
      await page.locator(`#trendPeriod button[data-value="${period}"]`).click();
      metricPointCounts[metric][period] = await page.locator(".trend-point").count();
    }
  }
  await updateButton.click();
  await page.locator('#trendPeriod button[data-value="30"]').click();
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
    selectedPeriod: await page.locator('#trendPeriod button[aria-pressed="true"]').getAttribute("data-value"),
    pointCount: await page.locator(".trend-point").count(),
    uploadPointCounts,
    metricPointCounts,
    legend: await page.locator("#trendLegend").innerText(),
    tooltipVisible: await page.locator(".trend-tooltip").isVisible(),
    tooltip: await page.locator(".trend-tooltip").innerText(),
    tooltipImages: await page.locator(".trend-tooltip img").count(),
    loadErrorVisible: await page.locator("#loadError").isVisible(),
    errors,
  };
  await page.screenshot({ path: path.resolve("logs/dashboard-v15.png"), fullPage: true });
  console.log(JSON.stringify(result));
  await browser.close();
  const metricWindowsGrow = Object.values(metricPointCounts).every((counts) => counts["7"] <= counts["30"] && counts["30"] <= counts["90"] && counts["90"] <= counts.all);
  if (result.uploadButtonPressed !== "true" || result.selectedPeriod !== "30" || result.pointCount !== 60 || uploadPointCounts["7"] !== 14 || uploadPointCounts["30"] !== 60 || uploadPointCounts["90"] !== 180 || uploadPointCounts.all < 180 || !metricWindowsGrow || !result.tooltipVisible || !result.tooltip.includes("更新数量") || result.tooltipImages !== 2 || result.loadErrorVisible || errors.length) {
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
