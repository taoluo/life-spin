---
description: What is coming up, day by day.
tags: meta
---

${lifeos.views.upcoming()}

# About this page
The next two weeks, one heading per day, from `deadline` and `scheduled` together. A task carrying
both appears once — under the day you planned to work on it, with the deadline shown alongside —
so nothing gets counted twice.

Tasks marked `#waiting` or `#someday` are left out here as they are on
[[Library/LifeOS/Pages/Today]]: this page is for deciding what to pull forward, and something you
cannot act on is not a candidate.

Change the horizon with `lifeos.upcomingDays`. Like the other projections this is a shell around
`lifeos.views.upcoming()`.
