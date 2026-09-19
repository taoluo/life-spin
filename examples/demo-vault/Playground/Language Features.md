# Language Features Playground

## Managed task fields

- [ ] 中文输入和日期补全 [scheduled: "__TOMORROW__"]
- [ ] A deliberately long task title for checking completion ranges without damaging adjacent text

在第一条任务中，把整个 `scheduled` attribute 改成 `[sche`，然后分别尝试：

- 继续输入字段名；
- 用 Enter 接受 Today 或 Tomorrow；
- 用 Escape 取消；
- 确认插入的是候选显示的同一个绝对 ISO 日期。

接受 completion 只编辑 Markdown，不会完成任务、创建外部对象或写入历史事实。

## Navigation and explanation

Hover 上面的 task、日期或 [[Projects/Application]]；再试 Definition、References、Document Symbols
和 Task Actions。临时输入无效日期可观察 diagnostic 和 Code Action，然后 Undo 恢复。

## Foam coexistence

在下一行的 `[[` 后输入页面名，确认普通 Wiki link completion 仍由 Foam 提供：

Wiki target:
