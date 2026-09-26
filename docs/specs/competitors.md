# 竞品功能矩阵（每个方向前 5 名）

- 数据来源：Apify Store 公开 API `https://api.apify.com/v2/store?search=...`（列表字段：`stats.totalUsers30Days`、`totalUsers7Days`、`totalUsers`、`publicActorRunStats30Days`、`actorReviewRating/Count`、`currentPricingInfo`、`isWhiteListedForAgenticPayments`）和 `https://api.apify.com/v2/acts/{user}~{name}`（`createdAt`）。
- **抓取时间：2026-09-26 11:33–11:40（UTC+8）**。原始数据：`raw/pool.json`（6,397 个去重 Actor）、`raw/competitors_2026-09-26.json`。
- “前 5 名”= 与该方向直接相关的 Actor 按 30 天用户排序（剔除只是顺带提到 sitemap/GitHub 的无关 Actor，例如 PitchBook、社交账号查找）。
- 成功率 = 30 天 SUCCEEDED / TOTAL（ABORTED、TIMED-OUT 都算不成功，和详情页口径可能不同）。价格为 Store API 当前值；“功能 / 缺口”依据 Store 描述，未实际运行竞品（运行需要账号）——标【假设】的是推断。
- 付费用户占比：Store 不公开【未查到】。

## 方向 ①：Sitemap / robots.txt / llms.txt URL 提取

| Actor | 30 天用户 | 价格（主事件，美元） | 30 天成功率 | 评分 | 创建日期 | x402 白名单 | 主要功能 | 缺口（我们的机会） |
|---|---|---|---|---|---|---|---|---|
| `apify/sitemap-extractor`<br>Sitemap Extractor | 46（7天 10；累计 356） | `apify-default-dataset-item` FREE $0.0005 / BRONZE $0.0003 / GOLD $0.0001 | 66%（605 次） | ★3.2（8） | 2026-01-20 | 是 | robots.txt/sitemap 发现、递归、URL 状态检查（HEAD）；Apify 官方 | 30 天成功率 66%（106 次 ABORTED、94 次 FAILED）；评分 3.2（8 条）；无增量对比、无 llms.txt |
| `crawlerbros/sitemap-url-extractor`<br>Sitemap URL Extractor | 18（7天 4；累计 75） | `apify-default-dataset-item` FREE $0.002 / BRONZE $0.00167 / GOLD $0.001；启动 $0.005 | 56%（87 次） | ★5（1） | 2026-04-24 | 否 | sitemap index、gz、robots 发现；image/video/hreflang 字段 | 成功率 56%（31 次 FAILED）；启动费 $0.005 偏高；非 x402 白名单 |
| `onescales/sitemap-url-extractor`<br>Sitemap URL Extractor | 11（7天 2；累计 635） | `apify-default-dataset-item` FREE $0.03 / BRONZE $0.0029 / GOLD $0.0026；启动 $0.00005 | 100%（352 次） | ★5（3） | 2025-05-18 | 是 | 输入单个 sitemap.xml，输出 URL 和 sitemap 字段 | 需手动给 sitemap URL（无自动发现）；FREE 档 $0.03/条很贵；无对比 |
| `lofomachines/urls-extractor`<br>Website URL Extractor - Get All Site URLs | 8（7天 2；累计 227） | `apify-default-dataset-item` FREE $0.00035 / BRONZE $0.0003 / GOLD $0.0002；启动 $0.05 | 100%（56 次） | ★5（1） | 2025-11-14 | 是 | 爬页面 + 解析 sitemap；关键词过滤、数量上限 | 启动费 FREE $0.05；偏“全站爬取”，不是纯 sitemap；无对比、无 llms.txt |
| `maximedupre/website-url-crawler`<br>Website URL Crawler & Link Extractor | 8（7天 2；累计 42） | `website-url` FREE $0.0003 / BRONZE $0.00025 / GOLD $0.00015 | 81%（62 次） | 无评价 | 2026-05-26 | 是 | 渲染导航 + sitemap，输出链接图、深度、锚文本、HTTP 信息 | 成功率 81%（10 次 TIMED-OUT）；重（浏览器渲染）；无对比 |

**观察名单（同功能新进入者 / 低用户但功能重叠）**

| Actor | 名称 | 30 天用户 | 价格 | 成功率（次数） | 创建 | 描述摘录（Store API） |
|---|---|---|---|---|---|---|
| `boxbox10/sitemap-extractor` | Sitemap Extractor: Website → All URLs (sitemap.xml parser) | 4 | 免费（按用量） | 100%（32） | 2026-07-19 | Give it a website. Get every URL from its sitemap — loc, lastmod, changefreq, priority — as one clean record per URL. Auto-discovers sitemap.xml, robots.txt Sit… |
| `gertner-data/sitemap-delta` | Sitemap Diff — Added, Removed & Changed URLs | 2 | `url-result` $0.0005；启动 $0.001 | 88%（17） | 2026-09-18 | Turn sitemap changes into actionable URL events. Detect added, removed and changed pages for crawl queues, SEO monitoring and content-sync workflows. Launch pri… |
| `webdatatools/sitemap-extractor` | Sitemap URL Extractor & Change Monitor | 1 | `apify-default-dataset-item` FREE $0.0002 / BRONZE $0.00016 / GOLD $0.00012；启动 $0.00005 | 100%（8） | 2026-09-12 | Sitemap URL extractor that reads robots.txt, sitemap indexes, .xml.gz and plain-text sitemaps and returns one row per URL with lastmod, changefreq, priority — p… |
| `noclat/sitemap-llms-txt-extractor` | Sitemap & llms.txt URL Extractor | 1 | `url` $0.001；启动 $0.00001 | 0%（4） | 2026-09-21 | Get every URL a website publishes. Reads robots.txt, follows all sitemaps including sitemap indexes and gzipped files, probes the usual sitemap paths when robot… |
| `cuantic_data/robots-llms-txt-monitor` | robots.txt & llms.txt Monitor - Crawler & AI Access Rules | 1 | 免费（按用量） | 100%（4） | 2026-09-20 | Fetches and parses a domain's robots.txt (RFC 9309) and llms.txt (the emerging AI-agent-friendly file), and flags what changed since the last run. Both files ar… |
| `soilair/sitemap-url-diff-api` | Sitemap URL Diff API | 1 | `url-result` $0.0003；启动 $0.00005 | 100%（2） | 2026-09-23 | Expand public XML sitemaps and compare URLs with a previous snapshot. Return added and removed URLs with source sitemap and lastmod evidence; fail on incomplete… |

**结论：**

- **可靠性仍是最大缺口**：前两名成功率 66%、56%，唯一 100% 的 onescales 需要手动给 sitemap 且 FREE 档 $0.03/条。
- **“与上次运行对比”已不是独家**：2026-09-12 以后新出现了 `webdatatools/sitemap-extractor`（new/removed diff，FREE $0.0002）、`gertner-data/sitemap-delta`（09-18）、`soilair/sitemap-url-diff-api`（09-23），llms.txt 读取也有 `noclat/sitemap-llms-txt-extractor`（09-21，30 天成功率 0%）。它们目前 30 天用户都 ≤2。**我们的主卖点应改为“可靠性 + 清晰失败原因 + 一站式（发现、对比、llms.txt、状态检查）”**，对比功能是加分项而不是唯一差异。
- 价格：webdatatools 的 FREE $0.0002 低于我们的 $0.0005。按任务书 §5.2 规则“先看曝光不先降价”，上线时不跟价。

## 方向 ②：批量 PageSpeed / Core Web Vitals

| Actor | 30 天用户 | 价格（主事件，美元） | 30 天成功率 | 评分 | 创建日期 | x402 白名单 | 主要功能 | 缺口（我们的机会） |
|---|---|---|---|---|---|---|---|---|
| `smart-digital/complete-seo-audit-tool`<br>Complete SEO Audit Tool - Website Crawler with 0-100 Scores | 85（7天 27；累计 666） | `PAGE_ANALYZED` $0.04 | 98%（1036 次） | ★5（3） | 2025-11-11 | 是 | 全站爬取 + 每页 0–100 SEO 分，含 CWV、死链、schema，附修复提示 | $0.04/页，不是专门的批量 CWV 工具；不能直接给 URL 列表只测速【假设，按描述判断】 |
| `dev00/Google-PageSpeed-Insights-api`<br>Google PageSpeed Insights & Lighthouse Scores API | 42（7天 16；累计 73） | `pagespeed-query` $0.002 | 100%（539 次） | 无评价 | 2026-07-29 | 是 | 调 PSI API：4 项分数 + CWV + 建议；“No API Key required” | 依赖开发者自己的 Google key（条款/配额风险在它那边）；无 CrUX 说明【未查到】；2026-07-29 新建两个月 42 人 |
| `constant_quadruped/lighthouse-auditor`<br>Lighthouse Website Auditor | 35（7天 17；累计 191） | 免费（按用量） | 99%（1091 次） | 无评价 | 2025-12-11 | 否 | 本地 Lighthouse；mobile/desktop、节流可配、可选 HTML 报告 | 免费（按用量付费，开发者不赚钱）；非 x402 白名单 |
| `seemuapps/google-pagespeed-insights`<br>Google PageSpeed Insights | 19（7天 8；累计 55） | `url-analyzed` $0.008；启动 $0.00005 | 96%（132 次） | 无评价 | 2026-05-13 | 是 | URL 列表跑 PSI，返回 Lighthouse 分数 + CWV | 单价 $0.008；无数据集输入；无评价 |
| `perryay/website-performance-auditor`<br>Website Performance Auditor — Lighthouse & PageSpeed | 12（7天 3；累计 27） | `apify-actor-start` $0.01；另有 `single-audit`, `batch-audit`, `scheduled-check`, `comparison-report` | 100%（46 次） | 无评价 | 2026-07-27 | 否 | 通过 PSI API 的 Lighthouse 审计；单次/批量/定时/对比报告多事件 | 5 个计费事件、启动费 $0.01，定价复杂；非 x402 白名单 |

**观察名单（同功能新进入者 / 低用户但功能重叠）**

| Actor | 名称 | 30 天用户 | 价格 | 成功率（次数） | 创建 | 描述摘录（Store API） |
|---|---|---|---|---|---|---|
| `onescales/website-speed-checker` | Website Speed Checker | 11 | `apify-default-dataset-item` FREE $0.1 / BRONZE $0.03 / GOLD $0.01；启动 $0.00005 | 99%（137） | 2025-05-28 | Easily get Website Speed Data with Google Lighthouse performance metrics & Core Web Vitals Tool (Performance Score, FCP, LCP, TBT, CLS, Speed Index) from any we… |
| `automation-lab/website-lighthouse-seo-audit` | Lighthouse Website Performance Scraper | 8 | `page-audit` FREE $0.014168 / BRONZE $0.01232 / GOLD $0.007392；启动 $0.005 | 76%（75） | 2026-08-14 | Run Lighthouse audits for public website URLs and export page scores, Core Web Vitals, and structured performance, accessibility, Best Practices, and SEO findin… |
| `nexgendata/page-speed-analyzer` | Page Speed Analyzer — Lighthouse & Web Vitals | 8 | `apify-default-dataset-item` $0.1；启动 $0.00005；另有 `addon-tech-stack-detected`, `addon-page-meta-extracted` | 73%（6807） | 2026-02-17 | Run Google Lighthouse audits at scale — Core Web Vitals, performance scores, SEO analysis. Track site speed across all pages. No API key. Pay per record.… |
| `nexgendata/google-lighthouse-checker` | Lighthouse Bulk Checker — Performance at Scale | 6 | `apify-default-dataset-item` $0.1；启动 $0.00005 | 100%（42） | 2026-02-15 | Run Lighthouse audits on hundreds of URLs simultaneously. Get performance, SEO, accessibility & best practices scores. Monitor Core Web Vitals across your entir… |
| `eliai/core-web-vitals-checker` | Core Web Vitals Checker - Bulk PageSpeed & CrUX Reports | 4 | `vitals-report` FREE $0.01 / BRONZE $0.0093 / GOLD $0.008 | 100%（39） | 2026-08-08 | Bulk Core Web Vitals audits via the official PageSpeed Insights API: score, LCP, CLS, TBT + real-user CrUX assessment per URL. $0.01/report, no start fee. Faile… |

**结论：**

- 需求最大的是**全站 SEO 审计**（smart-digital 85 人）和 **PSI API 封装**（dev00 42 人、seemuapps 19 人）。本地 Lighthouse 类最高是免费的 constant_quadruped（35 人）。
- 我们（B 方案）的直接对手是本地 Lighthouse 类：automation-lab $0.01232（BRONZE，成功率 76%）、onescales $0.03、nexgendata $0.1（成功率 73%）。$0.02 居中；**机会在“可靠性 + 成本透明（失败不收费）+ 可接 Actor ① 数据集 + 用户自带 key 的低价通道”**。
- 风险：dev00 以 $0.002 “无需 key” 占据低价心智；我们用户自带 PSI key 的 `url-audited` 价格与它持平（BRONZE $0.002），但用户要自己申请 key。

## 方向 ③：GitHub 新星仓库 / 仓库数据

| Actor | 30 天用户 | 价格（主事件，美元） | 30 天成功率 | 评分 | 创建日期 | x402 白名单 | 主要功能 | 缺口（我们的机会） |
|---|---|---|---|---|---|---|---|---|
| `automation-lab/github-trending-scraper`<br>GitHub Trending Scraper | 23（7天 14；累计 97） | `repo` FREE $0.00115 / BRONZE $0.001 / GOLD $0.0006；启动 $0.001 | 100%（631 次） | 无评价 | 2026-03-03 | 是 | 抓 GitHub Trending 页面：今日/本周/本月、语言、star 增量、top contributors | 抓网页（Trending 页面结构变化即失效）；输出 contributors（个人数据）；只有 Trending 列表，无关键词搜索/批量仓库 |
| `ryanclinton/github-repo-search`<br>GitHub Repo Search — Stars, Language & Topics | 14（7天 3；累计 125） | `repo-fetched` $0.15；启动 $0.00005 | 99%（119 次） | ★2.7（2） | 2026-02-07 | 是 | 关键词/语言/stars/forks/topic 搜索，输出 owner、license、topics、时间 | $0.15/仓库，极贵；评分 2.7（2 条）；无“新星”模式 |
| `moving_beacon-owner1/github----repository-search-data-scraper`<br>GitHub — Repository Search & Data Scraper | 11（7天 4；累计 48） | `apify-default-dataset-item` $0.01；启动 $0.00005 | 98%（62 次） | 无评价 | 2026-04-05 | 否 | REST API v3：关键词、限定符、用户/组织列表、trending、topic、单仓库 | $0.01/条；支持按用户列仓库（个人数据风险）；非 x402 白名单；slug 难记 |
| `viralanalyzer/github-trending-scraper`<br>GitHub Trending Scraper - Repos, Stars & Developers | 11（7天 4；累计 52） | `repo-scraped` FREE $0.03 / BRONZE $0.03 / GOLD $0.01575 | 100%（127 次） | ★5（4） | 2026-03-04 | 是 | Trending 仓库 + developer profiles，日/周/月 | $0.03/条；输出开发者资料（个人数据）；抓网页 |
| `rupom888/github-repository-scraper`<br>GitHub Repository & Trending Scraper | 9（7天 2；累计 25） | `apify-default-dataset-item` $0.0005；启动 $0.00005 | 100%（84 次） | 无评价 | 2026-05-24 | 是 | 搜索仓库、用户资料、贡献者、trending；可选 token | $0.0005/条最便宜；含用户资料和贡献者（个人数据） |

**观察名单（同功能新进入者 / 低用户但功能重叠）**

| Actor | 名称 | 30 天用户 | 价格 | 成功率（次数） | 创建 | 描述摘录（Store API） |
|---|---|---|---|---|---|---|
| `automation-lab/github-scraper` | GitHub Scraper | 8 | `repo` FREE $0.003 / BRONZE $0.003 / GOLD $0.0018；启动 $0.005；另有 `profile` | 98%（183） | 2026-03-08 | Extract data from GitHub — repository details, developer profiles, trending repos, and search results. Stars, forks, languages, topics, and more. No API key nee… |
| `scrapeworks/github-repo-search` | GitHub Repository Search & Scraper | 4 | `apify-default-dataset-item` $0.002；启动 $0.00005 | 52%（56） | 2026-05-28 | Search GitHub repositories by keyword, language, topic, stars, and date. Clean structured JSON with stars, forks, license, topics, owner, and activity dates. Op… |

**结论：**

- 前 5 名里 4 个输出开发者资料、贡献者或按用户列仓库（个人数据），2 个抓 Trending 网页。**“只用官方 API + 只含仓库级数据 + 声明非官方”在这个方向是明显差异**，也符合 x402/agent 用户对合规的偏好【假设】。
- 价格带：$0.0005（rupom888）到 $0.15（ryanclinton）。我们的 `repo` FREE $0.001 / BRONZE $0.0008 低于头部 automation-lab 的 $0.00115 / $0.001。
- 缺口：没有竞品提供 “stars per day” 这类计算指标和 bounty 标签计数；ryanclinton 价格高、评分低，是可以争取的用户群。
