const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('site/index.html');
const css = read('site/styles.css');
assert.match(css, /\.trend-charts\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.618fr\) minmax\(0, 1fr\)/, 'all selection states share the golden-ratio desktop layout');
assert(!/\.is-all-channels\s+\.trend-charts/.test(css), 'layout must not depend on selecting All');
assert.match(css, /@media \(max-width: 900px\)\s*\{\s*\.trend-charts\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/, 'all selection states stack on narrow screens');
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
    for (const metric of ['viewCount', 'subscriberDelta', 'likeCount', 'commentCount', 'uploadCount']) {
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
for (const period of ['7', '30', '90', 'all']) {
choices.trendPeriod = period;
for (const count of [1, 2, 5]) {
  choices.primaryChannel = channels.slice(0, count).map(c => c.channelId);
  for (const metric of ['viewCount', 'subscriberDelta', 'likeCount', 'commentCount', 'uploadCount']) {
    choices.trendMetric = metric;
    choices.breakdownMode = 'bar'; render();
    assert(!get('trendPanel').classList.contains('is-all-channels'));
    assert.equal(get('aggregateTitle').textContent, `所选频道趋势 · ${count} 个频道`);
    const chartIds = [...get('trendChart').innerHTML.matchAll(/data-channel-id="([^"]+)"/g)].map(m => m[1]);
    assert(chartIds.length > 0);
    assert(chartIds.every(id => choices.primaryChannel.includes(id)));
    const barIds = [...get('breakdownChart').innerHTML.matchAll(/data-channel-id="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual([...barIds].sort(), [...choices.primaryChannel].sort());
    // Recompute video-based bar totals independently from the selected catalog.
    if (metric !== 'subscriberDelta') {
      const end = Date.parse(data.generatedAt);
      const start = period === 'all' ? -Infinity : end - Number(period) * 86400000;
      for (const match of get('breakdownChart').innerHTML.matchAll(/data-channel-id="([^"]+)" data-value="([^"]*)" data-metric="([^"]+)"/g)) {
        const included = videos.filter(v => v.channelId === match[1] && Date.parse(v.publishedAt) >= start && Date.parse(v.publishedAt) <= end);
        const expected = metric === 'uploadCount' ? included.length : included.some(v => v[metric] == null) ? null : included.reduce((sum, v) => sum + Number(v[metric]), 0);
        assert.equal(match[3], metric);
        assert.equal(match[2], expected == null ? '' : String(expected), `${period}/${metric}/${match[1]} bar total follows selected scope`);
      }
    }
    assert(!get('trendChart').innerHTML.includes('stroke-dasharray="7 4"'));
    choices.breakdownMode = 'line'; render();
    const lineIds = [...get('breakdownChart').innerHTML.matchAll(/data-channel-id="([^"]+)"/g)].map(m => m[1]);
    assert(lineIds.every(id => choices.primaryChannel.includes(id)));
  }
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
    choices.breakdownMode = 'bar'; render();
    const bars = [...get('breakdownChart').innerHTML.matchAll(/data-value="([\d]+)"/g)].map(m => Number(m[1]));
    assert.equal(bars.reduce((a,b)=>a+b,0), windowVideos.length);
    const points = [...get('trendChart').innerHTML.matchAll(/data-value="([\d]+)"/g)].map(m => Number(m[1]));
    assert.equal(points.reduce((a,b)=>a+b,0), windowVideos.length);
    for(const rowHtml of get('breakdownChart').innerHTML.split('<div class="upload-bar-row channel-metric-bar"').slice(1)) {
      const channelId = rowHtml.match(/data-channel-id="([^"]+)"/)[1];
      const channelVideos = windowVideos.filter(v=>v.channelId===channelId);
      const segments = [...rowHtml.matchAll(/data-format="([^"]+)" data-count="(\d+)"/g)];
      assert.equal(segments.reduce((sum,m)=>sum+Number(m[2]),0),channelVideos.length);
      for(const type of ['long','short','live','unknown']) {
        const actual = Number(segments.find(m=>m[1]===type)?.[2]??0);
        assert.equal(actual,channelVideos.filter(v=>v.youtubeFormat===type).length);
      }
    }
    choices.breakdownMode = 'line'; render();
    const linePoints = [...get('breakdownChart').innerHTML.matchAll(/data-value="([\d]+)"/g)].map(m => Number(m[1]));
    assert.equal(linePoints.reduce((a,b)=>a+b,0), windowVideos.length);
    assert(!get('breakdownChart').classList.contains('is-upload-stacked'));
  }
}
assert.equal(context.videoType({durationSeconds: 600}), 'unknown', 'no duration inference');
assert.equal(context.videoType({durationSeconds: 600, youtubeFormat: 'short'}), 'short', 'YouTube category is authoritative');
choices.trendMetric = 'viewCount';render();
assert(!html.includes('id="uploadType'));
assert(!read('site/app.js').includes('$("uploadType'));
context.renderUploadStackedBars([{id:'test',channel:{channel:'Test',channelUrl:'#'},value:4,rows:[{updates:[{youtubeFormat:'long'},{youtubeFormat:'short'},{youtubeFormat:'live'},{durationSeconds:10}]}]}]);
assert.equal((get('breakdownChart').innerHTML.match(/data-count="1"/g)||[]).length,4);
assert(get('breakdownLegend').innerHTML.includes('待确认'));
assert(!get('breakdownChart').innerHTML.includes('NaN'));
console.log('PASS: shared module ancestry, all-channel windows/metrics/widths, 1/2/5-channel multi-select, filtered bar/line controls, removed comparisons');
console.log('PASS: stacked YouTube types reconcile by channel with all updates across 4 periods and all/selected channels; long/short/live/unknown; type selector removed');
