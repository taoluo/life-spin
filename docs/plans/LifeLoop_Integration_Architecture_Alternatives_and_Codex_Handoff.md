# ADR: LifeLoop integration ownership and handoff

状态：Accepted direction；每项实现状态需独立验证。
基线：`0febfe2`。
上位范围：[`LifeLoop_Action_Loop_UX_Consolidated_Addendum_v2.md`](./LifeLoop_Action_Loop_UX_Consolidated_Addendum_v2.md)。

## 1. Decision

LifeLoop 不成为通用 PKM、外部对象数据库或 provider/router 平台。选择最小 ownership 模型：

| Domain | Durable authority | LifeLoop responsibility |
|---|---|---|
| Tasks、Projects、People、Interaction、Progress/Cue | Markdown | 派生语义、`SourceHandle`、guarded mutation、action/review loop |
| 通用文件、Wiki links、backlinks、graph、search、templates、editor behavior | VS Code / Foam | 只复用，不复制 |
| Reminder 通知与 recurrence | Apple Reminders | 显式 binding、受限 reconciliation、集中冲突入口 |
| Calendar interval、recurrence、attendee、原生编辑 | Apple Calendar | 显式 binding、受限 title sync；Agenda 仅在读取资格通过后加入 |
| Notes mobile pending capture | Apple Notes + pending Markdown copy | Process 前双边 reconciliation；Process 后转交 Markdown authority |
| SQLite projections、temporary result documents | 可删除重建 | 展示和定位；不成为 mutation truth |

每次写操作仍经过共享 semantic mutation API。Projection 只携带 opaque source identity；不能从展示文字、旧 offset 或活动编辑器光标猜 canonical source。

## 2. Integration modes

只保留实际存在的三种模式：

1. **Markdown semantic mutation**：LifeLoop 检查 identity、版本、dirty buffer 和业务前提后提交。
2. **External reconciliation**：正常单边变化自动传播；双方自 baseline 后都变化时保留 binding、暂停自动写入，在 LifeLoop 中 Resolve。
3. **Read-only federation**：读取外部 owner 的事实形成临时视图；不因此获得写入、participant 推断或 task mutation 权限。

不建设通用 adapter registry、event bus、queue、service、event store 或任意 provider framework。

### Object distinctions that must remain visible

| Case | Authority and behavior |
|---|---|
| External-native Reminder | Reminders owns title/state/date/recurrence；LifeLoop 可读取并发送已验证命令，不创建同等权威的 Markdown checkbox |
| Markdown task + reminder trigger | 两者是相关但不同的对象；处理提醒不完成任务，完成任务也不猜测触发器结果 |
| Legacy mirrored task | 继续执行已承诺的 limited reconciliation；除非单独迁移，不改成 external-owned 或 reference-only |
| Calendar event + task | Event interval 与 task commitment 分离；时间块结束不表示任务完成 |
| Notes pending capture | Process 前允许两边编辑并 reconciliation；Process 成功后 Markdown 才接管后续整理 |

不要默认把 title、完成 state、date 等字段分别交给不同 owner。优先按完整对象或语义上确实不同的子对象划分，避免 UI 拼接不同时间的碎片。

## 3. External conflict contract

External systems 可以暴露 divergence，LifeLoop 是唯一 conflict-resolution control plane。

- 正常单边修改直接同步并更新 baseline。
- 双边修改保留 binding 并暂停该对象自动同步。
- Notes 展示 text diff；Calendar/Reminders 展示已支持字段的 field diff。
- Resolver 只让用户选择 LifeLoop 或 External 版本，不做自动三方 merge、逐字段编辑器或 conflict marker。
- Apply 前重新读取并验证双方版本；成功后覆盖另一侧、更新 baseline 并恢复同步。
- 冲突、拒绝、missing object 和持久化失败进入持久 report，不只显示短暂状态栏消息。
- Detach 仅解除 binding，保留两边内容；它不是默认冲突处理。
- Recurring Reminder 保持特殊 completion/reopen 语义。

## 4. Sync state ownership

目标契约是：baseline、conflict 和 suspended binding 由所有 writer 可见的 durable shared state 持有；workspace state 只保存 UI 摘要。

当前事实较窄：

- 只有 VS Code manual/autoSync writer，二者共用同一入口；
- `0febfe2` 已串行更新 observation，并在安全决定、Resolve 和成功报告前等待 flush；
- workspace state 是持久的，但不是跨 CLI/host 的共享 authority；
- 没有已知静默覆盖路径，也没有获准的 CLI sync writer。

因此完整 shared authority migration 不是纯本地 UX 的前置条件。新增外部 writer、跨窗口/跨 host sync 或需要迁移既有 binding 时，再单独实施 durable store、旧状态迁移、provider/vault 隔离和单写者准入。legacy binding 不自动迁移。

`ObservationStore` 以后若换存储，失败表达和调用链必须一起迁移；不能只改成 JSON 后继续忽略写入结果。

Provider-owned 写入仍按 `fresh read → exact identity/scope validation → narrow write → authoritative reread` 执行。外部 API 没有 CAS 时，写前读取不能证明消除了 TOCTOU；无法安全表达的复杂修改回到 owner UI。Calendar/Reminder identifier 可能因同步、移动或重复实例而漂移，因此定位至少保留 provider/container/object/occurrence 语义；missing 或 ambiguous 时不按相似标题和时间猜测，也不自动重建外部对象。LifeLoop 只报告本机已确认的结果，不把一次 EventKit 读回描述为所有设备已经同步。

## 5. Notes ownership transfer

Notes pending 不是只读 snapshot：Process 前两边仍可能编辑，继续使用现有 baseline 和 reconciliation。

```text
Apple Note ↔ pending Inbox copy
              |
              | explicit Process succeeds
              v
       Markdown-owned result
```

Process 必须核对期间的新编辑、部分失败和迟到 sync。只有 Process 的 Markdown mutation 与相关 observation 持久化都满足当前契约后，才完成 ownership transfer。

## 6. Calendar read-only federation

Agenda 的 EventKit API 技术路径可行，但产品资格尚未合格：

- 无数据 JXA 探针可以创建 `EKEventStore`、范围 predicate，并读取内存事件的 start/end/all-day/timezone/recurrence；
- 当前 Calendar authorization status 是 `not determined`，没有请求权限或读取个人事件；
- 尚未验证 VS Code 发布扩展通过 `osascript` 使用 EventKit 时的 TCC 和 usage-description 归属；
- 现有 AppleScript bridge 只按 UID 读取一个命名 Calendar，不能代替 range/occurrence qualification。

因此近期不发布 Agenda。下一次 spike 先用隔离、可丢弃 Calendar 证明权限、多 Calendar、全天/跨日、DST、重复实例、空结果和失败状态；再决定 JXA 是否足够，或是否值得承担签名 native helper。

## 7. Derived document handoff

Query Result 与 Pre-meeting Brief 已迁移到 LifeLoop 专用 scheme/language 的只读 `TextDocumentContentProvider`：

- 内容只在内存，关闭后释放；
- 来源导航是只读能力；
- 不进入 vault 或 SQLite index；
- 不从生成行 mutation；
- 不预建 Brief/Review/Resolve 共用平台。

两条路径已通过 task-only 与 Foam 0.44.6 共存 gate。Review、Resolve 仍逐项决定是否复用，不因共享展示机制而改变各自 authority。

## 8. Consequences and deferred work

选择该方案的结果：

- 高频本地 UX 不等待完整 sync authority migration；
- 新 external writer 在共享 authority 和单写者准入完成前不得加入；
- legacy binding 保持原契约，不以升级为由自动重写；
- Calendar Agenda、existing-event association、native Reminders import 各自保留资格条件；
- complete/reopen 等本地入口若会触发 external effect，仍适用对应同步 gate。

继续 deferred：通用 Dashboard/Kanban/database builder、generic event store、provider/router、复杂 merge engine、跨 workspace authority 和自动 legacy migration。

本 ADR 收敛所选 ownership，不抹去先前方案：未选择的架构只在其触发条件出现时重新评估，旧 feature 与测试反例仍由 v2 和原始 action-loop 设计持有。改写前逐字文本保存在已校验的 non-normative recovery snapshot 中，不作为第二份活动规范。

实施与体验退出条件见 [`ux-first.md`](./ux-first.md)。
