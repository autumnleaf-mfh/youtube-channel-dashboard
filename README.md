# YouTube 频道增长雷达

追踪 13 个财经 YouTube 频道的公开更新与增长数据，并通过 GitHub Pages 提供静态看板。

## 看板内容

- 当前订阅数、频道总播放、公开视频数
- 24 小时与 7 日订阅/播放变化（从首次快照开始累计）
- 7/30/90 日更新数、平均更新间隔、停更天数
- 近 5 条视频平均播放、平均点赞与公开互动率
- 单频道订阅和频道总播放历史趋势
- 最新视频表现、停更提醒与采集健康状态
- 公开 Data API 与频道主 OAuth/Analytics API 的能力边界

## 自动更新

`.github/workflows/pages.yml` 每小时运行一次：

1. 使用仓库 Secret `YOUTUBE_API_KEY` 调用 YouTube Data API v3；
2. 更新 `src/data.json` 并提交快照；
3. 构建静态站点并部署到 GitHub Pages。

首次部署后，24 小时和 7 日变化需要分别积累足够时间才会显示；缺失历史不会被当作 0。

## 本地更新与构建

```powershell
$env:YOUTUBE_API_KEY = "your-api-key"
python scripts/collect_youtube.py
npm ci
npm run build
```

## 数据口径

- 公开订阅数由 YouTube 按三位有效数字取整，也可能被频道隐藏。
- 历史变化不是 YouTube 提供的历史字段，而是本仓库按小时保存的快照差值。
- `(点赞 + 评论) / 播放` 仅为本站的公开互动率定义，不等于 YouTube Studio 指标。
- 视频时长只用于“短视频候选”提示，不能单靠时长准确判定 Shorts。
- 展示次数、点击率、观看时长、留存、独立观众、流量来源和收入等数据需要频道主 OAuth 授权与 YouTube Analytics API。

