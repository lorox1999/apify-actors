# Store 上架文案（英文成稿，面向海外用户）

- 适用：Publishing → Display information（名称、描述、SEO 名、SEO 描述、分类）和 README 首段。
- 字符数由脚本计算（Python `len`，含空格和标点）。官方建议：名称 40–50、描述约 300、SEO 名 40–50、SEO 描述 145–155（[Actor description & SEO description](https://docs.apify.com/academy/actor-marketing-playbook/actor-basics/actor-description)、[Name your Actor](https://docs.apify.com/academy/actor-marketing-playbook/actor-basics/name-your-actor)）。
- 规则自检：①名称 / 描述 / input schema 标题 / README 首段使用同一组术语（见各节“术语表”）；②第三方商标只作描述性使用并声明非官方；③不出现任何平台外产品、网站、联系方式或站外付款引导（Publishing Terms 2.2.4 / 10.4）；④文案为本项目原创，未复制竞品描述（竞品原文见 `competitors.md` 观察名单，可对照）。
- Store 分类取值来自 Store API 返回的 `categories` 枚举（AUTOMATION、DEVELOPER_TOOLS、SEO_TOOLS、OPEN_SOURCE 等）。

## Actor ① Sitemap URL Extractor  （技术名 `sitemap-url-diff-extractor`）

| 字段 | 英文文案 | 字符数 |
|---|---|---|
| Display name（显示名） | Sitemap URL Extractor with Diff & llms.txt Check | 48 |
| Short description（Store 描述） | Sitemap URL extractor for SEO audits, migrations and crawl seeding. Finds sitemaps via robots.txt and common paths, follows sitemap indexes and .gz files, and checks llms.txt. Get URL, lastmod, changefreq and priority, filter by date or regex, and see URLs added or removed since your last run. | 294 |
| SEO title（SEO 名） | Sitemap Extractor: Get All URLs from XML Sitemaps | 49 |
| SEO description | Sitemap extractor that gets every URL from XML sitemaps, indexes and .gz files. Finds sitemaps via robots.txt, checks llms.txt, flags new and removed URLs. | 155 |
| Categories | SEO tools (SEO_TOOLS), Developer tools (DEVELOPER_TOOLS) | — |
| SEO keywords（README 中自然使用，不堆砌） | sitemap extractor, sitemap url extractor, xml sitemap extractor, extract urls from sitemap, get all urls from sitemap, sitemap scraper, sitemap parser, sitemap crawler, sitemap to csv, robots.txt sitemap, llms.txt checker, sitemap monitoring | — |
| Pricing line（README Pricing 节首句） | `url-extracted` — $0.50 per 1,000 URLs (FREE), $0.40 (BRONZE), $0.35 (SILVER), $0.30 (GOLD); optional `status-checked` — $0.40 / $0.30 / $0.25 / $0.20 per 1,000 URLs; plus the default Actor start fee. | — |
| Trademark / disclaimer | Not applicable (no third-party brand in the name). README states that the Actor only reads files that websites publish for crawlers (robots.txt, sitemaps, llms.txt) and must not be used to collect personal data. | — |

**README first paragraph（成稿）**

**Sitemap URL Extractor** gets every URL a website lists in its XML sitemaps, in one clean table. Enter a domain and this sitemap extractor finds the sitemaps through robots.txt and common paths, follows sitemap indexes and `.gz` files, and returns each URL with `lastmod`, `changefreq` and `priority`. Turn on change tracking to see which URLs were **added** or **removed** since your last run, check whether the site publishes `llms.txt`, and optionally record the HTTP status of every URL. Use it for SEO audits, site migrations, content monitoring and seeding your own crawlers.

（582 字符；主关键词出现在首句）

## Actor ② Bulk Core Web Vitals Checker  （技术名 `bulk-core-web-vitals-checker`）

| 字段 | 英文文案 | 字符数 |
|---|---|---|
| Display name（显示名） | Bulk Core Web Vitals Checker – Lighthouse Audit | 47 |
| Short description（Store 描述） | Bulk Core Web Vitals checker that runs real Lighthouse audits in the cloud. Paste URLs or reuse a dataset and get Performance, Accessibility, Best Practices and SEO scores plus LCP, CLS, TBT, FCP and top fixes per page, mobile or desktop. No API key needed; add your own PageSpeed key for field data. | 300 |
| SEO title（SEO 名） | Bulk Core Web Vitals & Page Speed Test, Lighthouse | 50 |
| SEO description | Bulk Core Web Vitals checker: run Lighthouse audits on hundreds of URLs and get LCP, CLS, TBT, FCP and all four scores. No API key needed. Export to CSV. | 153 |
| Categories | SEO tools (SEO_TOOLS), Developer tools (DEVELOPER_TOOLS) | — |
| SEO keywords（README 中自然使用，不堆砌） | bulk core web vitals checker, core web vitals checker, core web vitals test, bulk pagespeed test, page speed checker, website speed checker, lighthouse audit, lighthouse scores, lighthouse api, pagespeed insights api, core web vitals report, bulk website speed test | — |
| Pricing line（README Pricing 节首句） | `url-audited-local` — $0.02 per audit (FREE/BRONZE), $0.018 (SILVER), $0.016 (GOLD); `url-audited` (your own PageSpeed Insights key) — $0.003 / $0.002 / $0.0018 / $0.0016; failed audits are free; plus the default Actor start fee. | — |
| Trademark / disclaimer | "Lighthouse, PageSpeed Insights and Chrome are trademarks of Google LLC. This Actor is an independent tool and is not affiliated with or endorsed by Google." | — |

**README first paragraph（成稿）**

**Bulk Core Web Vitals Checker** runs real Lighthouse audits on a list of URLs and gives you one row per page: Performance, Accessibility, Best Practices and SEO scores, plus the lab metrics behind Core Web Vitals — LCP, CLS, TBT and FCP — and the top fixes ranked by estimated savings. Lighthouse runs inside the Actor, so **no API key is needed**. If you have your own PageSpeed Insights API key, you can switch to it for a lower per-URL price and real-user (Chrome UX Report) field data. Paste URLs, or load them from a dataset such as the output of a sitemap extractor, and export the results to CSV, Excel or JSON.

（619 字符；主关键词出现在首句）

## Actor ③ Rising & Trending Repos Finder for GitHub  （技术名 `rising-repos-for-github`）

| 字段 | 英文文案 | 字符数 |
|---|---|---|
| Display name（显示名） | Rising & Trending Repos Finder for GitHub | 41 |
| Short description（Store 描述） | Find rising and trending GitHub repositories with the official GitHub REST API. Discover new projects gaining stars fast, search by keyword, language, topic or stars, or look up a list of repos. Get stars, forks, stars per day, license, topics and last push. Repository data only. Not affiliated with GitHub. | 308 |
| SEO title（SEO 名） | Trending GitHub Repos Finder: Rising Stars via API | 50 |
| SEO description | Find trending GitHub repos via the official REST API: new projects gaining stars fast, keyword and topic search, bulk repo stats. Unofficial, no scraping. | 154 |
| Categories | Developer tools (DEVELOPER_TOOLS), Open source (OPEN_SOURCE) | — |
| SEO keywords（README 中自然使用，不堆砌） | trending github repos, github trending repos, github trending api, fastest growing github repos, github rising stars, github repository search, github repository search api, github repo search, github search api, github stars tracker, github trending ai repos, github trending python | — |
| Pricing line（README Pricing 节首句） | `repo` — $1.00 per 1,000 repositories (FREE), $0.80 (BRONZE), $0.70 (SILVER), $0.60 (GOLD); optional `repo-enriched` — $3.00 / $2.50 / $2.00 / $1.80 per 1,000; plus the default Actor start fee. | — |
| Trademark / disclaimer | "GitHub is a trademark of GitHub, Inc. This is an unofficial tool that uses the public GitHub REST API. It is not affiliated with, sponsored or endorsed by GitHub, Inc. You are responsible for complying with the GitHub Terms of Service and Acceptable Use Policies." | — |

**README first paragraph（成稿）**

**Rising & Trending Repos Finder for GitHub** finds trending GitHub repos — new repositories that are gaining stars fast — and also searches repositories by keyword, language, topic and star range, or looks up stats for a list of repos. Everything comes from the **official GitHub REST API**; it approximates "trending" with the Search API (new repositories sorted by stars) and does not copy the github.com/trending page. Each row is one repository: stars, forks, stars per day, language, license, topics, creation date and last push. Add your own GitHub token to raise rate limits and unlock enriched fields such as latest release and bounty-labeled issue counts. Output contains repository data only — no emails, profiles or contributor lists. Unofficial tool, not affiliated with or endorsed by GitHub, Inc.

（811 字符；主关键词出现在首句）

## 术语表（名称、描述、schema、README 必须一致）

| Actor | 统一使用 | 避免使用 |
|---|---|---|
| ① | sitemap URL extractor / sitemap extractor；URL row；added / removed URLs；change tracking；llms.txt check；HTTP status check；snapshot store | crawler（易被理解为全站爬取）、scraper of pages、diff engine |
| ② | Bulk Core Web Vitals Checker；Lighthouse audit；audit = one URL × one device；local Lighthouse / your own PageSpeed Insights API key；lab data / field data；top fixes | “Google PageSpeed” 作为名称；“official”；“real user data”（local 模式没有） |
| ③ | rising repos / trending GitHub repos；official GitHub REST API；repository data only；stars per day；enriched fields；your own GitHub token | “GitHub Trending scraper”、“scrape GitHub”、developer / user / contributor data |

## 发布前检查

- [ ] Publishing → Display information 四项文案与本文件一致；Actor input schema 的 `title`/`description` 与显示名一致（已写入 `schemas/*.input_schema.json`）。
- [ ] README H1 由平台用 Actor 名生成，README 内只用 H2/H3（[Create an Actor README](https://docs.apify.com/actors/publishing/actor-readme.md)）。
- [ ] README 与描述不出现站外链接（GitHub 仓库、个人网站、Discord 等）、不出现邮箱；只链接 Apify 内页面和官方文档（Apify / Google / GitHub 文档属于说明性引用）。
- [ ] Monetization：只 PPE，删除 `apify-default-dataset-item`，保留 `apify-actor-start`，设置 BRONZE/SILVER/GOLD 与 `minimalMaxTotalChargeUsd`，不开 “Pay per event + usage”。
- [ ] Settings：Limited permissions；不启用 Standby。
