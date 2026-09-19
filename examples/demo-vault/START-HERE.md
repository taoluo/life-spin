# LifeLoop Demo Vault

这个 Vault 生成于 **__TODAY__**，用于在隔离内容中边操作边学习 LifeLoop。它不包含 Apple
Reminder、Calendar event 或 Notes binding，`autoSync` 也保持关闭。

完整语义和命令参考见仓库中的 `docs/USER-GUIDE.md`。这里先走一条最短闭环：

> 捕获 → 整理 Inbox → 计划 → 选择 Now → 留下进展 → 找回 → 回顾

## 0. 开始前

1. 确认 VS Code 左侧出现 LifeLoop 的 Today、Projects 和 Inbox 视图。
2. 打开本文件，运行 **LifeLoop: Rebuild Index**。
3. 浏览 [Plans](Plans.md)、[Application Project](Projects/Application.md) 和
   [Alex](People/Alex.md)。普通 Wiki link、backlink 和 graph 由 Foam 提供。

所有写操作都只影响这份 Demo。要重置，关闭该文件夹，删除生成目录，再运行
`npm run demo:vault`。生成器发现同名目录时会拒绝覆盖。

## 1. 捕获，并返回原工作

1. 停在本页，运行 **LifeLoop: Capture**，输入“整理 Demo 学习笔记”。
2. 打开 [Inbox](Inbox.md)，确认新内容保存到了明确目标。
3. 回到本页，选中下一段引文中的一句，运行 **LifeLoop: Capture Selection with Source**。

> A useful system makes the next action easier to find without hiding its source.

预期：捕获成功后仍能回到原编辑位置；选区捕获记录来源，但来源位置不是永久写入凭据。

## 2. 连续处理 Inbox

运行 **LifeLoop: Process Inbox**，分别尝试 **Skip**、**Edit source** 和 **Make task**。Edit source
会回到原文并结束本次 picker；编辑后重新运行 Process Inbox 即可继续。

预期：一次操作后自然进入下一项；Make task 会把项目移到 `## Processed`，但 Processed 不等于
完成。取消或失败不会假装已经处理。

## 3. 计划今天或明天

运行 **LifeLoop: Plan Today**。在 [Plans](Plans.md) 中已经准备了 overdue deadline、due today、
scheduled today、past scheduled、Waiting、Someday 和两种 completed 示例。

依次试用：

1. Preview 一项，返回后确认原 scope 和选择仍在。
2. 对一个 Backlog 候选选择 **Schedule Today**。
3. 对另一个候选选择 **Set Now**，确认它没有同时写入 `scheduled`。
4. 打开本周 Focus；应进入 [Weekly Focus](Weekly/__WEEK_START__.md)，返回后仍在规划入口。

晚上可运行 **LifeLoop: Close Today and Plan Tomorrow**。它可以同时完成当天复盘和明日规划；
若今天是周日，明日 Focus 应属于 `__NEXT_WEEK_START__` 开始的新一周。

## 4. 执行、调整并留下下一步

从 Today 或任务来源运行 **LifeLoop: Task Actions**：

- 用 **Quick Reschedule** 改 `scheduled`；它不会改 deadline。
- 用 **Add Progress / Resume Cue** 留下做到哪里和下一步。
- 用 **Mark Waiting** 或 **Complete** 明确改变状态。
- 对 Waiting task 运行 **Waiting to Next Action**；Complete、Create next action、Schedule 和
  Clear Waiting 是四个独立意图。

预期：清除 direct Waiting/Someday 后若仍有 inherited 值，结果会解释实际有效状态。

## 5. 找回任务和项目背景

1. 运行 **LifeLoop: Find Task**，切换 Open、Completed、Waiting、Someday 和 All。
2. 输入关键词，Preview 一项，再 Open Source。
3. 运行 **LifeLoop: Return to Last Find**，确认查询、scope 和仍有效的选择被恢复。
4. 在 Projects 视图对 **Application** 运行 **Project Actions → Preview project context**。

预期：Project Preview 分开显示 Project 页面内任务和其他页面的 related tasks。来自
[Planning Meeting](Meetings/Planning.md) 的任务不会被误称为 Project-page member。你可以就地
Add Next Action、Pause 或 Leave Unchanged；后两种都不会自动处理子任务。

## 6. 人与互动

打开 [Alex](People/Alex.md)，再查看 Person Context。`Journal/__YESTERDAY__.md` 中有一条明确、
有日期的 Interaction；普通 mention 不会算作互动事实。可以在隔离内容中尝试 Log Interaction、
Create Reconnect Task 和 Meeting Wrap-up，每一步都可以跳过。

## 7. 每周回顾

1. 运行 **LifeLoop: Weekly Review**，由 [Review template](Templates/Review.md) 创建本周页面。
2. 运行 **LifeLoop: Review in Place**，切换 Open、Projects、Waiting、Someday、Completed、
   Unscheduled 和 Paused scopes。
3. 处理一项后确认 picker 保持当前查询并选择合理相邻项。
4. 运行 **Review Period Facts**；它只列出带可靠完成日期的任务和有日期的 Interaction。

Freeze Review 产生的是历史快照。快照用于查看和导航，不能直接充当以后的 mutation authority。

## 8. 编辑器与高级练习

- [Language Features Playground](Playground/Language Features.md)：completion、Hover、References、
  Symbols、Diagnostics、Code Actions、中文和 Foam completion 共存。
- [Advanced Queries](Advanced/README.md)：只读 query result、baking 和 X-Ray。

这两部分是可选练习。完成前七节已经覆盖最常用的日常闭环。
