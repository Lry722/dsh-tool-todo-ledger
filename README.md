# dsh-tool-todo-ledger

面向 DeepSeek Harness 的增量任务账本插件。它用追加、显式重排和状态流转替代官方 `todo_write` 的全量覆写，保留完成、作废、目标切换与局部任务上报的历史，减少长程任务中的重复输入和偏航。

## 功能

- `todo_write`：统一修改规划与任务状态，可在一次原子调用中依次完成旧任务、追加或重排规划、启动新任务；未完成任务只能通过重排显式作废。
- `todo_report`：每次执行动作时上报当前顶层目标，并可选进入第二层局部任务。漏报时，插件会在下一次模型请求前插入提示，要求补报。
- `todo_read`：默认返回精简视图；`full: true` 将完整状态与历史导出为临时 JSON 文件。
- 可选前置审查：追加或重排规划前按当前生效的 AGENTS.md 进行审查，仅给出警告，不阻塞写入；纯状态切换不触发审查。
- 任务 dock：在输入框上方展示当前规划与局部任务。

工具语义、状态机、持久化与 UI 行为等设计细节见 [DESIGN.md](DESIGN.md)。

## 安装与设置

本包是带 Host 与 Web Client 的 Cordis bundle。安装后，可在 **设置 → 常规 → 使用 AGENTS.md 审查任务规划** 中切换前置审查；也可直接配置：

```yaml
- id: todo-ledger
  name: dsh-tool-todo-ledger
  config:
    reviewEnabled: false
```

默认关闭，避免简单任务产生额外模型请求。开关通过实时配置立即生效，无需重载插件。

## 开发

无需构建，源码为原生 ESM，Client 使用 Harness 浏览器模块加载器。

```sh
npm run check
npm test
```

模块划分与实现说明见 [DESIGN.md](DESIGN.md)。
