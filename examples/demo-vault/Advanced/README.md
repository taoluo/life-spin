# Optional advanced exercises

## Read-only query result

把光标放在下面的 `lifeloop` block 中，观察 result-count CodeLens 和 Hover，然后运行
**LifeLoop: Open Query Result**。结果文档是只读的，不会进入 canonical index。

```lifeloop
today
```

```lifeloop
signals
project: Projects/Application
```

## Baking and X-Ray

对受支持的 query 试用 Bake、Update Baked Sections 和 Unbake。Baked Markdown 会成为普通来源，
因此不要让自定义输出无意生成 checkbox。**LifeLoop: Toggle X-Ray** 用于解释索引对象，不是日常视图。
