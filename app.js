const compact = new Intl.NumberFormat("zh-HK", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("zh-HK", { maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("zh-HK", {
  timeZone: "Asia/Hong_Kong",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const colors = ["#e5bd57", "#4ed5a0", "#65a8ff", "#f17f7f", "#a78bfa", "#ff9f43", "#43c6db", "#f36eb5", "#97c95c", "#8e9aad", "#f4d35e", "#5dc0a6", "#c884ff"];

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const toTime = (value) => new Date(value).getTime();
const exact = (value) => Number.isFinite(Number(value)) ? integer.format(Number(value)) : "—";

function previousSnapshot(history, channelId, generatedAt, period) {
  const channelHistory = history.filter((row) => row.channelId === channelId);
  if (period === "all") {
    return channelHistory.sort((a, b) => toTime(a.observedAt) - toTime(b.observedAt))[0];
  }
  const cutoff = toTime(generatedAt) - Number(period) * 24 * 60 * 60 * 1000;
  return channelHistory
    .filter((row) => toTime(row.observedAt) <= cutoff)
    .sort((a, b) => toTime(b.observedAt) - toTime(a.observedAt))[0];
}

function growthRate(current, baseline, field) {
  const now = Number(current?.[field]);
  const before = Number(baseline?.[field]);
  if (!Number.isFinite(now) || !Number.isFinite(before) || before <= 0) return null;
  return (now - before) / before;
}

function growthText(value, periodLabel) {
  if (value == null) return periodLabel === "全部记录" ? "等待历史基线" : `等待${periodLabel.replace("近", "")}基线`;
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function durationText(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function renderDonut(targetId, rows, field, label, periodLabel) {
  const target = $(targetId);
  const values = rows
    .filter((row) => Number.isFinite(Number(row[field])) && Number(row[field]) >= 0)
    .map((row, index) => ({ ...row, value: Number(row[field]), color: colors[index % colors.length] }));
  const total = values.reduce((sum, row) => sum + row.value, 0);
  const radius = 86;
  const circumference = 2 * Math.PI * radius;
  let used = 0;

  const segments = values.map((row) => {
    const length = total > 0 ? row.value / total * circumference : 0;
    const dashOffset = -used;
    used += length;
    return `<circle class="donut-segment" cx="120" cy="120" r="${radius}" fill="none" stroke="${row.color}" stroke-width="28" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${dashOffset}" data-channel="${esc(row.channel)}" data-value="${row.value}" data-growth="${row.periodGrowth == null ? "" : row.periodGrowth}" tabindex="0" role="img" aria-label="${esc(row.channel)}，${label} ${exact(row.value)}，${periodLabel}增长率 ${growthText(row.periodGrowth, periodLabel)}"></circle>`;
  }).join("");

  target.innerHTML = `
    <div class="donut-wrap">
      <svg viewBox="0 0 240 240" aria-label="${label}频道占比图">
        <circle class="donut-track" cx="120" cy="120" r="${radius}" fill="none" stroke-width="28"></circle>
        <g transform="rotate(-90 120 120)">${segments}</g>
      </svg>
      <div class="donut-total"><strong>${compact.format(total)}</strong><span>${label} · ${periodLabel}</span></div>
      <div class="tooltip" role="status" hidden></div>
    </div>
    <div class="legend">${values.map((row) => `<button type="button" class="legend-item" data-channel="${esc(row.channel)}"><i style="background:${row.color}"></i><span>${esc(row.channel)}</span><b>${compact.format(row.value)}</b></button>`).join("")}</div>`;

  const tooltip = target.querySelector(".tooltip");
  const wrap = target.querySelector(".donut-wrap");
  const show = (channel, x, y) => {
    const row = values.find((item) => item.channel === channel);
    if (!row) return;
    tooltip.innerHTML = `<strong>${esc(row.channel)}</strong><span>${label}：${exact(row.value)}</span><span>${periodLabel}增长率：${growthText(row.periodGrowth, periodLabel)}</span>`;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(Math.max(12, x), wrap.clientWidth - 210)}px`;
    tooltip.style.top = `${Math.min(Math.max(12, y), wrap.clientHeight - 96)}px`;
  };
  const hide = () => { tooltip.hidden = true; };

  const segmentNodes = [...target.querySelectorAll(".donut-segment")];
  const activate = (channel) => {
    target.classList.add("has-active");
    segmentNodes.forEach((segment) => segment.classList.toggle("is-active", segment.dataset.channel === channel));
  };
  const deactivate = () => {
    target.classList.remove("has-active");
    segmentNodes.forEach((segment) => segment.classList.remove("is-active"));
    hide();
  };

  segmentNodes.forEach((segment) => {
    segment.addEventListener("mouseenter", (event) => {
      const rect = wrap.getBoundingClientRect();
      activate(segment.dataset.channel);
      show(segment.dataset.channel, event.clientX - rect.left + 12, event.clientY - rect.top + 12);
    });
    segment.addEventListener("mousemove", (event) => {
      const rect = wrap.getBoundingClientRect();
      show(segment.dataset.channel, event.clientX - rect.left + 12, event.clientY - rect.top + 12);
    });
    segment.addEventListener("mouseleave", deactivate);
    segment.addEventListener("focus", () => { activate(segment.dataset.channel); show(segment.dataset.channel, wrap.clientWidth / 2 + 32, wrap.clientHeight / 2 - 48); });
    segment.addEventListener("blur", deactivate);
  });

  target.querySelectorAll(".legend-item").forEach((item) => {
    item.addEventListener("mouseenter", () => { activate(item.dataset.channel); show(item.dataset.channel, wrap.clientWidth / 2 + 32, wrap.clientHeight / 2 - 48); });
    item.addEventListener("mouseleave", deactivate);
    item.addEventListener("focus", () => { activate(item.dataset.channel); show(item.dataset.channel, wrap.clientWidth / 2 + 32, wrap.clientHeight / 2 - 48); });
    item.addEventListener("blur", deactivate);
  });
}

function bindPeriodSwitch(targetId, render) {
  const target = $(targetId);
  target.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      target.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      render(button.dataset.period);
    });
  });
}

function renderUpdates(videos, generatedAt) {
  const cutoff = toTime(generatedAt) - 7 * 24 * 60 * 60 * 1000;
  const rows = videos
    .filter((row) => Number.isFinite(toTime(row.publishedAt)) && toTime(row.publishedAt) >= cutoff)
    .sort((a, b) => toTime(b.publishedAt) - toTime(a.publishedAt));

  $("updateCount").textContent = `${rows.length} 条 · 最近更新优先`;
  $("updatesList").innerHTML = rows.length ? rows.map((row) => `
    <li>
      <a class="update-link" href="${esc(row.url)}" target="_blank" rel="noreferrer">
        <img src="${esc(row.thumbnail)}" alt="" loading="lazy">
        <span class="update-body">
          <strong>${esc(row.title)}</strong>
          <span class="update-meta"><b>${esc(row.channel)}</b><time datetime="${esc(row.publishedAt)}">${dateTime.format(new Date(row.publishedAt))}</time><span>${exact(row.viewCount)} 次播放</span></span>
        </span>
        <span class="open-mark" aria-hidden="true">↗</span>
      </a>
  </li>`).join("") : `<li class="empty">近 7 日暂无更新</li>`;
}

function renderTrend(videos) {
  const primaryId = $("primaryChannel").value;
  const comparisonId = $("comparisonChannel").value;
  const metric = $("trendMetric").value;
  const metricInfo = {
    viewCount: { label: "播放量", format: exact, tick: (value) => compact.format(value) },
    durationSeconds: { label: "播放时长", format: durationText, tick: (value) => `${Math.round(value / 60)} 分` },
    likeCount: { label: "点赞数量", format: exact, tick: (value) => compact.format(value) },
    commentCount: { label: "评论数量", format: exact, tick: (value) => compact.format(value) },
  }[metric];
  const ids = [primaryId, comparisonId].filter((id, index, list) => id && list.indexOf(id) === index);
  const series = ids.map((id, index) => ({
    id,
    color: index === 0 ? "#e5bd57" : "#65a8ff",
    rows: videos
      .filter((row) => row.channelId === id && row[metric] != null && Number.isFinite(Number(row[metric])))
      .sort((a, b) => toTime(a.publishedAt) - toTime(b.publishedAt)),
  })).filter((item) => item.rows.length);

  if (!series.length) {
    $("trendLegend").innerHTML = "";
    $("trendChart").innerHTML = `<div class="trend-empty">所选频道暂无可用数据</div>`;
    return;
  }

  const allRows = series.flatMap((item) => item.rows);
  const xValues = allRows.map((row) => toTime(row.publishedAt));
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const xRange = Math.max(1, xMax - xMin);
  const yMax = Math.max(1, ...allRows.map((row) => Number(row[metric])));
  const width = 1000;
  const height = 390;
  const left = 72;
  const right = 24;
  const top = 22;
  const bottom = 48;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (row) => left + (toTime(row.publishedAt) - xMin) / xRange * plotWidth;
  const y = (row) => top + plotHeight - Number(row[metric]) / yMax * plotHeight;
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const yPos = top + plotHeight * (1 - ratio);
    return `<line x1="${left}" y1="${yPos}" x2="${width - right}" y2="${yPos}"></line><text x="${left - 12}" y="${yPos + 4}" text-anchor="end">${esc(metricInfo.tick(yMax * ratio))}</text>`;
  }).join("");
  const dateLabel = new Intl.DateTimeFormat("zh-HK", { timeZone: "Asia/Hong_Kong", month: "2-digit", day: "2-digit" });
  const lines = series.map((item) => {
    const channel = item.rows[0].channel;
    const points = item.rows.map((row) => `${x(row)},${y(row)}`).join(" ");
    const circles = item.rows.map((row) => `<circle class="trend-point" cx="${x(row)}" cy="${y(row)}" r="5" fill="${item.color}" data-channel="${esc(channel)}" data-title="${esc(row.title)}" data-date="${esc(row.publishedAt)}" data-value="${Number(row[metric])}" tabindex="0" role="img" aria-label="${esc(channel)}，${dateLabel.format(new Date(row.publishedAt))}，${metricInfo.label} ${metricInfo.format(row[metric])}"></circle>`).join("");
    return `<polyline points="${points}" fill="none" stroke="${item.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>${circles}`;
  }).join("");

  $("trendLegend").innerHTML = series.map((item) => `<span><i style="background:${item.color}"></i>${esc(item.rows[0].channel)}<b>${item.rows.length} 条视频</b></span>`).join("");
  $("trendChart").innerHTML = `<div class="trend-canvas"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="频道${metricInfo.label}趋势对比"><g class="trend-grid">${grid}</g>${lines}<text class="axis-date" x="${left}" y="${height - 10}">${dateLabel.format(new Date(xMin))}</text><text class="axis-date" x="${width - right}" y="${height - 10}" text-anchor="end">${dateLabel.format(new Date(xMax))}</text></svg><div class="trend-tooltip" role="status" hidden></div></div>`;

  const chart = $("trendChart");
  const canvas = chart.querySelector(".trend-canvas");
  const tooltip = chart.querySelector(".trend-tooltip");
  const showPoint = (point, clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    tooltip.innerHTML = `<strong>${esc(point.dataset.channel)}</strong><span>${esc(point.dataset.title)}</span><b>${metricInfo.label}：${metricInfo.format(Number(point.dataset.value))}</b><small>${dateTime.format(new Date(point.dataset.date))}</small>`;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(Math.max(12, clientX - rect.left + 12), canvas.clientWidth - 260)}px`;
    tooltip.style.top = `${Math.min(Math.max(12, clientY - rect.top - 116), canvas.clientHeight - 126)}px`;
  };
  chart.querySelectorAll(".trend-point").forEach((point) => {
    point.addEventListener("mouseenter", (event) => showPoint(point, event.clientX, event.clientY));
    point.addEventListener("mousemove", (event) => showPoint(point, event.clientX, event.clientY));
    point.addEventListener("mouseleave", () => { tooltip.hidden = true; });
    point.addEventListener("focus", () => {
      const svgRect = point.ownerSVGElement.getBoundingClientRect();
      showPoint(point, svgRect.left + Number(point.getAttribute("cx")) / 1000 * svgRect.width, svgRect.top + Number(point.getAttribute("cy")) / 390 * svgRect.height);
    });
    point.addEventListener("blur", () => { tooltip.hidden = true; });
  });
}

async function init() {
  try {
    const response = await fetch("data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const current = data.queries.channel_current.rows;
    const history = data.queries.channel_history.rows;
    const rows = current;
    const periodLabels = { "7": "近 7 日", "30": "近 30 日", all: "全部记录" };
    const rowsForPeriod = (period, field) => rows.map((row) => ({
      ...row,
      periodGrowth: growthRate(row, previousSnapshot(history, row.channelId, data.generatedAt, period), field),
    }));
    const hiddenCount = rows.filter((row) => row.hiddenSubscriberCount).length;

    $("subscriberNote").textContent = hiddenCount ? `${hiddenCount} 个隐藏订阅频道未计入` : `${rows.length} 个频道公开值`;
    const renderSubscribers = (period) => renderDonut(
      "subscriberChart",
      rowsForPeriod(period, "subscriberCount").filter((row) => !row.hiddenSubscriberCount && row.subscriberCount != null),
      "subscriberCount",
      "公开订阅",
      periodLabels[period],
    );
    const renderViews = (period) => renderDonut(
      "viewsChart",
      rowsForPeriod(period, "channelViewCount").filter((row) => row.channelViewCount != null),
      "channelViewCount",
      "频道总播放",
      periodLabels[period],
    );
    bindPeriodSwitch("subscriberPeriod", renderSubscribers);
    bindPeriodSwitch("viewsPeriod", renderViews);
    renderSubscribers("7");
    renderViews("7");
    renderUpdates(data.queries.recent_videos.rows, data.generatedAt);
    const options = rows.map((row) => `<option value="${esc(row.channelId)}">${esc(row.channel)}</option>`).join("");
    $("primaryChannel").innerHTML = options;
    $("comparisonChannel").innerHTML = `<option value="">不对比</option>${options}`;
    if (rows[2]) $("comparisonChannel").value = rows[2].channelId;
    const updateTrend = () => renderTrend(data.queries.recent_videos.rows);
    $("primaryChannel").addEventListener("change", updateTrend);
    $("comparisonChannel").addEventListener("change", updateTrend);
    $("trendMetric").addEventListener("change", updateTrend);
    updateTrend();
  } catch (error) {
    $("loadError").hidden = false;
    $("loadError").textContent = `数据加载失败：${error.message}`;
  }
}

init();
