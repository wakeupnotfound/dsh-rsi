---
name: rsi
slug: rsi
displayName: "RSIAgent: 递归自我改进与独立双盲验证"
version: 0.3.0
summary: "无需微调的 Agent 递归改进引擎：遵循认识论 E1-E6 信道准则，以独立双盲盲审杜绝假阳性欺骗（False-Done），将试错经验沉淀为可演化持久记忆。v0.3.0 新增单 Skill 独立闭环与 BM25F 检索。"
description: "无需微调的 Agent 递归改进引擎：遵循认识论 E1-E6 信道准则，以独立双盲盲审杜绝假阳性欺骗（False-Done），将试错经验沉淀为可演化持久记忆。v0.3.0 新增单文件 CLI 独立闭环与 BM25F 字段加权检索。"
license: Apache-2.0
homepage: "https://github.com/wakeupnotfound/dsh-rsi"
tags: [self-improvement, verification, double-blind, epistemic-core, memory-distillation, debugging, code-audit]
allowed-tools:
  - rsi_query_memory
  - rsi_verify
  - rsi_distill_memory
  - rsi_reconcile_memory
  - rsi_explore
  - rsi_practice
  - bash
  - ops_bash
  - read
  - write
  - edit
metadata:
  framework: RSIAgent
  paper: "arXiv:2609.15364"
  version: "0.3.0"
---

# RSIAgent 自进化执行协议

## The RSI Pipeline

```text
Task Ingestion
      ↓
[Phase 1] Context & Recall (经验召回：查询环境避坑与最佳实践)
      ↓
[Phase 2] Grounded Execution (认识论纪律 E1-E6：事实信道锚定)
      ↓
[Phase 3] Double-Blind Verification (独立双盲验证：客观探针与防伪回执)
      ↓
[Phase 4] Causal Distillation (因果提炼：前置条件 + 成功解法 + 避坑 + 证据)
      ↓
[Phase 5] Reconcile & Persist (调和冲突：更新跨会话记忆库)
```

---

## 0. 环境预检（Preflight，仅模式 B 需要）
1. **Node.js 自检**：执行 `node --version`，要求 >= 20.0.0。若不可用或版本过低，向用户明确报告“RSI 单 Skill 模式需要 Node.js >= 20”，并降级为**纯认识论规程模式**：仅遵循本文件 §2 的闭环原则与按需阅读 `references/`，跳过所有 CLI 调用（验证以宿主可用的测试命令直接执行并如实记录结果）。
2. **`<SKILL_DIR>` 自定位**：`<SKILL_DIR>` 是本 `SKILL.md` 所在目录的绝对路径。宿主在加载本技能时通常会显示其路径，直接使用即可；若无法确定，依次探测常见安装位置（如 `~/.claude/skills/rsi/`、当前项目的 `.claude/skills/rsi/`、`skills/rsi/`），仍无法确定时询问用户，**禁止臆造路径**。

## 1. 运行模式自检与调用路由（Dual-Mode Dispatch）
在完成 §0 预检后，检查当前环境可用工具：
- **模式 A（原生 Tool 模式）**：若环境中已注册 `rsi_verify`、`rsi_distill_memory`、`rsi_query_memory`、`rsi_explore`、`rsi_practice`（无论来自 DSH 插件还是 MCP Server），请直接调用对应原生工具。
- **模式 B（Standalone 单 Skill CLI 模式）**：若环境中无上述原生工具，必须通过 Bash/终端运行本技能目录内置的自包含脚本（`<SKILL_DIR>` 按 §0.2 确定）：
  1. **任务上下文与记忆召回**：`node "<SKILL_DIR>/scripts/rsi-cli.mjs" context --task "<当前任务简述>" --top-k 5`
  2. **仓库波次探索**：`node "<SKILL_DIR>/scripts/rsi-cli.mjs" explore --goal "<探索目标>"`
  3. **独立双盲验证**：`node "<SKILL_DIR>/scripts/rsi-cli.mjs" verify --target "<目标文件或模块>" --probe "<验证测试命令>"`
  4. **因果记忆提炼**：`node "<SKILL_DIR>/scripts/rsi-cli.mjs" distill --target "<与 verify 相同的目标>" --title "<规则标题>" --preconditions "<触发前提>" --rule "<已验证规则>" --evidence "<实证依据>"`（自动读取最近一次验证回执，校验签名与目标任务绑定）
  5. **失败刻意练习**：`node "<SKILL_DIR>/scripts/rsi-cli.mjs" practice --target "<目标>" --failure "<失败原因>" --probe "<验证命令>"`

## 2. 强制自进化闭环（Mandatory Epistemic Loop）
1. **先查后改（Query Before Act）**：动手修改代码前，必须先执行 `query` 或 `context`，检查 `.rsi/memory/` 中是否已有相关模块的踩坑规则。
2. **双盲验证（Double-Blind Verification, E2/E3）**：严禁仅凭代码静态阅读或主观推断宣称“修复完成”。交付前必须调用 `verify` 运行客观探针并获取 `verification_receipt`。
3. **遇错必练、破局必存（Phase 2 Loop, E4/E5）**：
   - 若 `verify` 返回 `FAIL`：**禁止立即盲目修改代码重试**。必须先按需阅读 `references/causal-distillation.md`，调用 `distill` 记录失败模式，并调用 `practice` 生成四步靶向练习计划。
   - 若解决非平凡问题后 `verify` 返回 `PASS`：必须调用 `distill` 将因果经验持久化至 `.rsi/memory/`。

## 3. 参考规范按需懒加载（Lazy-Loaded References）
为节约上下文窗口，**切勿一次性读取全部参考文件**，仅在触发对应场景时按需读取：
- 初次探索陌生大型代码库时 -> 读取 `references/exploration-and-practice.md`
- 构造双盲验证探针或遇白名单拦截时 -> 读取 `references/double-blind-verification.md`
- 需要执行 `distill` 提炼规则或消解冲突时 -> 读取 `references/causal-distillation.md`
- 出现认识论违规争议时 -> 读取 `references/epistemic-core.md`
