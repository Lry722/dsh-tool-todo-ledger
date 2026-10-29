# dsh-tool-todo-ledger 设计方案

## 背景与目标

原版 `dsh-tool-todo` 的 `todo_write` 采用全量覆写机制。长程任务中，模型需要反复提交完整任务列表，不仅产生冗余上下文，也会在覆写后丢失任务规划和执行状态的变化过程，降低历史记录的可读性。

本项目将任务列表改为增量维护的 ledger，并增加显式的状态流转与执行上报机制，目标是：

- 减少全量覆写带来的重复输入；
- 保留完成、重排、作废和目标切换的历史，使执行过程更容易阅读和验收；
- 通过清晰规划和状态约束减少偏航、重复探索与无效返工；
- 通过局部问题的显式闭环，避免在处理任务时不断嵌套新问题、持续钻牛角尖。

上下文收益不只来自减少任务列表的传输量，也来自减少偏航和返工。todo 是对会话历史的结构化补充，其他工具的调用记录、执行结果和验证信息仍由会话日志保存。

## 核心机制

- **前置审查**：`todo_write` 执行时，由独立无状态模型依据 DSH 当前生效的 `AGENTS.md` 指令审查待写入内容。审查完成后才继续本次写入，违规则返回明确提示。
- **增量维护**：已完成任务只增不删，历史记录只读不可变。未开始或尚未完成的任务允许通过显式重排进行替换或作废。
- **显式流转**：通过 `todo_start` / `todo_finish` 推进任务，不允许静默跳过任务。目标确实变化时，通过 `todo_write` 重排当前规划。
- **执行上报**：执行具体动作的 step 同时调用 `todo_report`，声明当前目标、是否偏离及局部问题状态。
- **两层任务结构**：任务树最大深度为 2，即“顶层任务 → 局部问题”。局部问题必须闭环后才能正常切回顶层任务，新的派生问题不得继续向下嵌套。

## 基本概念

### 当前规划与历史记录

**当前规划**是最新一次 `todo_write` 后生效的任务顺序，用于解释后续的 `todo_start`、`todo_finish` 和 `todo_report`。

**历史记录**保存历次追加、完成、重排、作废和上报形成的过程信息。重排当前规划时，历史记录保持不变。

### 序号的有效范围

`todo_write` 返回的序号只在**当前规划内**保证唯一，用于后续状态流转和上报。重排未完成任务后，后续节点的序号可以变化，调用结果必须返回新的序号与任务内容对应关系。

历史 report 记录当时的上报内容，后续重排仍按当时的内容解释任务归属，因此序号只在当前规划内有效，会随重排变化。

### step 与“并行调用”

本文中的 **step** 指一次 assistant step。

“并行调用 `todo_report`”指模型在同一个 assistant step 中，在发起其他动作的同时一并发起 `todo_report` 工具调用。它描述的是工具调用在同一次模型输出中的组织方式，工具在实际运行时可以串行执行。


最终回复不需要调用 `todo_report`。

## 工具设计

### 1. `todo_write`

用于追加或重排顶层任务。

#### 追加

不传起始序号时，追加一批未开始项。调用成功后返回新增项在当前规划中的序号及内容。

#### 重排

传入起始序号时，从该序号开始重排：保留所有已完成节点，将该位置及之后尚未完成的节点显式作废，并替换为新的规划内容。

重排是对旧规划的显式替换。被替换节点及其作废历史仍需保留。目标变化、任务阻塞或出现必须优先处理的新问题时，都通过重排表达，不额外引入“跳过任务”的语义。

`todo_write` 触发前置审查。审查复用 DSH 已有的指令加载和生效机制，插件不自行遍历、收集或合并 `AGENTS.md` 文件。

### 2. `todo_start` / `todo_finish`

显式流转顶层任务状态：

- `todo_start` 声明开始执行指定任务；
- `todo_finish` 声明指定任务已经完成；
- 前序任务未完成时，不允许开始后续任务；
- 当前存在未闭环的局部问题时，不允许完成或正常切换其所属顶层任务；
- 不再适用的未完成任务必须通过 `todo_write` 显式替换或作废，不能直接丢弃。

### 3. `todo_read`

提供两种读取视图：

- **默认模式**：从最后一条已完成的顶层任务开始，返回当前有效规划及当前局部问题，直到后续待办任务结束。默认视图不包含更早的完成项和作废历史，以控制上下文长度。尚无已完成任务时，从首项开始返回。
- **全量模式**：返回完整历史，包括完成项、作废项、重排记录和局部问题记录，供阶段复盘或最终验收使用。

这些历史与其他会话记录共同还原执行过程，todo 本身不承担复制所有工具结果的责任。

### 4. `todo_report`

除最终回复外，每个执行具体动作的 step 都必须在同一个 assistant step 中调用一次 `todo_report`，上报该批动作所属的目标和局部问题状态。

#### 必填参数

- **当前目标的序号**：
  整数值，按当前规划解释，声明本 step 的动作所属顶层任务。
  若与上一次上报的序号不同，视为目标切换。前序任务必须最晚在下一 step 通过 `todo_finish` 标记完成，否则后续上报报错。局部问题尚未闭环时，不允许通过该字段切换到其他顶层任务。
- **是否偏离目标**：
  bool 值，由模型根据自身元认知判断当前行为是否严重偏离目标，或采用的方法是否违反既定规范。
  正常前置准备、轻微偏离且预期可快速闭环时输出 `false`。需要进入独立局部问题处理时输出 `true`。

  该参数是**局部问题状态机的控制输入**，与当前状态共同决定本次 report 触发哪种转换，具体转换规则见“局部问题状态机”一节。

  因此，在局部问题进行中，`false` 的核心含义是“局部问题已完成、可以回到顶层任务”，而不只是“当前动作看起来没有偏离”。模型必须在局部问题实际闭环后才能输出 `false`。

该字段是对模型语义判断的显式利用。状态机负责约束上报后的闭环和切换行为，不试图用确定性规则替代模型对“偏离”的判断。局部问题的开启、持续和完成必须由该参数显式驱动，不能仅通过偏离理由是否存在来推断。

#### 选填参数

- **偏离理由**：
  字符串，只记录和说明局部问题的内容。开启局部问题时必须提供。继续处理同一局部问题时，可以补充或更新说明，也可以省略。状态切换只由 `deviated` 驱动。省略理由时，当前局部问题仍按本次 `deviated` 的取值继续处理或关闭。填写理由只是补充说明，任务层级保持不变。

## 局部问题状态机

每个顶层任务下最多存在一个进行中的局部问题，由此将任务树限制为两层。局部问题不通过嵌套 report 继续派生下一层。

| 当前状态 | 上报或操作 | 状态变化 |
| --- | --- | --- |
| 无进行中局部问题 | `deviated=false` | 继续当前顶层任务 |
| 无进行中局部问题 | `deviated=true` 并提供理由 | 开启一个局部问题，顶层任务序号保持不变 |
| 局部问题进行中 | 再次 `deviated=true` | 表示继续处理当前局部问题，不创建下一层 |
| 局部问题进行中 | `deviated=false` | 将当前局部问题标记为已完成，回到所属顶层任务 |
| 局部问题进行中 | 完成或切换顶层任务 | 拒绝，必须先闭环局部问题 |
| 局部问题进行中 | 出现需要独立处理的新派生问题 | 不继续嵌套，通过 `todo_write` 提升并重排 |

“提升并重排”是显式改变规划的特殊出口：将新问题插入当前顶层位置，原先尚未完成的节点按新规划顺延或替换，相关旧节点显式作废。它不等同于声称旧局部问题已经完成，也不构成静默跳过。

## 典型重排示例

假设当前规划为：

1. 已完成：确认需求
2. 进行中：实现 ledger
3. 未开始：补充测试
4. 未开始：更新文档

处理第 2 项时发现一个必须优先解决的新问题，则从序号 2 开始重排：

1. 已完成：确认需求（保留）
2. 未开始：解决新发现的问题
3. 未开始：继续实现 ledger
4. 未开始：补充测试
5. 未开始：更新文档

旧的第 2～4 项保留为已作废历史，新规划返回新的序号对应关系。之后的 `todo_start`、`todo_finish` 和 `todo_report` 均按新规划解释序号。旧 report 不需要跟随重排重新绑定序号。

## 实现边界

本文约定模型可见行为和状态语义，不限定具体的 session event 类型、存储格式、projection 结构或工具调度方式。实现可以复用 DSH 现有的日志、指令、模型调用和工具管线能力，只要满足以下结果：

- 当前规划与历史记录能够一致恢复；
- 完成项、作废项和重排过程不会因后续覆写而丢失；
- 序号始终按操作发生时的当前规划解释；
- 顶层任务与局部问题的状态约束得到执行；
- 默认读取保持精简，全量读取能够支持复盘与验收。

## 技术实现方案

以下方案基于当前安装的 DSH `0.2.1-rc.2` API 和官方插件实现。它是对上述语义的一套具体落地选择。后续升级 DSH 时，应先用 Inspect 重新核对 Service、Event 和会话格式，再调整实现。

### 官方实现调研结论

| 官方包 | 可复用的机制 | 本项目的取舍 |
| --- | --- | --- |
| `@deepseek-ai/dsh-tool-todo` | `defineTool`、 owning agent 校验、`sessionProjections`、结构化输出与简洁 model-facing render | 复用工具与投影模式；不复用整表快照，也不在 `turn/start` 清空规划 |
| `@deepseek-ai/dsh-agent-instructions` | AGENTS 基线和增量都以 `source.kind === "agent-instructions"` 的持久 `user/message` 进入可见会话；更新和移除也在同一消息序列中 | 审查直接读取当前 visible surface 中的有效指令消息，不重新遍历文件系统 |
| `@deepseek-ai/dsh-session-title-llm` 与 `dsh-session-title-first-prompt-llm` | `llm.prepareCall()`、路由覆盖与当前路由回退、超时、最低 reasoning effort、`BlockAssembler`、终止原因检查 | 用同类辅助调用实现独立无状态审查，但不复用 session-title 的专用事件和 `purpose` |
| `@deepseek-ai/dsh-experimental-auto-review` | 当前路由的独立审查、固定 JSON 协议、技术失败时 fail closed、按 `agent-instructions` 来源筛选项目约束 | 复用审查边界；不复制其带豁免的 deprecated `snapshotEvents()` 全日志扫描 |
| `@deepseek-ai/dsh-tools` 与 `dsh-agent-loop` | 默认 exclusive 工具形成调度屏障；工具结果按模型调用顺序提交；`output.presentationMeta` 进入持久 `tool/result.meta`；`tools.guard()` 提供同步、单调拒绝 | 以标准工具事件承载 ledger，以 guard 执行同 step 上报约束 |
| `@deepseek-ai/dsh-repeat-tool-reminder` | 工具管线观察与下一 step 上下文注入方式 | 本项目需要阻止违规动作而非事后提醒，因此不用 post-execute 提醒代替 guard |

关键差异是：官方 todo 能通过声明合并新增 `todo/write` 事件类型，第三方持久插件不应照搬。普通插件新增不可忽略 session event 类型会破坏旧 reader 和会话恢复。`appendPluginRecord()` 又是实验能力。因此本方案不新增事件类型，也不引入第二份外部状态库。

### 总体结构

插件保持命名导出 `name` / `inject` / `apply` / `Config`，不导出默认对象。必需的 Cordis 注入为：

```ts
inject = ["tools", "sessionProjections", "llm"]
```

建议拆分为以下模块：

- `index.ts`：注册 projection、五个工具和 guard；
- `types.ts`：持久 envelope、durable state、操作记录及 declaration merging；
- `projection.ts`：纯同步状态折叠与读取视图；
- `tools.ts`：参数校验、状态约束、完整 next-state 计算和输出；
- `review.ts`：有效 AGENTS 提取、独立模型调用与严格结果解析；
- `report-guard.ts`：同 assistant step 的 report 结构约束。

组合中应保留官方 `dsh-agent-instructions`，并禁用原版 `dsh-tool-todo`，避免 `todo_write` 重名。`agent-instructions` 不是 Cordis 硬依赖：没有它或没有 AGENTS 文件时，审查输入中可以没有工作区指令，但不能因此伪造审查结果。

### 持久化：标准 `tool/result` + 完整 post-change state

#### 模型侧增量，日志侧完整状态

`dsh-session-projection` 有一条负载性约定：状态事件必须携带完整 post-change state，不能只是裸 delta。因此本项目只在**模型调用参数**上使用增量。每次成功操作写入日志的，是包含全部当前规划和历史的完整持久状态。projection 可以直接采用该状态，回放不依赖重新执行审查、序号解析或 ID 分配。

完整状态只位于模型不可见的 `tool/result.meta`，不会抵消减少上下文的收益。代价是历史增长会带来日志存储放大。首版应测量该成本，不能在违反 whole-value rule 的前提下用裸增量“优化”。后续若 DSH 提供稳定的插件日志能力，再单独设计存储格式迁移。

#### 不在工具体内直接改状态

每个写工具按以下流程执行：

1. 校验 `exec.agent`，非 agent 调用直接失败；
2. 通过 `ctx.sessionProjections.stateOf(agent.session, "todoLedger")` 读取当前状态；
3. 写工具还必须能在 `activeStep` 中找到当前 root `callId`，拒绝没有原生 `tool/call` 日志的 direct dispatch；
4. 校验本次操作和状态约束；
5. 纯函数计算完整的 `nextDurableState`，其中追加一条规范化操作记录；
6. 返回该状态和供 `render` 使用的简短结果，由 `output.presentationMeta()` 把状态放入工具结果元数据。

工具体内只做校验和计算，状态的采用和写入交给 projection 和 agent loop。DSH 完成输出校验和 render 后，由 agent loop 追加标准 `tool/call` / `tool/result`。`tool/result.meta` 就是该操作的逻辑提交点。

若执行、审查、输出校验或调度失败，则只产生错误结果，ledger 不变。进程在结果提交前退出时，该操作同样不生效。恢复产生的 `TOOL_OUTCOME_UNKNOWN` 不得被当成成功操作自动重放。Session 持久化本身采用异步缓冲，因此这里的“提交”不等于独立 fsync 或跨崩溃 exactly-once 保证。

持久 envelope 建议为：

```ts
interface TodoLedgerMeta {
  source: "dsh-tool-todo-ledger"
  version: 1
  operationId: string
  revision: number
  state: DurableTodoLedgerState
}
```

`state` 是自包含的完整 post-change state，其最新操作记录必须包含审计所需的全部语义，而不是只保存模型原始序号：

- `operationId`（取当前原生 `callId`）、单调递增的 `revision`、操作类型与 `planRevision`；
- 新建任务内容；
- 插件分配的内部 `taskId` / `issueId`；
- 操作发生时解析出的目标 `taskId`、序号和任务内容快照；
- report 的 `deviated`、可选理由，以及局部问题转换结果；
- `todo_write` 成功时的审查回执：使用路由、纳入审查的指令消息 id 列表和审查结论。

内部稳定 `taskId` 只用于拼接不可变历史，不改变模型可见的“序号只在当前规划内有效”约定。历史 report 始终保存当时的序号与内容快照，后续重排不重新绑定它。

projection 只从 `message.isError !== true` 且 meta schema 匹配的原始 `tool/result` append 中采用完整 durable state。由当前 step 事件单独折叠出的临时 guard 状态另行保留。

`operationId` 使用原生 `callId`，`revision` 每次成功变更恰好加一。正常追加记录必须满足 `revision === current.revision + 1`。同 ID、同 revision 且 payload 完全相同的重复记录才可幂等忽略。同 ID 不同 payload 或 revision 断裂都显式报错。

compaction 需要特殊处理。`dsh-compaction-tool-result-pruner` 会把旧 `tool/result` 的完整 data 连同旧 meta 一起复制为更晚 seq 的 `surfaceOp.op === "replace"` 事件。此类 replacement 不得触发 ledger 状态采用或 record 追加，否则旧快照会回滚新状态。原始 append 仍保留在完整日志中。

无关的 durable 事件返回原 state 引用。无法识别的其他插件 meta 直接忽略。属于本插件但版本不支持、结构损坏或连续性校验失败的记录同样显式报错，不能静默跳过并产生看似正常、实际缺失的历史。

#### Projection state

状态使用 plain JSON，并设置独立的 `stateVersion`。建议至少包含：

```ts
interface DurableTodoLedgerState {
  revision: number
  lastOperationId: string | null
  planRevision: number
  currentTaskIds: string[]
  tasks: Record<string, TaskNode>
  activeTaskId: string | null
  openIssue: LocalIssue | null
  records: LedgerRecord[]
  lastReport: ReportSnapshot | null
}

interface TodoLedgerState extends DurableTodoLedgerState {
  activeStep: StepObservation | null
}
```

- `TaskNode.status`：`pending | in_progress | completed | cancelled`。当前规划只引用前三者，作废状态留在历史节点中。
- `LocalIssue.status`：`open | closed | cancelled`。`openIssue` 只指向当前唯一未闭环问题。
- `records` 是只追加的不可变操作记录。节点当前状态与记录一起保存在完整快照中，后续重排不改写旧记录。
- `activeStep` 只服务 report guard，在 `step/end` 清理，不进入 `todo_read` 历史视图。
- 跨 turn、恢复和 fork 都以同一日志前缀折叠。

### 工具契约与顺序约束

建议把参数保持在最小集合，状态只能由专用工具改变：

| 工具 | 参数 | 成功结果的模型可见内容 |
| --- | --- | --- |
| `todo_write` | `todos: string[]`；可选 `start: integer` | 新增项的当前序号与内容；重排时再返回被作废数量 |
| `todo_start` | `index: integer` | 已开始的序号与内容 |
| `todo_finish` | `index: integer` | 已完成的序号与内容 |
| `todo_report` | `index: integer`、`deviated: boolean`、可选 `reason: string` | 当前目标及局部问题转换结果 |
| `todo_read` | 可选 `mode`、`offset`、`limit` | 当前视图，或有界历史页及分页信息 |

具体校验规则：

- 所有序号均为从 1 开始的整数，并在执行时按当前规划解析。任务内容先 `trim()`，空内容拒绝，当前规划内重复内容拒绝。
- 追加时 `todos` 不得为空。重排时允许为空，以显式作废旧后缀而不补入新任务。
- 重排的 `start` 不得落在已完成前缀内。`start` 之前的节点保持原状态。从 `start` 开始的未完成节点全部记为 `cancelled`，新任务一律以 `pending` 插入。
- 若重排作废当前活动任务，其未闭环局部问题一并记为 `cancelled`，不能伪装成已完成。若活动任务位于保留前缀，其局部问题继续保留。
- `todo_start` 只能在没有活动任务时开始当前规划中的首个 `pending` 任务，且它之前的任务均已完成。重复开始、越过前序任务或同时保留多个 `in_progress` 都拒绝。
- `todo_finish` 只能完成当前活动任务，且不存在属于它的未闭环局部问题。
- `todo_report` 的目标必须是当前活动任务。目标切换的规范顺序是先 `todo_finish` 旧任务、再 `todo_start` 新任务、最后上报新序号。若同一 step 同时包含这些调用，也必须按此模型顺序排列。
- 开启局部问题时 `reason` 必填且非空。继续同一问题时不得创建新的派生问题。`deviated=false` 关闭当前问题后，`reason` 只能作为本次闭环说明，不得再开启下一层。

五个工具都不声明 `isConcurrencySafe`，即使用官方 `defineTool` 的默认 exclusive 调度。这样一个 ledger 调用的 `tool/result` 会在下一个调用开始前提交，避免两个执行体同时基于旧 state 生成 next state，也避免另写易出错的内存锁或乐观覆盖层。模型仍可在同一 assistant step 组织多个调用，是否并发由 DSH 调度决定。

`todo_read` 也保持 exclusive，保证它读到的是按模型顺序已提交的视图，而不是并行组中尚未提交的旧状态。

### 前置审查实现

#### 获取“当前生效”的 AGENTS

不要在 `review.ts` 中再次实现项目根发现、候选文件合并、预算截断或 watcher。按以下方式复用官方指令管线的持久结果：

1. 调用 `agent.session.deriveMessages()`，按当前 visible surface 和已注册 message projection 取得主模型实际可见的消息序列；
2. 只保留 `role === "user"`、`source.kind === "agent-instructions"` 且 `source.form === "instructions"` 的消息；
3. 遇到新的 `source.baseline === true` 完整基线时，只淘汰更早的 baseline 消息；所有非 baseline 的新增、更新和移除消息都保留，包括位于最新 baseline 之前的独立 delta；
4. 将保留消息按原 surface 顺序交给审查模型。审查 system prompt 明确说明新 baseline 只替代旧 baseline，不删除独立 delta，同路径后到的更新或移除覆盖先前内容。没有 baseline 时也原样保留现有 delta；
5. 保存这些消息的 `message.id`，作为本次审查回执的一部分。

这里读取的是当前请求的派生消息，来源限于模型当前可见的 surface，因此 compaction 后仍跟随模型当前实际可见的消息。尚未进入该 surface 的 inbox 更新不属于本次已生效上下文。

实现只依赖官方消息来源约定，通过 `agent-instructions` 来源的消息读取指令，不导入官方内部的文件发现函数。

这里的“当前生效”特指 **committed visible instruction chain**，不等于磁盘最新完整 AGENTS：官方预算本来就可能省略或截断内容，compaction 也可能用 checkpoint 替换指令节点。空链只说明本次可见指令输入为空，磁盘上仍可能有文件。

审查回执必须如实记录该输入，不能沿用旧指令或伪造完整链。若未来要求“磁盘完整指令必须全部审查”，需要独立的 instruction surface projection 和新的完整性语义，不能声称当前方案已经提供该保证。

#### 独立无状态调用

审查是一次新的辅助 LLM 请求，独立于主 agent 的 continuation，也不启动 subagent：

- `system` 只包含审查职责、输出协议，以及 baseline 替换和独立 delta 的顺序和优先级说明。AGENTS 是待评估依据，不得改写固定的审查职责和 JSON 输出协议。`source.kind` 只作上下文归因，不当作安全 provenance；
- `messages` 仅包含上述 AGENTS 消息，以及最后一条新的 user 消息。该条 user 消息用 JSON 封装待追加/重排内容、`start` 和必要的当前规划摘要，避免任务文本破坏结构边界；
- 审查调用不传入主会话对话、assistant 思考、工具结果、工具声明和 `purpose: "session-title"`；
- 路由优先使用成对配置的 `reviewProvider` / `reviewModel`，否则读取 `agent.session.requestContext()` 的当前精确路由；缺少路由时失败；
- 通过 `llm.prepareCall()` 解析模型能力和默认值，可参照官方标题调用选择最低可用 reasoning effort；
- 用与 `exec.signal` 联动的 deadline 限制总时长，用 `BlockAssembler` 收集响应。

建议配置项为 `reviewProvider`、`reviewModel`、`reviewTimeoutMs`、`reviewMaxInputBytes`、`reviewMaxOutputTokens`、`historyDefaultLimit`。provider 与 model 必须同时提供。输入字节数按实际指令消息和 JSON 请求整体计算，超限直接失败，不静默截断 AGENTS。

审查模型只能返回严格 JSON：

```json
{
  "allow": false,
  "violations": [
    { "rule": "被违反的指令或路径", "message": "具体修正建议" }
  ]
}
```

只接受 `finish.kind === "stop"`，拒绝 tool-calls、max-tokens、空文本、Markdown 围栏、未知字段和不符合约束的 JSON。`allow=true` 时 `violations` 必须为空。`allow=false` 时至少要有一条可操作的违规说明。

审查拒绝、超时、路由失败、调用失败、输出非法或输入超限都使本次 `todo_write` 失败，且不提交新状态。即“审查不可用则关闭写入”，不能降级为跳过审查。错误结果区分“审查拒绝”和“审查不可用”，前者返回有界违规列表，后者返回可操作诊断。

### 同 step 上报的执行约束

仅靠 `todo_report` 描述无法保证模型遵守，因此增加同步 `ctx.tools.guard()`。guard 不改变其他插件的 waterfall 决策，只在条件不满足时返回拒绝理由。它只对能通过当前原生 `tool/call` 映射到 assistant step 的模型调用套用此策略。没有该映射的程序化插件调用不误判为模型违规。写工具自身的 direct dispatch 拒绝规则单独生效。

projection 从现有事件派生 `activeStep`：

- `step/start`：记录 `(turn, step)` 和此刻是否已有未完成任务；
- `assistant/message`：读取该 step 的全部 `tool-call` block，计算计划中的 `todo_report` 数量；若本 step 包含可能创建任务的 `todo_write`，也将本 step 标记为需要上报；
- `tool/call`：建立 `callId -> (turn, step)` 映射；guard 被调用时，当前 call 已经追加了此事件；
- 成功的 ledger report 结果：记录该 step 已完成的上报；
- `step/end`：清理临时观察状态。

当 step 开始时已有未完成任务，或该 step 包含可能创建任务的 `todo_write` 时，非 todo 工具必须满足：其所属 assistant message 中恰好计划调用一次 `todo_report`。缺失或重复时，guard 在执行具体动作前拒绝。`todo_write` / `todo_start` / `todo_finish` / `todo_read` 豁免此结构检查，避免形成规划与闭环的死锁。`todo_report` 自身不豁免唯一性检查，计划数量大于一时每个重复 report 都在执行前被拒绝。

只包含 todo 工具且满足 report 唯一性的 step 合法，纯文本和最终回复不在 guard 的检查范围内。step 开始时没有未完成任务、也不创建新任务时不强制上报，使简单任务和规划前准备不受干扰。

上报要求由 step 开始时的状态和该 assistant message 的完整调用计划共同确定，并在整个 step 内保持不变，不能通过先调用 `todo_finish` 再执行未上报动作来绕过。

此检查保证的是“assistant 计划中恰好一次”，范围限于计划层面。report 最终执行失败时，已经执行的其他工具仍保持已执行状态。如果模型把无效 report 排在其他动作之后，前面的动作可能已经执行。因此，工具描述应建议将 report 放在同批调用前面，以尽早暴露错误。guard 和 report 状态机仍负责拒绝违规流转。不能用事后提醒冒充严格前置约束。

首版明确只支持 DSH 原生 Function Calling，组合应当只在非 PTC 场景中挂载本插件。PTC 的 `run_code` 子调用与 assistant tool-call 的结构不同，因此靠扫描代码文本推断不出未来是否会 report。直接 Node side effect 也会绕过工具 guard。更重要的是，PTC 内层结果写入 `tool/ptc-dispatch.meta` 且异步追加，下一内层调用可能读不到前一结果。

因此在 PTC 场景下，guard 必须直接拒绝 ledger 工具执行。具体做法是，任何带 `exec.parent` 的 ledger 子调用都直接拒绝。在完整支持 PTC 前，上述状态持久化和上报约束只在 Function Calling 场景下成立。

局部问题闭环还有一条时序约束。模型发出同一批工具调用时，还没有看到本批结果。因此声明问题已经闭环的依据，只能是已经执行并观察到结果的修复动作。尝试修复的 step 应继续 `deviated=true`。后续 step 观察到结果并确认闭环后，再发起 `deviated=false` 的 report。该 report 可以单独成为一个 step。后续合法调用若已经基于既有事实决定，也可以和该 report 放在同一个 step。

### 读取视图与上下文预算

- 默认 `mode="current"` 只返回最后一条已完成顶层任务起的当前有效规划、当前活动任务、未闭环局部问题及必要的最近 report 摘要，不返回作废记录。
- `mode="history"` 返回完整历史的分页视图。`offset` 从 0 开始，`limit` 使用 `historyDefaultLimit` 并设置硬上限。结果包含 `total` 和可选 `nextOffset`。因此“全量”指可逐页读取全部记录，不要求一次性把无界历史塞入上下文。
- 工具 `render` 输出简洁文本或紧凑 JSON。完整 durable state 只进入 meta，不复制到模型可见 content。`todo_read` 是唯一主动读取大段 ledger 历史的入口。
- 工具描述只说明各自行为和参数约束。同 step 上报规则集中放在 `todo_report` 描述中，不在其他四个工具和 system prompt 重复多份。

### 恢复、兼容与验证重点

#### 状态与回放测试

1. **reducer 测试**：追加、纯追加空数组、尾部重排、活动任务重排、局部问题作废、顺序 start/finish、目标切换和非法跳转。
2. **事件回放测试**：实时执行后的 state 与从 `tool/call` / `tool/result` 全量回放一致。失败结果、无关 meta 和 `turn/start` 不改变 ledger。重复 operationId 的冲突和 revision 断裂会显式失败。
3. **生命周期测试**：resume、fork（分别位于 call 和 result 前后）、compaction 后当前规划和完整历史一致。旧结果在新操作之后被 prune 时不会回滚或重复。恢复得到 unknown 结果时不推进 ledger。projection checkpoint 的 `stateVersion` 升级能触发回放。

#### 调度与 guard 测试

4. **调度测试**：多个同 step 调用按模型顺序提交。延迟或失败的前序调用要么完整提交，要么整体放弃。默认 exclusive 下读到的是上一个调用已提交的状态。
5. **guard 测试**：上报结构覆盖无 report、重复 report（包括排在普通动作之前）和 report-only。绕过尝试覆盖最终无工具回复、无活动规划，以及先 finish 后动作。审计边界覆盖 planned report 失败但动作已执行。
6. **PTC 测试**：确认带 `exec.parent` 的 ledger 子调用被直接拒绝。

#### 审查与容量测试

7. **审查测试**：只注入当前可见指令链。新 baseline 只替换旧 baseline，其前后的独立 delta 仍然保留。baseline 被 compaction 替换后，改用新的可见指令链。审查还要确认 pending inbox 不提前纳入，更新与移除的顺序正确。
8. **审查失败与路由测试**：拒绝、超时、非法 JSON 或超预算时均无写入。路由方面分别覆盖显式配置路由和回退到当前路由两种情况。
9. **模型体验与容量测试**：比较多步任务下新旧调用的累计输入 token。确认 meta 只写入模型不可见的 `tool/result.meta`，历史页的输出大小有明确上限。最后测量完整状态快照带来的日志体积放大。

推荐实现顺序是：先完成纯 reducer 与 meta 回放，再接入五个 exclusive 工具，然后增加 report guard，最后接入独立审查。这样每一步都能用确定性的会话日志测试验证，避免把状态机、模型审查和调度问题混在一起排查。
