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
  await page.goto("http://127.0.0.1:8787/index.html?v=17", { waitUntil: "networkidle" });
  const updateButton = page.locator('#trendMetric button[data-value="uploadCount"]');
  const comparisonMetricRowInitiallyHidden = await page.locator("#comparisonMetricRow").isHidden();
  await page.locator('#comparisonChannel button[data-value="UCZNlDT4tKgZS8R6sDuJWwMA"]').click();
  const comparisonMetricRowVisible = await page.locator("#comparisonMetricRow").isVisible();
  const defaultComparisonMetric = await page.locator('#comparisonMetric button[aria-pressed="true"]').getAttribute("data-value");
  await updateButton.click();
  await page.locator('#comparisonMetric button[data-value="uploadCount"]').click();
  const uploadPointCounts = {};
  for (const period of ["7", "30", "90", "all"]) {
    await page.locator(`#trendPeriod button[data-value="${period}"]`).click();
    uploadPointCounts[period] = await page.locator(".trend-point").count();
  }
  const metricPointCounts = {};
  for (const metric of ["viewCount", "durationSeconds", "likeCount", "commentCount"]) {
    await page.locator(`#trendMetric button[data-value="${metric}"]`).click();
    await page.locator(`#comparisonMetric button[data-value="${metric}"]`).click();
    metricPointCounts[metric] = {};
    for (const period of ["7", "30", "90", "all"]) {
      await page.locator(`#trendPeriod button[data-value="${period}"]`).click();
      metricPointCounts[metric][period] = await page.locator(".trend-point").count();
    }
  }
  await page.locator('#trendMetric button[data-value="viewCount"]').click();
  await page.locator('#comparisonMetric button[data-value="likeCount"]').click();
  await page.locator('#trendPeriod button[data-value="30"]').click();
  const mixedMetricState = {
    primary: await page.locator('#trendMetric button[aria-pressed="true"]').getAttribute("data-value"),
    comparison: await page.locator('#comparisonMetric button[aria-pressed="true"]').getAttribute("data-value"),
    secondaryAxisTicks: await page.locator(".axis-secondary").count(),
    legend: await page.locator("#trendLegend").innerText(),
  };
  const mixedCanvas = page.locator(".trend-canvas");
  await mixedCanvas.evaluate((element) => {
    const box = element.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: box.left + box.width * 0.55, clientY: box.top + box.height * 0.5 }));
  });
  mixedMetricState.tooltip = await page.locator(".trend-tooltip").innerText();
  await page.screenshot({ path: path.resolve("logs/dashboard-v17-mixed.png"), fullPage: true });
  await updateButton.click();
  await page.locator('#comparisonMetric button[data-value="uploadCount"]').click();
  await page.locator('#trendPeriod button[data-value="30"]').click();
  const multiUpdatePoint = page.locator('.trend-point[aria-label*="更新数量 2 条"]').first();
  if (!await multiUpdatePoint.count()) throw new Error("没有找到含 2 条更新的日期节点");
  const pointX = Number(await multiUpdatePoint.getAttribute("cx"));
  const canvas = page.locator(".trend-canvas");
  await canvas.evaluate((element, svgPointX) => {
    const box = element.getBoundingClientRect();
    const svg = element.querySelector("svg");
    const svgBox = svg.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: svgBox.left + svgPointX / 1000 * svgBox.width,
      clientY: box.top + box.height * 0.5,
    }));
  }, pointX);
  const tooltipSeries = await page.locator(".upload-day-series").evaluateAll((sections) => sections.map((section) => ({
    expected: Number(section.dataset.updateCount),
    rendered: section.querySelectorAll(".upload-video-item").length,
  })));
  const result = {
    uploadButtonPressed: await updateButton.getAttribute("aria-pressed"),
    selectedPeriod: await page.locator('#trendPeriod button[aria-pressed="true"]').getAttribute("data-value"),
    pointCount: await page.locator(".trend-point").count(),
    uploadPointCounts,
    metricPointCounts,
    comparisonMetricRowInitiallyHidden,
    comparisonMetricRowVisible,
    defaultComparisonMetric,
    mixedMetricState,
    legend: await page.locator("#trendLegend").innerText(),
    tooltipVisible: await page.locator(".trend-tooltip").isVisible(),
    tooltip: await page.locator(".trend-tooltip").innerText(),
    tooltipImages: await page.locator(".trend-tooltip img").count(),
    tooltipVideoItems: await page.locator(".upload-video-item").count(),
    tooltipSeries,
    loadErrorVisible: await page.locator("#loadError").isVisible(),
    errors,
  };
  await page.screenshot({ path: path.resolve("logs/dashboard-v17.png"), fullPage: true });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const mobileErrors = [];
  mobile.on("pageerror", (error) => mobileErrors.push(error.message));
  await mobile.goto("http://127.0.0.1:8787/index.html?v=17", { waitUntil: "networkidle" });
  await mobile.locator('#comparisonChannel button[data-value="UCZNlDT4tKgZS8R6sDuJWwMA"]').click();
  await mobile.locator('#trendMetric button[data-value="uploadCount"]').click();
  const mobileLayout = await mobile.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  await mobile.screenshot({ path: path.resolve("logs/dashboard-v17-mobile.png"), fullPage: true });
  await mobile.close();
  result.mobileLayout = mobileLayout;
  result.mobileErrors = mobileErrors;
  console.log(JSON.stringify(result));
  await browser.close();
  const metricWindowsGrow = Object.values(metricPointCounts).every((counts) => counts["7"] <= counts["30"] && counts["30"] <= counts["90"] && counts["90"] <= counts.all);
  const tooltipCountsMatch = tooltipSeries.length === 2 && tooltipSeries.every((item) => item.expected === item.rendered);
  const mixedMetricsWork = mixedMetricState.primary === "viewCount" && mixedMetricState.comparison === "likeCount" && mixedMetricState.secondaryAxisTicks === 5 && mixedMetricState.legend.includes("播放量") && mixedMetricState.legend.includes("点赞数量") && mixedMetricState.tooltip.includes("播放量 / 点赞数量") && mixedMetricState.tooltip.includes("播放量") && mixedMetricState.tooltip.includes("点赞数量");
  if (!comparisonMetricRowInitiallyHidden || !comparisonMetricRowVisible || defaultComparisonMetric !== "viewCount" || !mixedMetricsWork || result.uploadButtonPressed !== "true" || result.selectedPeriod !== "30" || result.pointCount !== 60 || uploadPointCounts["7"] !== 14 || uploadPointCounts["30"] !== 60 || uploadPointCounts["90"] !== 180 || uploadPointCounts.all < 180 || !metricWindowsGrow || !result.tooltipVisible || !result.tooltip.includes("更新数量") || !result.tooltip.includes("播放") || !result.tooltip.includes("点赞") || !result.tooltip.includes("评论") || result.tooltipVideoItems < 2 || result.tooltipImages !== result.tooltipVideoItems || !tooltipCountsMatch || result.loadErrorVisible || errors.length || mobileErrors.length || mobileLayout.scrollWidth !== mobileLayout.clientWidth) {
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
