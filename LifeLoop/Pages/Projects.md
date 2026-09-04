---
description: Every active project, with how much is actually open on it.
tags: meta
---

${lifeloop.views.projects()}

# About this page
Open counts follow ownership, not mention: a task counts against a project when it is written on
the project's page, or when it names that project and no other. A task that compares two projects
belongs to neither and is counted by neither — it still shows up on both project pages through
SilverBullet's built-in Linked Tasks widget.

Like [[Library/LifeLoop/Pages/Today]], this is a shell around a view function —
`lifeloop.views.projects()` — that returns Markdown and knows nothing about where it is displayed.
