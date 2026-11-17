# dsh-tool-todo-ledger

面向 DeepSeek Harness 的增量任务账本插件。它用追加、显式重排和状态流转替代官方 `todo_write` 的全量覆写，保留完成、作废、目标切换与 issue 上报的历史，减少长程任务中的重复输入和偏航。

## 功能

- `todo_write`：统一修改规划与任务状态，可在一次原子调用中依次完成旧任务、追加或重排规划、启动新任务。每次调用后若没有进行中任务，自动启动第一个待处理任务。未完成任务只能通过重排显式作废。`finish` 前该 task 必须已有 `todo_report`（同一次回复中的 `todo_report` 也计入）；仅输出结论的收尾 task 首次 `finish` 会要求再次确认，前提失效时应用 `reorderFrom` 作废而不是 `finish`。
- `todo_report`：每次执行动作时上报当前顶层目标，并可选声明正在处理的具体 issue。`todo_report` 需与至少一个其他工具位于同一个 assistant message，位置和重复调用不受限制；单独调用会被拒绝，避免额外增加请求。`finish` 与 `todo_report` 的先后顺序不构成错误：同一次回复中排在 `finish` 之后的上报仍按该 task 的收尾上报写入账本。上报也可以引用同一次回复中随后 `todo_write` 才追加的新任务序号，工具会投影剩余写入并在写入落地后补记账本。当前没有进行中任务时动作工具会被拦截；但同一步中排在动作之后、可创建任务的首次 `todo_write` 会按 bootstrap 临时放行，下一 step 再校验账本。缺失上报会先消耗有限豁免预算并收到警告，预算耗尽后由工具 guard 拦截；已存在但未成功记录的上报只消耗豁免预算，持续失败最终会触发拦截。PTC 模式下按 `run_code` 程序聚合：外层程序放行，子调用逐项校验，空账本可在程序内先建任务；程序结束未上报时消耗预算，耗尽后要求下一个程序先调用 `todo_report`。连续上报同一 active issue 名称时会收到一次提醒，告知省略 `issue` 内容；上报本身不受影响。工具结果会按配置的提醒间隔（默认约一分钟）附带一次当前进行中的 task 的 `content`；若该 task 有 active issue，同时附带 `issue` 名称。这些提醒用于检查是否该切换目标。
- `todo_read`：默认返回精简视图。`full: true` 将完整状态与历史导出为临时 JSON 文件。
- 任务 dock：仅展示本轮工作集、完成/待办摘要与当前 issue。新 turn 没有本轮工作时自动隐藏。
- 右侧“任务”标签页：按 turn 查看工作集历史，支持精确 turn 导航、轮末状态、作废标记和按任务聚合的 issue 摘要。

工具语义、状态机、持久化与 UI 行为等设计细节见 [DESIGN.md](DESIGN.md)。

## 配置

- `reminderIntervalMs`：`todo_report` 周期性提醒当前任务与 active issue 的间隔，单位毫秒，默认 `60000`；设为 `0` 关闭提醒。该字段为 volatile；在 Plugins 页打开本插件即可直接修改，无需重启。

## 安装

本包是带 Host 与 Web Client 的 Cordis bundle，安装后即可使用。

## 开发

无需构建，源码为原生 ESM，Client 使用 Harness 浏览器模块加载器。

```sh
npm run check
npm test
```

模块划分与实现说明见 [DESIGN.md](DESIGN.md)。
