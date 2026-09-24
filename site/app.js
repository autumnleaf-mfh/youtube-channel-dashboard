const state = { data: null, channelRows: [], visibleVideos: 24 };
const compact = new Intl.NumberFormat("zh-HK", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("zh-HK", { maximumFractionDigits: 0 });
const dt = new Intl.DateTimeFormat("zh-HK", { timeZone: "Asia/Hong_Kong", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const num = (value, formatter = integer) => value == null || !Number.isFinite(Number(value)) ? "—" : formatter.format(Number(value));
const signed = (value) => value == null ? `<span class="pending">等待基线</span>` : `<span class="delta ${value < 0 ? "negative" : "positive"}">${value > 0 ? "+" : ""}${integer.format(value)}</span>`;
const hours = (value) => new Date(value).getTime();

function previous(history, id, generatedAt, backHours) {
  const cutoff = hours(generatedAt) - backHours * 3600000;
  return history.filter((row) => row.channelId === id && hours(row.observedAt) <= cutoff).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
}

function addChanges(current, history, generatedAt) {
  return current.map((row) => {
    const day = previous(history, row.channelId, generatedAt, 24);
    const week = previous(history, row.channelId, generatedAt, 168);
    const diff = (field, baseline) => baseline?.[field] == null || row[field] == null ? null : row[field] - baseline[field];
    return { ...row, subscribers24h: diff("subscriberCount", day), subscribers7d: diff("subscriberCount", week), views24h: diff("channelViewCount", day), views7d: diff("channelViewCount", week) };
  });
}

function renderKpis(rows, health) {
  const items = [
    ["追踪频道", `${rows.length} / 13`, health?.failureCount ? `${health.failureCount} 个采集异常` : "本轮全部采集成功"],
    ["公开订阅合计", num(rows.reduce((sum, row) => sum + (row.subscriberCount ?? 0), 0), compact), "隐藏订阅不计入"],
    ["频道总播放合计", num(rows.reduce((sum, row) => sum + (row.channelViewCount ?? 0), 0), compact), "13 个频道当前公开值"],
    ["近 7 日更新", num(rows.reduce((sum, row) => sum + (row.uploads7d ?? 0), 0)), `${rows.filter((row) => (row.daysSinceUpload ?? Infinity) <= 7).length} 个频道有更新`],
  ];
  $("kpis").innerHTML = items.map(([label, value, note]) => `<article class="kpi"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join("");
}

function renderDecisions(rows) {
  const efficient = [...rows].sort((a, b) => (b.recent5AverageViews ?? -1) - (a.recent5AverageViews ?? -1))[0];
  const frequent = [...rows].sort((a, b) => (b.uploads30d ?? -1) - (a.uploads30d ?? -1))[0];
  const stale = rows.filter((row) => (row.daysSinceUpload ?? 0) > 7).sort((a, b) => b.daysSinceUpload - a.daysSinceUpload);
  $("decisions").innerHTML = [
    ["近期效率领先", efficient?.channel ?? "—", `近 5 条平均 ${num(efficient?.recent5AverageViews, compact)} 播放`, "accent"],
    ["更新最密集", frequent?.channel ?? "—", `30 日发布 ${num(frequent?.uploads30d)} 条`, ""],
    ["需要关注", stale.length ? `${stale.length} 个频道停更 > 7 日` : "暂无停更提醒", stale[0] ? `${stale[0].channel} · ${Math.floor(stale[0].daysSinceUpload)} 日` : "最近更新状态正常", ""],
  ].map(([label, value, note, cls]) => `<article class="decision ${cls}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join("");
  $("alerts").innerHTML = stale.slice(0, 8).map((row) => `<span>${esc(row.channel)} 已 ${Math.floor(row.daysSinceUpload)} 天未更新</span>`).join("");
}

function renderBars(target, rows, field, formatter) {
  const values = [...rows].filter((row) => row[field] != null).sort((a, b) => b[field] - a[field]);
  const max = Math.max(1, ...values.map((row) => row[field]));
  $(target).innerHTML = values.map((row, index) => `<div class="bar-row"><span class="rank">${String(index + 1).padStart(2, "0")}</span><span class="bar-name" title="${esc(row.channel)}">${esc(row.channel)}</span><span class="track"><i style="width:${Math.max(2, row[field] / max * 100)}%"></i></span><strong>${formatter(row[field])}</strong></div>`).join("");
}

function renderChannelTable(rows) {
  const query = $("channelSearch").value.trim().toLowerCase();
  const filtered = rows.filter((row) => `${row.channel} ${row.youtubeTitle}`.toLowerCase().includes(query));
  $("channelRows").innerHTML = filtered.map((row) => `<tr><td><a class="channel" href="${esc(row.channelUrl)}" target="_blank" rel="noreferrer"><img src="${esc(row.thumbnail)}" alt=""><span><strong>${esc(row.channel)}</strong>${row.youtubeTitle !== row.channel ? `<small>${esc(row.youtubeTitle)}</small>` : ""}</span></a></td><td>${row.hiddenSubscriberCount ? "已隐藏" : num(row.subscriberCount, compact)}</td><td>${signed(row.subscribers24h)}</td><td>${num(row.channelViewCount, compact)}</td><td>${signed(row.views24h)}</td><td>${num(row.uploads30d)}</td><td>${row.averageUploadGapDays == null ? "—" : `${row.averageUploadGapDays} 天`}</td><td>${num(row.recent5AverageViews, compact)}</td><td>${num(row.recent5AverageLikes, compact)}</td><td>${row.daysSinceUpload == null ? "—" : row.daysSinceUpload < 1 ? "今天" : `${Math.floor(row.daysSinceUpload)} 天`}</td></tr>`).join("");
}

function renderTrend() {
  const id = $("channelSelect").value;
  const field = $("metricSelect").value;
  const label = { subscriberCount: "订阅数", channelViewCount: "频道总播放", videoCount: "公开视频数" }[field];
  const rows = state.data.queries.channel_history.rows.filter((row) => row.channelId === id && row[field] != null).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const channel = state.channelRows.find((row) => row.channelId === id);
  const values = rows.map((row) => Number(row[field]));
  const first = values[0], last = values.at(-1), change = first == null || last == null ? null : last - first;
  $("trendSummary").innerHTML = `<div><span>${esc(channel?.channel ?? "频道")} · ${label}</span><strong>${num(last, compact)}</strong></div><div><span>已记录变化</span><strong>${change == null || rows.length < 2 ? "等待更多快照" : `${change > 0 ? "+" : ""}${integer.format(change)}`}</strong></div><div><span>观测点</span><strong>${rows.length}</strong></div>`;
  if (rows.length < 2) { $("trendChart").innerHTML = `<div class="empty-chart"><span>历史基线正在累积</span><small>下一次每小时采集后会出现趋势线</small></div>`; return; }
  const width = 1000, height = 260, pad = 30, min = Math.min(...values), max = Math.max(...values), range = Math.max(1, max - min);
  const points = values.map((value, index) => `${pad + index / (values.length - 1) * (width - pad * 2)},${height - pad - (value - min) / range * (height - pad * 2)}`).join(" ");
  const area = `${pad},${height - pad} ${points} ${width - pad},${height - pad}`;
  $("trendChart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(channel?.channel)} ${label}趋势"><defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".34"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height-pad}"/><line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}"/><polygon points="${area}" fill="url(#areaFill)"/><polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${points.split(" ").at(-1).split(",")[0]}" cy="${points.split(" ").at(-1).split(",")[1]}" r="7" fill="var(--accent)"/></svg><div class="axis-labels"><span>${dt.format(new Date(rows[0].observedAt))}</span><span>${dt.format(new Date(rows.at(-1).observedAt))}</span></div>`;
}

function renderVideos() {
  const videos = [...state.data.queries.recent_videos.rows].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  const shown = videos.slice(0, state.visibleVideos);
  $("videoCountLabel").textContent = `显示 ${shown.length} / ${videos.length}`;
  $("videoRows").innerHTML = shown.map((row) => `<tr><td><a class="video" href="${esc(row.url)}" target="_blank" rel="noreferrer"><img src="${esc(row.thumbnail)}" alt=""><span>${esc(row.title)}</span></a></td><td>${esc(row.channel)}</td><td>${row.publishedAt ? dt.format(new Date(row.publishedAt)) : "—"}</td><td>${num(row.viewCount, compact)}</td><td>${num(row.likeCount, compact)}</td><td>${num(row.commentCount, compact)}</td><td><span class="tag">${esc(row.formatHint)}</span></td></tr>`).join("");
  $("moreVideos").hidden = shown.length >= videos.length;
}

function renderCapabilities(rows) {
  $("capabilityCards").innerHTML = rows.map((row) => `<article class="capability"><div><span>${esc(row.scope)}</span><b>${esc(row.availability)}</b></div><h3>${esc(row.metric)}</h3><p>${esc(row.note)}</p></article>`).join("");
}

async function init() {
  try {
    const response = await fetch("data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    const current = state.data.queries.channel_current.rows;
    const history = state.data.queries.channel_history.rows;
    state.channelRows = addChanges(current, history, state.data.generatedAt);
    const health = state.data.queries.collection_health.rows[0];
    $("health").innerHTML = `<span class="pulse ${health.failureCount ? "warn" : ""}"></span><div><strong>${health.failureCount ? "部分采集异常" : "采集正常"}</strong><small>香港时间 ${dt.format(new Date(state.data.generatedAt))}</small></div>`;
    renderKpis(state.channelRows, health); renderDecisions(state.channelRows);
    renderBars("viewsRanking", state.channelRows, "recent5AverageViews", (value) => num(value, compact));
    renderBars("cadenceRanking", state.channelRows, "uploads30d", (value) => `${num(value)} 条`);
    renderChannelTable(state.channelRows); renderVideos(); renderCapabilities(state.data.queries.capability_matrix.rows);
    $("channelSelect").innerHTML = state.channelRows.map((row) => `<option value="${esc(row.channelId)}">${esc(row.channel)}</option>`).join("");
    renderTrend();
  } catch (error) {
    $("health").innerHTML = `<span class="pulse warn"></span><div><strong>数据加载失败</strong><small>${esc(error.message)}</small></div>`;
  }
}

$("channelSearch").addEventListener("input", () => renderChannelTable(state.channelRows));
$("channelSelect").addEventListener("change", renderTrend);
$("metricSelect").addEventListener("change", renderTrend);
$("moreVideos").addEventListener("click", () => { state.visibleVideos += 24; renderVideos(); });
$("themeToggle").addEventListener("click", () => { document.documentElement.classList.toggle("light"); localStorage.setItem("theme", document.documentElement.classList.contains("light") ? "light" : "dark"); });
if (localStorage.getItem("theme") === "light") document.documentElement.classList.add("light");
init();
