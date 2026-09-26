# 关键词表（三个 Actor）

- 抓取时间：2026-09-26 11:36–11:41（UTC+8）
- Google 自动补全来源：`https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=us&q=<种子词>`；原始返回在 `raw/gsug_*.json`。“Google 来源”列写的是**哪个种子词的补全列表里出现了这个关键词**；写【未出现】表示本次种子词的补全里没有它（不等于没人搜）。
- Store 来源：`https://api.apify.com/v2/store?search=<关键词>&limit=10`；原始返回在 `raw/keywords_2026-09-26.json`。
  - “Store 结果数”= API 的 `total`。**注意**：Store 搜索是模糊匹配（多词时像 OR），结果数只能看相对大小，不代表同类 Actor 数。
  - “Store 头部”= 前 10 条结果中 30 天用户最多的 Actor 及其 `totalUsers30Days`；“前10合计”= 前 10 条 30 天用户之和（会重复计算同一用户）。
- 搜索量：Google Keyword Planner / Ahrefs 需要账号，本次**不注册账号**，所以绝对搜索量【未查到】。

## Actor ①  Sitemap URL Extractor（`sitemap-url-diff-extractor`）

| # | 关键词 | Google 来源（种子词） | Store 结果数 | Store 排第 1 | Store 头部（前10最高 30 天用户） | 前10合计 |
|---|---|---|---|---|---|---|
| 1 | **sitemap extractor** | `sitemap extractor` | 1,871 | `apify/sitemap-extractor`（46） | `apify/sitemap-extractor`（46） | 81 |
| 2 | sitemap url extractor | `sitemap url extractor` | 1,825 | `onescales/sitemap-url-extractor`（11） | `crawlerbros/sitemap-url-extractor`（18） | 32 |
| 3 | sitemap extractor online | `sitemap extractor` | 303 | `memo23/investors-club-scraper`（3） | `automation-lab/social-media-profile-finder`（38） | 84 |
| 4 | xml sitemap extractor | `sitemap extractor`、`xml sitemap extractor` | 946 | `pink_comic/sitemap-url-extractor`（0） | `factpipe/sitemap-url-extractor`（1） | 5 |
| 5 | extract urls from sitemap | `extract urls from sitemap` | 1,000 | `boring_code/get-urls-from-link`（1） | `boring_code/get-urls-from-link`（1） | 4 |
| 6 | extract all urls from sitemap | `extract urls from sitemap` | 764 | `logiover/sitemap-to-url-crawler`（0） | `andok/wayback-machine-scraper`（17） | 23 |
| 7 | get all urls from sitemap | `get all urls from sitemap` | 1,013 | `dltik/sitemap-url-extractor`（1） | `dltik/sitemap-url-extractor`（1） | 9 |
| 8 | sitemap scraper | `sitemap scraper` | 1,871 | `apify/sitemap-extractor`（46） | `apify/sitemap-extractor`（46） | 81 |
| 9 | sitemap parser | `sitemap parser` | 757 | `boxbox10/sitemap-extractor`（4） | `onescales/sitemap-url-extractor`（11） | 22 |
| 10 | sitemap crawler | `sitemap crawler` | 1,871 | `apify/sitemap-extractor`（46） | `apify/sitemap-extractor`（46） | 81 |
| 11 | sitemap checker | `sitemap checker` | 673 | `zerobreak/sitemap-finder-checker-tool`（1） | `zerobreak/sitemap-finder-checker-tool`（1） | 5 |
| 12 | sitemap to csv | `sitemap to csv` | 939 | `logiover/sitemap-to-url-crawler`（0） | `parseforge/website-content-crawler`（29） | 33 |
| 13 | sitemap link extractor | `sitemap extractor` | 1,170 | `getascraper/url-link-extractor`（1） | `maged120/get-urls-pro`（29） | 44 |
| 14 | website sitemap extractor | `sitemap extractor`、`sitemap url extractor` | 1,130 | `clearfetch/website-sitemap-extractor`（1） | `factpipe/website-screenshot`（2） | 10 |
| 15 | robots.txt sitemap | `robots.txt sitemap` | 703 | `automation-lab/robots-sitemap-analyzer`（1） | `213x/robots-sitemap-discovery`（2） | 8 |
| 16 | llms.txt checker | `llms.txt checker` | 152 | `alizarin_refrigerator-owner/llms-txt-checker`（0） | `zinin/ai-crawler-access-checker`（5） | 13 |
| 17 | llms txt validator | `llms.txt checker` | 318 | `checksmithcats/llms-txt-generator-validator`（1） | `webdatatools/domain-security-audit`（2） | 11 |
| 18 | sitemap monitoring | `sitemap monitor` | 746 | `tugelbay/article-extractor`（16） | `tugelbay/article-extractor`（16） | 20 |
| 19 | sitemap diff | 【未出现】 | 825 | `gertner-data/sitemap-delta`（2） | `automation-lab/domain-age-checker`（3） | 13 |
| 20 | website url extractor | 【未出现】 | 18,825 | `maged120/get-urls-pro`（29） | `maged120/get-urls-pro`（29） | 57 |

**建议：**

- **主关键词：`sitemap extractor`**。Google 自动补全出 10 个变体（online / tool / url / free / xml / link / website），Store 上该词排第一的 `apify/sitemap-extractor` 30 天 46 人，是这个方向需求最集中的词。
- **第二关键词：`sitemap url extractor`**（放在显示名最前）。Store 头部只有 18 人（crawlerbros，成功率 56%），比主词更容易排进前列。
- **H2 候选**：“Extract URLs from sitemap”“Get all URLs from sitemap (XML, .gz, index)”“Sitemap to CSV”“robots.txt sitemap discovery”“llms.txt checker”“Sitemap monitoring: added and removed URLs”。
- `sitemap diff` / `sitemap monitoring` 在 Google 基本没有补全（`sitemap changes` 返回空），差异对比只作功能卖点，不作主词。

## Actor ②  Bulk Core Web Vitals Checker（`bulk-core-web-vitals-checker`）

| # | 关键词 | Google 来源（种子词） | Store 结果数 | Store 排第 1 | Store 头部（前10最高 30 天用户） | 前10合计 |
|---|---|---|---|---|---|---|
| 1 | **bulk core web vitals checker** | `core web vitals bulk` | 99 | `factpipe/lighthouse-auditor`（1） | `onescales/website-speed-checker`（11） | 24 |
| 2 | core web vitals checker | `core web vitals checker` | 149 | `eliai/core-web-vitals-checker`（4） | `onescales/website-speed-checker`（11） | 20 |
| 3 | core web vitals test | `core web vitals checker` | 214 | `trovevault/seo-fields-scraper`（1） | `onescales/website-speed-checker`（11） | 19 |
| 4 | bulk pagespeed test | `bulk pagespeed` | 103 | `nerolabs/bulk-pagespeed-checker`（1） | `nexgendata/page-speed-analyzer`（8） | 21 |
| 5 | bulk pagespeed insights | `bulk pagespeed`、`pagespeed insights bulk` | 43 | `accountable_eel/site-performance-lookup`（1） | `seemuapps/google-pagespeed-insights`（19） | 35 |
| 6 | bulk website speed test | `website speed test bulk` | 1,081 | `scrapeworks/website-performance-analyzer`（0） | `onescales/website-speed-checker`（11） | 34 |
| 7 | page speed checker | `page speed checker` | 2,260 | `nerolabs/bulk-pagespeed-checker`（1） | `perryay/website-performance-auditor`（12） | 34 |
| 8 | website speed checker | `page speed checker` | 909 | `onescales/website-speed-checker`（11） | `ntriqpro/maigret-actor`（172） | 255 |
| 9 | lighthouse audit | `lighthouse audit` | 201 | `constant_quadruped/lighthouse-auditor`（35） | `constant_quadruped/lighthouse-auditor`（35） | 56 |
| 10 | lighthouse audit tool | `lighthouse audit` | 174 | `constant_quadruped/lighthouse-auditor`（35） | `smart-digital/complete-seo-audit-tool`（85） | 132 |
| 11 | lighthouse scores | `lighthouse scores` | 185 | `dev00/Google-PageSpeed-Insights-api`（42） | `dev00/Google-PageSpeed-Insights-api`（42） | 65 |
| 12 | lighthouse api | `lighthouse api` | 212 | `dev00/Google-PageSpeed-Insights-api`（42） | `dev00/Google-PageSpeed-Insights-api`（42） | 68 |
| 13 | pagespeed insights api | `pagespeed insights api` | 82 | `dev00/Google-PageSpeed-Insights-api`（42） | `dev00/Google-PageSpeed-Insights-api`（42） | 69 |
| 14 | core web vitals report | `core web vitals report` | 195 | `eliai/core-web-vitals-checker`（4） | `eliai/core-web-vitals-checker`（4） | 9 |
| 15 | page load time checker | `page speed checker` | 2,236 | `ninhothedev/website-uptime-monitor`（12） | `zhorex/domain-authority-checker`（15） | 32 |
| 16 | lighthouse performance scores | `lighthouse scores` | 95 | `onescales/website-speed-checker`（11） | `onescales/website-speed-checker`（11） | 32 |
| 17 | pagespeed insights api rate limit | `pagespeed insights api` | 39 | `alizarin_refrigerator-owner/pagespeed-intelligence`（2） | `dev00/Google-PageSpeed-Insights-api`（42） | 53 |
| 18 | web vitals | 【未出现】 | 344 | `nexgendata/page-speed-analyzer`（8） | `nexgendata/page-speed-analyzer`（8） | 25 |

**建议：**

- **主关键词：`bulk core web vitals checker`**（Google 自动补全在 “core web vitals bulk” 下给出原词；和技术名、显示名完全一致）。Store 里这个词的头部只有 11 人，竞争小。
- **流量更大的相关词**：`lighthouse audit`（Store #1 constant_quadruped 35 人）、`pagespeed insights api` / `lighthouse scores`（#1 dev00 42 人）、`page speed checker`（Google 10 个补全）。放进 SEO 名、H2 和 FAQ。
- `pagespeed insights` 是 Google 产品名，只作描述（“works like PageSpeed Insights / bring your own PageSpeed Insights API key”），不放进显示名。
- `bulk lighthouse` 在 Google 被非技术含义占据（gifts / flour），不用。

## Actor ③  Rising & Trending Repos Finder for GitHub（`rising-repos-for-github`）

| # | 关键词 | Google 来源（种子词） | Store 结果数 | Store 排第 1 | Store 头部（前10最高 30 天用户） | 前10合计 |
|---|---|---|---|---|---|---|
| 1 | github trending | `github trending` | 1,987 | `viralanalyzer/github-trending-scraper`（11） | `automation-lab/github-trending-scraper`（23） | 52 |
| 2 | github trending repos | `github rising`、`github trending` | 1,451 | `viralanalyzer/github-trending-scraper`（11） | `viralanalyzer/github-trending-scraper`（11） | 25 |
| 3 | **trending github repos** | `trending github repos` | 1,451 | `saswave/github-trending-repositories-developers`（0） | `trepanat0r/github-trending`（2） | 5 |
| 4 | github trending api | `github trending api` | 1,280 | `devilscrapes/github-trending-scraper`（2） | `mohamedgb00714/github-trending-scraper`（3） | 13 |
| 5 | github trending repositories today | `github trending repositories` | 99 | `muzafferkadir/github-trending-scraper`（1） | `automation-lab/github-trending-scraper`（23） | 36 |
| 6 | github trending repositories this week | `github trending repositories` | 222 | `precious_bathmat/emerging-launch-radar`（1） | `automation-lab/github-trending-scraper`（23） | 37 |
| 7 | github rising stars | `github rising` | 282 | `actor_researcher.48/github-developer-intelligence-v1-0`（0） | `betterscrapers/the-better-github-repos-scraper`（1） | 7 |
| 8 | fastest growing github repos | `fastest growing github repos` | 44 | `miccho27/trends-aggregator`（6） | `ryanclinton/github-repo-search`（14） | 24 |
| 9 | github repository search | `github repository search` | 1,065 | `moving_beacon-owner1/github----repository-search-data-scraper`（11） | `moving_beacon-owner1/github----repository-search-data-scraper`（11） | 21 |
| 10 | github repository search api | `github repository search` | 1,010 | `adobeflex/github-repo-search-lite`（1） | `ryanclinton/github-repo-search`（14） | 31 |
| 11 | github search api | `github search api` | 4,575 | `automly/github-code-search-api`（3） | `automly/github-code-search-api`（3） | 11 |
| 12 | github search api rate limit | `github search api` | 1,940 | `chuckling_yarn/dollar-hunter-github-trending`（1） | `moving_beacon-owner1/github----repository-search-data-scraper`（11） | 18 |
| 13 | github repo search | 【未出现】 | 807 | `ryanclinton/github-repo-search`（14） | `ryanclinton/github-repo-search`（14） | 25 |
| 14 | github repo scraper | `github repo scraper` | 1,241 | `dami_studio/github-scraper`（9） | `dami_studio/github-scraper`（9） | 27 |
| 15 | github stars tracker | `github stars tracker` | 700 | `scrapemint/github-trending-scraper`（2） | `scrapemint/github-trending-scraper`（2） | 10 |
| 16 | github star history | `github star history` | 311 | `straightforward_hydra/github-repo-intelligence-stars-releases-issues`（1） | `constant_quadruped/github-repository-analyzer`（3） | 10 |
| 17 | github trending ai repos | `github trending` | 857 | `robinworld/github-ai-trending-repos-radar`（1） | `automation-lab/github-trending-scraper`（23） | 29 |
| 18 | github trending python | `github trending` | 916 | `maximedupre/github-trending-repositories`（1） | `maximedupre/github-trending-repositories`（1） | 5 |
| 19 | github api repository | `github api repository` | 1,328 | `bovi/github-scraper`（0） | `benthepythondev/github-repository-intelligence`（1） | 6 |

**建议：**

- **主关键词：`trending github repos` / `github trending repos`**（两种语序 Google 都有大量补全；Store 头部 23 人 automation-lab，抓的是 Trending 网页，我们走官方 API）。
- **第二关键词：`github repository search`**（Google 补全含 syntax / api；Store 头部 11–14 人，ryanclinton 评分 2.7、单价 $0.15）。
- **长尾**：`fastest growing github repos`（this week / this month 补全，Store 结果只有 44 个，头部 14 人）、`github rising stars`、`github trending ai repos`、`github trending python` —— 适合做 README 的 H3 和 FAQ，以及 Actor Task 预设。
- 措辞：可以用 “trending” 描述用户意图，但 README 必须说明“用官方 Search API 近似，不复制 github.com/trending 页面”。

## 说明：一些噪声结果

- `website speed checker` 的前 10 里出现 `ntriqpro/maigret-actor`（172 人），它是用户名 OSINT 工具，与测速无关，是模糊匹配的噪声；判断头部时已忽略。
- `sitemap extractor online`、`sitemap link extractor` 的头部同样是不相关 Actor（社交资料查找、URL 列表），说明这些长尾词在 Store 里没有专门的 Actor 占位。
- 包含个人数据含义的补全（如 `github see who starred`、`github remove yourself from repo`）已排除，不作为关键词。
