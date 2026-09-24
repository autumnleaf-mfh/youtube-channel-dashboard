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

function previousWeek(history, channelId, generatedAt) {
  const cutoff = toTime(generatedAt) - 7 * 24 * 60 * 60 * 1000;
  return history
    .filter((row) => row.channelId === channelId && toTime(row.observedAt) <= cutoff)
    .sort((a, b) => toTime(b.observedAt) - toTime(a.observedAt))[0];
}

function growthRate(current, baseline, field) {
  const now = Number(current?.[field]);
  const before = Number(baseline?.[field]);
  if (!Number.isFinite(now) || !Number.isFinite(before) || before <= 0) return null;
  return (now - before) / before;
}

function growthText(value) {
  if (value == null) return "等待 7 日基线";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function renderDonut(targetId, rows, field, label) {
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
    return `<circle class="donut-segment" cx="120" cy="120" r="${radius}" fill="none" stroke="${row.color}" stroke-width="28" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${dashOffset}" data-channel="${esc(row.channel)}" data-value="${row.value}" data-growth="${row.weekGrowth == null ? "" : row.weekGrowth}" tabindex="0" role="img" aria-label="${esc(row.channel)}，${label} ${exact(row.value)}，相比上周 ${growthText(row.weekGrowth)}"></circle>`;
  }).join("");

  target.innerHTML = `
    <div class="donut-wrap">
      <svg viewBox="0 0 240 240" aria-label="${label}频道占比图">
        <circle class="donut-track" cx="120" cy="120" r="${radius}" fill="none" stroke-width="28"></circle>
        <g transform="rotate(-90 120 120)">${segments}</g>
      </svg>
      <div class="donut-total"><strong>${compact.format(total)}</strong><span>${label}</span></div>
      <div class="tooltip" role="status" hidden></div>
    </div>
    <div class="legend">${values.map((row) => `<button type="button" class="legend-item" data-channel="${esc(row.channel)}"><i style="background:${row.color}"></i><span>${esc(row.channel)}</span><b>${compact.format(row.value)}</b></button>`).join("")}</div>`;

  const tooltip = target.querySelector(".tooltip");
  const wrap = target.querySelector(".donut-wrap");
  const show = (channel, x, y) => {
    const row = values.find((item) => item.channel === channel);
    if (!row) return;
    tooltip.innerHTML = `<strong>${esc(row.channel)}</strong><span>${label}：${exact(row.value)}</span><span>相比上周：${growthText(row.weekGrowth)}</span>`;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(Math.max(12, x), wrap.clientWidth - 210)}px`;
    tooltip.style.top = `${Math.min(Math.max(12, y), wrap.clientHeight - 96)}px`;
  };
  const hide = () => { tooltip.hidden = true; };

  target.querySelectorAll(".donut-segment").forEach((segment) => {
    segment.addEventListener("mouseenter", (event) => {
      const rect = wrap.getBoundingClientRect();
      show(segment.dataset.channel, event.clientX - rect.left + 12, event.clientY - rect.top + 12);
    });
    segment.addEventListener("mousemove", (event) => {
      const rect = wrap.getBoundingClientRect();
      show(segment.dataset.channel, event.clientX - rect.left + 12, event.clientY - rect.top + 12);
    });
    segment.addEventListener("mouseleave", hide);
    segment.addEventListener("focus", () => show(segment.dataset.channel, wrap.clientWidth / 2 + 32, wrap.clientHeight / 2 - 48));
    segment.addEventListener("blur", hide);
  });

  target.querySelectorAll(".legend-item").forEach((item) => {
    item.addEventListener("mouseenter", () => show(item.dataset.channel, wrap.clientWidth / 2 + 32, wrap.clientHeight / 2 - 48));
    item.addEventListener("mouseleave", hide);
    item.addEventListener("focus", () => show(item.dataset.channel, wrap.clientWidth / 2 + 32, wrap.clientHeight / 2 - 48));
    item.addEventListener("blur", hide);
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

async function init() {
  try {
    const response = await fetch("data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const current = data.queries.channel_current.rows;
    const history = data.queries.channel_history.rows;
    const rows = current.map((row) => {
      const baseline = previousWeek(history, row.channelId, data.generatedAt);
      return {
        ...row,
        subscriberGrowth: growthRate(row, baseline, "subscriberCount"),
        viewsGrowth: growthRate(row, baseline, "channelViewCount"),
      };
    });

    const subscriberRows = rows
      .filter((row) => !row.hiddenSubscriberCount && row.subscriberCount != null)
      .map((row) => ({ ...row, weekGrowth: row.subscriberGrowth }));
    const viewRows = rows
      .filter((row) => row.channelViewCount != null)
      .map((row) => ({ ...row, weekGrowth: row.viewsGrowth }));
    const hiddenCount = rows.filter((row) => row.hiddenSubscriberCount).length;

    $("subscriberNote").textContent = hiddenCount ? `${hiddenCount} 个隐藏订阅频道未计入` : `${subscriberRows.length} 个频道公开值`;
    renderDonut("subscriberChart", subscriberRows, "subscriberCount", "公开订阅");
    renderDonut("viewsChart", viewRows, "channelViewCount", "频道总播放");
    renderUpdates(data.queries.recent_videos.rows, data.generatedAt);
  } catch (error) {
    $("loadError").hidden = false;
    $("loadError").textContent = `数据加载失败：${error.message}`;
  }
}

init();
