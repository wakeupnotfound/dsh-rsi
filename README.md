<p align="center">
  <img src="icon.png" alt="dsh-rsi icon" width="120" height="120">
</p>

<h1 align="center">RSIAgent for DeepSeek Harness (dsh-rsi)</h1>

<p align="center">
  <strong>面向 DeepSeek Harness 的无需权重微调（Training-Free）递归自我改进（Recursive Self-Improvement, RSI）插件与运行引擎</strong>
</p>

<p align="center">
  <strong>简体中文</strong> | <a href="README-EN.md">English</a>
</p>

<p align="center">
  <a href="https://arxiv.org/abs/2609.15364"><img src="https://img.shields.io/badge/Paper-arXiv%3A2609.15364-b31b1b?style=flat" alt="Paper: arXiv"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-blue.svg?style=flat" alt="License: Apache 2.0"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/DSH_Plugin-v0.3.0-6554c0?style=flat" alt="DSH Plugin v0.3.0"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js >= 20.0.0"></a>
</p>

---

## 项目简介

**dsh-rsi** 是为 **DeepSeek Harness (DSH)** 桌面 AI Agent 环境量身定制的**递归自我改进（RSI）引擎与官方标准插件**。

本项目工程化落地了学术前沿论文 [**RSIAgent: Autonomous Exploration for Recursive Self-improvement in New Environments**](https://arxiv.org/abs/2609.15364)（Aether AI 联合 UCSD、UIC 发表于 2026 年）的核心理论。在**完全保持大模型底层权重冻结（Frozen Weights）**的前提下，通过**独立双盲验证（Double-Blind Verifier）**、**因果可演化持久记忆库（Evolvable Memory Bank）**以及**并行自探索与刻意练习引擎**，使 Agent 能够在新环境、复杂软件与大型工程项目中自主试错、吸取教训，实现“跨会话、跨任务的经验连续进化”。

---

## v0.3.0 版本更新说明（Release Notes）

v0.3.0 重点完成了单 Skill 跨生态独立闭环与基于 BM25F 的检索与生命周期质量演进：

### 1. 单 Skill 独立闭环（Standalone Single-Skill Closed-Loop）
- **自动回执缓存（Receipt Caching）**：`verify` 运行后自动将包含目标规范化哈希（`target_hash = sha256(normalize(target))`）与时间戳签名的 `verification_receipt` 写入 `.rsi/receipts/<receipt_id>.json`，并维护 `.rsi/.last_receipt` 指针。
- **任务绑定校验（Task Binding）**：`distill` 自动读取最近一次验证回执，强制校验 HMAC 签名、目标绑定（`target_hash` 一致）与 24 小时时效性；校验失败保留原样供重试；经验写入成功后归档至 `.rsi/receipts/.consumed/` 杜绝重复消费。
- **零外部运行时依赖单文件打包**：内置打包单文件 CLI `skills/rsi/scripts/rsi-cli.mjs`（`npm run build:skill`），基于 esbuild 内联核心算法，仅依赖 Node.js 内置原生模块，实现单个文件夹即插即用。
- **双模自适应分级路由**：重构 `skills/rsi/SKILL.md`，支持 Node >= 20 预检与 `<SKILL_DIR>` 自动探测，在 DSH 原生 Tool（模式 A）与 Standalone 单文件 CLI（模式 B）之间无缝自适应分发。
- **全生命周期 CLI 子命令补全**：新增 `context`、`distill` 子命令，升级 `verify`、`explore`、`practice`、`query` 与 `status`（支持 `--gc` 过期回执回收、`--migrate` 存量记忆迁移）。

### 2. BM25F 检索引擎与生命周期管理
- **纯原生 JS 字段加权 BM25F 算法（lib/core/bm25.js）**：严格按照字段权重配置 title(3.0)、provenRule(2.5)、preconditions(2.0)、tags(2.0)、failureModes(1.0)、evidence(1.0) 进行长度归一化打分；结合置信度乘数 W_conf、采纳效用对数因子 ln(e + 0.2 * hit_count) 与 90 天半衰期时间衰减。
- **效用统计 Sidecar 分离（.rsi/stats.json）**：将易变会话统计与 Markdown 规则文本完全分离，采用临时文件原子替换更新，消除 Git diff 噪音，保障团队记忆库纯净；`query` 与 `context` 严格保持纯只读，不触碰文件 mtime。
- **显式回传与自动降级状态机**：通过 `verify --memory-ids "<ids>"` 显式回传采纳记忆条目；针对目标的验证若连续 2 次 FAIL，系统自动将其降级为 `PROBATION`（召回权重降至 0.4），后续任一 PASS 立即恢复 `ACTIVE`。
- **动态 Top-K 上下文注入**：从当前会话提取最新任务指令作为检索词，调用 BM25F 动态召回 Top-5 `ACTIVE` 记忆直接注入核心摘要，其余条目展示统计计数，彻底根治上下文膨胀（Context Bloat）。
- **存量记忆平滑迁移**：`rsi status --migrate` 支持将 v0.2.0 遗留记忆文件平滑迁移至包含 `confidence`、`status`、`last_validated_at` 的 v0.3.0 规范格式并完成重签名。

---

## 痛点与核心价值

当前大模型驱动的 AI Coding Agent 在复杂工程任务中普遍面临三大痛点：

1. **假阳性自欺欺人（False-Done / Semantic Entanglement）**：
   - *问题*：Agent 自己编写代码、自己调用测试，往往沿用自身错误的初始推演逻辑，陷入虚假自洽并宣布“任务已完成”。
   - *解决*：**独立双盲验证器**。以全新、空白的会话上下文执行独立物理探针（Probes），严禁读取 Actor 的内部思维链与推演草稿，杜绝确认偏差。
2. **试错经验跨会话丢失（Loss of Grounded Lessons）**：
   - *问题*：单次交互上下文结束后，Agent 历经千辛万苦调试出的关键参数、环境踩坑记录全部烟消云散，下次执行类似任务依然重复踩坑。
   - *解决*：**可演化持久记忆库**。任务终态（无论是通过还是失败）均触发因果提炼，沉淀“前置条件 -> 有效规程 -> 避坑机理”的三元组因果知识。
3. **不可靠的经验固化（Scope Loss & Hallucination）**：
   - *问题*：模型容易把一次偶然的临时变通（如为避开某 bug 强行加的参数）当成普适真理，污染后续所有任务。
   - *解决*：**全库一致性对齐（Reconciliation）**。新规则入库时主动与历史规则比对；直接矛盾、显式 supersedes，以及“同标题/同类别且高重叠”的规程演进会被标记为 `SUPERSEDED`，而通用标题、低重叠与长标题截断差异会被保守保留，动态维护记忆库的逻辑自洽。

---

## 模块化组件（DSH 规范）

`dsh-rsi` 严格遵循 DSH 的 Bundle 与 Component 规范，拆分为 **4 个独立可启停的运行中组件**：

```text
dsh-rsi (v0.3.0)
|
|-- dsh-rsi-verifier   [RSIAgent 独立双盲验证器]
|     └── 基于 Epistemic 准则对候选交付物执行独立只读探针，防范 Agent 自欺与假阳性 (False-Done)。
|
|-- dsh-rsi-memory     [可演化持久记忆库]
|     └── 跨任务可演化持久记忆库：BM25F 字段加权检索、前置条件捕获与全局冲突消解 (Reconciliation)。
|
|-- dsh-rsi-epistemic  [认识论真理信道 (E1-E6)]
|     └── 向系统提示词注入 E1-E6 认识论准则与动态 Top-K 记忆摘要：以真实环境探针为准，严禁臆测。
|
└── dsh-rsi-explorer   [递归自探索与练习引擎]
      └── 基于 DSH workflow 引擎调度并行波次仓库探索（Phase 1）与失败驱动重试练习（Phase 2）。
```

在 DSH 的「**设置**」->「**插件**」详情中，各组件均可独立开启或停用，并完整显示中文本地化标题、描述与状态指示灯。

---

## 核心工作流：递归自进化闭环

整个自我进化生命周期遵循闭环流转：
1. **任务启动**：注入 E1-E6 认识论法则，通过 BM25F 检索动态注入 Top-5 最相关持久记忆摘要，Actor 编写和执行代码；
2. **双盲验收**：产物完成后，Agent 调用 `rsi_verify`（或 CLI `verify`）；运行只读探针探测物理环境，执行疑点一票否决并生成防伪核验凭据；
3. **因果经验提炼**：Actor 复盘整条轨迹与审计反馈，抽取因果机理与避坑关键点；
4. **冲突排查对齐**：Reconciler 遍历记忆库，按“完整未截断标题相等 + 非通用标题 + 同 category + Jaccard > 35%”识别同主题规程演进；极性矛盾或显式 supersedes 的旧规则打上 `SUPERSEDED`，通用标题、低重叠与长标题截断差异保守保留；
5. **波次自探索（Phase 1）**：针对全新仓库，通过 `rsi_explore` 调度多波次并行探测，审计后批量入库；
6. **失败驱动迭代（Phase 2）**：针对困难任务，通过 `rsi_practice` 跑通 `FAIL -> Distill -> Practice -> Retry`，隔离试验验证后重试。

### RSI 工具调用协议

DSH 负责注入 Prompt Section 并注册工具。要让引擎真正生效，Agent 需要执行：

1. 任务前调用 `rsi_query_memory` 检索相关经验（或在单 Skill 模式下运行 `rsi-cli.mjs context`）；
2. 宣称完成前调用 `rsi_verify`（或 `rsi-cli.mjs verify`）生成审计 Prompt，运行物理探针并获取回执；
3. 裁决后调用 `rsi_distill_memory`（或 `rsi-cli.mjs distill`）并传入完整的 `rule_content`，完成核验与记忆写入；
4. 新仓库调用 `rsi_explore`，反复失败的任务调用 `rsi_practice`；冲突时调用 `rsi_reconcile_memory`。

该协议由 `dsh-rsi:rsi-protocol` Prompt Section（order 3120）在每个会话中注入。

---

## 注册的 6 大 DSH Tools

插件向 DSH 注册了 6 个高阶工具，满足 DSH strict output schema 与 lossless JSON 契约：

### 1. `rsi_verify`（独立双盲验证）
- **功能**：对当前任务的交付物执行只读独立探针审计。
- **机制**：
  - **无 Shell 白名单执行（`ProbePolicy`）**：探针指令被直接词法解析为 `argv` 并通过 `spawn(..., { shell: false })` 执行，严禁管道、重定向、命令拼接与子命令替换，仅放行白名单内的只读检视工具与测试运行器；
  - **加密核验凭据（`verification_receipt`）**：解析盲审报告后签发绑定目标哈希与时间戳的 HMAC 凭据，供 `rsi_distill_memory` 验证真伪，防止模型伪造 `verified: true`；
  - 严格执行 **Doubt Invariant**：若报告缺失明确的 DOUBTS 段落（E4 沉默不代表没有），或包含未消除存疑，即使标有 PASS 也强制降级为 FAIL。

### 2. `rsi_distill_memory`（因果经验提炼）
- **功能**：在任务完成后，基于验证器的成败报告与执行轨迹提炼可复用的因果规则。
- **机制**：支持 `verification_receipt` 凭据核验、任务绑定校验与 `supersedes` 显式取代列表；写入磁盘的记忆文件均附带用户级密钥 HMAC 签名；克隆第三方仓库中未签名的 `.rsi/memory/` 文件将被隔离且绝不注入系统提示词（可通过 `rsi trust <id>` 手动审核信任）。
- **产物**：包含 YAML Frontmatter（ID、标签、分类、验证标记、置信度、状态、最后验证时间、签名）以及「前置条件 / 推荐规程 / 避坑机理 / 证据」四段式的结构化 Markdown。

### 3. `rsi_reconcile_memory`（全局记忆对齐）
- **功能**：检查记忆库中是否存在与新经验冲突或被演进取代的陈旧规则。
- **机制**：按“完整未截断标题相等、非通用标题、同 category、Jaccard > 35%”四重门槛识别同主题规程演进；跨规则高重叠通过反义极性分析检测直接矛盾；命中的旧规则追加 `[SUPERSEDED / CONFLICT NOTICE]` 注释，否则保留并建立 `related_topic` 关联，同时维护原始存储作用域。

### 4. `rsi_query_memory`（检索持久记忆）
- **功能**：提供基于 BM25F 字段加权的检索能力，融合分类、标签与关键词打分，帮助 Agent 在新任务启动时按需调阅过往验证过的避坑指南。

### 5. `rsi_explore`（Phase 1 并行波次自探索）
- **功能**：针对新仓库或环境，通过 `agentPresets.serviceFor(agent, 'workflowEngine')` 穿透 Cordis delegation 组隔离调度并行 Subagent 进行结构化探索。
- **机制**：Wave 1 多维度调研 -> Wave 2 针对跟进疑问进行深度探针 -> 独立 Verifier 双盲伪证审计 -> 通过规则对齐入库。

### 6. `rsi_practice`（Phase 2 失败驱动深度练习）
- **功能**：针对困难任务运行 `FAIL -> Distill -> Practice -> Retry` 状态机。
- **机制**：验证失败后提取根因规则，并在独立临时目录进行最小隔离实验（Practice）验证修正方案，再携新知识重试。

---

## 终端 CLI 使用指南（bin/rsi.mjs）

`dsh-rsi` 提供了全功能的终端命令行工具：

```bash
# 1. 查看记忆库状态、树哈希与缓存回执数量
node bin/rsi.mjs status

# 2. 清理超过 24 小时的过期回执
node bin/rsi.mjs status --gc

# 3. 批量平滑迁移存量记忆至 v0.3.0 Frontmatter 格式
node bin/rsi.mjs status --migrate

# 4. 任务前上下文与 Top-K 记忆动态召回
node bin/rsi.mjs context --task "解决 SQLite 高并发写入锁冲突" --top-k 5

# 5. 使用 BM25F 检索引擎检索因果经验
node bin/rsi.mjs query "sqlite busy timeout" --top-k 5

# 6. 执行只读安全探针并签发缓存验证回执
node bin/rsi.mjs verify --target "src/db.js" --probe "npm test" --memory-ids "mem_a1b2c3d4"

# 7. 提炼因果经验（自动核验最近一次有效回执与目标绑定）
node bin/rsi.mjs distill \
  --target "src/db.js" \
  --title "SQLite 并发写入 busy_timeout 配置规范" \
  --preconditions "SQLite3, WAL 模式, 多进程并发" \
  --rule "PRAGMA busy_timeout = 5000; 开启 WAL 模式避免 database is locked" \
  --evidence "verified under 10 concurrent writers with zero busy lock errors"

# 8. 生成 Phase 1 仓库自探索工作流
node bin/rsi.mjs explore --goal "调研项目核心架构与依赖"

# 9. 生成 Phase 2 刻意练习四阶段状态机指令
node bin/rsi.mjs practice --target "src/db.js" --failure "SQLITE_BUSY error" --probe "npm test"

# 10. 签名并信任克隆仓库中未签名的记忆条目
node bin/rsi.mjs trust <entry-id>
```

---

## RSIAgent 官方单 Skill 独立闭环（skills/rsi/）

除了作为 DSH 底层插件外，本项目已将自进化闭环能力完全下沉打包至 `skills/rsi/`：

```text
skills/rsi/
|-- SKILL.md                          # 双模自适应路由指令与认识论执行协议
|-- _meta.json                        # Skill 元数据配置（v0.3.0）
|-- scripts/
|     └── rsi-cli.mjs                 # 零外部依赖自包含单文件 CLI（体积约 103KB）
└── references/                       # 按需懒加载的参考规程
      |-- epistemic-core.md           # E1-E6 认识论六大准则操作手册
      |-- double-blind-verification.md# 独立双盲盲审、探针白名单与疑点不变量协议
      |-- causal-distillation.md      # 四段式因果规则提炼与任务绑定规范
      └── exploration-and-practice.md # 波次探索与失败驱动刻意练习状态机
```

### 1. 宿主分级适配矩阵

| 宿主类别 | 代表环境 | 发现与激活方式 | 承诺级别 |
| :--- | :--- | :--- | :--- |
| Agent Skills 标准 | Claude Code、DSH | 原生识别 `SKILL.md` frontmatter 与 `references/` 懒加载 | 零配置自动发现 |
| MCP 宿主 | 支持 MCP 的 IDE Agent | 通过 MCP Server 入口注册工具 | 一次配置工具常驻 |
| Rules 类宿主 | Cursor、Windsurf | 宿主规则文件中加入单行指令（如 `遵循 skills/rsi/SKILL.md 执行协议`） | 单行激活 |

### 2. Standalone 独立单 Skill 调用方式

将 `skills/rsi/` 拷贝到任意工程中，在没有 DSH 插件原生 Tool 的环境下，通过 Bash 即可跑通完整闭环：

```bash
# 1. 任务上下文与记忆召回
node "skills/rsi/scripts/rsi-cli.mjs" context --task "<当前任务简述>" --top-k 5

# 2. 仓库波次探索
node "skills/rsi/scripts/rsi-cli.mjs" explore --goal "<探索目标>"

# 3. 独立双盲验证
node "skills/rsi/scripts/rsi-cli.mjs" verify --target "<目标文件>" --probe "<验证命令>"

# 4. 因果经验提炼（自动核验并消费回执）
node "skills/rsi/scripts/rsi-cli.mjs" distill \
  --target "<目标文件>" \
  --title "<规则标题>" \
  --preconditions "<前置条件>" \
  --rule "<已验证规则>" \
  --evidence "<验证证据>"

# 5. 失败刻意练习
node "skills/rsi/scripts/rsi-cli.mjs" practice --target "<目标文件>" --failure "<失败报错>" --probe "<验证命令>"
```

### 3. 构建独立单文件 CLI

```bash
npm run build:skill
```

---

## 部署与安装方式

### 方式一：开发调试部署（软链接生效）

1. **建立源码软链接**：
   ```bash
   ln -s "$(pwd)" ~/.dsh/profiles/desktop/node_modules/dsh-rsi
   ```
2. **在桌面 Profile 中注册**：
   在 `~/.dsh/profiles/desktop/cordis.patch.yml` 中插入组件配置：
   ```yaml
   - insert:
       - id: dsh-rsi-verifier
         name: dsh-rsi/verifier
         config:
           probeTimeoutMs: 30000
           maxProbes: 10
       - id: dsh-rsi-memory
         name: dsh-rsi/memory
         config:
           enabled: true
       - id: dsh-rsi-epistemic
         name: dsh-rsi/epistemic
         config:
           epistemicPromptOrder: 3100
           memoryPromptOrder: 3110
       - id: dsh-rsi-explorer
         name: dsh-rsi/explorer
         config: {}
   ```
3. **重启 DeepSeek Harness**。

---

### 方式二：标准离线打包与分发部署

1. **执行构建并打包为 `.tgz`**：
   ```bash
   npm run build:skill
   npm pack
   ```
   打包生成 `dsh-rsi-0.3.0.tgz`。
2. **复制归档到插件目录**：
   ```bash
   mkdir -p ~/.dsh/plugin-packages
   cp dsh-rsi-0.3.0.tgz ~/.dsh/plugin-packages/
   ```
3. **在 DSH 桌面 Profile 中关联该归档并重启**。

---

## 自动化测试套件

项目采用 Node.js 原生测试运行器（`node:test`），零外部测试框架依赖：

```bash
npm test
```

`npm test` 自动触发 `npm run build:skill` 内联打包并执行全部单元与集成测试。

**测试结果（35/35 项测试全数通过）：**
```text
ok 1 - MemoryDistiller prompt creation and entry parsing
ok 2 - Comprehensive test of dsh-rsi components and workflows (E2E)
ok 3 - Epistemic Core rules completeness
ok 4 - renderEpistemicSection includes all E1-E6 principles
ok 5 - renderMemoryPreamble formats empty and populated inventory
ok 6 - ExplorationPlanner builds a valid workflow request
ok 7 - exploration script runs waves, audits double-blind, and enforces the doubt invariant
ok 8 - verify=false never yields committable lessons
ok 9 - lessonToEntry produces the four-section memory format
ok 10 - lessonToEntry and MemoryBank preserve distinct CJK titles without collision
ok 11 - MemoryBank CRUD operations and tree hashing
ok 12 - BM25F field-weighted retrieval benchmark (>= 25 labeled query-expected pairs across Chinese, English, Mixed, Partial)
ok 13 - Query and context operations are strictly read-only (mtimes unmodified)
ok 14 - Stats sidecar utility tracking and PROBATION downgrade on consecutive verify failures
ok 15 - System Prompt Top-K bounded memory inventory
ok 16 - Legacy memory migration to v0.3 schema
ok 17 - tool definitions declare DSH-compatible output schemas and renderers
ok 18 - DSH plugin lifecycle enforces strict host contracts (output, sync sections, disposers)
ok 19 - rsi_explore and rsi_practice execute via workflowEngine and commit only audited lessons
ok 20 - rsi_verify issues cryptographic receipt and rsi_distill_memory enforces receipt attestation
ok 21 - transition table rejects illegal moves
ok 22 - normalizeVerdict applies the doubt invariant
ok 23 - PracticeLoop: FAIL -> Distill -> Practice -> Retry -> PASS
ok 24 - PracticeLoop: exhausts the attempt budget
ok 25 - practice workflow script follows the same state machine, double-blind
ok 26 - practice workflow script ends EXHAUSTED when every attempt fails
ok 27 - MemoryReconciler contradiction detection and resolution
ok 28 - MemoryReconciler supersedes old entry when same lesson topic procedure evolves
ok 29 - MemoryReconciler avoids false-positive supersession on generic titles, low overlap, or truncated long titles
ok 30 - RSI Skill definitions and reference files integrity
ok 31 - Standalone Single-Skill CLI E2E: context -> explore -> verify -> distill -> practice
ok 32 - Security DoD: Stale receipt (target mismatch & expired >24h) and duplicate consumption rejected
ok 33 - VerifierRuntime probe safety checks
ok 34 - VerifierRuntime runProbe execution
ok 35 - VerifierRuntime parseReport handling and doubt enforcement
# tests 35 | pass 35 | fail 0 | duration ~460ms
```

---

## 项目完整目录架构

```text
dsh-rsi/
|-- bin/
|     └── rsi.mjs                  # CLI 命令行入口（支持 context/distill/verify/query/status 等）
|-- lib/
|     |-- index.js                 # DSH 插件入口（动态 Top-K 注入与工具注册）
|     |-- components/              # 4 大模块化子组件
|     |-- core/                    # 算法核心层
|     |     |-- bm25.js            # [v0.3.0 新增] 字段加权 BM25F 检索与时间衰减评分器
|     |     |-- epistemic.js       # E1-E6 认识论公理与系统提示词渲染器
|     |     |-- probe-policy.js    # 无 Shell 只读探针白名单安全策略
|     |     |-- integrity.js       # HMAC 密钥环、收据签名与任务绑定校验
|     |     |-- verifier.js        # 双盲验收引擎与回执缓存持久化管理
|     |     |-- memory.js          # 记忆库读写、BM25F 接入、Sidecar 统计与生命周期管理
|     |     |-- distillation.js    # 因果规则提炼与结构化解析器
|     |     |-- reconciliation.js  # 中英文分词器与语料库一致性消解器
|     |     |-- exploration.js     # Phase 1 并行波次探索调度器
|     |     └── practice.js        # Phase 2 失败驱动刻意练习状态机
|     └── tools/
|           └── definitions.js     # DSH Tools 契约与 JSON Schema 参数声明
|-- skills/
|     └── rsi/                     # 可独立分发的单 Skill 完整包
|           |-- SKILL.md           # 双模自适应执行协议与指令
|           |-- _meta.json         # Skill 元数据
|           |-- scripts/
|           |     └── rsi-cli.mjs  # [v0.3.0 新增] 打包内联的零外部依赖 CLI 单文件
|           └── references/        # 按需懒加载参考规程
|-- locale/                        # 多语言本地化字典 (zh.json, en.json)
|-- tests/                         # 单元与集成测试套件 (35 项测试全覆盖)
|-- docs/
|     └── ARCHITECTURE.md          # 架构与演进技术设计文档
|-- cordis.patch.yml               # Cordis 组件装配清单
|-- dsh-plugin.json                # DSH 规范 Manifest 清单 (v0.15)
|-- package.json                   # 项目工程配置
|-- README.md                      # 中文文档
|-- README-EN.md                   # 英文文档
|-- icon.png                       # 256x256 矢量图标
└── LICENSE                        # Apache-2.0 许可证
```

---

## 后续演进计划 (Roadmap)

- [x] **v0.1.0 MVP 阶段**：E1-E6 认识论法则注入、双盲验证探针、双作用域记忆库与语料库冲突调和。
- [x] **v0.2.0 自探索与练习**：Phase 1 并行波次探索与 Phase 2 失败驱动刻意练习工作流。
- [x] **v0.3.0-alpha (M1) 单 Skill 独立闭环**：回执缓存与任务绑定、全命令 CLI、零依赖单文件打包、双模自适应分级路由。
- [x] **v0.3.0 (M2) BM25F 检索与生命周期**：纯 JS 字段加权 BM25F 算法、效用统计 Sidecar、自动降级状态机、动态 Top-K 上下文注入。
- [ ] **v0.4.0 (M3) 回归探针与安全守门**：历史经验自动沉淀为回归测试探针、工作区防污染快照检查、任务交付自动化守门机制。
- [ ] **v0.5.0 ~ v1.0.0 (M4) 团队共享与 MCP 生态**：Ed25519 团队公钥环验签、自适应技术栈探索、标准 MCP Server 跨生态分发。

---

## 许可证

本项目依据 [Apache License 2.0](LICENSE) 开源。

学术引用请参考原始论文：
```bibtex
@misc{zhu2026rsiagentautonomousexplorationrecursive,
      title={RSIAgent: Autonomous Exploration for Recursive Self-improvement in New Environments},
      author={Sibo Zhu and Shicheng Fan and Xinyue Wang and Wenyi Wu and Kun Zhou and Biwei Huang},
      year={2026},
      eprint={2609.15364},
      archivePrefix={arXiv},
      primaryClass={cs.AI},
      url={https://arxiv.org/abs/2609.15364},
}
```
