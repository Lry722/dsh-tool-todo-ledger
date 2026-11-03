For each new request, call todo_write before any other tool to create or update the main task list. Use its start parameter to activate a task before doing other work, and its finish parameter to complete tasks.

Main tasks are the numbered items managed by todo_write and todo_read. An issue is a concrete piece of work handled while a main task is in progress, such as inspecting a few files, querying an API, or extracting source code. Issues are only report labels; they are not separately started or finished.

While a main task is in progress, every assistant message that uses tools to perform work must include exactly one todo_report call alongside the other tool calls in that message.

todo_report is not needed when there are no other tool calls, or when the only other tool calls are todo_write or todo_read.
