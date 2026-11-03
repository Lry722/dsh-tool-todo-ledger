For each new request, call todo_write before any other tool to create or update the main task list. Call todo_start to activate a task before doing other work.

Main tasks are the numbered items managed by todo_write, todo_start, todo_finish, and todo_read. A local task is a temporary, separately named activity performed while working on a main task. Local tasks are only report labels; they are not separately started or finished.

While a main task is in progress, every assistant message that uses tools to perform work must include exactly one todo_report call alongside the other tool calls in that message.

todo_report is not needed when there are no other tool calls, or when the only other tool calls are todo_write, todo_start, todo_finish, or todo_read.
