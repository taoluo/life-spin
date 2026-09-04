---
command: "LifeOS: Weekly Review"
description: This week's review — facts queried, judgement written
suggestedName: "${lifeos.review.pageName()}"
confirmName: false
openIfExists: true
tags: meta/template/page
frontmatter: |
  tags: weekly-review
  week: ${lifeos.week().key}
  weekStart: ${lifeos.week().start}
  weekEnd: ${lifeos.week().finish}
---
# ${lifeos.week().key}
${lifeos.week().start} → ${lifeos.week().finish}

## Completed
${"$"}{lifeos.review.completed()}

## Still open
${"$"}{lifeos.review.stillOpen()}

## Active projects
${"$"}{lifeos.review.activeProjects()}

## Waiting on
${"$"}{lifeos.review.waiting()}

## Inbox
${"$"}{lifeos.review.inbox()}

${"$"}{lifeos.review.status()}

## Reflection

### What moved forward?
|^|

### What is stuck?

### What matters next week?
