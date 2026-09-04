---
command: "LifeLoop: Weekly Review"
description: This week's review — facts queried, judgement written
suggestedName: "${lifeloop.review.pageName()}"
confirmName: false
openIfExists: true
tags: meta/template/page
frontmatter: |
  tags: weekly-review
  week: ${lifeloop.week().key}
  weekStart: ${lifeloop.week().start}
  weekEnd: ${lifeloop.week().finish}
---
# ${lifeloop.week().key}
${lifeloop.week().start} → ${lifeloop.week().finish}

## Completed
${"$"}{lifeloop.review.completed()}

## Still open
${"$"}{lifeloop.review.stillOpen()}

## Active projects
${"$"}{lifeloop.review.activeProjects()}

## Waiting on
${"$"}{lifeloop.review.waiting()}

## Inbox
${"$"}{lifeloop.review.inbox()}

${"$"}{lifeloop.review.status()}

## Reflection

### What moved forward?
|^|

### What is stuck?

### What matters next week?
