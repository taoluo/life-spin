---
description: What is actually on your plate today.
tags: meta
---

${lifeloop.views.today()}

# About this page
Today is a projection. Nothing lives here: every line above is a task on its own page, rendered
through a reference, and ticking one writes straight back to where it really is. Nothing is
copied forward, nothing rolls over, there is no state to keep in sync.

The three sections are disjoint — a task appears at most once, in the most urgent bucket that
applies. Overdue and due-today come from `deadline`; the last section is what you planned to look
at today with `scheduled`.

The page is a shell around `lifeloop.views.today()`, which returns Markdown and knows nothing about
where it is displayed. Copy this page and call the same function if you want a different framing,
or call it from somewhere that is not a page at all.
