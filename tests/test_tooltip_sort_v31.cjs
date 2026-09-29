const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../site/app.js'), 'utf8');
const context = vm.createContext({Intl});
vm.runInContext(source.replace(/init\(\);\s*$/, ''), context);
assert(source.includes('sortTooltipEntries(nearestRows(targetTime))'), 'the shared hover renderer must sort the displayed nearest points');
for (const metric of ['viewCount','subscriberDelta','likeCount','commentCount','uploadCount']) {
  const values = [3, 100, 0, -2, 100, null, undefined, NaN, -10, '12'];
  const entries = values.map((value, seriesIndex) => ({item:{metric},row:{[metric]:value},seriesIndex}));
  const sorted = context.sortTooltipEntries(entries);
  assert.deepEqual(Array.from(sorted, e => e.seriesIndex), [1,4,9,0,2,3,8,5,6,7], metric);
  assert.deepEqual(entries.map(e => e.seriesIndex), values.map((_,i) => i), 'do not reorder plot series or colors');
}
assert.equal(context.sortTooltipEntries([]).length, 0);
console.log('PASS: every metric descending, ties stable, negative/zero/string values, missing values last, original series unchanged');
