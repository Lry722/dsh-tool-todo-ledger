# dsh-tool-todo-ledger

面向 DeepSeek Harness 的增量任务账本插件。它用追加、显式重排和状态流转替代官方 `todo_write` 的全量覆写，保留完成、作废、目标切换与 issue 上报的历史，减少长程任务中的重复输入和偏航。

## 功能

- `todo_write`：统一修改规划与任务状态，可在一次原子调用中依次完成旧任务、追加或重排规划、启动新任务。每次调用后若没有进行中任务，自动启动第一个待处理任务。未完成任务只能通过重排显式作废。
- `todo_report`：每次执行动作时上报当前顶层目标，并可选声明正在处理的具体 issue。`todo_report` 必须与动作工具位于同一个 assistant message 并排在其前，且当前存在进行中任务；单独上报会被拒绝，提前在独立 message 中上报也不能覆盖后续动作。缺失上报会先消耗有限豁免预算并收到警告，预算耗尽后由工具 guard 拦截；重复、顺序错误、单独上报或没有进行中任务会立即拦截；已存在但未成功记录的上报只消耗豁免预算，持续失败最终会触发拦截。
- `todo_read`：默认返回精简视图。`full: true` 将完整状态与历史导出为临时 JSON 文件。
- 可选前置审查：追加或重排规划前按当前生效的 AGENTS.md 进行审查，仅给出警告，不阻塞写入。纯状态切换不触发审查。
- 任务 dock：仅展示本轮工作集、完成/待办摘要与当前 issue。新 turn 没有本轮工作时自动隐藏。
- 右侧“任务”标签页：查看完整当前规划及逐 turn 工作集历史，支持精确 turn 导航、轮末状态、作废标记和按任务聚合的 issue 摘要。

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
