# README 骨架（三个 Actor）

- 目的：第1周 R3 写 README 时直接按此填充；首段成稿见 `store-listing.md`。
- 格式规则：README 的 H1 由平台用 Actor 名生成，正文只用 H2 / H3；H2 构成目录，放高搜索量关键词；长问句放 H3（[Create an Actor README](https://docs.apify.com/actors/publishing/actor-readme.md)、[SEO](https://docs.apify.com/academy/actor-marketing-playbook/promote-your-actor/seo)）。
- 通用约束：主关键词出现在首段；名称 / 描述 / schema / README 用词一致（术语表见 `store-listing.md`）；不放站外产品和联系方式；价格示例和 Console 设置一致（改价时同步改 README）。
- 价格示例用任务书 §3.3 的价格；“免费计划每月 $5 用量”来自 [Apify Pricing](https://apify.com/pricing.md)。

---

## 通用章节顺序（三个 README 共用）

| # | 章节（H2） | 内容要点 |
|---|---|---|
| 0 | （无标题首段） | 主关键词开头的 1 段话（成稿见 store-listing.md） |
| 1 | What does {Actor} do? | 3–6 条要点；典型用例 |
| 2 | How to use {Actor} | 3–5 步：打开 → 填输入 → Start → 下载；API / Schedule / 集成 各 1 句 |
| 3 | Input | 字段表（与 input schema 标题一致）+ 1 个 JSON 输入示例 |
| 4 | Output example | 1–2 行 JSON 示例 + 字段说明表；说明 Output 各 view |
| 5 | How much does it cost? (Pricing) | PPE 事件表 + 2–3 个计算示例 + 预算上限说明 |
| 6 | FAQ | 5–8 个 H3 问题 |
| 7 | Limitations | 诚实列出不能做的事 |
| 8 | Disclaimer / Unofficial notice | 商标与非官方声明（③ 必须，② 必须，① 写数据使用声明） |
| 9 | Related Actors（上线后可选） | 只推荐本账号在 Apify Store 上的其它 Actor（平台内推荐，不违规） |

---

## Actor ① Sitemap URL Extractor with Diff & llms.txt Check（`sitemap-url-diff-extractor`）

主关键词：**sitemap extractor**；第二关键词：sitemap url extractor

1. **首段**：见 store-listing.md。
2. **H2 What does Sitemap URL Extractor do?**
   - H3 Extract URLs from sitemap (XML, .gz, sitemap index)
   - H3 Find sitemaps automatically via robots.txt
   - H3 Sitemap monitoring: added and removed URLs（说明快照存在用户自己的命名 KV store）
   - H3 llms.txt checker
   - H3 Optional HTTP status check
   - 用例：SEO 审计、网站迁移、内容监控、给爬虫做种子 URL、“sitemap to CSV”
3. **H2 How to use the sitemap extractor**：输入域名 → 可选过滤 → 可选对比 → Start → 导出 CSV/JSON/Excel；API 调用和每日 Schedule（监控用法）。
4. **H2 Input**：`startUrls`、`maxUrlsPerSite`、发现选项、过滤、对比、状态检查；JSON 示例 `{ "startUrls": ["https://docs.apify.com"], "maxUrlsPerSite": 100 }`。
5. **H2 Output example**：一行 URL 记录 JSON（`url, lastmod, changefreq, priority, changeType, sourceSitemap`）+ 一行 error 记录 + KV `SUMMARY` 示例；说明 views：URLs / Errors。
6. **H2 How much does it cost to extract sitemap URLs?**
   - 事件表：`url-extracted` FREE $0.0005 / BRONZE $0.0004 / SILVER $0.00035 / GOLD $0.0003；`status-checked` $0.0004 / $0.0003 / $0.00025 / $0.0002；Actor start $0.00005。
   - 示例 1：Starter（BRONZE）提取 10,000 条 URL = 10,000 × $0.0004 = **$4.00**（+ $0.00005 启动）。
   - 示例 2：同上再开状态检查 = $4.00 + 10,000 × $0.0003 = **$7.00**。
   - 示例 3：免费计划每月 $5 用量约可提取 **10,000 条** URL（$5 ÷ $0.0005）。
   - 说明：被过滤的 URL、错误行不收费；可在运行选项设置最高费用，撞限后停止并保留已有结果。
7. **H2 FAQ**（H3）：
   - How do I get all URLs from a sitemap?
   - Can it read sitemap index files and .xml.gz sitemaps?
   - How does change tracking work, and where are snapshots stored?（用户账号内的命名 KV store，谁也看不到；可删除）
   - What if a website has no sitemap?（NO_SITEMAP_FOUND；建议改用爬虫类工具）
   - Does it check llms.txt?
   - Can I export the sitemap to CSV or Excel?
   - Why was a site blocked (403)?（不绕过网站访问控制）
   - Can I call it from the API / schedule it daily?
8. **H2 Limitations**：只读网站公开发布的 robots.txt / sitemap / llms.txt，不抓页面内容；sitemap 不完整则结果不完整；被 403/WAF 拦截不会绕过；单文件 >100 MB 停止；对比功能对 >50 万 URL 的站点关闭；lastmod 以网站提供为准。
9. **H2 Responsible use**：不得用于收集个人信息（如个人主页地址）；遵守目标网站条款；状态检查限速。

---

## Actor ② Bulk Core Web Vitals Checker – Lighthouse Audit（`bulk-core-web-vitals-checker`）

主关键词：**bulk core web vitals checker**；相关：lighthouse audit、bulk pagespeed test、page speed checker

1. **首段**：见 store-listing.md。
2. **H2 What does Bulk Core Web Vitals Checker do?**
   - H3 Lighthouse audit for many URLs (mobile and desktop)
   - H3 Core Web Vitals: LCP, CLS, TBT, FCP, Speed Index
   - H3 Top fixes ranked by estimated savings
   - H3 Optional: your own PageSpeed Insights API key for field data
   - 用例：SEO 审计、上线前回归、竞品测速、配合 sitemap extractor 做全站测速
3. **H2 How to check Core Web Vitals in bulk**：粘贴 URL 或选择数据集（接 Actor ①）→ 选设备 → Start → 导出；Schedule 做每周监控。
4. **H2 Input**：`urls`、`urlsDataset`、`strategy`、`categories`、`maxOpportunities`、`engine`、`psiApiKey`（secret，说明加密存储、不记录日志）、超时 / 重试；JSON 示例。
5. **H2 Output example**：一行结果 JSON + 字段表（分数、指标单位、评级阈值）；views：Core Web Vitals / Field data / Top fixes。
6. **H2 How much does a bulk Lighthouse audit cost?**
   - 事件表：`url-audited-local` FREE $0.02 / BRONZE $0.02 / SILVER $0.018 / GOLD $0.016；`url-audited`（自带 key）$0.003 / $0.002 / $0.0018 / $0.0016；Actor start $0.00005 × 内存 GB 数（4 GB = $0.0002）。
   - 示例 1：Starter 测 100 个 URL（mobile）= 100 × $0.02 = **$2.00**（+ $0.0002 启动）。
   - 示例 2：同 100 个 URL 测 mobile + desktop = **$4.00**。
   - 示例 3：用自己的 PSI key 测 100 个 URL = 100 × $0.002 = **$0.20**。
   - 说明：失败的审计不收费（`charged: false`）；最高费用撞限前停止。
7. **H2 FAQ**（H3）：
   - Why are my scores different from PageSpeed Insights?（硬件、网络、Lighthouse 版本、variability；看 `benchmarkIndex`；趋势对比请用同一工具）
   - Do I need a Google API key?（不需要；自带 key 可降价并拿 field data）
   - What is the difference between lab data and field data?
   - How many URLs can I audit per run, and how long does it take?（顺序执行，约 100–200 次/小时【待实测后改为实测值】）
   - Which memory setting should I use?（local 默认 4 GB）
   - Can I audit pages behind a login?（不能）
   - Can I use the output of Sitemap URL Extractor as input?
8. **H2 Limitations**：实验室数据≠真实用户数据；每次审计有波动（建议对重要页面多跑几次取中位数）；不支持登录页、不绕过反爬；不输出截图和 HTML 报告；local 模式无 INP（INP 只有 field data）。
9. **H2 Disclaimer**：Lighthouse、PageSpeed Insights、Chrome 为 Google LLC 商标；独立工具，与 Google 无关联；用户自带 key 时须遵守 Google API 条款。

---

## Actor ③ Rising & Trending Repos Finder for GitHub（`rising-repos-for-github`）

主关键词：**trending github repos**；第二关键词：github repository search

1. **首段**：见 store-listing.md（首段已含非官方声明和“近似 trending、不复制 trending 页面”）。
2. **H2 What does Rising & Trending Repos Finder do?**
   - H3 Find trending GitHub repos (new and gaining stars)
   - H3 GitHub repository search by keyword, language, topic and stars
   - H3 Bulk repository stats for a list of repos
   - H3 Enriched fields with your own token (latest release, README size, bounty issue count)
   - 用例：技术 newsletter、开源趋势研究、投资/选型调研、找值得贡献的项目
3. **H2 How to find trending GitHub repos**：选模式 → 设天数 / 语言 / topic → Start → 导出；每日 Schedule 生成“本周新星”列表。
4. **H2 Input**：模式字段表；`githubToken`（secret；建议 fine-grained、只读公共仓库；不会被记录、共享或复用）；JSON 示例 `{ "mode": "rising", "createdWithinDays": 7, "maxRepos": 20 }`。
5. **H2 Output example**：一行仓库 JSON（`fullName, url, stars, starsPerDay, language, topics, licenseSpdx, createdAt, pushedAt`）+ 字段表；明确写“no owner profile, no emails, no contributor lists”。
6. **H2 How much does it cost?**
   - 事件表：`repo` FREE $0.001 / BRONZE $0.0008 / SILVER $0.0007 / GOLD $0.0006；`repo-enriched` $0.003 / $0.0025 / $0.002 / $0.0018；Actor start $0.00005。
   - 示例 1：Starter 每天拉 100 个新星仓库 = 100 × $0.0008 = **$0.08/天**，约 **$2.40/月**。
   - 示例 2：100 个仓库 + 增强字段 = $0.08 + 100 × $0.0025 = **$0.33**。
   - 示例 3：免费计划 $5 约可获取 **5,000** 个仓库基础数据（$5 ÷ $0.001）。
7. **H2 FAQ**（H3）：
   - How is "trending" calculated?（created 窗口内按 stars 排序 + stars per day；不是 github.com/trending 的算法）
   - Do I need a GitHub token?（默认不需要；未认证搜索每分钟 10 次限额，自带 token 更稳）
   - Is my token safe?（secret 加密输入，只用于本次运行的 API 请求）
   - Why don't you return owner emails or contributor lists?（隐私，GitHub 条款禁止出售个人信息）
   - Why do I get at most 1,000 results per search?（GitHub Search API 限制，缩小日期 / star 区间）
   - What happens when I hit the rate limit?
   - Can I search repositories of a specific user?（不支持 `user:`，可用 `org:`）
8. **H2 Limitations**：GitHub Search API 每查询最多 1,000 条；限额；stars per day 是平均值不是真实日增；数据取自调用时刻；不含私有仓库；不含个人数据字段。
9. **H2 Unofficial notice**：GitHub 为 GitHub, Inc. 商标；本 Actor 非官方、与 GitHub 无关联；只使用公开 REST API；用户须遵守 GitHub Terms of Service 与 Acceptable Use Policies。
