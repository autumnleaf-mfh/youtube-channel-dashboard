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

function completeWindowSnapshot(history, channelId, generatedAt, period) {
  const channelHistory = history.filter((row) => row.channelId === channelId);
  if (period === "all") {
    return channelHistory.sort((a, b) => toTime(a.observedAt) - toTime(b.observedAt))[0];
  }
  const cutoff = toTime(generatedAt) - Number(period) * 24 * 60 * 60 * 1000;
  return channelHistory
    .filter((row) => toTime(row.observedAt) <= cutoff)
    .sort((a, b) => toTime(b.observedAt) - toTime(a.observedAt))[0];
}

function previousSnapshot(history, channelId, generatedAt, period) {
  const complete = completeWindowSnapshot(history, channelId, generatedAt, period);
  if (complete) return complete;
  return history
    .filter((row) => row.channelId === channelId)
    .sort((a, b) => toTime(a.observedAt) - toTime(b.observedAt))[0];
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

function elapsedText(startTime, endTime) {
  const elapsedHours = Math.max(0, Math.floor((endTime - startTime) / (60 * 60 * 1000)));
  if (!elapsedHours) return "不足 1 小时";
  const days = Math.floor(elapsedHours / 24);
  const hours = elapsedHours % 24;
  return [days ? `${days} 天` : "", hours ? `${hours} 小时` : ""].filter(Boolean).join(" ");
}

function countdownText(targetTime, coverageStart, generatedAt) {
  const remainingHours = Math.max(0, Math.ceil((targetTime - Date.now()) / (60 * 60 * 1000)));
  const covered = elapsedText(coverageStart, toTime(generatedAt));
  if (!remainingHours) return `当前先显示已积累 ${covered} 的数据；预计 ${ymdh(targetTime)}（香港时间）完整，等待下一次整点采集`;
  const days = Math.floor(remainingHours / 24);
  const hours = remainingHours % 24;
  const remaining = [days ? `${days} 天` : "", hours ? `${hours} 小时` : ""].filter(Boolean).join(" ");
  return `当前先显示已积累 ${covered} 的数据；完整窗口预计 ${ymdh(targetTime)}（香港时间），还需 ${remaining}`;
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
      if (button.getAttribute("aria-disabled") === "true") return;
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

function bindMultiChannelButtons(targetId, render, allValue = "") {
  const group = $(targetId);
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button || !group.contains(button)) return;
    const buttons = [...group.querySelectorAll("button[data-value]")];
    const channels = buttons.filter((item) => item.dataset.value !== allValue);
    if (button.dataset.value === allValue) {
      buttons.forEach((item) => item.setAttribute("aria-pressed", String(item.dataset.value === allValue)));
    } else {
      button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
      const count = channels.filter((item) => item.getAttribute("aria-pressed") === "true").length;
      const all = count === 0 || count === channels.length;
      buttons.forEach((item) => {
        if (item.dataset.value === allValue) item.setAttribute("aria-pressed", String(all));
        else if (all) item.setAttribute("aria-pressed", "false");
      });
    }
    render();
  });
}

function hongKongDayTimestamp(value) {
  const parts = Object.fromEntries(dateOnly.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00+08:00`);
}

function dailyUploadRows(catalog, channel, start, end) {
  const dayMs = 24 * 60 * 60 * 1000;
  const videosByDay = new Map();
  catalog
    .filter((row) => row.channelId === channel.channelId && Number.isFinite(toTime(row.publishedAt)))
    .forEach((row) => {
      const day = hongKongDayTimestamp(row.publishedAt);
      if (day < start || day > end) return;
      const rows = videosByDay.get(day) ?? [];
      rows.push(row);
      videosByDay.set(day, rows);
    });
  const rows = [];
  for (let day = start; day <= end; day += dayMs) {
    const updates = (videosByDay.get(day) ?? []).sort((a, b) => toTime(b.publishedAt) - toTime(a.publishedAt));
    rows.push({
      channelId: channel.channelId,
      channel: channel.channel,
      publishedAt: new Date(day).toISOString(),
      uploadCount: updates.length,
      updates,
      thumbnail: updates[0]?.thumbnail || channel.thumbnail,
      title: updates.length ? `${updates.length} 条更新${updates[0]?.title ? ` · ${updates[0].title}` : ""}` : "当日无更新",
    });
  }
  return rows;
}

function channelMetricSeries(catalog, channels, history, generatedAt, metric, metricInfo, period) {
  const end = toTime(generatedAt);
  const cutoff = period === "all" ? -Infinity : end - Number(period) * 86400000;
  const selected = catalog.filter((row) => toTime(row.publishedAt) >= cutoff && toTime(row.publishedAt) <= end);
  const endDay = hongKongDayTimestamp(generatedAt);
  const startDay = period === "all" ? (selected.length ? Math.min(...selected.map((row) => hongKongDayTimestamp(row.publishedAt))) : endDay) : hongKongDayTimestamp(cutoff);
  return channels.map((channel, index) => {
    const rows = metric === "subscriberCount"
      ? [...new Map(history.filter((row) => row.channelId === channel.channelId && toTime(row.observedAt) >= cutoff && toTime(row.observedAt) <= end)
        .map((row) => [row.observedAt, { ...row, channel: channel.channel, publishedAt: row.observedAt, thumbnail: channel.thumbnail, title: "频道公开订阅数量 · 历史采集快照" }])).values()].sort((a, b) => toTime(a.publishedAt) - toTime(b.publishedAt))
      : dailyUploadRows(selected, channel, startDay, endDay).map((row) => ({
        ...row,
        [metric]: metric === "uploadCount" ? row.uploadCount : row.updates.some((video) => video[metric] == null || !Number.isFinite(Number(video[metric]))) ? null : row.updates.reduce((sum, video) => sum + Number(video[metric]), 0),
        title: `${row.uploadCount} 条视频 · 按发布日期汇总最近采集值`,
      }));
    return { id: channel.channelId, channel, color: colors[index % colors.length], metric, metricInfo, rows, daily: metric !== "subscriberCount" };
  });
}

function aggregateChannelSeries(series, metric, metricInfo) {
  const byTime = new Map();
  series.forEach((item) => item.rows.forEach((row) => {
    const contributions = byTime.get(row.publishedAt) ?? new Map();
    contributions.set(item.id, { ...row, color: item.color });
    byTime.set(row.publishedAt, contributions);
  }));
  const rows = [...byTime].sort(([a], [b]) => toTime(a) - toTime(b)).map(([publishedAt, values]) => {
    const contributions = [...values.values()];
    const complete = contributions.length === series.length && contributions.every((row) => row[metric] != null && Number.isFinite(Number(row[metric])));
    return {
      channelId: "all", channel: "全部频道总和", publishedAt,
      [metric]: complete ? contributions.reduce((sum, row) => sum + Number(row[metric]), 0) : null,
      contributions, isAggregate: true, updates: contributions.flatMap((row) => row.updates ?? []),
      title: complete ? `${series.length} 个频道合计${metric === "subscriberCount" ? " · 同一采集时点" : " · 按视频发布日期汇总"}` : "该时点数据不齐全，不计算总和",
    };
  });
  return { id: "all", channel: { channel: "全部频道总和" }, color: colors[0], metric, metricInfo, rows, daily: metric !== "subscriberCount" };
}

function renderTrend(videos, catalog, channels, generatedAt, channelHistory = []) {
  const selectedIds = [...$("primaryChannel").querySelectorAll('[aria-pressed="true"]')].map((button) => button.dataset.value);
  const isAll = selectedIds.includes("all") || selectedIds.length === 0;
  const primaryIds = isAll ? channels.map((row) => row.channelId) : selectedIds;
  $("trendPanel").classList.toggle("is-all-channels", isAll);
  $("aggregateTitle").textContent = isAll ? "全部频道总和" : `所选频道趋势 · ${primaryIds.length} 个频道`;
  const primaryMetric = selectedChoice("trendMetric");
  const period = selectedChoice("trendPeriod");
  const periodLabels = { "7": "近 7 日", "30": "近 30 日", "90": "近 90 日", all: "全部记录" };
  const periodDays = { "7": 7, "30": 30, "90": 90 };
  const metricDefinitions = {
    viewCount: { label: "播放量", format: exact, tick: (value) => compact.format(value) },
    subscriberCount: { label: "订阅数量", format: (value) => `${exact(value)} 人`, tick: (value) => compact.format(value) },
    likeCount: { label: "点赞数量", format: exact, tick: (value) => compact.format(value) },
    commentCount: { label: "评论数量", format: exact, tick: (value) => compact.format(value) },
    uploadCount: { label: "更新数量", format: (value) => `${exact(value)} 条`, tick: (value) => exact(Math.round(value)) },
  };
  const dayMs = 24 * 60 * 60 * 1000;
  const cutoff = period === "all" ? -Infinity : toTime(generatedAt) - periodDays[period] * dayMs;
  const selectedMetrics = [primaryMetric];
  const notes = [];
  if (selectedMetrics.includes("subscriberCount")) notes.push("订阅数量按采集时间显示频道公开订阅快照，仅显示已有记录（公开值可能取整）");
  if (selectedMetrics.includes("uploadCount")) notes.push("更新数量按香港日期统计发布数");
  if (selectedMetrics.some((metric) => !["subscriberCount", "uploadCount"].includes(metric))) notes.push("播放、点赞及评论按视频发布时间排列，数值为最近一次采集的累计值");
  $("trendDescription").textContent = isAll
    ? `${periodLabels[period]} · 全部频道总和；${primaryMetric === "subscriberCount" ? "按同一采集时点求和，仅绘制各频道数据齐全的时点；缺失不补零" : primaryMetric === "uploadCount" ? "按香港日期合计发布数量" : "按视频发布日期每日求和，采用最近采集的累计值，并非当日新增量"}。`
    : `${periodLabels[period]} · 已选 ${primaryIds.length} 个频道；${notes.join("；")}。`;
  const breakdown = channelMetricSeries(catalog, channels, channelHistory, generatedAt, primaryMetric, metricDefinitions[primaryMetric], period).filter((item) => primaryIds.includes(item.id));
  const requests = primaryIds.map((id) => ({ id, metric: primaryMetric, comparison: false }));
  const candidates = isAll ? [aggregateChannelSeries(breakdown, primaryMetric, metricDefinitions[primaryMetric])] : requests.map(({ id, metric, comparison }) => {
    const channel = channels.find((row) => row.channelId === id);
    const metricInfo = metricDefinitions[metric];
    const rows = metric === "uploadCount"
      ? channelMetricSeries(catalog, channels, channelHistory, generatedAt, metric, metricInfo, period).find((item) => item.id === id).rows
      : metric === "subscriberCount"
        ? [...new Map(channelHistory.filter((row) => row.channelId === id && row.subscriberCount != null && Number.isFinite(Number(row.subscriberCount)) && toTime(row.observedAt) >= cutoff && toTime(row.observedAt) <= toTime(generatedAt))
          .map((row) => [row.observedAt, { ...row, channel: channel.channel, publishedAt: row.observedAt, thumbnail: channel.thumbnail, title: "频道公开订阅数量 · 历史采集快照" }])).values()]
          .sort((a, b) => toTime(a.publishedAt) - toTime(b.publishedAt))
      : videos
        .filter((row) => row.channelId === id && toTime(row.publishedAt) >= cutoff && toTime(row.publishedAt) <= toTime(generatedAt) && row[metric] != null && Number.isFinite(Number(row[metric])))
        .sort((a, b) => toTime(a.publishedAt) - toTime(b.publishedAt));
    return { id, channel, comparison, color: colors[channels.findIndex((row) => row.channelId === id) % colors.length], metric, metricInfo, rows };
  });
  renderTimeSeries(candidates, periodLabels[period], "trendChart", "trendLegend", isAll && primaryMetric === "subscriberCount" ? "尚无各频道订阅数据齐全的采集时点，暂不计算总和" : "所选频道暂无可用数据");
  renderChannelBreakdown(breakdown, periodLabels[period]);
}

function positionTrendTooltip(tooltip, canvas, event, motion) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const padding = 12;
  const gap = 18;
  if (motion.anchorX == null) {
    motion.anchorX = x;
    motion.side = x >= canvas.clientWidth / 2 ? "left" : "right";
  }
  const deltaX = x - motion.anchorX;
  // Ignore tiny hand jitter but accumulate slow movement until it is meaningful.
  if (Math.abs(deltaX) >= 4) {
    motion.side = deltaX > 0 ? "left" : "right";
    motion.anchorX = x;
  }
  tooltip.style.maxWidth = `${Math.max(1, canvas.clientWidth - padding * 2)}px`;
  tooltip.style.maxHeight = `${Math.max(1, canvas.clientHeight - padding * 2)}px`;
  const tooltipWidth = tooltip.offsetWidth;
  let tooltipHeight = tooltip.offsetHeight;
  const roomLeft = x - gap - padding;
  const roomRight = canvas.clientWidth - x - gap - padding;
  const clamp = (value, low, high) => Math.max(low, Math.min(value, Math.max(low, high)));
  let tooltipLeft;
  let tooltipTop;
  let placement = motion.side;
  if ((motion.side === "left" ? roomLeft : roomRight) >= tooltipWidth) {
    tooltipLeft = motion.side === "left" ? x - gap - tooltipWidth : x + gap;
    tooltipTop = clamp(y - tooltipHeight / 2, padding, canvas.clientHeight - tooltipHeight - padding);
  } else {
    // Do not flip into the direction of travel at an edge. Move above/below
    // instead, shrinking the scroll area so the cursor itself stays uncovered.
    const roomAbove = y - gap - padding;
    const roomBelow = canvas.clientHeight - y - gap - padding;
    placement = roomAbove >= roomBelow ? "above" : "below";
    const verticalRoom = Math.max(1, placement === "above" ? roomAbove : roomBelow);
    tooltip.style.maxHeight = `${verticalRoom}px`;
    tooltipHeight = tooltip.offsetHeight;
    tooltipLeft = clamp(x - tooltipWidth / 2, padding, canvas.clientWidth - tooltipWidth - padding);
    tooltipTop = placement === "above" ? y - gap - tooltipHeight : y + gap;
  }
  tooltip.dataset.placement = placement;
  tooltip.dataset.directionSide = motion.side;
  tooltip.style.left = `${tooltipLeft}px`;
  tooltip.style.top = `${tooltipTop}px`;
}

function renderTimeSeries(candidates, periodLabel, targetId, legendId, emptyMessage = "暂无可用数据") {
  const series = candidates.map((item) => ({ ...item, timeline: item.rows, rows: item.rows.filter((row) => row[item.metric] != null && Number.isFinite(Number(row[item.metric]))) })).filter((item) => item.rows.length);

  if (!series.length) {
    $(legendId).innerHTML = "";
    $(targetId).innerHTML = `<div class="trend-empty">${esc(emptyMessage)}</div>`;
    return;
  }

  const allRows = series.flatMap((item) => item.rows);
  const xValues = allRows.map((row) => toTime(row.publishedAt));
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const xRange = Math.max(1, xMax - xMin);
  const leftSeries = series.find((item) => !item.comparison) ?? series[0];
  const rightSeries = series.find((item) => item.comparison && item.metric !== leftSeries.metric);
  const hasDualAxis = Boolean(rightSeries);
  const maxForSeries = (item) => item.metric === "uploadCount" ? Math.max(4, ...item.rows.map((row) => Number(row[item.metric]))) : Math.max(1, ...item.rows.map((row) => Number(row[item.metric])));
  series.forEach((item) => { item.yMax = Math.max(...series.filter((other) => other.metric === item.metric).map(maxForSeries)); });
  const width = Math.max(260, $(targetId).clientWidth);
  const height = 300;
  const left = width < 600 ? 54 : 66;
  const right = hasDualAxis ? 66 : 20;
  const top = 22;
  const bottom = 48;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (row) => xMax === xMin ? left + plotWidth / 2 : left + (toTime(row.publishedAt) - xMin) / xRange * plotWidth;
  const y = (item, row) => top + plotHeight - Number(row[item.metric]) / item.yMax * plotHeight;
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const yPos = top + plotHeight * (1 - ratio);
    const secondaryTick = hasDualAxis ? `<text class="axis-secondary" style="fill:${rightSeries.color}" x="${width - right + 12}" y="${yPos + 4}">${esc(rightSeries.metricInfo.tick(rightSeries.yMax * ratio))}</text>` : "";
    return `<line x1="${left}" y1="${yPos}" x2="${width - right}" y2="${yPos}"></line><text class="${hasDualAxis ? "axis-primary" : ""}" x="${left - 12}" y="${yPos + 4}" text-anchor="end">${esc(leftSeries.metricInfo.tick(leftSeries.yMax * ratio))}</text>${secondaryTick}`;
  }).join("");
  const lines = series.map((item, seriesIndex) => {
    const channel = item.rows[0].channel;
    const segments = [];
    let segment = [];
    item.timeline.forEach((row) => {
      if (row[item.metric] == null || !Number.isFinite(Number(row[item.metric]))) {
        if (segment.length) segments.push(segment.join(" "));
        segment = [];
      } else segment.push(`${x(row)},${y(item, row)}`);
    });
    if (segment.length) segments.push(segment.join(" "));
    const circles = item.rows.map((row, rowIndex) => `<circle class="trend-point" cx="${x(row)}" cy="${y(item, row)}" r="${series.length > 2 ? 3 : 5}" fill="${item.color}" data-series="${seriesIndex}" data-row="${rowIndex}" data-channel-id="${esc(item.id)}" data-metric="${item.metric}" data-value="${Number(row[item.metric])}" data-time="${esc(row.publishedAt)}" tabindex="0" role="img" aria-label="${esc(channel)}，${ymdh(row.publishedAt)}，${item.metricInfo.label} ${item.metricInfo.format(row[item.metric])}"></circle>`).join("");
    return `${segments.map((points) => `<polyline points="${points}" fill="none" stroke="${item.color}" stroke-width="${item.comparison ? 3 : 2}" ${item.comparison ? 'stroke-dasharray="7 4"' : ""} stroke-linecap="round" stroke-linejoin="round"></polyline>`).join("")}${circles}`;
  }).join("");

  $(legendId).innerHTML = candidates.map((candidate) => {
    const item = series.find((item) => item.id === candidate.id && item.metric === candidate.metric && item.comparison === candidate.comparison) ?? { ...candidate, rows: [] };
    const detail = !item.rows.length ? "暂无可用数据" : item.metric === "uploadCount" ? `${item.rows.reduce((sum, row) => sum + row.uploadCount, 0)} 条更新` : item.metric === "subscriberCount" ? `${item.metricInfo.format(item.rows.at(-1).subscriberCount)} · ${item.rows.length} 个快照` : item.daily ? `${item.metricInfo.format(item.rows.reduce((sum, row) => sum + row[item.metric], 0))} · 窗口内合计` : `${item.rows.length} 条视频`;
    return `<span title="${esc(`${item.channel.channel} · ${item.metricInfo.label} · ${detail}`)}"><i style="background:${item.color}"></i>${esc(item.channel.channel)}${item.comparison ? "（对比·虚线）" : ""}<b>${item.metricInfo.label} · ${detail}</b></span>`;
  }).join("");
  const ariaMetrics = series.map((item) => `${item.rows[0].channel}${item.metricInfo.label}`).join("与");
  $(targetId).innerHTML = `<div class="trend-canvas"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${periodLabel}${esc(ariaMetrics)}趋势对比"><g class="trend-grid">${grid}</g>${lines}<line class="trend-crosshair" x1="${left}" y1="${top}" x2="${left}" y2="${top + plotHeight}" hidden></line><rect class="trend-hitbox" x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}"></rect><text class="axis-date" x="${left}" y="${height - 10}">${ymd(xMin)}</text><text class="axis-date" x="${width - right}" y="${height - 10}" text-anchor="end">${ymd(xMax)}</text></svg><div class="trend-tooltip" role="status" hidden></div></div>`;

  const chart = $(targetId);
  const canvas = chart.querySelector(".trend-canvas");
  const svg = chart.querySelector("svg");
  const tooltip = chart.querySelector(".trend-tooltip");
  const crosshair = chart.querySelector(".trend-crosshair");
  const pointNodes = [...chart.querySelectorAll(".trend-point")];
  const tooltipMotion = { anchorX: null, side: null };
  const nearestRows = (targetTime) => series.map((item, seriesIndex) => {
    let rowIndex = 0;
    for (let index = 1; index < item.rows.length; index += 1) {
      if (Math.abs(toTime(item.rows[index].publishedAt) - targetTime) < Math.abs(toTime(item.rows[rowIndex].publishedAt) - targetTime)) rowIndex = index;
    }
    return { item, seriesIndex, rowIndex, row: item.rows[rowIndex] };
  });
  const showNearest = (event) => {
    const svgRect = svg.getBoundingClientRect();
    const svgX = Math.min(width - right, Math.max(left, (event.clientX - svgRect.left) / svgRect.width * width));
    const targetTime = xMin + (svgX - left) / plotWidth * xRange;
    const nearest = nearestRows(targetTime);
    crosshair.hidden = false;
    crosshair.setAttribute("x1", svgX);
    crosshair.setAttribute("x2", svgX);
    pointNodes.forEach((point) => point.classList.remove("is-nearest"));
    nearest.forEach(({ seriesIndex, rowIndex }) => chart.querySelector(`.trend-point[data-series="${seriesIndex}"][data-row="${rowIndex}"]`)?.classList.add("is-nearest"));
    tooltip.classList.toggle("is-upload-detail", nearest.some(({ item }) => item.metric === "uploadCount"));
    tooltip.classList.toggle("is-multi-series", series.length > 2);
    const tooltipLabel = hasDualAxis ? `${leftSeries.metricInfo.label} / ${rightSeries.metricInfo.label}` : leftSeries.metricInfo.label;
    tooltip.innerHTML = `<strong>${tooltipLabel}</strong>${nearest.map(({ item, row }) => item.metric === "uploadCount"
      ? `<section class="upload-day-series" data-update-count="${row.uploadCount}"><div class="upload-day-header"><span><i style="background:${item.color}"></i>${esc(row.channel)}</span><b>${item.metricInfo.label} ${item.metricInfo.format(row.uploadCount)}</b><small>${ymd(row.publishedAt)}</small></div>${row.updates.length ? `<div class="upload-video-list">${row.updates.map((video) => `<div class="upload-video-item"><img src="${esc(video.thumbnail)}" alt="" loading="lazy"><span class="upload-video-copy"><strong>${esc(video.title)}</strong><span class="upload-video-stats"><span>播放 ${video.viewCount == null ? "—" : exact(video.viewCount)}</span><span>点赞 ${video.likeCount == null ? "—" : exact(video.likeCount)}</span><span>评论 ${video.commentCount == null ? "—" : exact(video.commentCount)}</span></span></span></div>`).join("")}</div>` : `<div class="upload-zero">当日无更新</div>`}</section>`
      : `<div class="nearest-series">${row.isAggregate ? '<div class="aggregate-thumb" aria-hidden="true">Σ</div>' : `<img src="${esc(row.thumbnail)}" alt="">`}<div><span><i style="background:${item.color}"></i>${esc(row.channel)}${item.comparison ? "（对比）" : ""}</span><b>${item.metricInfo.label} ${item.metricInfo.format(row[item.metric])}</b><small>${ymdh(row.publishedAt)}</small><em>${esc(row.title)}</em></div></div>`).join("")}`;
    tooltip.hidden = false;
    positionTrendTooltip(tooltip, canvas, event, tooltipMotion);
  };
  canvas.addEventListener("pointermove", showNearest);
  // Keep long detail lists scrollable without letting the floating box capture
  // pointer motion or freeze the nearest-node calculation underneath it.
  canvas.addEventListener("wheel", (event) => {
    if (tooltip.hidden || event.ctrlKey || event.metaKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const maximum = tooltip.scrollHeight - tooltip.clientHeight;
    if (maximum <= 0) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? tooltip.clientHeight : 1);
    const next = Math.max(0, Math.min(maximum, tooltip.scrollTop + delta));
    if (next === tooltip.scrollTop) return;
    event.preventDefault();
    tooltip.scrollTop = next;
  }, { passive: false });
  canvas.addEventListener("pointerleave", () => {
    tooltip.hidden = true;
    tooltipMotion.anchorX = null;
    tooltipMotion.side = null;
    crosshair.hidden = true;
    pointNodes.forEach((point) => point.classList.remove("is-nearest"));
  });
}

function renderChannelBreakdown(series, periodLabel) {
  const metric = series[0]?.metric;
  const info = series[0]?.metricInfo;
  const mode = selectedChoice("breakdownMode");
  $("breakdownTitle").textContent = `各频道数据 · ${info.label}`;
  $("breakdownNote").textContent = `${periodLabel} · ${series.length} 个频道 · 跟随上方指标与时间窗口；${metric === "subscriberCount" ? "柱状图取窗口内各频道最新订阅快照，折线按采集时间；总和仅使用同一时点齐全的快照" : metric === "uploadCount" ? "柱状图统计窗口内发布总数，折线按香港日期显示每日发布数量" : "柱状图合计窗口内发布视频的最近累计值；折线按发布日期每日求和，并非当日新增量"}。`;
  if (mode === "line") {
    $("breakdownChart").classList.remove("upload-bars");
    renderTimeSeries(series, periodLabel, "breakdownChart", "breakdownLegend");
    return;
  }
  $("breakdownLegend").innerHTML = "";
  $("breakdownChart").classList.add("upload-bars");
  const rows = series.map((item) => ({ ...item, value: metric === "subscriberCount" ? item.rows.at(-1)?.[metric] ?? null : item.rows.some((row) => row[metric] == null) ? null : item.rows.reduce((sum, row) => sum + Number(row[metric]), 0) }))
    .sort((a, b) => (a.value == null) - (b.value == null) || b.value - a.value || a.channel.channel.localeCompare(b.channel.channel, "zh-HK"));
  const maximum = Math.max(1, ...rows.map((row) => row.value ?? 0));
  $("breakdownChart").innerHTML = rows.map((row) => `<div class="upload-bar-row channel-metric-bar" data-channel-id="${esc(row.id)}" data-value="${row.value ?? ""}" data-metric="${metric}"><a class="upload-bar-channel" href="${esc(row.channel.channelUrl)}" target="_blank" rel="noopener noreferrer"><img src="${esc(row.channel.thumbnail)}" alt="" loading="lazy"><span>${esc(row.channel.channel)}</span></a><div class="upload-bar-track" role="img" aria-label="${esc(row.channel.channel)} ${info.label} ${row.value == null ? "暂无数据" : info.format(row.value)}" title="${esc(row.channel.channel)}：${row.value == null ? "暂无数据" : info.format(row.value)}"><span style="width:${(row.value ?? 0) / maximum * 100}%;background:${row.color}"></span></div><b>${row.value == null ? "—" : info.format(row.value)}</b></div>`).join("");
}

function renderAllVideos(videos, generatedAt) {
  const selectedChannels = [...$("videoChannel").querySelectorAll('[aria-pressed="true"]')];
  const channelIds = new Set(selectedChannels.map((button) => button.dataset.value).filter(Boolean));
  const period = selectedChoice("videoPeriod");
  const end = toTime(generatedAt);
  const start = period === "all" ? -Infinity : end - Number(period) * 86400000;
  const direction = selectedChoice("videoSort") === "asc" ? 1 : -1;
  const hasViews = (video) => video.viewCount != null && Number.isFinite(Number(video.viewCount));
  const filtered = videos.filter((video) => (!channelIds.size || channelIds.has(video.channelId))
    && toTime(video.publishedAt) >= start && toTime(video.publishedAt) <= end).sort((a, b) => {
    if (hasViews(a) !== hasViews(b)) return hasViews(a) ? -1 : 1;
    return (hasViews(a) ? direction * (Number(a.viewCount) - Number(b.viewCount)) : 0)
      || toTime(b.publishedAt) - toTime(a.publishedAt) || a.videoId.localeCompare(b.videoId);
  });
  const channelLabel = channelIds.size ? `已选 ${channelIds.size} 个频道：${selectedChannels.filter((button) => button.dataset.value).map((button) => button.textContent.trim()).join("、")}` : "全部频道";
  $("allVideosCount").textContent = `${channelLabel} · ${period === "all" ? "全部时间" : `近 ${period} 天发布`} · ${exact(filtered.length)} 条视频`;
  $("allVideosList").innerHTML = filtered.length ? filtered.map((video) => `<li data-video-id="${esc(video.videoId)}" data-channel-id="${esc(video.channelId)}" data-views="${hasViews(video) ? Number(video.viewCount) : ""}"><a class="all-video-link" href="${esc(video.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(video.thumbnail)}" alt="" loading="lazy"><span class="all-video-copy"><strong>${esc(video.title)}</strong><span><b>${esc(video.channel)}</b><time datetime="${esc(video.publishedAt)}">${ymdh(video.publishedAt)}</time></span></span><span class="all-video-views"><b>${hasViews(video) ? exact(video.viewCount) : "—"}</b><small>次播放</small></span></a></li>`).join("") : `<li class="empty">所选频道在该时间窗口内暂无已采集视频</li>`;
  $("allVideosList").scrollTop = 0;
}

async function init() {
  try {
    const response = await fetch("data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const current = data.queries.channel_current.rows;
    const titles = new Map(current.map((row) => [row.channelId, row.youtubeTitle || row.channel]));
    Object.values(data.queries).forEach((query) => query.rows?.forEach((row) => {
      if (titles.has(row.channelId)) row.channel = titles.get(row.channelId);
    }));
    const history = data.queries.channel_history.rows;
    const rows = current;
    const catalog = [...new Map((data.queries.video_catalog?.rows ?? data.queries.recent_videos.rows)
      .filter((video) => titles.has(video.channelId)).map((video) => [video.videoId, video])).values()];
    const latestVideoById = new Map();
    (data.queries.video_history?.rows ?? data.queries.recent_videos.rows)
      .slice()
      .sort((a, b) => toTime(a.observedAt ?? 0) - toTime(b.observedAt ?? 0))
      .forEach((video) => latestVideoById.set(video.videoId, video));
    const catalogWithMetrics = catalog.map((video) => ({ ...(latestVideoById.get(video.videoId) ?? {}), ...video }));
    const periodLabels = { "7": "近 7 日", "30": "近 30 日", all: "全部记录" };
    const rowsForPeriod = (period, field) => rows.map((row) => ({
      ...row,
      periodGrowth: growthRate(row, previousSnapshot(history, row.channelId, data.generatedAt, period), field),
      periodBaseline: previousSnapshot(history, row.channelId, data.generatedAt, period),
    }));
    const hiddenCount = rows.filter((row) => row.hiddenSubscriberCount).length;
    const publicSubscriberRows = rows.filter((row) => !row.hiddenSubscriberCount && row.subscriberCount != null);
    const subscriberAvailable = (period) => publicSubscriberRows.every((row) => completeWindowSnapshot(history, row.channelId, data.generatedAt, period));
    const availability = { "7": subscriberAvailable("7"), "30": subscriberAvailable("30"), all: true };
    const coverageStart = Math.max(...publicSubscriberRows.map((row) => {
      const channelTimes = history.filter((item) => item.channelId === row.channelId).map((item) => toTime(item.observedAt)).filter(Number.isFinite);
      return channelTimes.length ? Math.min(...channelTimes) : toTime(data.generatedAt);
    }));
    $("subscriberPeriod").querySelectorAll("button").forEach((button) => {
      const incomplete = !availability[button.dataset.period];
      button.setAttribute("aria-disabled", "false");
      if (incomplete) {
        const targetTime = coverageStart + Number(button.dataset.period) * 24 * 60 * 60 * 1000;
        const message = countdownText(targetTime, coverageStart, data.generatedAt);
        button.dataset.countdown = message;
        button.title = message;
      } else {
        delete button.dataset.countdown;
        button.removeAttribute("title");
      }
    });
    const defaultSubscriberPeriod = "7";
    $("subscriberPeriod").querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.period === defaultSubscriberPeriod)));

    const subscriberBaseNote = hiddenCount ? `${hiddenCount} 个隐藏订阅频道未计入` : `${rows.length} 个频道公开值`;
    const renderSubscribers = (period) => {
      const periodRows = rowsForPeriod(period, "subscriberCount").filter((row) => !row.hiddenSubscriberCount && row.subscriberCount != null);
      const isAll = period === "all";
      const displayRows = isAll ? periodRows : periodRows.map((row) => ({ ...row, subscriberDelta: row.subscriberCount - row.periodBaseline.subscriberCount }));
      $("subscriberNote").textContent = !isAll && !availability[period]
        ? `${subscriberBaseNote} · 部分数据 ${elapsedText(coverageStart, toTime(data.generatedAt))}`
        : subscriberBaseNote;
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
      catalogWithMetrics.filter((video) => toTime(video.publishedAt) >= cutoff && toTime(video.publishedAt) <= toTime(data.generatedAt)).forEach((video) => {
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
    renderUpdates(catalogWithMetrics, data.generatedAt);
    const channelChoices = rows.map((row) => ({ value: row.channelId, label: row.channel, avatar: row.thumbnail }));
    setChoiceButtons("primaryChannel", [{ value: "all", label: "全部频道" }, ...channelChoices], "all");
    setChoiceButtons("videoChannel", [{ value: "", label: "全部频道" }, ...channelChoices], "");
    const updateVideoList = () => renderAllVideos(catalogWithMetrics, data.generatedAt);
    bindMultiChannelButtons("videoChannel", updateVideoList);
    bindChoiceButtons("videoSort", updateVideoList);
    bindChoiceButtons("videoPeriod", updateVideoList);
    updateVideoList();
    const trendVideos = catalogWithMetrics
      .filter((video) => video.viewCount != null || video.durationSeconds != null || video.likeCount != null || video.commentCount != null);
    const updateTrend = () => renderTrend(trendVideos, catalogWithMetrics, rows, data.generatedAt, history);
    bindMultiChannelButtons("primaryChannel", updateTrend, "all");
    bindChoiceButtons("trendMetric", updateTrend);
    bindChoiceButtons("trendPeriod", updateTrend);
    bindChoiceButtons("breakdownMode", updateTrend);
    let trendResizeFrame;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(trendResizeFrame);
      trendResizeFrame = requestAnimationFrame(updateTrend);
    });
    updateTrend();
  } catch (error) {
    $("loadError").hidden = false;
    $("loadError").textContent = `数据加载失败：${error.message}`;
  }
}

init();
