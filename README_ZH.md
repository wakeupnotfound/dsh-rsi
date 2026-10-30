# RSIAgent for DeepSeek Harness (dsh-rsi)

面向 **DeepSeek Harness (DSH)** 的 **无需权重微调（Training-Free）** 递归自我改进（Recursive Self-Improvement, RSI）插件与运行引擎。

本项目基于学术论文 [**RSIAgent: Autonomous Exploration for Recursive Self-improvement in New Environments**](https://arxiv.org/abs/2609.15364)（Aether AI 联合 UCSD、UIC 发表于 2026 年）的核心理念，针对实际复杂桌面环境与代码开发工作流进行了实用工程化改造。

---

## 核心解决的问题

当前大模型驱动的 AI Agent 在复杂操作系统与代码库中作业时普遍面临三大瓶颈：
1. **假阳性自欺欺人（False-Done）**：Agent 自己写代码、自己验证，容易沿用自身错误的初始假设，宣布“假成功”。
2. **试错经验无法跨会话沉淀**：任务完成后 Context 一清空，踩过的坑与试出来的正确脚本全部丢失，下次遇到同样的问题依然重蹈覆辙。
3. **不可靠的经验固化（Scope Loss & Hallucination）**：模型容易将一次偶然的临时变通误当成通用准则，导致后续任务产生严重认知偏差。

**dsh-rsi** 保持大模型权重完全冻结（Frozen Weights），通过**独立双盲验证机制**与**因果可演化记忆库（Evolvable Memory Bank）**，让 Agent 在实际工程任务中“越用越聪明”。

---

## 核心机制与架构映射

| RSIAgent 论文核心机制 | DSH 插件实现 (`dsh-rsi`) | 作用与价值 |
| :--- | :--- | :--- |
| **Epistemic Core (E1-E6)** | `dsh-rsi:epistemic-core` Prompt Section | 硬编码认识论准则：以真实环境探针为准，严禁凭空猜测，错误信息即因果数据。 |
| **Double-Blind Verifier** | `rsi_verify` 工具 + Subagent 独立无历史会话 | 隔绝 Actor 的私有思考与记忆，通过只读探针独立验证交付物是否真正达标。 |
| **Memory Distillation** | `rsi_distill_memory` 工具 | 任务完成后提炼“条件-动作-避坑因果对”，而非流水账式记录。 |
| **Memory Reconciliation** | `rsi_reconcile_memory` 工具 | 新经验入库时自动比对旧规则，消除直接矛盾，标注废弃规则，防止记忆污染。 |
| **Durable Memory Bank** | `~/.dsh/storages/rsi/` 与 `<workspace>/.rsi/` | 支持全局跨项目沉淀与项目本地沉淀，带 SHA-256 Tree Hash 完整性校验。 |

---

## 项目结构

```text
dsh-rsi/
├── bin/
│   └── rsi.mjs                  # CLI 命令行工具 (status, list, query, verify, prompt)
├── lib/
│   ├── index.js                 # DSH / Cordis 插件入口 (apply)
│   ├── core/
│   │   ├── epistemic.js         # E1-E6 认识论准则定义与 Prompt 格式化
│   │   ├── verifier.js          # 独立双盲验证器 (只读探针、防破坏过滤、Doubt 裁决)
│   │   ├── memory.js            # 记忆库管理 (CRUD、Tree SHA-256、格式化)
│   │   ├── distillation.js      # 经验因果提炼 (Distillation Prompt & Parser)
│   │   └── reconciliation.js    # 全局记忆冲突检测与对齐 (Reconciliation)
│   └── tools/
│       └── definitions.js       # DSH 工具清单与 JSON Schema 参数契约
├── tests/                       # 原生测试套件 (node --test)
│   ├── epistemic.test.mjs
│   ├── memory.test.mjs
│   ├── verifier.test.mjs
│   ├── distillation.test.mjs
│   ├── reconciliation.test.mjs
│   └── plugin.test.mjs
├── docs/
│   └── ARCHITECTURE.md          # 详细系统架构设计说明
├── package.json
└── dsh-plugin.json              # DSH 插件规范 Manifest
```

---

## 快速上手

### 1. 独立 CLI 体验与测试

可以直接在终端使用 `rsi` 工具操作记忆库与验证流程：

```bash
# 查看记忆库状态与 Tree SHA-256
node bin/rsi.mjs status

# 检查注入的认识论准则与记忆清单
node bin/rsi.mjs prompt

# 生成独立双盲验证器的 Audit Prompt
node bin/rsi.mjs verify "实现一个支持超时与重试的 HTTP 请求函数"

# 检索已有因果规则
node bin/rsi.mjs query "git"
```

### 2. 运行单元测试套件

本项目采用 Node 20 原生测试运行器，零额外测试依赖：

```bash
npm test
```

输出：
```text
✔ MemoryDistiller prompt creation and entry parsing (6.4ms)
✔ Epistemic Core rules completeness (1.8ms)
✔ renderEpistemicSection includes all E1-E6 principles (0.1ms)
✔ renderMemoryPreamble formats empty and populated inventory (0.2ms)
✔ MemoryBank CRUD operations and tree hashing (10.7ms)
✔ DSH plugin lifecycle mounts prompt sections and tools (0.9ms)
✔ MemoryReconciler contradiction detection and resolution (10.4ms)
✔ VerifierRuntime probe safety checks (1.8ms)
✔ VerifierRuntime runProbe execution (8.8ms)
✔ VerifierRuntime parseReport handling and doubt enforcement (0.4ms)

ℹ tests 10 | pass 10 | fail 0
```

---

## 配置为 DeepSeek Harness 插件

在 DSH 的配置目录（如 `~/.dsh/profiles/desktop/cordis.patch.yml`）中添加本插件引用：

```yaml
- id: dsh-rsi-core
  name: "dsh-rsi"
  config:
    epistemicPromptOrder: 3100
    memoryPromptOrder: 3110
    probeTimeoutMs: 30000
    maxProbes: 10
```

在 `package.json` 中配置本地依赖或链接：
```json
{
  "dependencies": {
    "dsh-rsi": "file:/Users/juheng/Documents/AgentProjects/dsh-rsi"
  }
}
```

---

## 注册的 DSH Tools 说明

1. **`rsi_verify`**：
   - 接收任务诉求与交付物，运行只读探针（自动拦截任何潜在破坏性操作如 `rm -rf`, `git reset --hard` 等），生成双盲验收 Prompt。
2. **`rsi_distill_memory`**：
   - 在任务完成后，基于 Verifier 报告提取因果规程、前置条件与踩坑机理，格式化为 Markdown 写入持久化存储。
3. **`rsi_reconcile_memory`**：
   - 跨语料检测冲突，当新规则与旧规则矛盾时（例如命令参数变更或废弃），自动将旧规则标记为 `deprecated / superseded`。
4. **`rsi_query_memory`**：
   - 支持 Agent 关键词与标签检索已有记忆，随取随用。

---

## 后续演进计划 (Roadmap)

- [x] **MVP 阶段**：Epistemic Core 注入、独立双盲 Verifier、持久化 Memory Bank、因果提炼与记忆对齐。
- [ ] **Phase 1 工作流**：基于 DSH `workflow` API 实现新仓库并行波次探索（Broad Recursive Self-exploration）。
- [ ] **Phase 2 自动化循环**：实现针对特定难点任务的失败驱动迭代（Deep Recursive Self-exploration），全自动跑通 `FAIL -> Distill -> Practice -> Retry` 状态机。
