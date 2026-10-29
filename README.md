<p align="center">
  <img src="icon.png" alt="dsh-rsi icon" width="120" height="120">
</p>

<h1 align="center">RSIAgent for DeepSeek Harness (dsh-rsi)</h1>

<p align="center">
  <strong>面向 DeepSeek Harness 的无需权重微调（Training-Free）递归自我改进（Recursive Self-Improvement, RSI）插件与运行引擎</strong>
</p>

<p align="center">
  <a href="https://arxiv.org/abs/2609.15364"><img src="https://img.shields.io/badge/Paper-arXiv%3A2609.15364-b31b1b?style=flat" alt="Paper: arXiv"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-blue.svg?style=flat" alt="License: Apache 2.0"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/DSH_Plugin-v0.1.0-6554c0?style=flat" alt="DSH Plugin v0.1.0"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js >= 20.0.0"></a>
</p>

---

## 🧭 项目简介

**dsh-rsi** 是为 **DeepSeek Harness (DSH)** 桌面 AI Agent 环境量身定制的**递归自我改进（RSI）引擎与官方标准插件**。

本项目工程化落地了学术前沿论文 [**RSIAgent: Autonomous Exploration for Recursive Self-improvement in New Environments**](https://arxiv.org/abs/2609.15364)（Aether AI 联合 UCSD、UIC 发表于 2026 年）的核心理论。在**完全保持大模型底层权重冻结（Frozen Weights）**的前提下，通过**独立双盲验证（Double-Blind Verifier）**与**因果可演化持久记忆库（Evolvable Memory Bank）**，使 Agent 能够在新环境、复杂软件与大型工程项目中自主试错、吸取教训，实现“跨会话、跨任务的经验连续进化”。

---

## 🎯 痛点与核心价值

当前大模型驱动的 AI Coding Agent 在复杂工程任务中普遍面临三大痛点：

1. **假阳性自欺欺人（False-Done / Semantic Entanglement）**：
   - *问题*：Agent 自己编写代码、自己调用测试，往往沿用自身错误的初始推演逻辑，陷入虚假自洽并宣布“任务已完成”。
   - *解决*：**独立双盲验证器**。以全新、空白的会话上下文执行独立物理探针（Probes），严禁读取 Actor 的内部思维链与推演草稿，杜绝确认偏差。
2. **试错经验跨会话丢失（Loss of Grounded Lessons）**：
   - *问题*：单次交互上下文结束后，Agent 历经千辛万苦调试出的关键参数、环境踩坑记录全部烟消云散，下次执行类似任务依然重复踩坑。
   - *解决*：**可演化持久记忆库**。任务终态（无论是通过还是失败）均触发因果提炼，沉淀“前置条件 ➔ 有效规程 ➔ 避坑机理”的三元组因果知识。
3. **不可靠的经验固化（Scope Loss & Hallucination）**：
   - *问题*：模型容易把一次偶然的临时变通（如为避开某 bug 强行加的参数）当成普适真理，污染后续所有任务。
   - *解决*：**全库一致性对齐（Reconciliation）**。新规则入库时主动与历史规则比对，自动标记直接矛盾或过时规则为 `SUPERSEDED`，动态维护记忆库的逻辑自洽。

---

## 🧩 模块化组件（DSH 规范）

`dsh-rsi` 严格遵循 DSH 的 Bundle 与 Component 规范，拆分为 **3 个独立可启停的运行中组件**：

```text
dsh-rsi (v0.1.0)
│
├── 🛡️ dsh-rsi-verifier   [RSIAgent 独立双盲验证器]
│     └── 基于 Epistemic 准则对候选交付物执行独立只读探针，防范 Agent 自欺与假阳性 (False-Done)。
│
├── 🧠 dsh-rsi-memory     [可演化持久记忆库]
│     └── 跨任务可演化持久记忆库：因果规程提炼、前置条件捕获与全局冲突消解 (Reconciliation)。
│
└── 📜 dsh-rsi-epistemic  [认识论真理信道 (E1-E6)]
      └── 向系统提示词注入 E1-E6 认识论准则：以真实环境探针为准，严禁臆测，错误即证据。
```

在 DSH 的「**设置**」→「**插件**」详情中，各组件均可独立开启或停用，并完整显示中文本地化标题、描述与状态指示灯。

---

## 🔄 核心工作流：递归自进化闭环

```text
                     ┌──────────────────────────────────┐
                     │          Task Objective          │
                     └────────────────┬─────────────────┘
                                      │
                                      ▼
                      ┌────────────────────────────────┐
 ┌── System Prompt ──►│   Actor Agent (执行者)         │
 │   注入 E1-E6 准则  │   - 挂载 ~/.memory 经验清单    │
 │   与记忆库清单      │   - 采用 Code-as-Policy 编写代码│
 │                    └───────────────┬────────────────┘
 │                                    │ 交付物已就绪
 │                                    ▼
 │                    ┌────────────────────────────────┐
 │                    │ Double-Blind Verifier (独立法官)│
 │                    │ - 零历史上下文 (Zero-History)  │
 │                    │ - 只读物理探针 (Read-only)     │
 │                    │ - 疑点一票否决 (Doubt Invariant)│
 │                    └───────────────┬────────────────┘
 │                                    │ 裁决结果 (PASS / FAIL + 证据)
 │                                    ▼
 │                    ┌────────────────────────────────┐
 │                    │ Memory Distillation (经验提炼) │
 │                    │ - 抽取因果机理与避坑关键点      │
 │                    └───────────────┬────────────────┘
 │                                    │ 新因果条目
 │                                    ▼
 │                    ┌────────────────────────────────┐
 │                    │ Memory Reconciliation (对齐消歧)│
 │                    │ - 排查语料库冲突               │
 │                    │ - 标注 Superseded 废弃旧假设   │
 │                    └───────────────┬────────────────┘
 │                                    │
 └────────────────────────────────────┴── 写入可演化持久记忆库
```

---

## 🛠 注册的 DSH Tools

插件向 DSH 注册了 4 个高阶工具，Agent 可在对话中自主调用：

### 1. `rsi_verify`（独立双盲验证）
- **功能**：对当前任务的交付物执行无污染的只读独立探针审计。
- **机制**：
  - 自动拦截一切潜在破坏性命令（如 `rm -rf`, `git reset --hard` 等）；
  - 严格执行 **Doubt Invariant**：如果最终报告中包含未解决的实质性疑问（Doubts），即使标有 PASS 也会自动强制降级为 FAIL。

### 2. `rsi_distill_memory`（因果经验提炼）
- **功能**：在任务完成后，基于验证器的成败报告与执行轨迹提炼可复用的因果规则。
- **产物**：包含 YAML Frontmatter（ID、标签、分类、验证标记）以及「前置条件 / 推荐规程 / 避坑机理 / 证据」四段式的结构化 Markdown。

### 3. `rsi_reconcile_memory`（全局记忆对齐）
- **功能**：检查记忆库中是否存在与新经验冲突的陈旧规则。
- **机制**：通过分词 Jaccard 重叠与反义语义分析，自动定位冲突规则并为其追加 `> ⚠️ SUPERSEDED / CONFLICT NOTICE` 注释。

### 4. `rsi_query_memory`（检索持久记忆）
- **功能**：提供关键词检索、标签筛选和分类查询，帮助 Agent 在新任务启动时按需调阅过往验证过的避坑指南。

---

## 💻 快速体验与 CLI 使用

除了作为 DSH 插件在后台无感运行外，`dsh-rsi` 提供了独立的终端 CLI 工具 `rsi`：

```bash
cd /Users/juheng/Documents/AgentProjects/dsh-rsi

# 1. 查看当前记忆库状态与 SHA-256 根哈希
node bin/rsi.mjs status

# 2. 检视注入的认识论准则与记忆库索引清单
node bin/rsi.mjs prompt

# 3. 模拟针对任务目标生成独立双盲审计 Prompt
node bin/rsi.mjs verify "实现一个支持超时与重试的 HTTP 请求函数"

# 4. 检索已有因果规则
node bin/rsi.mjs query "git"

# 5. 列出所有沉淀的经验文件
node bin/rsi.mjs list
```

---

## 🧪 自动化测试套件

项目采用 Node.js 原生测试运行器（`node:test`），零外部测试框架依赖，极速稳定：

```bash
cd /Users/juheng/Documents/AgentProjects/dsh-rsi
npm test
```

**测试结果（10/10 单元测试全数通过）：**
```text
TAP version 13
ok 1 - MemoryDistiller prompt creation and entry parsing
ok 2 - Epistemic Core rules completeness
ok 3 - renderEpistemicSection includes all E1-E6 principles
ok 4 - renderMemoryPreamble formats empty and populated inventory
ok 5 - MemoryBank CRUD operations and tree hashing
ok 6 - DSH plugin lifecycle mounts prompt sections and tools
ok 7 - MemoryReconciler contradiction detection and resolution
ok 8 - VerifierRuntime probe safety checks
ok 9 - VerifierRuntime runProbe execution
ok 10 - VerifierRuntime parseReport handling and doubt enforcement
1..10
# tests 10 | pass 10 | fail 0 | duration 53ms
```

---

## 📦 项目完整目录架构

```text
dsh-rsi/
├── bin/
│   └── rsi.mjs                  # CLI 命令行工具入口
├── lib/
│   ├── index.js                 # DSH / Cordis 插件入口 (applyComponent)
│   ├── components/              # 3 大模块化子组件
│   │   ├── verifier/            # 独立双盲验证器组件
│   │   ├── memory/              # 可演化持久记忆库组件
│   │   └── epistemic/           # 认识论真理信道组件
│   ├── core/                    # 算法核心层
│   │   ├── epistemic.js         # E1-E6 认识论公理及系统提示词渲染器
│   │   ├── verifier.js          # 独立双盲验收引擎与只读探针安全拦截器
│   │   ├── memory.js            # 记忆库读写、Tree Hash 计算与双作用域管理
│   │   ├── distillation.js      # 因果规则提炼与结构化解析器
│   │   └── reconciliation.js    # 语料库一致性排查与废弃标注器
│   └── tools/
│       └── definitions.js       # DSH Tools 契约与 JSON Schema 参数声明
├── locale/                      # 根包多语言翻译 (zh.json, en.json)
├── tests/                       # 单元测试套件
├── docs/
│   └── ARCHITECTURE.md          # 详细架构映射与技术设计文档
├── cordis.patch.yml             # Cordis 组件装配清单
├── dsh-plugin.json              # DSH 规范 Manifest 清单 (v0.15)
├── package.json                 # Node ESM 规范配置
├── icon.png                     # 256x256 插件专属矢量图标
└── LICENSE                      # Apache-2.0 许可证
```

---

## 🔌 在 DeepSeek Harness 中集成

在 DSH 的桌面 Profile 配置目录（`~/.dsh/profiles/desktop/package.json`）中声明该 Bundle 即可：

```json
{
  "name": "dsh-profile-desktop",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-ops",
        "dsh-rsi"
      ]
    }
  },
  "dependencies": {
    "dsh-ops": "file:/Users/juheng/.dsh/plugin-packages/dsh-ops-0.3.1.tgz",
    "dsh-rsi": "file:/Users/juheng/.dsh/plugin-packages/dsh-rsi-0.1.0.tgz"
  }
}
```

重新启动 **DeepSeek Harness** 应用即可在「插件」管理界面中查阅和管理 `dsh-rsi`。

---

## 🗺️ 后续演进计划 (Roadmap)

- [x] **MVP 阶段**：E1-E6 Epistemic Core 注入、独立双盲 Verifier 探针验收、双作用域 Memory Bank、因果经验提炼与跨语料 Reconciliation。
- [x] **DSH 组件化规范适配**：独立子组件包结构、专属 256px 图标、多语言本地化配置。
- [ ] **Phase 1 并行探索工作流**：基于 DSH `workflow` API 实现新仓库并行波次探索（Broad Recursive Self-exploration）。
- [ ] **Phase 2 自动化迭代循环**：实现针对特定难点任务的失败驱动迭代（Deep Recursive Self-exploration），全自动跑通 `FAIL -> Distill -> Practice -> Retry` 状态机。

---

## ⚖️ 许可证

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
