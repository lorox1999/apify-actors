# 第1周开发拆分（2026-09-28 至 10-04，UTC+8）——给云端编码 agent

- 依据：`actor1-sitemap-spec.md`、`actor2-cwv-spec.md`、`actor3-github-spec.md`、`schemas/*.json`、`readme-outline.md`、`store-listing.md`；任务书 §4 第1周验收、§6 红线。
- 结构：一个**私有 monorepo**，每个 Actor 一个目录 + 共享包。所有改动走 PR，一个任务 = 一个 PR。
- **token 分界**：T0–T7 全部在本地完成，**不需要 Apify token、GitHub token 或 Google key**（测试用 mock / 本地 fixture 服务器 / SDK 本地模式）。C1–C5 需要 Apify token（`apify push`、云端运行、Console 配置），**等用户在密钥库放入 token 后再做**。
- 本地 PPE 测试方法（无需 token）：Apify JS SDK 支持 `ACTOR_TEST_PAY_PER_EVENT=true`，计费记录写到 `storage/datasets/charging-log/`，本地每个事件按 $1 计（[SDK 文档](https://docs.apify.com/sdk/js/docs/concepts/pay-per-event)）；配合 `ACTOR_MAX_TOTAL_CHARGE_USD=3` 可在本地测“撞预算上限”。

## 仓库结构（T0 建立）

```
apify-actors/                      # 私有 Git 仓库
├─ package.json                    # pnpm workspaces, Node >=22.19
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ .github/workflows/ci.yml        # lint + typecheck + unit tests（无任何 secret）
├─ docs/specs/                     # 从 /workspace/apify-actors/specs 复制的规格（只读参考）
├─ packages/common/                # 共享：charging、errors、redact、pii、url、summary、http
├─ actors/sitemap-url-diff-extractor/
│  ├─ .actor/{actor.json,input_schema.json,dataset_schema.json,output_schema.json}
│  ├─ Dockerfile                   # dockerContextDir 指向仓库根，以便带上 packages/common
│  ├─ src/  test/  README.md
├─ actors/rising-repos-for-github/ （同上）
├─ actors/bulk-core-web-vitals-checker/（同上）
├─ tools/selftest/                 # 每日自测（复刻平台测试）
└─ tools/costreport/               # 成本实测
```

## 顺序与日程

| 日期 | 任务 | 需要 token |
|---|---|---|
| 09-28 | T0 仓库骨架与 CI；T1 共享包 | 否 |
| 09-29 | T2 Actor ① 核心提取 | 否 |
| 09-30 | T3 Actor ① 对比 + 状态检查 + README | 否 |
| 10-01 | T4 Actor ③ | 否 |
| 10-02 | T5 Actor ② B 方案 | 否 |
| 10-03 | T6 每日自测脚本；T7 成本实测脚本 | 否 |
| 拿到 Apify token 后（目标 10-01 起） | C1 私有部署 + 云端默认输入；C2 自测上云；C3 成本实测；C4 定价配置；C5 发布 ① ③ | **是** |

> 国庆期间人工可能延迟给 token；T0–T7 不受影响。① ③ “第1周发布”依赖 C1–C5 和人工步骤（§2 第 3、4 步账单 / KYC；KYC 不影响发布本身，只影响出款和 x402）。

---

## T0 仓库骨架与 CI（不需要 token）

- 目标：可构建、可测试的 monorepo 骨架，三个 Actor 目录各自能 `pnpm build` 并本地 `apify run`（CLI 本地运行不需要登录）。
- 输入文件：`docs/specs/schemas/actor{1,2,3}.{input,dataset,output}_schema.json`；各 spec §9/§10/§11 的依赖和内存设置。
- 验收：CI 绿；三个 Actor 本地 `ACTOR_TEST_PAY_PER_EVENT=true apify run` 能启动并输出 “not implemented” 占位行；`actor.json` 里名称 / 内存 / schema 引用正确；`@apify/input_schema` 校验三个 input schema 通过（写成测试）。

```text
【任务 T0：创建 Apify Actors monorepo 骨架与 CI】
背景：我们要在 Apify Store 发布 3 个 PPE（pay-per-event）Actor。规格文档已放在仓库 docs/specs/（若不存在，请从我提供的 specs 目录复制：actor1-sitemap-spec.md、actor2-cwv-spec.md、actor3-github-spec.md、schemas/*.json、readme-outline.md、store-listing.md）。本任务只搭骨架，不写业务逻辑。不需要也不要使用任何 Apify/GitHub/Google token。
要求：
1. pnpm workspaces；Node >=22.19（Lighthouse 13 要求）；TypeScript strict；ESLint；vitest。
2. 目录：packages/common、actors/sitemap-url-diff-extractor、actors/rising-repos-for-github、actors/bulk-core-web-vitals-checker、tools/selftest、tools/costreport。
3. 每个 Actor：.actor/actor.json（actorSpecification 1，name 分别为上述目录名，title 取 docs/specs/store-listing.md 的 Display name，input/storages.dataset/output 指向同目录的 schema 文件；dockerfile + dockerContextDir 设为仓库根，使构建能包含 packages/common）；把 docs/specs/schemas 下对应的三个 schema 复制为 .actor/input_schema.json、dataset_schema.json、output_schema.json。
   内存：sitemap min 512 / max 4096；github min 256 / max 1024；cwv min 1024 / max 8192，defaultMemoryMbytes 用表达式 "equalText(get(input, 'engine', 'local'), 'psi') ? 1024 : 4096"（若本地 CLI 校验不认该字段，保留并在 PR 说明）。
4. Dockerfile：sitemap 和 github 用 apify/actor-node:22；cwv 用 apify/actor-node-puppeteer-chrome:22。多阶段构建，只把编译产物和生产依赖放进最终镜像。
5. src/main.ts 占位：Actor.init() → 读取输入 → pushData({ recordType: 'error', errorCode: 'NOT_IMPLEMENTED' }) → Actor.exit()。
6. 测试：用 @apify/input_schema 的 validateInputSchema（配 ajv/dist/2019）校验三个 input schema；校验 dataset_schema 的 views 字段都存在于 fields.properties。
7. CI（.github/workflows/ci.yml）：install、lint、typecheck、test；不得引用任何 secrets。
8. README.md（仓库根）：说明结构、本地运行方法（ACTOR_TEST_PAY_PER_EVENT=true apify run）、禁止把 token 写入代码或日志。
验收：CI 通过；三个 Actor 本地 apify run 成功输出 1 行占位数据；PR 描述列出所有文件。
```

## T1 共享包 packages/common（不需要 token）

- 目标：三个 Actor 共用的计费、错误、日志脱敏、PII 清洗、URL 规范化、SUMMARY 写入、HTTP 重试。
- 输入文件：三份 spec 的 §6（计费规则）、§8（错误码）、§5（PII 规则）。
- 验收：单元测试覆盖率 ≥90%；脱敏与 PII 清洗有针对性用例。

```text
【任务 T1：实现 packages/common】
背景：规格在 docs/specs/。三个 Actor 都只用自定义 PPE 事件（Console 中会删除 apify-default-dataset-item），错误行免费。不需要任何 token。
实现以下模块（TypeScript，导出类型）：
1. charging.ts
   - pushCharged(item, eventName): 调 Actor.pushData(item, eventName)，返回 { chargedCount, limitReached }；limitReached 来自 ChargeResult.eventChargeLimitReached。
   - pushFree(item): Actor.pushData(item) 不带事件名（错误行）。
   - chargeExtra(eventName, count=1): Actor.charge；返回同上。
   - canAfford(eventName, n=1): 用 Actor.getChargingManager() 的 chargeableWithinLimit 判断还能否支付 n 次。
   - 计数器：记录每个事件已计费次数，供 SUMMARY 使用。
2. errors.ts：ErrorCode 字符串联合类型（合并三份 spec §8 的全部错误码）+ makeErrorRow(base, code, message)；message 只能用固定模板，禁止拼接响应正文。
3. redact.ts：redact(text) 去除：Authorization/Cookie/Set-Cookie 头值；URL 查询参数 key=、token=、access_token=；GitHub token 模式 ghp_、gho_、ghu_、ghs_、ghr_、github_pat_ 开头的串；Google API key 模式 AIza[0-9A-Za-z_-]{35}；以及运行时注册的 secret 值（registerSecret(value)）。提供 createSafeLogger()：包装 Apify log，所有输出先 redact。
4. pii.ts：scrubText(text, maxLen)：把邮箱、电话号码（E.164 与常见格式）、@handle（@ 后 1–39 位字母数字或-，且前面是空白或行首）替换为 "[removed]"，再截断。
5. url.ts：normalizeUrl（小写 host、去 fragment、去默认端口、保留 query 顺序）、toSiteRoot（域名/URL → https://host）、isPrivateHost（localhost、私网 IP、.local → true）。
6. summary.ts：SummaryWriter：按 site 或全局累积字段，最终 Actor.setValue('SUMMARY', ...)；同时 setStatusMessage 生成一句话摘要。
7. http.ts：fetchWithRetry(url, { timeoutMs, retries, retryOn: [429, 5xx], respectRetryAfter: maxSeconds })，默认固定 UA（由调用方传入），不使用任何代理；返回 status、headers、body stream；错误对象里的 URL 必须经过 redact。
测试（vitest）：每个模块至少 5 个用例；redact 用例必须包含 "ghp_TESTSECRET000"、"AIza" 开头 39 字符串、"?key=ABC&x=1"；pii 用例包含 john@example.com、+1 415 555 0100、@johndoe、以及不能误伤 "C# @ 2x"、邮箱格式以外的 "@" 用法。
验收：pnpm test 通过，覆盖率 ≥90%。
```

## T2 Actor ① 核心提取（不需要 token）

- 目标：sitemap 发现、递归解析（index、gz、txt）、过滤、llms.txt 检测、错误行、计费。
- 输入文件：`actor1-sitemap-spec.md` §2、§3、§5、§6、§8、§11（A1-01～A1-10、A1-12、A1-13）。
- 验收：本地 fixture 测试全部通过；对 `https://docs.apify.com` 本地运行 100 条 <60 秒。

```text
【任务 T2：Actor sitemap-url-diff-extractor 核心提取】
读 docs/specs/actor1-sitemap-spec.md（必须遵守 §5 字段白名单和 §6 计费规则）。输入 schema 已在 .actor/input_schema.json，不要改字段名。不需要任何 token。
实现：
1. 输入解析：startUrls 每项可为域名、首页、robots.txt、sitemap（.xml/.xml.gz/.txt）、llms.txt URL；非法 → INVALID_INPUT_URL 错误行。私网 / localhost 地址拒绝（测试环境可通过环境变量 ALLOW_PRIVATE_HOSTS_FOR_TESTS=1 放开）。
2. 发现：discoverFromRobotsTxt → 读 Sitemap: 行；无则 probeCommonPaths（/sitemap.xml、/sitemap_index.xml、/sitemap-index.xml、/sitemap.xml.gz、/wp-sitemap.xml）。respectRobotsTxt=true 时用 robots 规则跳过被 Disallow 的 sitemap 文件（BLOCKED_BY_ROBOTS）。
3. 解析：流式（sax 或 crawlee 的 sitemap 工具，二选一并在 PR 说明理由），支持 urlset、sitemapindex（深度 ≤ maxSitemapDepth、文件数 ≤ maxSitemapFiles）、gzip（按 magic bytes 判断，不只看扩展名）、纯文本 sitemap。单文件解压后 >100 MB 或压缩比 >100 → SITEMAP_TOO_LARGE；XML 出错 → SITEMAP_PARSE_ERROR 并保留已解析条目。
4. 扩展：image/video/news/hreflang 只输出 imageCount、videoCount、hreflangCount、sitemapKind；严禁输出 image:caption、image:title、video:uploader、video:title、video:description、news:title、news:keywords。
5. 过滤：include/exclude 正则（非法正则 → 运行 FAILED 并提示）、lastmodFrom/To（支持绝对和 "7 days" 相对格式）、dropUrlsWithoutLastmod、sameHostOnly；站点内按规范化 URL 去重。被过滤和重复的不写、不计费。
6. llms.txt：checkLlmsTxt 时请求 /llms.txt 和 /llms-full.txt，只记录存在、字节数、Markdown 链接数到 SUMMARY；includeLlmsTxtUrls=true 时把链接作为 source="llms.txt" 的 URL 行输出（计费）。
7. 计费：每条 URL 行用 common 的 pushCharged(item,'url-extracted')；limitReached → 停止所有站点、写 SUMMARY（CHARGE_LIMIT_REACHED）、正常退出。错误行 pushFree。
8. 并发：站点间并发 5，同一 host 串行下载 sitemap 文件，请求间隔 ≥200 ms。固定 UA：Mozilla/5.0 (compatible; SitemapUrlDiffExtractor/1.0)。不使用代理。
9. 结束：SUMMARY 按 spec §5.2；状态消息如 "Done: 3 sites, 12,340 URLs, 1 failed (NO_SITEMAP_FOUND)"。单站失败不让运行失败。
测试：用本地 HTTP fixture 服务器（vitest 内启动）覆盖 spec §11 的 A1-02～A1-10、A1-12、A1-13；A1-09 用 ACTOR_TEST_PAY_PER_EVENT=true 读取 storage/datasets/charging-log 断言 url-extracted 次数 = 1000；A1-10 本地用 ACTOR_MAX_TOTAL_CHARGE_USD=3（本地每事件 $1）断言只写 3 行并正常退出。另写一个可选的 e2e（默认跳过，E2E=1 时跑）：真实请求 https://docs.apify.com，maxUrlsPerSite=100，断言 <60 秒、100 行、llmsTxtFound=true。
验收：所有测试通过；日志中无响应正文和 Cookie。
```

## T3 Actor ① 对比、状态检查、README（不需要 token）

- 目标：命名 KV store 快照对比（added / unchanged / removed）、HTTP 状态检查、README 初稿。
- 输入文件：`actor1-sitemap-spec.md` §2.6–2.7、§5.3、§6（含 `site-compared` 待确认说明）、§11 A1-11、A1-14 准备；`readme-outline.md` Actor ①；`store-listing.md`。
- 验收：A1-11 本地通过；README 按骨架完成且首段与 store-listing 一致。

```text
【任务 T3：Actor ① 对比 + 状态检查 + README】
读 docs/specs/actor1-sitemap-spec.md。不需要任何 token。
1. 对比：compareWithPreviousRun=true 时，用 Actor.openKeyValueStore(stateStoreName) 打开用户账号下的命名 store（本地运行时落在 storage/key_value_stores/<name>/）。key = "snap-" + sha1(规范化 site + 过滤参数 JSON)。value = gzip 后的 JSON { site, createdAt, urls: [[url, firstSeenAt], ...] }。本次 URL 与快照比较：新 URL changeType=added（firstSeenAt=now），已有 unchanged（沿用 firstSeenAt），消失的追加为 changeType=removed 行（照常计 url-extracted）。成功后写回新快照。快照 >500,000 条 → 跳过对比，SUMMARY 标 STATE_TOO_LARGE；读写异常 → STATE_STORE_ERROR，changeType=null，不影响提取。
2. outputMode：实现 "all"。"changesOnly" 先用功能开关 FEATURE_CHANGES_ONLY 包起来（默认关闭，运行时若用户选了该值则按 "all" 处理并在 SUMMARY 提示），等产品确认是否新增 site-compared 事件。
3. 状态检查：checkHttpStatus=true 时，对最多 statusCheckMaxUrls 个 URL 发 HEAD（405/501 回退 GET，只读响应头后立即中止），记录 httpStatus、finalUrl（跟随重定向 ≤5 跳）。每 host 并发 ≤ statusCheckConcurrencyPerHost，遵守 robots.txt。每个拿到状态码的 URL 调 chargeExtra('status-checked')，先用 canAfford 判断预算。
4. README.md：按 docs/specs/readme-outline.md 的 Actor ① 章节写英文 README，首段逐字使用 docs/specs/store-listing.md 的成稿；Pricing 示例用 spec §6 的价格；不得出现任何站外链接、邮箱或推广；Limitations 与 Responsible use 必写。
测试：A1-11（同一 fixture 站点两次运行，第二次删 3 加 5，断言 5 added、3 removed、其余 unchanged）；状态检查计费次数；HEAD→GET 回退；重定向链。
验收：测试通过；README 通过 markdownlint；PR 附 README 渲染截图（可选）。
```

## T4 Actor ③ Rising & Trending Repos Finder（不需要 token）

- 目标：rising / search / repos 三模式、enrich（需用户 token，测试用 mock）、限流处理、PII 清洗。
- 输入文件：`actor3-github-spec.md` 全文（尤其 §2 合规设计、§5 白名单、§6、§8、§11）。
- 验收：A3-02～A3-13 全部用 mock（nock / msw）通过；A3-01 作为可选 e2e（真实未认证请求 1 次）。

```text
【任务 T4：Actor rising-repos-for-github】
读 docs/specs/actor3-github-spec.md。只允许请求 https://api.github.com（在 http 层加白名单断言）；绝不请求 github.com/trending 或任何 HTML 页面；不使用任何代理；不池化 token。开发和测试不需要真实 token（用 mock）；可选 e2e 只发 1 次未认证搜索请求。
1. 用 @octokit/rest + @octokit/plugin-throttling + @octokit/plugin-retry。githubToken 若提供：registerSecret(token)（common/redact），只放在 Authorization 头；绝不写日志、数据集、SUMMARY、状态消息。
2. 模式：
   - rising：q = created:>={today-createdWithinDays} stars:>={minStars} fork:false archived:false [language:X] [topic:Y...]，sort=stars，order=desc，per_page=min(100,maxRepos)，分页直到 maxRepos 或 1000。
   - search：用户 query + 限定符；query 含 "user:"（大小写不敏感）→ 运行 FAILED，USER_QUALIFIER_NOT_ALLOWED，且不发请求。
   - repos：解析 owner/name 或 https://github.com/owner/name；无 token 时把多个 repo:owner/name 合并进一次 search（查询串 ≤256 字符）；有 token 时 GET /repos/{o}/{r}。
3. 输出字段严格按 spec §5 白名单：丢弃 owner 对象（只保留 ownerIsOrganization = owner.type==='Organization'）、homepage、README 内容等。description 经 common/pii.scrubText(…, 500)。searchQuery 也经 scrubText。计算 ageDays、starsPerDay。按 repoId 去重。
4. enrich=true 且有 token：GET releases/latest（404→null）、GET readme 只取 size（丢弃 content）、GET /search/issues?q=repo:o/r is:issue is:open label:"a","b" 取 total_count。三项都成功（或确定为空）才 chargeExtra('repo-enriched')，并且先 canAfford 检查。enrich=true 无 token → 只出基础行，SUMMARY 警告 ENRICH_REQUIRES_TOKEN。
5. 限流：读 x-ratelimit-remaining / reset；remaining=0 且 reset ≤65 秒 → 等待后重试；更久 → 优雅结束（保留已出行，SUMMARY 写 resetAt 和“填 token 可提升限额”）。secondary rate limit（retry-after）→ 等待 ≤120 秒并降为串行。5xx 退避重试 3 次。401 → TOKEN_INVALID，停止使用 token。
6. 计费：每个 repo 行 pushCharged(item,'repo')；错误行 pushFree；limitReached → 正常退出。
测试（mock）：spec §11 的 A3-02～A3-13；A3-09 用 ACTOR_MAX_TOTAL_CHARGE_USD=3 本地断言 3 行；A3-10 断言 "ghp_TESTSECRET000" 在 storage/ 下所有文件和捕获的日志中 0 命中；A3-11 断言无邮箱/电话模式、无 owner/homepage 字段；A3-13 断言所有请求 host 为 api.github.com。README：按 readme-outline.md Actor ③ 写英文 README，首段用 store-listing.md 成稿，必须含 Unofficial notice。
验收：测试通过；可选 e2e（E2E=1）默认输入 20 行 <60 秒。
```

## T5 Actor ② B 方案（本地 Lighthouse，可选 PSI key）（不需要 token）

- 目标：顺序 Lighthouse 审计、字段抽取（去除 details/截图）、预检、超时与崩溃恢复、PSI 模式（mock 测试）、计费。
- 输入文件：`actor2-cwv-spec.md` 全文（§5 白名单、§6、§8、§9 内存/超时、§12）。
- 验收：A2-01（本地 Docker 内跑 example.com）<60 秒；A2-02～A2-12 通过（PSI 用 mock）。

```text
【任务 T5：Actor bulk-core-web-vitals-checker（B 方案）】
读 docs/specs/actor2-cwv-spec.md。不使用我们自己的任何 Google key；PSI 只在用户提供 psiApiKey 时使用（测试全部用 mock，不需要真实 key）。
1. 输入：urls 与 urlsDataset 二选一（都空 → FAILED，NO_URLS）；urlsDataset 用 Actor.openDataset(id) 只读，按 urlsDatasetField 取值，忽略 recordType==='error' 的行；拒绝含 user:pass@ 的 URL 和私网地址（INVALID_URL）；截断到 maxUrls。
2. local 引擎：
   - 启动前检查内存（process.env.ACTOR_MEMORY_MBYTES）< 4096 → 所有 URL 写 LOW_MEMORY_FOR_LIGHTHOUSE 错误行（不计费），状态消息提示。
   - 用 lighthouse 13 + chrome-launcher（或 puppeteer-core），Chrome flags: --headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu；单 Chrome 进程复用，每 50 次或崩溃后重启。
   - 严格顺序：同一时间只跑 1 个审计（Lighthouse 官方建议不要并发）。
   - config：mobile 用默认配置，desktop 用 desktop preset；onlyCategories = input.categories；maxWaitForLoad = 45000；外层超时 perUrlTimeoutSecs（超时杀页面 → TIMEOUT，按 retries 重试）。
   - precheckReachability=true：先 HEAD/GET（10 秒超时）；DNS 失败/4xx/5xx → 跳过并写错误行（不计费）。
3. psi 引擎：psiApiKey 缺失 → FAILED（PSI_KEY_MISSING）；registerSecret(key)；调用 https://www.googleapis.com/pagespeedonline/v5/runPagespeed（url、strategy、category 多值、key），并发 4；429 → 退避 1/2/4 秒最多 3 次（PSI_RATE_LIMITED）；400/403 且提示 key 无效 → PSI_KEY_INVALID 并停止后续调用；从 loadingExperience 取 field 指标。
4. 字段抽取严格按 spec §5 白名单：分数×100 取整；lcpMs/fcpMs/tbtMs/speedIndexMs/ttfbMs/cls；评级阈值 LCP 2500/4000、CLS 0.1/0.25、TBT 200/600；topOpportunities 只取 audit 的 id、title、overallSavingsMs、overallSavingsBytes（按 savingsMs 降序取 maxOpportunities）；lighthouseVersion、environment.benchmarkIndex、runWarnings（每条截断 300 字符，最多 5 条）。严禁输出 screenshot/thumbnail/full-page-screenshot、任何 details.items、nodeLabel、snippet、selector、完整 LHR、HTML 报告。
5. 计费：审计成功写行时 pushCharged(item, engine==='local' ? 'url-audited-local' : 'url-audited')；每次审计开始前 canAfford(event) 为 false → 停止并写 SUMMARY CHARGE_LIMIT_REACHED；失败行 pushFree 且 charged=false。
6. SUMMARY：audited、failed（按 errorCode 分组）、billed 次数、平均 auditDurationMs。
测试：spec §12 的 A2-02～A2-12（Chrome 崩溃用测试钩子；PSI 用 mock；A2-10 断言 "TEST_SECRET_123" 在 storage/ 和日志中 0 命中；A2-11 本地 ACTOR_MAX_TOTAL_CHARGE_USD=3 断言最多 3 次计费；A2-12 用本地 fixture 页面含邮箱文本的 LCP 元素，断言输出不含该邮箱）。A2-01：在 Docker 镜像内（docker build + docker run，内存 4g）对 https://example.com 跑默认输入，断言 <60 秒、1 行 ok。README：按 readme-outline.md Actor ② 写英文 README（含 Google 商标声明、分数差异 FAQ）。
验收：测试通过；PR 附 20 个公开站点首页本地 Docker（--cpus=1 --memory=4g）的平均审计秒数，作为 C3 云端实测前的参考。
```

## T6 每日自测脚本（本地部分不需要 token）

- 目标：复刻平台每日测试（默认输入 / prefill、5 分钟内 SUCCEEDED、数据集非空），我们内部标准更严（60 秒、至少 1 行非 error 行）。
- 输入文件：各 spec §7 默认输入、§11/§12 第 1 条用例；[Actor testing](https://docs.apify.com/actors/publishing/test.md)。
- 验收：`pnpm selftest --local` 对三个 Actor 跑通并生成 JSON 报告；`--cloud` 模式代码完成但在无 token 时明确跳过。

```text
【任务 T6：tools/selftest 每日自测】
目标：复刻 Apify Store 每日自动测试：用 input_schema 里的 prefill 组成默认输入运行 Actor，要求 5 分钟内 SUCCEEDED 且默认数据集非空。我们的内部标准更严：≤60 秒，且至少 1 行 recordType!=='error'（Actor ② 为 status==='ok'）。
1. 从 .actor/input_schema.json 读取所有 prefill 值组装输入（没有 prefill 的字段不传），与平台行为一致。
2. --local：在每个 Actor 目录执行 apify run（或 docker run 构建好的镜像，Actor ② 必须用 Docker 且 --memory=4g --cpus=1），计时，读取 storage/datasets/default 判断结果。不需要任何 token。
3. --cloud：用环境变量 APIFY_TOKEN（没有则打印 "SKIPPED: no APIFY_TOKEN" 并以 0 退出）调用 Apify API：POST /v2/acts/{actorId}/runs，**显式传入第 1 步用 prefill 组装的输入**（input schema 文档写明 prefill 只作用于界面，API 不传 input 时不会套用 prefill；平台每日测试用的是 prefill 输入）；memory 用 Actor 默认，轮询到结束，读取 run.status、stats.runTimeSecs、defaultDatasetId 的 itemCount 和前 10 行。token 只从环境变量读，绝不打印。
4. 输出 selftest-report-YYYY-MM-DD.json（每个 Actor：passedPlatformRule、passedInternalRule、durationSecs、itemCount、okItemCount、runId）和一行 Markdown 摘要；任何失败以非 0 退出。
5. 提供 GitHub Actions workflow selftest.yml：schedule 每天 UTC 01:00（北京时间 09:00）跑 --cloud，secrets.APIFY_TOKEN 由用户稍后在仓库设置；当前无 secret 时 workflow 自动跳过。
验收：--local 三个 Actor 通过；无 token 时 --cloud 显示 SKIPPED 且退出码 0；单元测试覆盖“prefill 组装输入”。
```

## T7 成本实测脚本（本地部分不需要 token）

- 目标：给定运行 ID 列表，从 Apify API 拉取 CU、数据集写入等用量，按档位单价计算“每 1,000 条结果成本”，对照各 spec 护栏自动判定通过 / 不通过。
- 输入文件：任务书 §3.1 CU 价格（FREE/BRONZE $0.2、SILVER $0.16、GOLD $0.13 每 CU；数据集写入 $0.005/1,000）；各 spec §9/§10 护栏。
- 验收：用离线 fixture（录制的 run JSON）计算正确；`--cloud` 无 token 时跳过。

```text
【任务 T7：tools/costreport 成本实测】
1. 输入：一个 YAML 场景文件，列出要跑的 Actor、输入、档位假设（例如 sitemap 1万/10万 URL、cwv 20 个 URL mobile、github search 1000 + enrich 100）。
2. --cloud（需要环境变量 APIFY_TOKEN，没有则 SKIPPED 并退出 0）：逐个启动运行并等待结束；从 GET /v2/actor-runs/{id} 读取 stats.computeUnits、usage（如 DATASET_WRITES、KEY_VALUE_STORE_READS/WRITES、DATA_TRANSFER_*），以及数据集 itemCount；token 不得打印。
3. 计算：成本 = CU × 档位单价 + 数据集写入 × $0.005/1000 + 其他用量（若 usageUsd 字段存在，同时输出平台给出的美元数做对照）；得到“每 1,000 条结果成本”和“每个计费事件成本”。
4. 护栏判定（写成配置）：
   - sitemap：每 1,000 条 URL ≤ $0.128（BRONZE）/ ≤ $0.096（GOLD）；status-checked 每 1,000 次 ≤ $0.096。
   - cwv：url-audited-local 每次 ≤ $0.008（BRONZE）/ $0.0072（SILVER）/ $0.0064（GOLD）；url-audited 每次 ≤ $0.0008。
   - github：repo 每条 ≤ $0.00032；repo-enriched 每条 ≤ $0.001。
5. 输出 cost-report.md（表格：场景、runId、CU、秒数、条数、每千条成本、护栏、通过/不通过）和 JSON。
6. 离线测试：用 fixtures/*.json（手写的 run 对象）验证计算与判定逻辑。
验收：离线测试通过；无 token 时 --cloud SKIPPED。
```

---

## 需要 Apify token 的步骤（等用户给 token 后再做）

> 前置：用户完成任务书 §2 第 1、2 步，把 token 放进密钥库（环境变量 `APIFY_TOKEN`），**不写入仓库、不打印**。以下每步都是独立 PR 或操作记录。

| # | 步骤 | 内容 | 验收 |
|---|---|---|---|
| C1 | 私有部署 + 云端默认输入 | `apify login`（用环境变量 token）→ 在三个 Actor 目录 `apify push`（保持**私有**）；Settings 确认 Limited permissions、未启用 Standby；各跑 1 次默认输入 | 三个 Actor 云端默认输入 SUCCEEDED、数据集非空、①③ <60 秒、② <60 秒（4 GB）；Actor ① 连续两次运行验证命名 KV store 跨运行可读（spec ① §2 待实测项）；Actor ② 验证动态内存表达式是否生效 |
| C2 | 自测上云 | 在私有仓库设置 `APIFY_TOKEN` secret，启用 `selftest.yml` | 连续 3 天通过（第1周验收：自测连续 3 天通过） |
| C3 | 成本实测 | 跑 T7 场景，产出 `cost-report.md` | 三个 Actor 都满足护栏；不满足则先优化再议价（涨价需 14 天通知，必须在发布前定准） |
| C4 | 定价配置 | Console → Publishing → Monetization：PPE；按 spec §6 建事件和 BRONZE/SILVER/GOLD 价格；**删除 `apify-default-dataset-item`**；保留 `apify-actor-start` 默认价；设 `minimalMaxTotalChargeUsd`（① $0.05、② $0.05、③ $0.02）；不开 “Pay per event + usage”。是否能通过 API（`PUT /v2/acts/{id}` 的 pricing 字段）完成**【未查到】**，默认在 Console 操作；账单信息需人工（§2 第 3 步） | 截图或 API 返回存档；Store 页面价格显示与 README 一致 |
| C5 | 发布 ① ③ | Publishing 页填 Logo、Display information（store-listing.md）、README、Sample output、Output schema、Actor permissions → Publish on Store；② 在 C3 通过后于第 2 周发布 | Store 公开搜索技术名可见；README 章节齐全（任务书 §4 第1周验收） |

C1–C5 的提示词模板（粘给编码 agent，token 由运行环境注入）：

```text
【任务 C1–C5：云端部署与发布（需要 APIFY_TOKEN）】
前提：环境变量 APIFY_TOKEN 已由用户注入；绝不打印、写入文件或提交它。仓库为 apify-actors monorepo，规格在 docs/specs/。
按顺序执行，每步完成后在 docs/ops-log.md 追加记录（时间 UTC+8、命令、结果、runId；不含 token）：
C1：对 actors/ 下三个目录执行 apify push（保持私有）；在 Console/API 确认 Limited permissions 与未启用 Standby；各运行一次默认输入，记录耗时与数据集条数；Actor ① 用 compareWithPreviousRun=true 连续跑两次，确认第二次能读到第一次的快照；Actor ② 查看运行内存是否为 4096 MB（动态表达式是否生效）。
C2：提示用户在私有仓库 Settings → Secrets 添加 APIFY_TOKEN（agent 不代为操作仓库密钥，除非用户授权），然后启用 selftest.yml，连续观察 3 天。
C3：运行 pnpm costreport --cloud scenarios/week1.yaml，提交 cost-report.md；任何护栏不通过就停止并报告，不做定价变更。
C4：按 docs/specs 各 spec §6 配置 PPE（若只能在 Console 操作，输出一份逐项配置清单交给用户或在用户授权的浏览器会话里操作）；务必删除 apify-default-dataset-item，不开启 Pay per event + usage。
C5：仅当 C1–C4 全部通过：按 docs/specs/store-listing.md 填写 Display information，上传 README，Publish Actor ① 和 ③；Actor ② 等第 2 周。
遇到以下情况立即停止并通知用户：cannot-create-public-actor / full-permission-actor-not-approved 等发布限制错误；需要填写账单或 KYC；需要接受新的服务条款；成本护栏不通过。
```
