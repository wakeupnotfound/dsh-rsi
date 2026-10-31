# RSIAgent for DeepSeek Harness (dsh-rsi)

面向 **DeepSeek Harness (DSH)** 的 **无需权重微调（Training-Free）** 递归自我改进（Recursive Self-Improvement, RSI）插件与运行引擎。

本项目基于学术论文 [**RSIAgent: Autonomous Exploration for Recursive Self-improvement in New Environments**](https://arxiv.org/abs/2609.15364)（Aether AI 联合 UCSD、UIC 发表于 2026 年）的核心理念，针对实际复杂桌面环境与代码开发工作流进行了实用工程化改造。

---

## 核心解决的问题

当前大模型驱动的 AI Agent 在复杂操作系统与代码库中作业时普遍面临三大瓶颈：
1. **假阳性自欺欺人（False-Done）**：Agent 自己写代码、自己验证，容易沿用自身错误的初始假设，宣布“假成功”。
2. **试错经验无法跨会话沉淀**：任务完成后 Context 一清空，踩过的坑与试出来的正确脚本全部丢失，下次遇到同样的问题依然重蹈覆辙。
3. **不可靠的经验固化（Scope Loss & Hallucination）**：模型容易将一次偶然的临时变通误当成通用准则，导致后续任务产生严重认知偏差。

**dsh-rsi** 保持大模型权重完全冻结（Frozen Weights），通过**独立双盲验证机制**、**因果可演化记忆库（Evolvable Memory Bank）**以及**自动化自探索与深度练习工作流**，让 Agent 在实际工程任务中“越用越聪明”。

---

## 核心机制与架构映射

| RSIAgent 论文核心机制 | DSH 插件实现 (`dsh-rsi`) | 作用与价值 |
| :--- | :--- | :--- |
| **Epistemic Core (E1-E6)** | `dsh-rsi:epistemic-core` Prompt Section | 硬编码认识论准则：以真实环境探针为准，严禁凭空猜测，错误信息即因果数据。 |
| **Double-Blind Verifier** | `rsi_verify` 工具 + Subagent 独立无历史会话 | 隔绝 Actor 的私有思考与记忆，通过只读探针独立验证交付物是否真正达标。 |
| **Memory Distillation** | `rsi_distill_memory` 工具 | 任务完成后提炼“条件-动作-避坑因果对”，而非流水账式记录。 |
| **Memory Reconciliation** | `rsi_reconcile_memory` 工具 | 新经验入库时自动比对旧规则，消除直接矛盾，标注废弃规则，防止记忆污染。 |
| **Durable Memory Bank** | `~/.dsh/storages/rsi/` 与 `<workspace>/.rsi/` | 支持全局跨项目沉淀与项目本地沉淀，带 SHA-256 Tree Hash 完整性校验。 |
| **Phase 1 Broad Exploration** | `rsi_explore` 工具 + DSH `workflow` API | 新环境/仓库并行波次探索（Survey ➔ Deep Probes ➔ 双盲复核入库）。 |
| **Phase 2 Deep Practice** | `rsi_practice` 工具 + 失败驱动状态机 | 困难任务闭环状态机（FAIL ➔ Distill ➔ Practice ➔ Retry），试验验证后重试。 |

---

## 项目结构

```text
dsh-rsi/
├── bin/
│   └── rsi.mjs                  # CLI 命令行工具 (status, list, query, verify, prompt, explore, practice)
├── lib/
│   ├── index.js                 # DSH / Cordis 插件入口 (apply / applyComponent)
│   ├── components/              # 4 大模块化子组件 (DSH 规范)
│   │   ├── verifier/            # 独立双盲验证器组件
│   │   ├── memory/              # 可演化持久记忆库组件
│   │   ├── epistemic/           # 认识论真理信道组件
│   │   └── explorer/            # 递归自探索与练习组件 (Phase 1 & Phase 2)
│   ├── core/
│   │   ├── epistemic.js         # E1-E6 认识论准则定义与 Prompt 格式化
│   │   ├── verifier.js          # 独立双盲验证器 (只读探针、防破坏过滤、Doubt 裁决)
│   │   ├── memory.js            # 记忆库管理 (CRUD、Tree SHA-256、格式化、同步清单读取)
│   │   ├── distillation.js      # 经验因果提炼 (Distillation Prompt & Parser)
│   │   ├── reconciliation.js    # 全局记忆冲突检测与对齐 (Reconciliation)
│   │   ├── exploration.js       # Phase 1 并行波次探索工作流与独立审计
│   │   └── practice.js          # Phase 2 失败驱动迭代状态机与刻意练习
│   └── tools/
│       └── definitions.js       # 6 大 DSH 工具契约与 JSON Schema 参数与输出声明
├── tests/                       # 原生测试套件 (node --test)
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
│   └── ARCHITECTURE.md          # 详细系统架构设计说明
├── package.json
├── cordis.patch.yml             # Cordis 组件装配清单
└── dsh-plugin.json              # DSH 插件规范 Manifest (v0.15)
```

---

## 快速上手

### 1. 独立 CLI 体验与测试

可以直接在终端使用 `rsi` 工具操作记忆库与验证流程：

```bash
# 1. 查看记忆库状态与 Tree SHA-256
node bin/rsi.mjs status

# 2. 检查注入的认识论准则与记忆清单
node bin/rsi.mjs prompt

# 3. 生成独立双盲验证器的 Audit Prompt
node bin/rsi.mjs verify "实现一个支持超时与重试的 HTTP 请求函数"

# 4. 检索已有因果规则
node bin/rsi.mjs query "git"

# 5. 生成 Phase 1 仓库并行自探索工作流请求 JSON
node bin/rsi.mjs explore

# 6. 生成 Phase 2 失败驱动重试练习工作流请求 JSON
node bin/rsi.mjs practice "修复在 Node 20 下间歇性超时的网络请求测试"
```

### 2. 运行单元测试套件

本项目采用 Node 20 原生测试运行器，零额外测试框架依赖：

```bash
npm test
```

**测试结果（26 个单元与端到端测试全数通过）：**
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
# tests 26 | pass 26 | fail 0
```

---

## 配置为 DeepSeek Harness 插件

在 DSH 的配置目录（如 `~/.dsh/profiles/desktop/cordis.patch.yml`）中添加组件配置：

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

在 `package.json` 中配置本地依赖或软链接：
```json
{
  "dependencies": {
    "dsh-rsi": "file:/Users/juheng/Documents/AgentProjects/dsh-rsi"
  }
}
```

---

## 注册的 6 大 DSH Tools 说明

1. **`rsi_verify`**（独立双盲验证）：
   - 对任务交付物执行只读独立探针（通过启发式正则拦截常见文件增删改、重定向、代码执行与包管理变更等，并配合宿主沙箱进行纵深防御）；
   - 贯彻 **Doubt Invariant**：报告中若未包含明确的 DOUBTS 段落（E4 沉默不代表没有），或包含未消除疑问，即使标记为 PASS 也强制降级为 FAIL。
2. **`rsi_distill_memory`**（因果经验提炼）：
   - 任务终态触发，提取前置条件、有效规程、踩坑机理三元组因果知识，结构化入库。
3. **`rsi_reconcile_memory`**（全局记忆对齐）：
   - 跨语料检测冲突与版本演进：同主题规程演进（同标题不同规程）或跨规则反义极性矛盾时自动将旧规则标记为 `SUPERSEDED`（无矛盾重叠作为 `related_topic` 保留），同时维护原始存储作用域。
4. **`rsi_query_memory`**（检索持久记忆）：
   - 支持关键词、分类与标签检索，Agent 在任务启动时按需调阅避坑指南。
5. **`rsi_explore`**（Phase 1 并行波次自探索）：
   - 针对新环境与新仓库，通过 `agentPresets.serviceFor(agent, 'workflowEngine')` 穿透 Cordis delegation 组隔离调度并行 Subagent（构建、测试、工具链、规范、踩坑点）；
   - 第二波次针对第一波次提出的疑问进行深度探针，所有候选经验均经独立 Verifier 审计，仅双盲通过的规则才会入库；
   - *环境提示*：若当前会话 preset 禁用了 workflow 引擎（如默认 standard 桌面预设禁用），工具将返回结构化工作流编排脚本与指引，执行后通过 `workflow_result` 提交入库。
6. **`rsi_practice`**（Phase 2 失败驱动深度迭代）：
   - 驱动困难任务跑通 `FAIL ➔ Distill ➔ Practice ➔ Retry` 状态机；
   - 每次失败后提炼假设，并在独立隔离环境中进行刻意练习（Practice）验证修正规程，再携新知识重试。

---

## 演进达成情况 (Roadmap)

- [x] **MVP 阶段**：Epistemic Core 注入、独立双盲 Verifier、持久化 Memory Bank、因果提炼与记忆对齐。
- [x] **DSH 组件化规范适配**：4 大独立子组件包结构、专属图标、多语言本地化配置。
- [x] **全流程部署指南与架构文档**：开发软链接、离线打包及宿主契约深度测试支持。
- [x] **Phase 1 工作流**：基于 DSH `workflow` API 实现新仓库并行波次探索（Broad Recursive Self-exploration）。
- [x] **Phase 2 自动化循环**：实现针对特定难点任务的失败驱动迭代（Deep Recursive Self-exploration），全自动跑通 `FAIL -> Distill -> Practice -> Retry` 状态机。

---

## 许可证

本项目依据 [Apache License 2.0](LICENSE) 开源。
