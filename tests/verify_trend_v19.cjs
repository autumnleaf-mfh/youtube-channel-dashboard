const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const url = process.env.DASHBOARD_TEST_URL || 'http://127.0.0.1:8787/index.html?v=19';
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('.trend-point').first().waitFor();
    const data = await page.evaluate(async () => (await fetch('data.json')).json());
    const channels = data.queries.channel_current.rows;
    const end = Date.parse(data.generatedAt);
    const choose = (group, value) => page.locator(`#${group} [data-value="${value}"]`).click();
    const points = () => page.locator('.trend-point').evaluateAll(nodes => nodes.map(n => ({ channel: n.dataset.channelId, metric: n.dataset.metric, value: Number(n.dataset.value), time: n.dataset.time })));
    const hover = async () => {
      await page.locator('.trend-canvas').evaluate(n => {
        const r = n.getBoundingClientRect();
        n.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * .6, clientY: r.top + r.height * .3 }));
      });
      assert(await page.locator('.trend-tooltip').isVisible());
    };
    assert.equal(await page.locator('#primaryChannel button').first().innerText(), '全部频道');
    assert.equal(await page.locator('#primaryChannel [aria-pressed="true"]').getAttribute('data-value'), 'all');
    assert.equal(await page.locator('[data-value="durationSeconds"]').count(), 0);
    assert.equal(await page.locator('#comparisonMetricRow').isHidden(), true);
    let displayed = await points();
    assert.equal(new Set(displayed.map(p => p.channel)).size, channels.length);
    await page.locator('[aria-labelledby="trendTitle"]').screenshot({ path: path.resolve('logs/trend-v19-default.png') });
    const snapshotCounts = {};
    await choose('trendMetric', 'subscriberCount');
    for (const period of ['7', '30', '90', 'all']) {
      await choose('trendPeriod', period);
      displayed = await points();
      const cutoff = period === 'all' ? -Infinity : end - Number(period) * 86400000;
      const expected = data.queries.channel_history.rows.filter(r => channels.some(c => c.channelId === r.channelId) && r.subscriberCount != null && Date.parse(r.observedAt) >= cutoff && Date.parse(r.observedAt) <= end);
      const expectedMap = new Map(expected.map(r => [r.channelId + '/' + r.observedAt, r.subscriberCount]));
      assert.equal(displayed.length, expectedMap.size);
      for (const p of displayed) {
        assert.equal(p.metric, 'subscriberCount');
        assert.equal(p.value, expectedMap.get(p.channel + '/' + p.time));
      }
      snapshotCounts[period] = displayed.length;
    }
    await choose('trendPeriod', '7');
    await hover();
    assert.equal(await page.locator('.trend-tooltip .nearest-series').count(), channels.length);
    assert(await page.locator('.trend-tooltip').evaluate(n => n.scrollHeight > n.clientHeight));
    await page.locator('.trend-tooltip').evaluate(n => { n.scrollTop = n.scrollHeight; });
    assert(await page.locator('.trend-tooltip').evaluate(n => n.scrollTop > 0));
    await page.locator('[aria-labelledby="trendTitle"]').screenshot({ path: path.resolve('logs/trend-v19-subscribers.png') });
    const firstId = channels[0].channelId;
    await choose('primaryChannel', firstId);
    assert((await points()).every(p => p.channel === firstId && p.metric === 'subscriberCount'));
    await choose('comparisonChannel', channels[1].channelId);
    assert.equal(await page.locator('#comparisonMetric [aria-pressed="true"]').getAttribute('data-value'), 'subscriberCount');
    assert.equal(new Set((await points()).map(p => p.channel)).size, 2);
    await choose('comparisonMetric', 'viewCount');
    assert.equal(await page.locator('.axis-secondary').count(), 5);
    await hover();
    assert((await page.locator('.trend-tooltip').innerText()).includes('订阅数量 / 播放量'));
    await choose('primaryChannel', 'all');
    assert.equal(new Set((await points()).map(p => p.channel)).size, channels.length);
    assert.equal(await page.locator('.axis-secondary').count(), 5);
    await choose('comparisonChannel', '');
    for (const metric of ['viewCount', 'likeCount', 'commentCount', 'uploadCount']) {
      await choose('trendMetric', metric);
      assert((await points()).every(p => p.metric === metric));
      await hover();
    }
    // Verify missing public subscriber counts do not turn into zero points.
    const hiddenId = channels[1].channelId;
    const sparse = structuredClone(data);
    sparse.queries.channel_history.rows = sparse.queries.channel_history.rows.map(r => r.channelId === hiddenId ? { ...r, subscriberCount: null } : r);
    await page.route('**/data.json', route => route.fulfill({ json: sparse }));
    await page.reload({ waitUntil: 'networkidle' });
    await choose('trendMetric', 'subscriberCount');
    assert(!(await points()).some(p => p.channel === hiddenId));
    assert((await page.locator('#trendLegend').innerText()).includes('暂无可用数据'));
    await choose('primaryChannel', hiddenId);
    assert.equal(await page.locator('.trend-point').count(), 0);
    assert(await page.locator('.trend-empty').isVisible());
    await page.unroute('**/data.json');
    // Synthetic observations verify that each window actually filters history.
    const boundary = structuredClone(data);
    boundary.queries.channel_history.rows = [...data.queries.channel_history.rows.filter(r => r.channelId !== firstId), ...[2, 8, 31, 91].map((age, index) => ({ channelId: firstId, channel: channels[0].channel, subscriberCount: index + 1, observedAt: new Date(end - age * 86400000).toISOString() }))];
    await page.route('**/data.json', route => route.fulfill({ json: boundary }));
    await page.reload({ waitUntil: 'networkidle' });
    await choose('trendMetric', 'subscriberCount');
    await choose('primaryChannel', firstId);
    for (const [period, count] of [['7', 1], ['30', 2], ['90', 3], ['all', 4]]) {
      await choose('trendPeriod', period);
      assert.equal((await points()).length, count);
    }
    await page.unroute('**/data.json');
    await page.reload({ waitUntil: 'networkidle' });
    await choose('trendMetric', 'subscriberCount');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#trendTitle').scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.resolve('logs/trend-v19-mobile.png') });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', url, default: 'all', channelCount: channels.length, snapshotCounts, missingCountsPreserved: true, mixedComparison: true, errors }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
