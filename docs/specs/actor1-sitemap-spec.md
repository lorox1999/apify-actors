# Actor ① 规格说明：Sitemap URL Extractor（sitemap / robots.txt / llms.txt + 与上次运行对比）

- 版本：v1.0-spec（第0周，2026-09-26，UTC+8）
- 依据：`/workspace/apify-passive-income-plan.md` §3.3 Actor ①、§4 第0周验收、§6 红线
- 数据：Store API 抓取于 2026-09-26 11:33（UTC+8），原始文件在 `specs/raw/`（`pool.json`、`competitors_2026-09-26.json`、`kwstore_*.json`、`gsug_*.json`）
- 标记：**【假设】**=推算；**【未查到】**=查过没找到一手依据；**【待实测】**=上线/本地实测后确认
- 机器可读版 schema（已用 `@apify/input_schema` 4.0.5 的 `validateInputSchema` 校验通过）：`specs/schemas/actor1.input_schema.json`、`actor1.dataset_schema.json`、`actor1.output_schema.json`

---

## 1. 命名与文案

| 项 | 取值 | 字符数 | 说明 |
|---|---|---|---|
| 技术名（URL slug，**定了不改**） | `sitemap-url-diff-extractor` | 26 | Store API 2026-09-26 检索：`search=sitemap-url-diff-extractor` 结果 0；在抓到的 6,397 个相关 Actor 中无同名 slug。`sitemap-url-extractor` 已被 **27 个用户**使用（含 crawlerbros、onescales），`sitemap-extractor` 被 apify 官方等使用，故不用。最接近的是 `soilair/sitemap-url-diff-api`（30 天用户 1，2026-09-23 创建）和 `gratifying_graph/sitemap-diff`，不构成明显撞名 |
| 显示名（Actor name） | Sitemap URL Extractor with Diff & llms.txt Check | 48 | 主关键词 “sitemap url extractor” 放最前 |
| SEO 名 | Sitemap Extractor: Get All URLs from XML Sitemaps | 49 | 覆盖 “sitemap extractor”“get all urls from sitemap”“xml sitemap” |
| SEO 描述 | Sitemap extractor that gets every URL from XML sitemaps, indexes and .gz files. Finds sitemaps via robots.txt, checks llms.txt, flags new and removed URLs. | 155 | |
| 短描述（Store description） | Sitemap URL extractor for SEO audits, migrations and crawl seeding. Finds sitemaps via robots.txt and common paths, follows sitemap indexes and .gz files, and checks llms.txt. Get URL, lastmod, changefreq and priority, filter by date or regex, and see URLs added or removed since your last run. | 294 | 约 300 |
| Store 分类 | SEO_TOOLS、DEVELOPER_TOOLS | — | 与头部竞品一致 |
| GitHub 仓库目录名 | `actors/sitemap-url-diff-extractor` | — | monorepo 内目录，见 week1-dev-plan.md |

## 2. 功能范围（v1）

1. 输入一批域名 / 首页 / robots.txt / sitemap / llms.txt URL。
2. 发现 sitemap：先读 robots.txt 的 `Sitemap:` 行；没有就探测常见路径（`/sitemap.xml`、`/sitemap_index.xml`、`/sitemap-index.xml`、`/sitemap.xml.gz`、`/wp-sitemap.xml`）。
3. 递归解析：sitemap index（深度上限 `maxSitemapDepth`）、`.gz`、纯文本 sitemap；news / image / video / hreflang 扩展**只输出计数或类型，不输出标题、说明、上传者等文本字段**（见 §5 个人数据审查）。
4. 过滤：lastmod 日期区间、include/exclude 正则、仅同 host。被过滤掉的 URL 不写数据集、不计费。
5. llms.txt：检测 `/llms.txt`、`/llms-full.txt` 是否存在，记录字节数、链接数（免费，写入 KV `SUMMARY`）；可选把 llms.txt 里的链接作为 URL 行输出（计费）。
6. 与上次运行对比（可选）：快照存在**用户自己账号**下的命名 KV store（默认名 `sitemap-url-diff-state`）。每行标 `changeType = added | unchanged`，消失的 URL 以 `changeType = removed` 追加。
7. 可选 HTTP 状态检查（HEAD，405/501 时回退 GET 且只读响应头），单独计费 `status-checked`。
8. 每个站点一条汇总写入默认 KV store 的 `SUMMARY`（数组），失败站点在数据集里写 `recordType = error` 行（不计费）。

**权限设计（limited permissions 可行性）**：官方文档写明 limited permissions 的 Actor 可以“创建任何额外存储并写入”“读写之前运行创建的存储”（[Actor permissions](https://docs.apify.com/platform/actors/development/permissions)，快照 `specs/raw/permissions.md`）。所以命名 KV store 快照方案**不需要** full permissions。【待实测】同一用户第二次运行能否按名字打开第一次运行创建的命名 store（文档表述支持，需上线前在私有 Actor 上验证一次）。

## 3. Input schema（INPUT_SCHEMA.json，完整）

要点：
- `startUrls` 用 `prefill`（给平台每日测试和新用户试用）；其他字段用 `default`，保证 API 调用不传也有合理值。
- 本 Actor **没有 secret 字段**（不需要任何凭据）。
- `maxUrlsPerSite` 的 `prefill` = 100（每日测试和首次试用成本低），`default` = 50,000（API 调用不传时的成本上限）。

```json
{
  "title": "Sitemap URL Extractor with Diff & llms.txt Check",
  "description": "Extract every URL from a website's XML sitemaps. Sitemaps are discovered via robots.txt and common paths; sitemap indexes and .gz files are followed. Optionally compare with your previous run to get added and removed URLs.",
  "type": "object",
  "schemaVersion": 1,
  "properties": {
    "startUrls": {
      "title": "Websites, sitemap URLs or robots.txt URLs",
      "type": "array",
      "description": "One entry per line. Accepts a domain (example.com), a homepage URL, a robots.txt URL, a sitemap URL (.xml, .xml.gz, .txt) or an llms.txt URL. For a homepage or domain, the extractor finds sitemaps via robots.txt and common paths such as /sitemap.xml.",
      "editor": "stringList",
      "prefill": [
        "https://docs.apify.com"
      ],
      "minItems": 1,
      "maxItems": 1000,
      "items": {
        "type": "string",
        "minLength": 3,
        "maxLength": 2048
      }
    },
    "maxUrlsPerSite": {
      "title": "Max URLs per website",
      "type": "integer",
      "description": "Stop after this many URL rows per website. Each URL row is billed as one url-extracted event, so this is also your cost cap per site.",
      "prefill": 100,
      "default": 50000,
      "minimum": 1,
      "maximum": 1000000
    },
    "discoverFromRobotsTxt": {
      "title": "Discover sitemaps from robots.txt",
      "type": "boolean",
      "description": "Read Sitemap: lines from /robots.txt.",
      "default": true,
      "sectionCaption": "Sitemap discovery",
      "sectionDescription": "How sitemaps are found when you enter a domain or homepage."
    },
    "probeCommonPaths": {
      "title": "Probe common sitemap paths",
      "type": "boolean",
      "description": "If robots.txt lists no sitemap, try /sitemap.xml, /sitemap_index.xml, /sitemap-index.xml, /sitemap.xml.gz and /wp-sitemap.xml.",
      "default": true
    },
    "checkLlmsTxt": {
      "title": "Check llms.txt and llms-full.txt",
      "type": "boolean",
      "description": "Record whether /llms.txt and /llms-full.txt exist, their size and how many links they contain. This check is free.",
      "default": true
    },
    "includeLlmsTxtUrls": {
      "title": "Also output URLs listed in llms.txt",
      "type": "boolean",
      "description": "Add each link found in llms.txt as a URL row (source = llms.txt). Billed like any other URL row.",
      "default": false
    },
    "maxSitemapFiles": {
      "title": "Max sitemap files per website",
      "type": "integer",
      "description": "Safety cap for very large sitemap indexes.",
      "default": 500,
      "minimum": 1,
      "maximum": 5000
    },
    "maxSitemapDepth": {
      "title": "Max sitemap index depth",
      "type": "integer",
      "description": "How many levels of nested sitemap indexes to follow.",
      "default": 5,
      "minimum": 1,
      "maximum": 10
    },
    "includeUrlRegex": {
      "title": "Include URLs matching (regex)",
      "type": "string",
      "description": "Only keep URLs that match this JavaScript regular expression, for example /blog/. Filtered-out URLs are not billed.",
      "editor": "textfield",
      "sectionCaption": "Filters",
      "sectionDescription": "Filtered-out URLs are never written to the dataset and never billed."
    },
    "excludeUrlRegex": {
      "title": "Exclude URLs matching (regex)",
      "type": "string",
      "description": "Drop URLs that match this JavaScript regular expression, for example \\.(pdf|jpg)$.",
      "editor": "textfield"
    },
    "lastmodFrom": {
      "title": "Last modified on or after",
      "type": "string",
      "description": "Keep only URLs whose lastmod is on or after this date. Absolute (2026-09-01) or relative (7 days). URLs without lastmod are kept unless 'Drop URLs without lastmod' is on.",
      "editor": "datepicker",
      "dateType": "absoluteOrRelative"
    },
    "lastmodTo": {
      "title": "Last modified on or before",
      "type": "string",
      "description": "Keep only URLs whose lastmod is on or before this date.",
      "editor": "datepicker",
      "dateType": "absoluteOrRelative"
    },
    "dropUrlsWithoutLastmod": {
      "title": "Drop URLs without lastmod when a date filter is set",
      "type": "boolean",
      "default": false,
      "description": "Only applies when a lastmod filter is set."
    },
    "sameHostOnly": {
      "title": "Keep only URLs on the same host",
      "type": "boolean",
      "description": "Drop sitemap entries that point to other hosts.",
      "default": false
    },
    "compareWithPreviousRun": {
      "title": "Compare with previous run (added / removed URLs)",
      "type": "boolean",
      "description": "Save a snapshot of each website's URL list in a named key-value store in your own Apify account and mark each URL as added or unchanged since the last snapshot. URLs that disappeared are added as rows with changeType = removed.",
      "default": false,
      "sectionCaption": "Change tracking",
      "sectionDescription": "Snapshots are stored in your own account. Nobody else can read them."
    },
    "stateStoreName": {
      "title": "Snapshot store name",
      "type": "string",
      "description": "Name of the key-value store (in your account) that keeps the snapshots. Use different names to keep separate histories.",
      "editor": "textfield",
      "default": "sitemap-url-diff-state",
      "pattern": "^[a-zA-Z0-9-]{1,63}$"
    },
    "outputMode": {
      "title": "Output mode",
      "type": "string",
      "description": "all = every current URL plus removed URLs. changesOnly = only added and removed URLs (requires 'Compare with previous run').",
      "editor": "select",
      "enum": [
        "all",
        "changesOnly"
      ],
      "enumTitles": [
        "All URLs (with change flags)",
        "Only added and removed URLs"
      ],
      "default": "all"
    },
    "checkHttpStatus": {
      "title": "Check HTTP status of each URL",
      "type": "boolean",
      "description": "Send a lightweight HEAD request (GET if HEAD is not allowed) to each URL and record the status code and final URL. Billed as status-checked per URL. Slower; respects robots.txt and per-host rate limits.",
      "default": false,
      "sectionCaption": "HTTP status check (optional, billed separately)"
    },
    "statusCheckMaxUrls": {
      "title": "Max URLs to status-check per website",
      "type": "integer",
      "default": 1000,
      "minimum": 1,
      "maximum": 100000,
      "description": "Upper limit of URLs to status-check for each website. Only used when HTTP status check is on."
    },
    "statusCheckConcurrencyPerHost": {
      "title": "Parallel status checks per host",
      "type": "integer",
      "description": "Kept low on purpose so target websites are not overloaded.",
      "default": 2,
      "minimum": 1,
      "maximum": 5
    },
    "respectRobotsTxt": {
      "title": "Respect robots.txt",
      "type": "boolean",
      "description": "Skip sitemap files and status checks for paths disallowed by robots.txt.",
      "default": true,
      "sectionCaption": "Advanced"
    },
    "requestTimeoutSecs": {
      "title": "Request timeout (seconds)",
      "type": "integer",
      "default": 30,
      "minimum": 5,
      "maximum": 120,
      "description": "Timeout for each robots.txt, sitemap or llms.txt request."
    }
  },
  "required": [
    "startUrls"
  ]
}
```

## 4. Dataset output schema

### 4.1 dataset_schema.json（`.actor/dataset_schema.json`）

```json
{
  "actorSpecification": 1,
  "fields": {
    "type": "object",
    "properties": {
      "recordType": {
        "type": "string",
        "enum": [
          "url",
          "error"
        ]
      },
      "site": {
        "type": "string"
      },
      "url": {
        "type": [
          "string",
          "null"
        ]
      },
      "source": {
        "type": [
          "string",
          "null"
        ],
        "enum": [
          "sitemap",
          "llms.txt",
          null
        ]
      },
      "sourceSitemap": {
        "type": [
          "string",
          "null"
        ]
      },
      "lastmod": {
        "type": [
          "string",
          "null"
        ]
      },
      "changefreq": {
        "type": [
          "string",
          "null"
        ]
      },
      "priority": {
        "type": [
          "number",
          "null"
        ]
      },
      "sitemapKind": {
        "type": [
          "string",
          "null"
        ],
        "enum": [
          "standard",
          "news",
          "image",
          "video",
          "text",
          null
        ]
      },
      "imageCount": {
        "type": [
          "integer",
          "null"
        ]
      },
      "videoCount": {
        "type": [
          "integer",
          "null"
        ]
      },
      "hreflangCount": {
        "type": [
          "integer",
          "null"
        ]
      },
      "changeType": {
        "type": [
          "string",
          "null"
        ],
        "enum": [
          "added",
          "unchanged",
          "removed",
          null
        ]
      },
      "firstSeenAt": {
        "type": [
          "string",
          "null"
        ]
      },
      "httpStatus": {
        "type": [
          "integer",
          "null"
        ]
      },
      "finalUrl": {
        "type": [
          "string",
          "null"
        ]
      },
      "errorCode": {
        "type": [
          "string",
          "null"
        ]
      },
      "errorMessage": {
        "type": [
          "string",
          "null"
        ]
      },
      "extractedAt": {
        "type": "string"
      }
    },
    "required": [
      "recordType",
      "site",
      "extractedAt"
    ]
  },
  "views": {
    "urls": {
      "title": "URLs",
      "transformation": {
        "fields": [
          "url",
          "lastmod",
          "changefreq",
          "priority",
          "changeType",
          "httpStatus",
          "sourceSitemap",
          "site"
        ]
      },
      "display": {
        "component": "table",
        "properties": {
          "url": {
            "format": "link"
          },
          "sourceSitemap": {
            "format": "link"
          }
        }
      }
    },
    "errors": {
      "title": "Errors",
      "transformation": {
        "fields": [
          "recordType",
          "site",
          "url",
          "errorCode",
          "errorMessage"
        ]
      },
      "display": {
        "component": "table"
      }
    }
  }
}
```

### 4.2 output_schema.json（`.actor/output_schema.json`，上架必填）

```json
{
  "actorOutputSchemaVersion": 1,
  "title": "Sitemap URL Extractor output",
  "properties": {
    "urls": {
      "title": "URLs",
      "description": "One row per URL (plus error rows).",
      "template": "{{links.apiDefaultDatasetUrl}}/items?view=urls"
    },
    "summary": {
      "title": "Per-site summary",
      "description": "Sitemaps found, counts, llms.txt status, added/removed counts per site.",
      "template": "{{links.apiDefaultKeyValueStoreUrl}}/records/SUMMARY"
    }
  }
}
```

## 5. 字段表 + 个人数据审查

结论列只允许“否”。如某字段原本有风险，已在“处理”列说明删除或改设计。

### 5.1 数据集字段

| 字段 | 类型 | 示例值 | 是否可能含个人数据 | 处理 / 理由 |
|---|---|---|---|---|
| `recordType` | string | `"url"` | 否 | 枚举 url / error |
| `site` | string | `"https://docs.apify.com"` | 否 | 用户输入的网站根地址 |
| `url` | string\|null | `"https://docs.apify.com/platform/actors"` | 否 | 网站为搜索引擎公开发布的页面地址；不访问页面正文。**设计约束**：README 和 Limitations 写明不得用于收集个人主页地址；不提供“按用户名/个人主页”相关预设；不做任何页面内容抓取 |
| `source` | string\|null | `"sitemap"` | 否 | 枚举 sitemap / llms.txt |
| `sourceSitemap` | string\|null | `"https://docs.apify.com/sitemap_base.xml"` | 否 | sitemap 文件地址 |
| `lastmod` | string\|null | `"2026-09-20T08:14:00Z"` | 否 | 原样 ISO 字符串 |
| `changefreq` | string\|null | `"weekly"` | 否 | |
| `priority` | number\|null | `0.8` | 否 | |
| `sitemapKind` | string\|null | `"standard"` | 否 | standard / news / image / video / text |
| `imageCount` | integer\|null | `3` | 否 | **改设计**：image 扩展只计数，不输出 `image:caption`、`image:title`（可能含人名） |
| `videoCount` | integer\|null | `0` | 否 | **改设计**：不输出 `video:uploader`（上传者姓名）、`video:title`、`video:description` |
| `hreflangCount` | integer\|null | `4` | 否 | 只计 alternate 数量 |
| `changeType` | string\|null | `"added"` | 否 | added / unchanged / removed；未开对比时为 null |
| `firstSeenAt` | string\|null | `"2026-09-26T03:40:00Z"` | 否 | 快照里首次出现时间 |
| `httpStatus` | integer\|null | `200` | 否 | 仅开状态检查时有值 |
| `finalUrl` | string\|null | `"https://docs.apify.com/platform/actors/"` | 否 | 重定向终点地址；不记录响应头 / Cookie |
| `errorCode` | string\|null | `"NO_SITEMAP_FOUND"` | 否 | 见 §8 |
| `errorMessage` | string\|null | `"robots.txt lists no Sitemap and none of 5 common paths returned XML"` | 否 | 固定模板文本，不回显响应正文 |
| `extractedAt` | string | `"2026-09-26T03:40:12Z"` | 否 | |

**删除的字段（原计划或竞品有，但本 Actor 不输出）**：news 扩展的 `news:title`（新闻标题常含人名）、`news:keywords`；image `caption/title`；video `uploader/title/description/tag`；任何页面正文、`<title>`、meta。news 扩展只保留 `sitemapKind = "news"`。

### 5.2 KV store `SUMMARY`（每站一条对象）

| 字段 | 类型 | 示例 | 是否可能含个人数据 |
|---|---|---|---|
| `site` | string | `"https://docs.apify.com"` | 否 |
| `robotsTxtFound` | boolean | `true` | 否 |
| `sitemapsFound` | integer | `1`（robots 声明的根 sitemap 数） | 否 |
| `sitemapFilesParsed` | integer | `6` | 否 |
| `urlsTotal` / `urlsOutput` | integer | `3888` / `100` | 否 |
| `addedCount` / `removedCount` | integer\|null | `12` / `3` | 否 |
| `llmsTxtFound` / `llmsTxtBytes` / `llmsTxtLinkCount` / `llmsFullTxtFound` | bool/int | `true` / `95274` / `812` / `false` | 否（只存计数，不存正文） |
| `truncated` | boolean | `true`（撞到 maxUrlsPerSite / maxSitemapFiles） | 否 |
| `chargedEvents` | object | `{"url-extracted":100,"status-checked":0}` | 否 |

### 5.3 快照（用户自己的命名 KV store）

- key：`snap-<sha1(规范化 site + 过滤参数)>`，value：gzip 的 JSON `{ site, createdAt, urls: [[url, firstSeenAt], ...] }`。只含 URL 和时间，**否**。
- 大站内存护栏：快照 >200,000 条 URL 时【假设】需要 ≥2 GB 内存；超过 `diffMaxUrls = 500,000`（代码常量）时跳过对比并在 SUMMARY 标 `STATE_TOO_LARGE`。【待实测】

## 6. PPE 事件定义（照任务书 §3.3）

| 事件名 | 触发时机 | FREE | BRONZE | SILVER | GOLD | 主事件 |
|---|---|---|---|---|---|---|
| `url-extracted` | 每写入数据集 1 条 `recordType = url` 行（含 `changeType = removed` 行）时，用 `Actor.pushData(item, 'url-extracted')` 同步计费 | $0.0005 | $0.0004 | $0.00035 | $0.0003 | 是 |
| `status-checked` | 开启状态检查时，每拿到 1 个 URL 的最终状态码（含 4xx/5xx 结果）计 1 次 | $0.0004 | $0.0003 | $0.00025 | $0.0002 | 否 |
| `apify-actor-start` | 平台自动（每次运行，≤1 GB 内存计 1 次） | 默认 $0.00005 | 默认 | 默认 | 默认 | 否 |

实现规则：
- **必须在 Console 里删除合成事件 `apify-default-dataset-item`**。PPE 文档写明它“默认启用”，不删会和 `url-extracted` 双重计费（[PPE 文档](https://docs.apify.com/actors/publishing/monetize/pay-per-event.md)）。
- `recordType = error` 行不计费（用不带事件名的 `pushData`，删掉 default-dataset-item 后即免费）。
- 被过滤、去重（同一站点内按规范化 URL 去重）的 URL 不计费。
- 每次 `pushData` 返回的 `ChargeResult.eventChargeLimitReached = true` 时：停止写入，写 SUMMARY（`CHARGE_LIMIT_REACHED`），`Actor.exit()` 正常结束（状态 SUCCEEDED）。
- `minimalMaxTotalChargeUsd`：**$0.05**【假设】（= 启动 + 100 条 FREE 价）。
- PLATINUM / DIAMOND 档：Store 数据显示竞品设置了这两档，任务书只定了三档。未设置时这两档按什么价收**【未查到】**，建议 Console 里与 GOLD 同价。
- 不开 “Pay per event + usage”，limited permissions，不用 Standby（x402 资格条件）。

**【建议新增，需确认后才上线】`site-compared` 事件**：`outputMode = changesOnly` 时，每站每次对比计 1 次（建议 FREE $0.002 / BRONZE $0.0018 / SILVER $0.0016 / GOLD $0.0014【假设】）。原因：changesOnly 模式下大站每天运行只输出少量行，收入≈启动费，但仍要下载解析全部 sitemap，会形成单次负利润（例：100 万 URL 站点约 2 分钟 × 2 GB ≈ 0.067 CU ≈ $0.013/次【假设】）。**如果不批准新增事件，v1 就去掉 `outputMode = changesOnly` 选项**，只保留 “all”。

## 7. 默认输入及理由

```json
{ "startUrls": ["https://docs.apify.com"], "maxUrlsPerSite": 100 }
```

- 平台每日测试用 prefill 运行，要求 5 分钟内 SUCCEEDED 且数据集非空（[Actor testing](https://docs.apify.com/actors/publishing/test.md)）。本项目目标是 **1 分钟内**。
- 选 `docs.apify.com`：2026-09-26 实测 robots.txt 声明 `Sitemap: https://docs.apify.com/sitemap.xml`，该文件是 **sitemap index（6 个子 sitemap）**，同时存在 `llms.txt`（95,274 字节）。一次默认运行就能展示 robots 发现、index 递归、llms.txt 检测三项核心能力；它是 Apify 自己的文档站，可用性高，和平台同一供应方，被拦截概率低【假设】。
- 预期：约 8–15 个 HTTP 请求，<15 秒，100 行 URL【待实测】。
- 备用默认（若 docs.apify.com 变更导致失败）：`https://crawlee.dev`（robots.txt 声明 2 个 sitemap，有 llms.txt，实测 `/sitemap.xml` 3,888 条）。

## 8. 错误处理与失败原因输出

原则：单个站点失败不让整个运行失败；输入整体合法时运行状态 = SUCCEEDED；每个失败站点写 1 条 error 行（免费）+ SUMMARY 记录。只有输入 schema 校验失败或代码崩溃才 FAILED。

| errorCode | 触发条件 | 行为 |
|---|---|---|
| `INVALID_INPUT_URL` | 无法解析为 http(s) 域名/URL | 跳过该条 |
| `DNS_ERROR` / `CONNECTION_ERROR` | 解析失败 / 连接被拒 | 重试 2 次（指数退避）后跳过 |
| `TIMEOUT` | 单请求超过 `requestTimeoutSecs` | 重试 2 次；sitemap 子文件超时只影响该文件，SUMMARY 记 `failedSitemapFiles` |
| `NO_SITEMAP_FOUND` | robots.txt 无声明且常见路径都不是 XML/文本 sitemap | 写 error 行；llms.txt 检测照常 |
| `SITEMAP_HTTP_403` / `SITEMAP_HTTP_404` / `SITEMAP_HTTP_410` / `SITEMAP_HTTP_5XX` | 对应状态码 | 403 不换 IP、不伪装、不绕过，直接记录（§6 红线 2） |
| `RATE_LIMITED` | 429 | 按 `Retry-After`（上限 30 秒）等待重试 1 次，仍 429 则跳过 |
| `BLOCKED_BY_ROBOTS` | `respectRobotsTxt = true` 且 sitemap 路径被 Disallow | 跳过该文件 |
| `SITEMAP_PARSE_ERROR` | XML 不合法（流式解析出错） | 保留已解析的条目（计费），SUMMARY 标 `partial = true` |
| `SITEMAP_TOO_LARGE` | 单文件解压后 >100 MB（协议上限 50 MB 的 2 倍）或 gzip 炸弹检测（压缩比 >100） | 停止该文件 |
| `MAX_SITEMAP_FILES_REACHED` / `MAX_URLS_REACHED` | 撞上限 | 不是错误行，只在 SUMMARY 标 `truncated = true` |
| `STATE_STORE_ERROR` / `STATE_TOO_LARGE` | 命名 KV store 读写失败 / 快照过大 | 本次不做对比，`changeType = null`，不影响提取 |
| `CHARGE_LIMIT_REACHED` | 达到用户 `maxTotalChargeUsd` | 优雅结束（SUCCEEDED） |

运行结束时 `Actor.setStatusMessage("Done: 3 sites, 12,340 URLs, 1 site failed (NO_SITEMAP_FOUND)")`。

## 9. 成本护栏与待实测项

- 内存：`actor.json` 设 `minMemoryMbytes: 512`、`maxMemoryMbytes: 4096`，默认 1024 MB【假设】（任务书写 512 MB；因快照对比要把 URL 集合放内存，默认提到 1 GB，512 MB 仍可用于不开对比的小站）。
- 默认运行超时：3,600 秒。
- 护栏（任务书 §3.3）：每 1,000 条 URL 的平台成本 ≤ BRONZE 收入 × 0.8 × 40% = **$0.128**；GOLD 档按同公式为 $0.096（GOLD 用户的 CU 单价也更低，$0.13）。
- 估算【假设】：纯 HTTP + 流式解析，1 GB 下约 5,000–20,000 URL/秒解析；平台成本主要是数据集写入 $0.005/1,000 次，合计 <$0.01/1,000 条，远低于护栏。
- 状态检查护栏：每 1,000 次检查成本 ≤ $0.3 × 0.8 × 40% = $0.096。按每主机并发 2、每请求 300 ms 估算，1,000 次约 150 秒 × 1 GB ≈ 0.042 CU ≈ $0.008【假设】。
- **待实测**：①默认输入耗时与 CU；②1 万 / 10 万 / 100 万 URL 站点的 CU、峰值内存；③快照 20 万条时内存；④命名 KV store 跨运行可读（limited permissions 下）；⑤用户长期保留命名 store 的存储费由谁承担【未查到】（推测记在用户账户，README 需提示）。

## 10. 主要依赖建议

- **Node.js 22 + TypeScript**，`apify` SDK 3.x（npm 最新 3.7.2），基础镜像 `apify/actor-node:22`。
- sitemap 解析：优先评估 `crawlee`（3.18.1）/ `@crawlee/utils` 里的 `Sitemap` / `parseSitemap`、`RobotsTxtFile`；若拿不到 lastmod/changefreq/priority 或无法流式处理大文件，改用 `sax`（1.6.1）流式解析 + Node `zlib` 解压。robots 规则用 `robots-parser`（3.0.1）或 crawlee 自带实现。
- HTTP：Node 内置 `fetch`（undici）或 `got-scraping`；固定 UA：`Mozilla/5.0 (compatible; SitemapUrlDiffExtractor/1.0; +https://apify.com/<user>/sitemap-url-diff-extractor)`（不伪装浏览器）。
- 不用任何代理（数据中心或住宅），不用浏览器。
- 共享包 `packages/common`：计费封装、错误码、日志脱敏、URL 规范化、SUMMARY 写入。

## 11. 验收用例（第1周开发验收用）

| # | 输入 | 预期输出 / 行为 | 通过标准 |
|---|---|---|---|
| A1-01 默认输入 | prefill：`docs.apify.com`，100 条 | SUCCEEDED；数据集 100 行 `recordType=url`；SUMMARY 显示 `robotsTxtFound=true`、`sitemapFilesParsed≥1`、`llmsTxtFound=true` | 本地与云端均 **<60 秒**（平台上限 5 分钟），数据集非空；连续 3 天自测通过 |
| A1-02 无 sitemap | `https://example.com` | 1 条 error 行 `NO_SITEMAP_FOUND`；SUMMARY `llmsTxtFound=false` | SUCCEEDED；`url-extracted` 计费 0 次 |
| A1-03 gz sitemap | 本地 fixture 服务器提供 `sitemap.xml.gz`（1,000 条） | 1,000 行 | 行数 = 1,000；lastmod 等字段与 fixture 一致 |
| A1-04 超大 index | fixture：index 含 600 个子 sitemap，每个 1,000 条；`maxSitemapFiles=500`、`maxUrlsPerSite=1000000` | 解析 500 个文件后停止 | `truncated=true`；峰值内存 <1 GB；无崩溃 |
| A1-05 超时 | fixture 子 sitemap 延迟 60 秒，`requestTimeoutSecs=5` | 该文件重试 2 次后记失败，其余文件照常 | 运行 SUCCEEDED；SUMMARY `failedSitemapFiles=1` |
| A1-06 404/403 | fixture：robots 指向的 sitemap 返回 403；另一站返回 404 | error 行 `SITEMAP_HTTP_403` / `SITEMAP_HTTP_404` | 不换 IP、不重试超过 2 次、不计费 |
| A1-07 限流 | fixture 返回 429 + `Retry-After: 2` | 等待约 2 秒后重试成功 | 日志有等待记录；结果完整 |
| A1-08 gzip 炸弹 / 坏 XML | fixture：压缩比 1000:1 的 gz；截断的 XML | `SITEMAP_TOO_LARGE`；`SITEMAP_PARSE_ERROR` 且保留已解析条目 | 内存不超过 1 GB；已写行正确计费 |
| A1-09 计费次数 | fixture 1,234 条，含 34 条重复、200 条被 exclude 正则过滤 | 输出 1,000 行 | 本地计费日志（SDK 本地模式）`url-extracted` = 1,000；`status-checked` = 0；Console 未启用 `apify-default-dataset-item` |
| A1-10 预算上限 | 云端运行设 `maxTotalChargeUsd = 0.05`（FREE 价下约 99 条） | 撞限后停止写入，SUCCEEDED | 计费总额 ≤ $0.05；数据集行数 = 已计费行数；SUMMARY `CHARGE_LIMIT_REACHED` |
| A1-11 差异对比 | 同一 fixture 站点跑两次，第二次删 3 条加 5 条，`compareWithPreviousRun=true` | 第二次：5 行 added、3 行 removed，其余 unchanged | 数字精确；快照存在用户命名 store；limited permissions 下可读写 |
| A1-12 个人数据 | fixture 含 `image:caption`、`video:uploader`、`news:title` | 输出里没有这些文本 | 自动化断言：数据集和 SUMMARY 中不出现 fixture 中的人名 / 邮箱字符串；字段集合 = §5.1 白名单 |
| A1-13 日志 | 任意运行 | 日志不含响应正文、Cookie、请求头 | 断言日志中无 `Set-Cookie`、无 fixture 正文片段（本 Actor 无 secret 输入） |
| A1-14 成本护栏 | 云端跑 10 万 URL 真实站点（如 `crawlee.dev` 多次或公开大站） | 记录 CU、数据集写入 | 每 1,000 条平台成本 ≤ $0.128，结果写入 `cost-report.md` |
