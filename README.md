# dsh-tool-todo-ledger

面向 DeepSeek Harness 的增量任务账本插件。它用追加、显式重排和状态流转替代官方 `todo_write` 的全量覆写，并保留完成、作废、目标切换与局部任务上报的历史。

## 功能

- `todo_write`：追加顶层任务。传入 `start` 时，从该位置起作废未完成任务并追加新规划。空数组可以只用来作废任务，不追加新规划。
- `todo_start` / `todo_finish`：按当前序号显式启动和完成任务。前序任务未完成时不能启动后续任务。
- `todo_report`：上报当前顶层目标和可选局部任务。局部任务只作为第二层记录，不再向下嵌套。
- `todo_read`：默认返回从最后完成项开始的精简视图。`full: true` 将完整状态与历史事件导出到临时 JSON 文件。
- 可选前置审查：每次 `todo_write` 前，由当前 Agent 的模型以独立、无状态请求审查当前生效的 AGENTS.md 指令。发现违例时返回警告但继续写入；审查技术失败时不向主会话报告，写入也照常继续。

所有任务初始均为 `pending`。序号从 1 开始，且只在当前规划内有效。

## 安装与设置

本包是带 Host 与 Web Client 的 Cordis bundle。安装后，在 **设置 → 常规 → 使用 AGENTS.md 审查任务规划** 中切换前置审查。

对应插件配置：

```yaml
- id: todo-ledger
  name: dsh-tool-todo-ledger
  config:
    reviewEnabled: false
```

默认关闭审查，避免简单任务产生额外模型请求。开关通过实时配置立即生效，无需重载插件。

## 审查机制

启用后，审查走当前会话的模型路由，只把当前 surface 中来源为 `agent-instructions` 的内容纳入审查上下文。

## 工具示例

```json
{"todos":["确认需求","实现 ledger","补充测试"]}
```

从第 2 项重排：

```json
{"start":2,"todos":["查询 DSH API","继续实现 ledger","补充测试","更新文档"]}
```

上报局部任务：

```json
{"index":2,"inLocalTask":true,"localTask":"查询官方插件实现"}
```

导出完整历史：

```json
{"full":true}
```

返回 `path` 和 `eventCount`。JSON 文档包含格式版本、Session ID、导出时间、完整投影状态及所有 `todo/write` 历史事件。

## 持久化兼容性

插件复用已知的 `todo/write` Session 事件：

- `todos` 保留当前有效规划的兼容快照，旧版读取方仍可读取。
- `ledger` 保存增量操作，包括追加、重排、启动、完成和上报。每个任务节点都带内部稳定 ID，用于历史回放。重排保留旧节点及其中记录的上报内容。
- `todoLedger` Host projection 从事件日志重建状态，并以该日志为唯一事实源。
- 安装前的官方全量 `todo/write` 事件可作为旧版快照回放。

## 任务 dock

输入框上方的任务 dock 读取 `todoLedger` 的轻量 wire view。任务全部完成或开始新 turn 后，dock 仍会保留，仅当当前规划为空时隐藏。带启动定位信息的任务可点击，必要时加载历史并跳转到对应的 `todo_start` 工具卡片。

当前局部任务以 `↳` 分支显示。dock 折叠时，当前局部任务位于进度下方。dock 展开时，当前局部任务归属到当前顶层任务。

## 开发

无需构建，源码为原生 ESM，Client 使用 Harness 浏览器模块加载器。

```sh
npm run check
npm test
```

核心状态机位于 `src/ledger.js`，Cordis 工具与历史导出位于 `src/tools.js`，独立模型审查位于 `src/review.js`，Host 生命周期位于 `index.js`。模型提示词、审查请求模板以及工具与参数说明位于 `prompts/`，由 `src/prompts.js` 加载。
