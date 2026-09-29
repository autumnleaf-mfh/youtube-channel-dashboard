const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const url = process.env.DASHBOARD_TEST_URL || 'http://127.0.0.1:8787/index.html?v=20';
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('#allVideosList [data-video-id]').first().waitFor();
    const data = await page.evaluate(async () => (await fetch('data.json')).json());
    const catalog = data.queries.video_catalog.rows;
    const channels = data.queries.channel_current.rows;
    const end = Date.parse(data.generatedAt);
    const choose = (id, value) => page.locator(`#${id} [data-value="${value}"]`).click();
    const selected = id => page.locator(`#${id} [aria-pressed="true"]`).getAttribute('data-value');
    const rows = () => page.locator('#allVideosList [data-video-id]').evaluateAll(nodes => nodes.map(n => ({ id: n.dataset.videoId, views: n.dataset.views === '' ? null : Number(n.dataset.views) })));
    assert.equal(await page.locator('select').count(), 0);
    assert.equal(await selected('videoPeriod'), 'all');
    assert.equal(await selected('videoChannel'), '');
    assert.equal(await selected('videoSort'), 'desc');
    assert.equal(await page.locator('#videoChannel button').count(), channels.length + 1);
    const totals = {};
    for (const period of ['7', '30', 'all']) {
      await choose('videoPeriod', period);
      const start = period === 'all' ? -Infinity : end - Number(period) * 86400000;
      for (const channel of ['', ...channels.map(c => c.channelId)]) {
        await choose('videoChannel', channel);
        const expected = catalog.filter(v => (!channel || v.channelId === channel) && Date.parse(v.publishedAt) >= start && Date.parse(v.publishedAt) <= end).map(v => v.videoId).sort();
        for (const sort of ['asc', 'desc']) {
          await choose('videoSort', sort);
          const actual = await rows();
          assert.deepEqual(actual.map(v => v.id).sort(), expected);
          let last, missing = false;
          for (const row of actual) {
            if (row.views == null) { missing = true; continue; }
            assert(!missing);
            if (last != null) assert(sort === 'asc' ? row.views >= last : row.views <= last);
            last = row.views;
          }
          assert.equal(await selected('videoPeriod'), period);
          assert.equal(await selected('videoChannel'), channel);
        }
        if (!channel) totals[period] = expected.length;
      }
    }
    await choose('videoChannel', '');
    await choose('videoPeriod', '7');
    await choose('videoSort', 'desc');
    assert.equal(await selected('trendPeriod'), '7');
    assert.equal(await page.locator('#uploadBarsPeriod [aria-pressed="true"]').getAttribute('data-period'), '7');
    await page.locator('[aria-labelledby="allVideosTitle"]').screenshot({ path: path.resolve('logs/videos-v20-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#allVideosTitle').scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert(await page.locator('#videoChannel').evaluate(n => n.scrollWidth <= n.clientWidth + 1));
    await page.screenshot({ path: path.resolve('logs/videos-v20-mobile.png') });
    await choose('videoPeriod', 'all');
    assert.equal((await rows()).length, catalog.length);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', url, totals, combinations: 3 * (channels.length + 1) * 2, dropdowns: 0, errors }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
