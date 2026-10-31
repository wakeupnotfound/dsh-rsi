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

## 项目简介

**dsh-rsi** 是为 **DeepSeek Harness (DSH)** 桌面 AI Agent 环境量身定制的**递归自我改进（RSI）引擎与官方标准插件**。

本项目工程化落地了学术前沿论文 [**RSIAgent: Autonomous Exploration for Recursive Self-improvement in New Environments**](https://arxiv.org/abs/2609.15364)（Aether AI 联合 UCSD、UIC 发表于 2026 年）的核心理论。在**完全保持大模型底层权重冻结（Frozen Weights）**的前提下，通过**独立双盲验证（Double-Blind Verifier）**、**因果可演化持久记忆库（Evolvable Memory Bank）**以及**并行自探索与刻意练习引擎**，使 Agent 能够在新环境、复杂软件与大型工程项目中自主试错、吸取教训，实现“跨会话、跨任务的经验连续进化”。

---

## 痛点与核心价值

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

## 模块化组件（DSH 规范）

`dsh-rsi` 严格遵循 DSH 的 Bundle 与 Component 规范，拆分为 **4 个独立可启停的运行中组件**：

```text
dsh-rsi (v0.1.0)
│
├── dsh-rsi-verifier   [RSIAgent 独立双盲验证器]
│     └── 基于 Epistemic 准则对候选交付物执行独立只读探针，防范 Agent 自欺与假阳性 (False-Done)。
│
├── dsh-rsi-memory     [可演化持久记忆库]
│     └── 跨任务可演化持久记忆库：因果规程提炼、前置条件捕获与全局冲突消解 (Reconciliation)。
│
├── dsh-rsi-epistemic  [认识论真理信道 (E1-E6)]
│     └── 向系统提示词注入 E1-E6 认识论准则：以真实环境探针为准，严禁臆测，错误即证据。
│
└── dsh-rsi-explorer   [递归自探索与练习引擎]
      └── 基于 DSH workflow 引擎调度并行波次仓库探索（Phase 1）与失败驱动重试练习（Phase 2）。
```

在 DSH 的「**设置**」→「**插件**」详情中，各组件均可独立开启或停用，并完整显示中文本地化标题、描述与状态指示灯。

---

## 核心工作流：递归自进化闭环

整个自我进化生命周期遵循闭环流转：
1. **任务启动**：注入 E1-E6 认识论法则，同步挂载当前持久记忆库清单，Actor 使用 Code-as-Policy 编写和执行代码；
2. **双盲验收**：产物完成后自动由 Verifier 开启无历史独立 Subagent，运行只读探针探测物理环境，执行疑点一票否决；
3. **因果经验提炼**：Actor 复盘整条轨迹与审计反馈，抽取因果机理与避坑关键点；
4. **冲突排查对齐**：Reconciler 遍历记忆库，利用 Jaccard 相似度与极性检测，自动为旧冲突规则打上 `SUPERSEDED` 标记；
5. **波次自探索（Phase 1）**：针对全新仓库，通过 `rsi_explore` 调度多波次并行探测，审计后批量入库；
6. **失败驱动迭代（Phase 2）**：针对困难任务，通过 `rsi_practice` 跑通 `FAIL ➔ Distill ➔ Practice ➔ Retry`，隔离试验验证后重试。

---

## 部署方式详解（Deployment Methods）

### 方式一：开发调试部署（推荐，实时生效）

**适用场景**：日常开发、功能调试、随改随测。

1. **建立源码软链接**：
   ```bash
   ln -s "/Users/juheng/Documents/AgentProjects/dsh-rsi" ~/.dsh/profiles/desktop/node_modules/dsh-rsi
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
3. **重启 DeepSeek Harness**：完全退出并重新打开应用。
   > **优势**：修改 `lib/` 源码无需重新打包，刷新或重启即可实时加载最新代码。

---

### 方式二：标准离线打包与分发部署

**适用场景**：稳定版交付、跨机器部署或分发归档。

1. **打包归档为 `.tgz`**：
   ```bash
   rm -rf /tmp/dsh-rsi-pkg && mkdir -p /tmp/dsh-rsi-pkg/package
   cp -R /Users/juheng/Documents/AgentProjects/dsh-rsi/* /tmp/dsh-rsi-pkg/package/
   tar -czf ~/.dsh/plugin-packages/dsh-rsi-0.1.0.tgz -C /tmp/dsh-rsi-pkg package
   ```
2. **确认文件归档路径**：
   `~/.dsh/plugin-packages/dsh-rsi-0.1.0.tgz`
3. **在 DSH 桌面 Profile 中关联该归档**。
4. **重启 DSH**。

---

## 🛠 注册的 6 大 DSH Tools

插件向 DSH 注册了 6 个高阶工具，满足 DSH strict output schema 与 lossless JSON 契约：

### 1. `rsi_verify`（独立双盲验证）
- **功能**：对当前任务的交付物执行只读独立探针审计。
- **机制**：
  - 启发式静态拦截常见破坏性指令（如 `rm`, `git reset --hard`, `sed -i`, 文件重定向、代码写入、包管理变更等），与 DSH 只读进程沙箱配合实现纵深防御；
  - 严格执行 **Doubt Invariant**：若报告缺失明确的 DOUBTS 段落（E4 沉默不代表没有），或包含未消除存疑，即使标有 PASS 也强制降级为 FAIL。

### 2. `rsi_distill_memory`（因果经验提炼）
- **功能**：在任务完成后，基于验证器的成败报告与执行轨迹提炼可复用的因果规则。
- **产物**：包含 YAML Frontmatter（ID、标签、分类、验证标记）以及「前置条件 / 推荐规程 / 避坑机理 / 证据」四段式的结构化 Markdown。

### 3. `rsi_reconcile_memory`（全局记忆对齐）
- **功能**：检查记忆库中是否存在与新经验冲突或被演进取代的陈旧规则。
- **机制**：支持同主题规程演进自动废弃旧版；跨规则高重叠通过反义极性分析检测直接矛盾并追加 `> ⚠️ SUPERSEDED / CONFLICT NOTICE` 注释（无矛盾则保留并建立 `related_topic` 关联），同时维护原始存储作用域。

### 4. `rsi_query_memory`（检索持久记忆）
- **功能**：提供关键词检索、标签筛选和分类查询，帮助 Agent 在新任务启动时按需调阅过往验证过的避坑指南。

### 5. `rsi_explore`（Phase 1 并行波次自探索）
- **功能**：针对新仓库或环境，通过 `agentPresets.serviceFor(agent, 'workflowEngine')` 穿透 Cordis delegation 组隔离调度并行 Subagent 进行结构化探索。
- **机制**：Wave 1 多维度调研 ➔ Wave 2 针对跟进疑问进行深度探针 ➔ 独立 Verifier 双盲伪证审计 ➔ 通过规则对齐入库。
- *环境提示*：在自动执行模式下（`mode: 'auto'`），需要当前会话所属 DSH Preset 启用了 workflow 引擎（如 PTC 预设）。若预设禁用了 workflow 引擎（如默认 standard 预设），工具将返回结构化工作流编排脚本与指引，执行后通过 `workflow_result` 提交入库。

### 6. `rsi_practice`（Phase 2 失败驱动深度练习）
- **功能**：针对困难任务运行 `FAIL ➔ Distill ➔ Practice ➔ Retry` 状态机。
- **机制**：验证失败后提取根因规则，并在独立临时目录进行最小隔离实验（Practice）验证修正方案，再携新知识重试。

---

## 快速体验与 CLI 使用

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

# 6. 生成 Phase 1 仓库并行自探索工作流脚本
node bin/rsi.mjs explore

# 7. 生成 Phase 2 失败驱动练习迭代工作流脚本
node bin/rsi.mjs practice "解决 SQLite 高并发写入锁冲突"
```

---

## 自动化测试套件

项目采用 Node.js 原生测试运行器（`node:test`），零外部测试框架依赖，极速稳定：

```bash
cd /Users/juheng/Documents/AgentProjects/dsh-rsi
npm test
```

**测试结果（26/26 单元与端到端测试全数通过）：**
```text
TAP version 13
ok 1 - MemoryDistiller prompt creation and entry parsing
ok 2 - /Users/juheng/Documents/AgentProjects/dsh-rsi/tests/e2e_simulation.test.mjs
ok 3 - Epistemic Core rules completeness
ok 4 - renderEpistemicSection includes all E1-E6 principles
ok 5 - renderMemoryPreamble formats empty and populated inventory
ok 6 - ExplorationPlanner builds a valid workflow request
ok 7 - exploration script runs waves, audits double-blind, and enforces the doubt invariant
ok 8 - verify=false never yields committable lessons
ok 9 - lessonToEntry produces the four-section memory format
ok 10 - lessonToEntry and MemoryBank preserve distinct CJK titles without collision
ok 11 - MemoryBank CRUD operations and tree hashing
ok 12 - tool definitions declare DSH-compatible output schemas and renderers
ok 13 - DSH plugin lifecycle enforces strict host contracts (output, sync sections, disposers)
ok 14 - rsi_explore and rsi_practice execute via workflowEngine and commit only audited lessons
ok 15 - transition table rejects illegal moves
ok 16 - normalizeVerdict applies the doubt invariant
ok 17 - PracticeLoop: FAIL -> Distill -> Practice -> Retry -> PASS
ok 18 - PracticeLoop: exhausts the attempt budget
ok 19 - practice workflow script follows the same state machine, double-blind
ok 20 - practice workflow script ends EXHAUSTED when every attempt fails
ok 21 - MemoryReconciler contradiction detection and resolution
ok 22 - MemoryReconciler supersedes old entry when same lesson topic procedure evolves
ok 23 - MemoryReconciler avoids false-positive supersession on generic titles, low overlap, or truncated long titles
ok 24 - VerifierRuntime probe safety checks
ok 25 - VerifierRuntime runProbe execution
ok 26 - VerifierRuntime parseReport handling and doubt enforcement
1..26
# tests 26 | pass 26 | fail 0 | duration ~95ms
```

---

## 项目完整目录架构

```text
dsh-rsi/
├── bin/
│   └── rsi.mjs                  # CLI 命令行工具入口
├── lib/
│   ├── index.js                 # DSH / Cordis 插件入口 (apply / applyComponent)
│   ├── components/              # 4 大模块化子组件
│   │   ├── verifier/            # 独立双盲验证器组件
│   │   ├── memory/              # 可演化持久记忆库组件
│   │   ├── epistemic/           # 认识论真理信道组件
│   │   └── explorer/            # 递归自探索与练习组件
│   ├── core/                    # 算法核心层
│   │   ├── epistemic.js         # E1-E6 认识论公理及系统提示词渲染器
│   │   ├── verifier.js          # 独立双盲验收引擎与只读探针安全拦截器
│   │   ├── memory.js            # 记忆库读写、Tree Hash 计算与双作用域管理
│   │   ├── distillation.js      # 因果规则提炼与结构化解析器
│   │   ├── reconciliation.js    # 语料库一致性排查与废弃标注器
│   │   ├── exploration.js       # Phase 1 并行波次探索与独立审计
│   │   └── practice.js          # Phase 2 失败驱动迭代状态机
│   └── tools/
│       └── definitions.js       # DSH Tools 契约与 JSON Schema 参数及输出声明
├── locale/                      # 根包多语言翻译 (zh.json, en.json)
├── tests/                       # 单元与集成测试套件
│   ├── epistemic.test.mjs
│   ├── memory.test.mjs
│   ├── verifier.test.mjs
│   ├── distillation.test.mjs
│   ├── reconciliation.test.mjs
│   ├── exploration.test.mjs
│   ├── practice.test.mjs
│   ├── plugin.test.mjs
│   └── e2e_simulation.test.mjs
├── docs/
│   └── ARCHITECTURE.md          # 详细架构映射与技术设计文档
├── cordis.patch.yml             # Cordis 组件装配清单
├── dsh-plugin.json              # DSH 规范 Manifest 清单 (v0.15)
├── package.json                 # Node ESM 规范配置
├── icon.png                     # 256x256 插件专属矢量图标
└── LICENSE                      # Apache-2.0 许可证
```

---

## 后续演进计划 (Roadmap)

- [x] **MVP 阶段**：E1-E6 Epistemic Core 注入、独立双盲 Verifier 探针验收、双作用域 Memory Bank、因果经验提炼与跨语料 Reconciliation。
- [x] **DSH 组件化规范适配**：4 大独立子组件包结构、专属 256px 图标、多语言本地化配置。
- [x] **全流程部署指南与架构文档**：开发软链接、离线打包、图标切换及一键卸载支持。
- [x] **Phase 1 并行探索工作流**：基于 DSH `workflow` API 实现新仓库并行波次探索（Broad Recursive Self-exploration）。
- [x] **Phase 2 自动化迭代循环**：实现针对特定难点任务的失败驱动迭代（Deep Recursive Self-exploration），全自动跑通 `FAIL -> Distill -> Practice -> Retry` 状态机。

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
