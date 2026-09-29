const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const url = process.env.DASHBOARD_TEST_URL || 'http://127.0.0.1:8787/index.html?v=18';
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('.upload-bar-row').first().waitFor();
    assert.equal(await page.locator('#loadError').isVisible(), false);
    const data = await page.evaluate(async () => (await fetch('data.json', { cache: 'no-store' })).json());
    const channels = data.queries.channel_current.rows;
    const titles = new Map(channels.map(row => [row.channelId, row.youtubeTitle]));
    assert.equal(channels.length, 12);
    assert(!titles.has('UC8RxFK0DNEz8Ad2DPIt3Bog'));
    assert(!titles.has('UCIj1v-XeGVGaR8rOkipW4gQ'));
    const addedId = 'UCtkUpmfJckdTZyNvyWBl_rg';
    assert(titles.has(addedId));
    assert.equal(titles.get('UCTueeHImxv4uLBQKsDEMqjQ'), '小Lu財經說');
    for (const query of Object.values(data.queries)) {
      for (const row of query.rows) {
        if (row.channelId) {
          assert(titles.has(row.channelId));
          assert.equal(row.channel, titles.get(row.channelId));
        }
      }
    }
    const catalog = data.queries.video_catalog.rows;
    assert.equal(new Set(catalog.map(row => row.videoId)).size, catalog.length);
    const end = Date.parse(data.generatedAt);
    const periodTotals = {};
    for (const period of ['7', '30', 'all']) {
      await page.locator(`#uploadBarsPeriod [data-period="${period}"]`).click();
      const bars = await page.locator('.upload-bar-row').evaluateAll(nodes => nodes.map(node => ({
        id: node.dataset.channelId, count: Number(node.dataset.count), title: node.querySelector('a span').textContent
      })));
      assert.equal(bars.length, channels.length);
      const start = period === 'all' ? -Infinity : end - Number(period) * 86400000;
      for (const bar of bars) {
        assert.equal(bar.title, titles.get(bar.id));
        assert.equal(bar.count, catalog.filter(v => v.channelId === bar.id && Date.parse(v.publishedAt) >= start && Date.parse(v.publishedAt) <= end).length);
      }
      assert(bars.every((bar, i) => !i || bars[i - 1].count >= bar.count));
      periodTotals[period] = bars.reduce((sum, bar) => sum + bar.count, 0);
    }
    const listRows = () => page.locator('#allVideosList > li[data-video-id]').evaluateAll(nodes => nodes.map(node => ({
      id: node.dataset.videoId, channel: node.dataset.channelId,
      views: node.dataset.views === '' ? null : Number(node.dataset.views),
      title: node.querySelector('.all-video-copy b').textContent,
      href: node.querySelector('a').href, thumbnail: node.querySelector('img').getAttribute('src')
    })));
    const latest = new Map();
    data.queries.video_history.rows.slice().sort((a,b) => Date.parse(a.observedAt) - Date.parse(b.observedAt)).forEach(row => latest.set(row.videoId, row));
    for (const sort of ['desc', 'asc']) {
      await page.locator(`#videoSort [data-value="${sort}"]`).click();
      const displayed = await listRows();
      assert.equal(displayed.length, catalog.length);
      let missing = false, previous;
      for (const row of displayed) {
        assert.equal(row.title, titles.get(row.channel));
        assert.equal(row.views, latest.get(row.id)?.viewCount ?? null);
        assert(row.href.includes(row.id));
        assert(row.thumbnail?.startsWith('https://'));
        if (row.views === null) { missing = true; continue; }
        assert(!missing, 'Missing views must sort last');
        if (previous != null) assert(sort === 'asc' ? row.views >= previous : row.views <= previous);
        previous = row.views;
      }
    }
    for (const channel of channels) {
      await page.locator(`#videoChannel [data-value="${channel.channelId}"]`).click();
      const displayed = await listRows();
      assert.equal(displayed.length, catalog.filter(v => v.channelId === channel.channelId).length);
      assert(displayed.every(row => row.channel === channel.channelId));
    }
    await page.locator('#videoChannel [data-value=""]').click();
    await page.locator('#videoSort [data-value="desc"]').click();
    assert.equal((await listRows()).length, catalog.length);
    const scrollable = await page.locator('#allVideosList').evaluate(node => node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY === 'auto');
    assert(scrollable);
    for (const legend of await page.locator('.legend').all()) assert(await legend.evaluate(node => node.scrollHeight <= node.clientHeight + 1));
    assert.equal(await page.locator('#primaryChannel button').count(), channels.length + 1);
    await page.locator(`#primaryChannel [data-value="${addedId}"]`).click();
    await page.locator('#comparisonChannel [data-value="UCZNlDT4tKgZS8R6sDuJWwMA"]').click();
    await page.locator('#comparisonMetric [data-value="likeCount"]').click();
    assert(await page.locator('#comparisonMetricRow').isVisible());
    assert(await page.locator('.trend-point').count() > 0);
    await page.locator('.trend-canvas').evaluate(node => {
      const box = node.getBoundingClientRect();
      node.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }));
    });
    assert(await page.locator('.trend-tooltip').isVisible());
    await page.locator('#uploadBarsPeriod [data-period="7"]').click();
    await page.locator('[aria-labelledby="uploadBarsTitle"]').screenshot({ path: path.resolve('logs/inventory-v18-bars.png') });
    await page.locator('[aria-labelledby="allVideosTitle"]').screenshot({ path: path.resolve('logs/inventory-v18-videos.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#allVideosTitle').scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Mobile overflow');
    await page.screenshot({ path: path.resolve('logs/inventory-v18-mobile.png') });
    assert.deepEqual(errors, []);
    const result = { url, channels: channels.length, addedChannel: titles.get(addedId), videos: catalog.length, periodTotals, scrollable, errors, status: 'PASS' };
    fs.writeFileSync(path.resolve('logs/inventory-v18-verification.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
