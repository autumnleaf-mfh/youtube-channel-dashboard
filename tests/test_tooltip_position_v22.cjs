const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../site/app.js'), 'utf8');
const context = vm.createContext({ Intl });
vm.runInContext(source.replace(/init\(\);\s*$/, ''), context);
const position = context.positionTrendTooltip;
function fixture(width, height, detailWidth = 280, detailHeight = 180) {
  const canvas = { clientWidth: width, clientHeight: height, getBoundingClientRect: () => ({ left: 113, top: 207 }) };
  const tooltip = {
    style: {}, dataset: {},
    get offsetWidth() { return Math.min(detailWidth, parseFloat(this.style.maxWidth) || Infinity); },
    get offsetHeight() { return Math.min(detailHeight, parseFloat(this.style.maxHeight) || Infinity); },
  };
  const motion = { anchorX: null, side: null };
  return { tooltip, canvas, motion, move(x, y) {
    position(tooltip, canvas, { clientX: 113 + x, clientY: 207 + y }, motion);
    const left = parseFloat(tooltip.style.left), top = parseFloat(tooltip.style.top);
    const right = left + tooltip.offsetWidth, bottom = top + tooltip.offsetHeight;
    assert(left >= 12 && right <= width - 12, `horizontal bounds ${left}..${right}/${width}`);
    assert(top >= 12 && bottom <= height - 12, `vertical bounds ${top}..${bottom}/${height}`);
    assert(!(x >= left && x <= right && y >= top && y <= bottom), 'tooltip covers pointer');
    if (tooltip.dataset.placement === 'left') assert(right <= x - 18);
    if (tooltip.dataset.placement === 'right') assert(left >= x + 18);
    if (tooltip.dataset.placement === 'above') assert(bottom <= y - 18);
    if (tooltip.dataset.placement === 'below') assert(top >= y + 18);
  } };
}
const main = fixture(1400, 500);
main.move(700, 250);
main.move(710, 250);
assert.equal(main.tooltip.dataset.placement, 'left');
main.move(708, 250);
assert.equal(main.motion.side, 'left', 'ignore two-pixel jitter');
main.move(705, 250);
assert.equal(main.tooltip.dataset.placement, 'right', 'reverse after accumulated movement');
const second = fixture(1400, 500);
second.move(500, 250);
assert.equal(second.motion.side, 'right');
assert.equal(main.motion.side, 'right');
main.move(715, 250);
assert.equal(main.motion.side, 'left');
assert.equal(second.motion.side, 'right', 'each chart tracks movement independently');
let checked = 0;
for (const width of [320, 390, 768, 1400]) {
  for (const height of [300, 500]) {
    for (const detailWidth of [280, 500]) {
      for (const detailHeight of [180, 1200]) {
        for (const direction of [-1, 1]) {
          for (let x = 0; x <= width; x += 10) {
            for (let y = 0; y <= height; y += 25) {
              const f = fixture(width, height, detailWidth, detailHeight);
              f.motion.anchorX = x - direction * 10;
              f.move(x, y);
              assert.equal(f.motion.side, direction > 0 ? 'left' : 'right');
              checked++;
            }
          }
        }
      }
    }
  }
}
assert(!source.includes('event.target?.closest?.(".trend-tooltip")'), 'hover should not freeze over tooltip');
console.log(`PASS: ${checked} geometry cases, reversal, jitter and independent chart state`);
