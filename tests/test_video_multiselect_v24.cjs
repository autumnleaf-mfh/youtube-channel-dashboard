const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const data = JSON.parse(read('site/data.json'));
const channels = data.queries.channel_current.rows;
const latest = new Map();
data.queries.video_history.rows.slice().sort((a,b) => Date.parse(a.observedAt)-Date.parse(b.observedAt)).forEach(row => latest.set(row.videoId,row));
const videos = data.queries.video_catalog.rows.map(row => ({...latest.get(row.videoId),...row}));
const buttons = [{channelId:'',channel:'全部频道'}, ...channels].map(row => ({
  dataset:{value:row.channelId}, textContent:row.channel, pressed:row.channelId ? 'false':'true',
  setAttribute(key,value) { if(key==='aria-pressed') this.pressed=value; },
  getAttribute(key) { return key==='aria-pressed' ? this.pressed : null; },
}));
let click, renders=0;
const elements = {
  videoChannel:{contains:b=>buttons.includes(b), addEventListener:(type,fn)=>{click=fn;}, querySelectorAll:s=>s.includes('aria-pressed') ? buttons.filter(b=>b.pressed==='true'):buttons},
  allVideosList:{innerHTML:'',scrollTop:100}, allVideosCount:{textContent:''},
};
const choices={videoPeriod:'all',videoSort:'desc'};
const ctx=vm.createContext({Intl,document:{getElementById:id=>elements[id]},choices});
vm.runInContext(read('site/app.js').replace(/init\(\);\s*$/,''),ctx);
vm.runInContext('selectedChoice = id => choices[id]',ctx);
const render=()=>{renders++;ctx.renderAllVideos(videos,data.generatedAt);};
ctx.bindMultiChannelButtons('videoChannel',render);
const press=index=>click({target:{closest:()=>buttons[index]}});
const selected=()=>buttons.filter(b=>b.pressed==='true').map(b=>b.dataset.value);
const ids=()=>[...elements.allVideosList.innerHTML.matchAll(/data-video-id="([^"]+)"/g)].map(m=>m[1]);
render();
assert.equal(ids().length,videos.length);
press(1); assert.deepEqual(selected(),[channels[0].channelId]);
press(2); assert.deepEqual(selected(),channels.slice(0,2).map(c=>c.channelId));
assert(elements.allVideosCount.textContent.includes('已选 2 个频道'));
press(1); assert.deepEqual(selected(),[channels[1].channelId]);
press(2); assert.deepEqual(selected(),[''],'last deselection restores all');
press(1);press(2);press(0);assert.deepEqual(selected(),['']);
for(let i=1;i<buttons.length;i++)press(i);
assert.deepEqual(selected(),[''],'selecting every channel normalizes to all');
let checks=0;
for(let a=1;a<buttons.length;a++) for(let b=a+1;b<buttons.length;b++) {
  press(0);press(a);press(b);
  for(const period of ['7','30','all']) for(const sort of ['asc','desc']) {
    choices.videoPeriod=period;choices.videoSort=sort;render();
    const end=Date.parse(data.generatedAt),start=period==='all'?-Infinity:end-Number(period)*86400000;
    const valid=v=>v.viewCount!=null&&Number.isFinite(Number(v.viewCount));
    const expected=videos.filter(v=>[buttons[a].dataset.value,buttons[b].dataset.value].includes(v.channelId)&&Date.parse(v.publishedAt)>=start&&Date.parse(v.publishedAt)<=end).sort((x,y)=>{
      if(valid(x)!==valid(y))return valid(x)?-1:1;
      return (valid(x)?(sort==='asc'?1:-1)*(Number(x.viewCount)-Number(y.viewCount)):0)||Date.parse(y.publishedAt)-Date.parse(x.publishedAt)||x.videoId.localeCompare(y.videoId);
    }).map(v=>v.videoId);
    assert.deepEqual(ids(),expected);
    assert.equal(elements.allVideosList.scrollTop,0);
    checks++;
  }
}
assert(!read('site/app.js').includes('bindChoiceButtons("videoChannel"'));
// The trend filter reuses this handler with a non-empty All sentinel.
buttons[0].dataset.value='all';
buttons.forEach((b,i)=>{b.pressed=i===0?'true':'false';});
ctx.bindMultiChannelButtons('videoChannel',()=>{},'all');
press(1);press(2);assert.deepEqual(selected(),channels.slice(0,2).map(c=>c.channelId));
press(1);press(2);assert.deepEqual(selected(),['all']);
press(1);press(0);assert.deepEqual(selected(),['all']);
// Trend-only Select all must keep individual channels, unlike the aggregate sentinel.
const selectAllButton = {dataset:{action:'select-all'},pressed:'false',setAttribute:buttons[0].setAttribute,getAttribute:buttons[0].getAttribute};
const trendButtons = [...buttons,selectAllButton];
elements.primaryChannel = {
  contains:b=>trendButtons.includes(b),
  addEventListener:(type,fn)=>{click=fn;},
  querySelectorAll:s=>s==='button' ? trendButtons : buttons,
};
ctx.bindMultiChannelButtons('primaryChannel',()=>{},'all');
click({target:{closest:()=>selectAllButton}});
assert.deepEqual(selected(),channels.map(c=>c.channelId));
assert.equal(selectAllButton.pressed,'true');
press(1);
assert.equal(selected().length,channels.length-1);
assert.equal(selectAllButton.pressed,'false');
press(1);
assert.deepEqual(selected(),channels.map(c=>c.channelId),'manually selecting all stays separate lines');
assert.equal(selectAllButton.pressed,'true');
press(0);
assert.deepEqual(selected(),['all']);
assert.equal(selectAllButton.pressed,'false');
press(1);press(1);
assert.deepEqual(selected(),['all'],'empty selection restores aggregate');
console.log('PASS: select-all individual channels differs from aggregate, manual select-all, deselection and reset');
console.log(`PASS: multi-select toggles, restore all, ${checks} channel-pair/window/sort combinations; ${renders} renders`);
