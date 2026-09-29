const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const url = process.env.DASHBOARD_TEST_URL || 'http://127.0.0.1:8787/index.html?v=21';
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('#trendChart .trend-point').first().waitFor();
    const data = await page.evaluate(async () => (await fetch('data.json')).json());
    const channels = data.queries.channel_current.rows;
    const ids = channels.map(c => c.channelId);
    const end = Date.parse(data.generatedAt);
    const latest = new Map();
    data.queries.video_history.rows.slice().sort((a,b) => Date.parse(a.observedAt) - Date.parse(b.observedAt)).forEach(r => latest.set(r.videoId, r));
    const catalog = data.queries.video_catalog.rows.map(r => ({ ...latest.get(r.videoId), ...r }));
    const dayKey = date => new Date(Date.parse(new Date(Date.parse(date) + 8 * 3600000).toISOString().slice(0,10) + 'T00:00:00+08:00')).toISOString();
    const choose = (group, value) => page.locator(`#${group} [data-value="${value}"]`).click();
    const points = target => page.locator(`#${target} .trend-point`).evaluateAll(nodes => nodes.map(n => ({ id: n.dataset.channelId, time: n.dataset.time, value: Number(n.dataset.value), metric: n.dataset.metric })));
    const bars = () => page.locator('.channel-metric-bar').evaluateAll(nodes => nodes.map(n => ({ id: n.dataset.channelId, value: n.dataset.value === '' ? null : Number(n.dataset.value) })));
    const hover = async target => {
      await page.locator(`#${target} .trend-canvas`).evaluate(n => {
        const r = n.getBoundingClientRect();
        n.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * .65, clientY: r.top + r.height * .5 }));
      });
      assert(await page.locator(`#${target} .trend-tooltip`).isVisible());
    };
    assert.equal(await page.locator('#uploadBarsTitle, #uploadBars, #uploadBarsPeriod').count(), 0);
    assert.equal(await page.locator('#primaryChannel [aria-pressed="true"]').getAttribute('data-value'), 'all');
    assert.equal(await page.locator('#comparisonChannel button:disabled').count(), channels.length + 1);
    assert.equal(await page.locator('#breakdownMode [aria-pressed="true"]').getAttribute('data-value'), 'bar');
    assert.equal(await page.locator('#trendChart polyline').count(), 1);
    const totals = {};
    for (const period of ['7', '30', '90', 'all']) {
      await choose('trendPeriod', period);
      const cutoff = period === 'all' ? -Infinity : end - Number(period) * 86400000;
      for (const metric of ['viewCount', 'likeCount', 'commentCount', 'uploadCount', 'subscriberCount']) {
        await choose('trendMetric', metric);
        await choose('breakdownMode', 'bar');
        const expectedBars = new Map();
        const expectedDays = new Map();
        let aggregateExpected;
        if (metric === 'subscriberCount') {
          const timestamps = new Map();
          const history = data.queries.channel_history.rows.filter(r => ids.includes(r.channelId) && Date.parse(r.observedAt) >= cutoff && Date.parse(r.observedAt) <= end).sort((a,b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
          for (const r of history) {
            expectedBars.set(r.channelId, r.subscriberCount);
            expectedDays.set(r.channelId + '/' + r.observedAt, r.subscriberCount);
            if (!timestamps.has(r.observedAt)) timestamps.set(r.observedAt, new Map());
            timestamps.get(r.observedAt).set(r.channelId, r.subscriberCount);
          }
          aggregateExpected = new Map([...timestamps].filter(([,r]) => r.size === channels.length && [...r.values()].every(v => v != null)).map(([t,r]) => [t, [...r.values()].reduce((a,b) => a+b,0)]));
        } else {
          channels.forEach(c => expectedBars.set(c.channelId, 0));
          const selected = catalog.filter(r => Date.parse(r.publishedAt) >= cutoff && Date.parse(r.publishedAt) <= end);
          for (const r of selected) {
            const value = metric === 'uploadCount' ? 1 : r[metric];
            assert.notEqual(value, null);
            expectedBars.set(r.channelId, expectedBars.get(r.channelId) + value);
            const key = r.channelId + '/' + dayKey(r.publishedAt);
            expectedDays.set(key, (expectedDays.get(key) ?? 0) + value);
          }
        }
        const actualBars = await bars();
        assert.equal(actualBars.length, channels.length);
        for (const bar of actualBars) assert.equal(bar.value, expectedBars.get(bar.id) ?? null);
        const totalPoints = await points('trendChart');
        assert(totalPoints.every(p => p.id === 'all' && p.metric === metric));
        if (metric === 'subscriberCount') {
          assert.equal(totalPoints.length, aggregateExpected.size);
          for (const p of totalPoints) assert.equal(p.value, aggregateExpected.get(p.time));
        } else {
          for (const p of totalPoints) assert.equal(p.value, ids.reduce((sum,id) => sum + (expectedDays.get(id+'/'+p.time) ?? 0),0));
          assert.equal(totalPoints.reduce((sum,p) => sum+p.value,0), [...expectedBars.values()].reduce((a,b) => a+b,0));
        }
        totals[period+'/'+metric] = metric === 'subscriberCount' ? totalPoints.at(-1)?.value : totalPoints.reduce((sum,p) => sum+p.value,0);
        await choose('breakdownMode', 'line');
        const detailPoints = await points('breakdownChart');
        assert.equal(new Set(detailPoints.map(p => p.id)).size, channels.length);
        for (const p of detailPoints) assert.equal(p.value, expectedDays.get(p.id + '/' + p.time) ?? 0);
        assert.equal(new Set(await page.locator('#breakdownChart polyline').evaluateAll(nodes => nodes.map(n => n.getAttribute('stroke')))).size, channels.length);
      }
    }
    await choose('trendPeriod', '7');
    await choose('trendMetric', 'viewCount');
    await choose('breakdownMode', 'bar');
    await hover('trendChart');
    assert((await page.locator('#trendChart .trend-tooltip').innerText()).includes('全部频道总和'));
    await page.locator('[aria-labelledby="trendTitle"]').screenshot({ path: path.resolve('logs/aggregate-v21-total.png') });
    await page.locator('[aria-labelledby="breakdownTitle"]').screenshot({ path: path.resolve('logs/aggregate-v21-bars.png') });
    await choose('breakdownMode', 'line');
    await hover('breakdownChart');
    assert.equal(await page.locator('#breakdownChart .nearest-series').count(), channels.length);
    await page.locator('[aria-labelledby="breakdownTitle"]').screenshot({ path: path.resolve('logs/aggregate-v21-lines.png') });
    // Single-channel comparisons still work and are cleared on return to All.
    await choose('primaryChannel', ids[0]);
    assert.equal(await page.locator('#comparisonChannel button:disabled').count(), 0);
    await choose('comparisonChannel', ids[1]);
    await choose('comparisonMetric', 'subscriberCount');
    assert(await page.locator('#comparisonMetricRow').isVisible());
    assert.equal(await page.locator('#trendChart .axis-secondary').count(), 5);
    await choose('primaryChannel', 'all');
    assert.equal(await page.locator('#comparisonChannel [aria-pressed="true"]').getAttribute('data-value'), '');
    assert(await page.locator('#comparisonMetricRow').isHidden());
    await page.locator(`#comparisonChannel [data-value="${ids[1]}"]`).dispatchEvent('click');
    assert.equal(await page.locator('#comparisonChannel [aria-pressed="true"]').getAttribute('data-value'), '');
    // Missing snapshots must not produce a false total or zero subscriber history.
    const sparse = structuredClone(data);
    sparse.queries.channel_history.rows = sparse.queries.channel_history.rows.map(r => r.channelId === ids[0] ? { ...r, subscriberCount: null } : r);
    await page.route('**/data.json', r => r.fulfill({ json: sparse }));
    await page.reload({ waitUntil: 'networkidle' });
    await choose('trendMetric', 'subscriberCount');
    assert.equal((await points('trendChart')).length, 0);
    assert(await page.locator('#trendChart .trend-empty').isVisible());
    assert.equal((await bars()).find(r => r.id === ids[0]).value, null);
    await page.unroute('**/data.json');
    await page.reload({ waitUntil: 'networkidle' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => Number(document.querySelector('#trendChart svg').getAttribute('viewBox').split(' ')[2]) < 400);
    await page.locator('#breakdownTitle').scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.resolve('logs/aggregate-v21-mobile.png') });
    await choose('breakdownMode', 'line');
    await page.locator('#breakdownChart').scrollIntoViewIfNeeded();
    const fits = await page.locator('#breakdownChart svg').evaluate(n => n.getBoundingClientRect().width <= n.parentElement.getBoundingClientRect().width + 1);
    assert(fits);
    await hover('breakdownChart');
    await page.screenshot({ path: path.resolve('logs/aggregate-v21-mobile-lines.png') });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status:'PASS', url, channels:channels.length, totals, nullsPreserved:true, comparisonsDisabledForAll:true, errors }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
