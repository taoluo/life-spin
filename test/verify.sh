#!/bin/bash
# LifeOS acceptance suite, run against a live SilverBullet client.
#
# The object index, Space Lua and queries all live in the client, so the only honest way to
# exercise this code is inside one. `sb` is the desktop app's CLI for the Runtime API.
#
# The whole suite is one round trip: test/suite.lua runs every assertion in the client and
# returns the results. Per-test CLI calls cost ~30s each and made the suite unusable.
set -u
SPACE=${SPACE:-test_space}
SB_BIN=${SB_BIN:-/usr/local/bin/sb}
HERE=$(cd "$(dirname "$0")" && pwd)

echo "reloading the client so edits are what gets tested"
"$SB_BIN" script -s "$SPACE" -t 120 'editor.invokeCommand("System: Reload")' > /dev/null 2>&1

# Wait for the reload to land rather than guessing at a sleep: a fixed delay is fine until the
# client also has to reindex a library file you just edited, and then the suite runs against
# half-loaded code and fails somewhere unrelated.
echo "waiting for the client to come back"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  ready=$("$SB_BIN" script -s "$SPACE" -t 60 --json '
    mq.awaitEmptyQueue("indexQueue")
    return { ready = type(lifeos.audit) == "table" and type(lifeos.tasks.toggleTag) == "function" }' 2>/dev/null)
  case "$ready" in *'"ready":true'*) break ;; esac
  sleep 2
done

echo "resetting fixtures"
"$SB_BIN" script -s "$SPACE" -t 120 '
space.writePage("Inbox", "Captured items land here.\n\n* investigate SilverBullet task recurrence\n* ask Jiulong about the decoder\n  * specifically the survivor case\n")
for _, name in ipairs({ lifeos.review.pageName(), "Scratch/Half Review", "Scratch/Bad",
     "Scratch/Ticking", "Scratch/Ticking Remote", "Scratch/Reopening",
     "Inbox/2020-01-01/09-00-00", "Notes/Taken", "Notes/Promoted",
     "Scratch/Destination", "Scratch/Occupied", "Scratch/Lifecycle", "Scratch/Plain",
     "Scratch/AllWaiting", "Scratch/Mixed", "Scratch/Paused", "Scratch/DeadlineSoon",
     "Scratch/BadProject", "Archive/Inbox", "Scratch/Not A Review", "Scratch/Old Review",
     "Scratch/Probe" }) do
  if space.pageExists(name) then space.deletePage(name) end
end
mq.awaitEmptyQueue("indexQueue")
return "reset"' > /dev/null 2>&1

echo "running suite"
"$SB_BIN" script -s "$SPACE" -t 300 --json --file "$HERE/suite.lua" | python3 -c '
import json, sys
raw = sys.stdin.read().strip()
try:
    results = json.loads(raw)
except Exception:
    print(raw[:2000]); sys.exit(1)
if not isinstance(results, list):
    print("unexpected result: " + json.dumps(results)[:2000]); sys.exit(1)

section, passed, failed = None, 0, 0
for r in results:
    if r.get("section") != section:
        section = r.get("section")
        print("== " + str(section))
    if r.get("ok"):
        print("  PASS  " + r["name"]); passed += 1
    else:
        print("  FAIL  " + r["name"]); failed += 1
        detail = r.get("detail")
        text = detail if isinstance(detail, str) else json.dumps(detail)
        for line in (text or "")[:600].split("\n"):
            print("        " + line)
print()
print("passed: %d   failed: %d" % (passed, failed))
sys.exit(1 if failed else 0)
'
