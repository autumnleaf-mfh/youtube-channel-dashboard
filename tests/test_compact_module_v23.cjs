const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('site/index.html');
// Verify real HTML section ancestry without a browser or a layout emulator.
const sections = [], ancestry = new Map();
for (const match of html.matchAll(/<\/?([a-z][\w-]*)\b[^>]*>/gi)) {
  const tag = match[1], raw = match[0];
  if (raw.startsWith('</')) { if (tag === 'section') sections.pop(); continue; }
  const id = raw.match(/\bid="([^"]+)"/)?.[1];
  if (tag === 'section') sections.push(id || '(section)');
  if (id) { assert(!ancestry.has(id), `duplicate id ${id}`); ancestry.set(id, [...sections]); }
}
for (const id of ['trendChart', 'breakdownChart', 'breakdownMode', 'trendMetric', 'trendPeriod']) {
  assert(ancestry.get(id).includes('trendPanel'), `${id} must share one module`);
}
const nodes = new Map();
function element() {
  const classes = new Set();
  return { innerHTML: '', textContent: '', hidden: false, dataset: {}, clientWidth: 620,
    classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle(x, on) { on ? classes.add(x) : classes.delete(x); } },
    setAttribute() {}, addEventListener() {}, querySelector: () => element(), querySelectorAll: () => [],
  };
}
const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
const choices = { primaryChannel: ['all'], trendMetric: 'viewCount', trendPeriod: '7', breakdownMode: 'bar' };
get('primaryChannel').querySelectorAll = () => choices.primaryChannel.map(value => ({dataset:{value}}));
assert(!/id="comparison/.test(html), 'comparison controls must be removed');
const context = vm.createContext({ Intl, document: {getElementById: get}, choices });
vm.runInContext(read('site/app.js').replace(/init\(\);\s*$/, ''), context);
vm.runInContext('selectedChoice = id => choices[id]', context);
const data = JSON.parse(read('site/data.json'));
const channels = data.queries.channel_current.rows;
const latest = new Map();
data.queries.video_history.rows.slice().sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt)).forEach(row => latest.set(row.videoId, row));
const formats = new Map((data.queries.video_formats?.rows ?? []).map(row => [row.videoId, row]));
const videos = data.queries.video_catalog.rows.map(row => ({ ...latest.get(row.videoId), ...row, youtubeFormat: formats.get(row.videoId)?.format ?? 'unknown' }));
const history = data.queries.channel_history.rows;
const render = () => context.renderTrend(videos, videos, channels, data.generatedAt, history);
for (const width of [280, 620, 1350]) {
  get('trendChart').clientWidth = width;
  get('breakdownChart').clientWidth = width;
  for (const period of ['7', '30', '90', 'all']) {
    for (const metric of ['viewCount', 'subscriberCount', 'likeCount', 'commentCount', 'uploadCount']) {
      choices.trendPeriod = period; choices.trendMetric = metric;
      choices.primaryChannel = ['all'];
      choices.breakdownMode = 'bar'; render();
      assert(get('trendPanel').classList.contains('is-all-channels'));
      assert.equal((get('breakdownChart').innerHTML.match(/class="upload-bar-row channel-metric-bar"/g) || []).length, channels.length);
      const svg = get('trendChart').innerHTML;
      if (svg.includes('<svg')) assert(svg.includes(`viewBox="0 0 ${width} 300"`));
      choices.breakdownMode = 'line'; render();
      assert(get('breakdownChart').innerHTML.includes('<svg'));
    }
  }
}
for (const count of [1, 2, 5]) {
  choices.primaryChannel = channels.slice(0, count).map(c => c.channelId);
  for (const metric of ['viewCount', 'subscriberCount', 'likeCount', 'commentCount', 'uploadCount']) {
    choices.trendMetric = metric;
    choices.breakdownMode = 'bar'; render();
    assert(!get('trendPanel').classList.contains('is-all-channels'));
    assert.equal(get('aggregateTitle').textContent, `所选频道趋势 · ${count} 个频道`);
    const chartIds = [...get('trendChart').innerHTML.matchAll(/data-channel-id="([^"]+)"/g)].map(m => m[1]);
    assert(chartIds.length > 0);
    assert(chartIds.every(id => choices.primaryChannel.includes(id)));
    const barIds = [...get('breakdownChart').innerHTML.matchAll(/data-channel-id="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual([...barIds].sort(), [...choices.primaryChannel].sort());
    assert(!get('trendChart').innerHTML.includes('stroke-dasharray="7 4"'));
    choices.breakdownMode = 'line'; render();
    const lineIds = [...get('breakdownChart').innerHTML.matchAll(/data-channel-id="([^"]+)"/g)].map(m => m[1]);
    assert(lineIds.every(id => choices.primaryChannel.includes(id)));
  }
}
choices.primaryChannel = ['all']; render();
assert.equal(get('aggregateTitle').textContent, '全部频道总和');
for (const period of ['7', '30', '90', 'all']) {
  choices.trendPeriod = period;
  choices.trendMetric = 'uploadCount';
  const end = Date.parse(data.generatedAt), start = period === 'all' ? -Infinity : end - Number(period) * 86400000;
  for (const selected of [['all'], channels.slice(0, 2).map(c => c.channelId)]) {
    choices.primaryChannel = selected;
    const selectedIds = selected.includes('all') ? channels.map(c => c.channelId) : selected;
    const windowVideos = videos.filter(v => selectedIds.includes(v.channelId) && Date.parse(v.publishedAt) >= start && Date.parse(v.publishedAt) <= end);
    let partitionTotal = 0;
    for (const type of ['all', 'long', 'short', 'live', 'unknown']) {
      choices.uploadType = type; choices.breakdownMode = 'bar'; render();
      const expected = windowVideos.filter(v => type === 'all' || v.youtubeFormat === type);
      const bars = [...get('breakdownChart').innerHTML.matchAll(/data-value="([\d]+)"/g)].map(m => Number(m[1]));
      assert.equal(bars.reduce((a,b)=>a+b,0), expected.length, `bar partition ${period}/${type}`);
      const points = [...get('trendChart').innerHTML.matchAll(/data-value="([\d]+)"/g)].map(m => Number(m[1]));
      assert.equal(points.reduce((a,b)=>a+b,0), expected.length, `trend partition ${period}/${type}`);
      assert.equal(get('uploadTypeRow').hidden, false);
      if (type !== 'all') partitionTotal += expected.length;
      choices.breakdownMode = 'line'; render();
      const linePoints = [...get('breakdownChart').innerHTML.matchAll(/data-value="([\d]+)"/g)].map(m => Number(m[1]));
      assert.equal(linePoints.reduce((a,b)=>a+b,0), expected.length);
    }
    assert.equal(partitionTotal, windowVideos.length);
  }
}
assert.equal(context.videoType({durationSeconds: 600}), 'unknown', 'no duration inference');
assert.equal(context.videoType({durationSeconds: 600, youtubeFormat: 'short'}), 'short', 'YouTube category is authoritative');
choices.trendMetric = 'viewCount';render();
assert.equal(get('uploadTypeRow').hidden, true);
console.log('PASS: shared module ancestry, all-channel windows/metrics/widths, 1/2/5-channel multi-select, filtered bar/line controls, removed comparisons');
console.log('PASS: YouTube types reconcile with all uploads across 4 periods, all/selected channels and 3 chart views; unknown is never inferred from duration');
