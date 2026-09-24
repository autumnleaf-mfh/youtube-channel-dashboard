const compact = new Intl.NumberFormat("zh-HK", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("zh-HK", { maximumFractionDigits: 0 });
const dateOnly = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Hong_Kong",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dateHour = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Hong_Kong",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  hourCycle: "h23",
});
const colors = ["#e5bd57", "#4ed5a0", "#65a8ff", "#f17f7f", "#a78bfa", "#ff9f43", "#43c6db", "#f36eb5", "#97c95c", "#8e9aad", "#f4d35e", "#5dc0a6", "#c884ff"];

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const toTime = (value) => new Date(value).getTime();
const exact = (value) => Number.isFinite(Number(value)) ? integer.format(Number(value)) : "—";
const ymd = (value) => {
  const parts = Object.fromEntries(dateOnly.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const ymdh = (value) => {
  const parts = Object.fromEntries(dateHour.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:00`;
};

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

function renderDonut(targetId, rows, field, label, periodLabel, options = {}) {
  const target = $(targetId);
  const values = rows
    .filter((row) => Number.isFinite(Number(row[field])))
    .map((row, index) => ({ ...row, value: Number(row[field]), chartValue: Math.max(0, Number(row[field])), color: colors[index % colors.length] }))
    .sort((a, b) => b.value - a.value || a.channel.localeCompare(b.channel, "zh-HK"));
  const total = values.reduce((sum, row) => sum + row.value, 0);
  const pieTotal = values.reduce((sum, row) => sum + row.chartValue, 0);
  const radius = 86;
  const circumference = 2 * Math.PI * radius;
  let used = 0;

  const segments = values.map((row) => {
    const length = pieTotal > 0 ? row.chartValue / pieTotal * circumference : 0;
    const dashOffset = -used;
    used += length;
    const detail = options.detailMode === "windowViews" ? `，发布视频 ${exact(row.windowVideoCount)} 条` : options.detailMode === "allViews" ? "，频道公开累计值" : `，${periodLabel}增长率 ${growthText(row.periodGrowth, periodLabel)}`;
    return `<circle class="donut-segment" cx="120" cy="120" r="${radius}" fill="none" stroke="${row.color}" stroke-width="28" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${dashOffset}" data-channel="${esc(row.channel)}" data-value="${row.value}" tabindex="0" role="img" aria-label="${esc(row.channel)}，${label} ${exact(row.value)}${detail}"></circle>`;
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
    const detail = options.detailMode === "windowViews"
      ? `<span>${periodLabel}发布视频：${exact(row.windowVideoCount)} 条</span>`
      : options.detailMode === "allViews"
        ? `<span>统计口径：频道公开累计值</span>`
        : `<span>${periodLabel}增长率：${growthText(row.periodGrowth, periodLabel)}</span>`;
    tooltip.innerHTML = `<strong>${esc(row.channel)}</strong><span>${label}：${exact(row.value)}</span>${detail}`;
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
          <span class="update-meta"><b>${esc(row.channel)}</b><time datetime="${esc(row.publishedAt)}">${ymdh(row.publishedAt)}</time><span>${exact(row.viewCount)} 次播放</span></span>
        </span>
        <span class="open-mark" aria-hidden="true">↗</span>
      </a>
  </li>`).join("") : `<li class="empty">近 7 日暂无更新</li>`;
}

function selectedChoice(targetId) {
  return $(targetId).querySelector('[aria-pressed="true"]')?.dataset.value ?? "";
}

function setChoiceButtons(targetId, choices, selectedValue) {
  $(targetId).innerHTML = choices.map((choice) => `<button type="button" data-value="${esc(choice.value)}" aria-pressed="${choice.value === selectedValue}">${choice.avatar ? `<img src="${esc(choice.avatar)}" alt="" loading="lazy">` : ""}<span>${esc(choice.label)}</span></button>`).join("");
}

function bindChoiceButtons(targetId, render) {
  $(targetId).addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    $(targetId).querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    render();
  });
}

function renderTrend(videos) {
  const primaryId = selectedChoice("primaryChannel");
  const comparisonId = selectedChoice("comparisonChannel");
  const metric = selectedChoice("trendMetric");
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
  const lines = series.map((item, seriesIndex) => {
    const channel = item.rows[0].channel;
    const points = item.rows.map((row) => `${x(row)},${y(row)}`).join(" ");
    const circles = item.rows.map((row, rowIndex) => `<circle class="trend-point" cx="${x(row)}" cy="${y(row)}" r="5" fill="${item.color}" data-series="${seriesIndex}" data-row="${rowIndex}" tabindex="0" role="img" aria-label="${esc(channel)}，${ymdh(row.publishedAt)}，${metricInfo.label} ${metricInfo.format(row[metric])}"></circle>`).join("");
    return `<polyline points="${points}" fill="none" stroke="${item.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>${circles}`;
  }).join("");

  $("trendLegend").innerHTML = series.map((item) => `<span><i style="background:${item.color}"></i>${esc(item.rows[0].channel)}<b>${item.rows.length} 条视频</b></span>`).join("");
  $("trendChart").innerHTML = `<div class="trend-canvas"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="频道${metricInfo.label}趋势对比"><g class="trend-grid">${grid}</g>${lines}<line class="trend-crosshair" x1="${left}" y1="${top}" x2="${left}" y2="${top + plotHeight}" hidden></line><rect class="trend-hitbox" x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}"></rect><text class="axis-date" x="${left}" y="${height - 10}">${ymd(xMin)}</text><text class="axis-date" x="${width - right}" y="${height - 10}" text-anchor="end">${ymd(xMax)}</text></svg><div class="trend-tooltip" role="status" hidden></div></div>`;

  const chart = $("trendChart");
  const canvas = chart.querySelector(".trend-canvas");
  const svg = chart.querySelector("svg");
  const tooltip = chart.querySelector(".trend-tooltip");
  const crosshair = chart.querySelector(".trend-crosshair");
  const pointNodes = [...chart.querySelectorAll(".trend-point")];
  const nearestRows = (targetTime) => series.map((item, seriesIndex) => {
    let rowIndex = 0;
    for (let index = 1; index < item.rows.length; index += 1) {
      if (Math.abs(toTime(item.rows[index].publishedAt) - targetTime) < Math.abs(toTime(item.rows[rowIndex].publishedAt) - targetTime)) rowIndex = index;
    }
    return { item, seriesIndex, rowIndex, row: item.rows[rowIndex] };
  });
  const showNearest = (event) => {
    const rect = canvas.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const svgX = Math.min(width - right, Math.max(left, (event.clientX - svgRect.left) / svgRect.width * width));
    const targetTime = xMin + (svgX - left) / plotWidth * xRange;
    const nearest = nearestRows(targetTime);
    crosshair.hidden = false;
    crosshair.setAttribute("x1", svgX);
    crosshair.setAttribute("x2", svgX);
    pointNodes.forEach((point) => point.classList.remove("is-nearest"));
    nearest.forEach(({ seriesIndex, rowIndex }) => chart.querySelector(`.trend-point[data-series="${seriesIndex}"][data-row="${rowIndex}"]`)?.classList.add("is-nearest"));
    tooltip.innerHTML = `<strong>${metricInfo.label}</strong>${nearest.map(({ item, row }) => `<div class="nearest-series"><img src="${esc(row.thumbnail)}" alt=""><div><span><i style="background:${item.color}"></i>${esc(row.channel)}</span><b>${metricInfo.format(row[metric])}</b><small>${ymdh(row.publishedAt)}</small><em>${esc(row.title)}</em></div></div>`).join("")}`;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(12, Math.min(event.clientX - rect.left + 14, Math.max(12, canvas.clientWidth - 292)))}px`;
    tooltip.style.top = `${Math.max(12, Math.min(event.clientY - rect.top - (series.length > 1 ? 205 : 132), Math.max(12, canvas.clientHeight - (series.length > 1 ? 218 : 145))))}px`;
  };
  canvas.addEventListener("pointermove", showNearest);
  canvas.addEventListener("pointerleave", () => {
    tooltip.hidden = true;
    crosshair.hidden = true;
    pointNodes.forEach((point) => point.classList.remove("is-nearest"));
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
      periodBaseline: previousSnapshot(history, row.channelId, data.generatedAt, period),
    }));
    const hiddenCount = rows.filter((row) => row.hiddenSubscriberCount).length;
    const publicSubscriberRows = rows.filter((row) => !row.hiddenSubscriberCount && row.subscriberCount != null);
    const subscriberAvailable = (period) => publicSubscriberRows.every((row) => previousSnapshot(history, row.channelId, data.generatedAt, period));
    const availability = { "7": subscriberAvailable("7"), "30": subscriberAvailable("30"), all: true };
    $("subscriberPeriod").querySelectorAll("button").forEach((button) => {
      button.disabled = !availability[button.dataset.period];
      button.setAttribute("aria-disabled", String(button.disabled));
    });
    const defaultSubscriberPeriod = availability["7"] ? "7" : "all";
    $("subscriberPeriod").querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.period === defaultSubscriberPeriod)));

    $("subscriberNote").textContent = hiddenCount ? `${hiddenCount} 个隐藏订阅频道未计入` : `${rows.length} 个频道公开值`;
    const renderSubscribers = (period) => {
      const periodRows = rowsForPeriod(period, "subscriberCount").filter((row) => !row.hiddenSubscriberCount && row.subscriberCount != null);
      const isAll = period === "all";
      const displayRows = isAll ? periodRows : periodRows.map((row) => ({ ...row, subscriberDelta: row.subscriberCount - row.periodBaseline.subscriberCount }));
      renderDonut("subscriberChart", displayRows, isAll ? "subscriberCount" : "subscriberDelta", isAll ? "公开订阅" : "订阅净增长", periodLabels[period]);
    };
    const renderViews = (period) => {
      if (period === "all") {
        $("viewsNote").textContent = "频道公开累计值";
        renderDonut("viewsChart", rows.filter((row) => row.channelViewCount != null), "channelViewCount", "频道总播放", periodLabels[period], { detailMode: "allViews" });
        return;
      }
      const cutoff = toTime(data.generatedAt) - Number(period) * 24 * 60 * 60 * 1000;
      const grouped = new Map();
      data.queries.recent_videos.rows.filter((video) => toTime(video.publishedAt) >= cutoff).forEach((video) => {
        const currentValue = grouped.get(video.channelId) ?? { views: 0, count: 0 };
        currentValue.views += Number(video.viewCount) || 0;
        currentValue.count += 1;
        grouped.set(video.channelId, currentValue);
      });
      const displayRows = rows.map((row) => ({ ...row, windowViewCount: grouped.get(row.channelId)?.views ?? 0, windowVideoCount: grouped.get(row.channelId)?.count ?? 0 }));
      $("viewsNote").textContent = `${periodLabels[period]}发布视频当前播放`;
      renderDonut("viewsChart", displayRows, "windowViewCount", "视频播放", periodLabels[period], { detailMode: "windowViews" });
    };
    bindPeriodSwitch("subscriberPeriod", renderSubscribers);
    bindPeriodSwitch("viewsPeriod", renderViews);
    renderSubscribers(defaultSubscriberPeriod);
    renderViews("7");
    renderUpdates(data.queries.recent_videos.rows, data.generatedAt);
    const channelChoices = rows.map((row) => ({ value: row.channelId, label: row.channel, avatar: row.thumbnail }));
    setChoiceButtons("primaryChannel", channelChoices, rows[0]?.channelId ?? "");
    setChoiceButtons("comparisonChannel", [{ value: "", label: "不对比" }, ...channelChoices.map(({ value, label }) => ({ value, label }))], "");
    const updateTrend = () => renderTrend(data.queries.recent_videos.rows);
    bindChoiceButtons("primaryChannel", updateTrend);
    bindChoiceButtons("comparisonChannel", updateTrend);
    bindChoiceButtons("trendMetric", updateTrend);
    updateTrend();
  } catch (error) {
    $("loadError").hidden = false;
    $("loadError").textContent = `数据加载失败：${error.message}`;
  }
}

init();
