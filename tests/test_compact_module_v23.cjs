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
const choices = { primaryChannel: 'all', comparisonChannel: '', trendMetric: 'viewCount', comparisonMetric: 'viewCount', trendPeriod: '7', breakdownMode: 'bar' };
const buttons = Array.from({length: 13}, (_, i) => ({ dataset: {value: String(i)}, setAttribute() {} }));
get('comparisonChannel').querySelectorAll = () => buttons;
const context = vm.createContext({ Intl, document: {getElementById: get}, choices });
vm.runInContext(read('site/app.js').replace(/init\(\);\s*$/, ''), context);
vm.runInContext('selectedChoice = id => choices[id]; selectChoice = (id, value) => { choices[id] = value; };', context);
const data = JSON.parse(read('site/data.json'));
const channels = data.queries.channel_current.rows;
const latest = new Map();
data.queries.video_history.rows.slice().sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt)).forEach(row => latest.set(row.videoId, row));
const videos = data.queries.video_catalog.rows.map(row => ({ ...latest.get(row.videoId), ...row }));
const history = data.queries.channel_history.rows;
const render = () => context.renderTrend(videos, videos, channels, data.generatedAt, history);
for (const width of [280, 620, 1350]) {
  get('trendChart').clientWidth = width;
  get('breakdownChart').clientWidth = width;
  for (const period of ['7', '30', '90', 'all']) {
    for (const metric of ['viewCount', 'subscriberCount', 'likeCount', 'commentCount', 'uploadCount']) {
      choices.trendPeriod = period; choices.trendMetric = metric;
      choices.primaryChannel = 'all'; choices.comparisonChannel = channels[0].channelId;
      choices.breakdownMode = 'bar'; render();
      assert(get('trendPanel').classList.contains('is-all-channels'));
      assert.equal(get('comparisonChannelRow').hidden, true);
      assert.equal(choices.comparisonChannel, '');
      assert(buttons.every(b => b.disabled));
      assert.equal((get('breakdownChart').innerHTML.match(/class="upload-bar-row channel-metric-bar"/g) || []).length, channels.length);
      const svg = get('trendChart').innerHTML;
      if (svg.includes('<svg')) assert(svg.includes(`viewBox="0 0 ${width} 300"`));
      choices.breakdownMode = 'line'; render();
      assert(get('breakdownChart').innerHTML.includes('<svg'));
    }
  }
}
choices.primaryChannel = channels[0].channelId; render();
assert.equal(get('comparisonChannelRow').hidden, false);
assert(!get('trendPanel').classList.contains('is-all-channels'));
assert(buttons.every(b => !b.disabled));
assert.equal(get('aggregateTitle').textContent, '所选频道趋势');
choices.comparisonChannel = channels[1].channelId; choices.comparisonMetric = 'viewCount'; render();
assert(get('trendChart').innerHTML.includes('stroke-dasharray="7 4"'));
choices.primaryChannel = 'all'; render();
assert.equal(choices.comparisonChannel, '');
assert.equal(get('aggregateTitle').textContent, '全部频道总和');
console.log('PASS: shared module ancestry, 120 chart renders across widths/metrics/windows, comparison hide/restore, bar/line controls');
