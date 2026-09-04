# LifeOS for SilverBullet

A Markdown-first life OS, built as a [SilverBullet](https://silverbullet.md) library — no plug,
no database, no format of its own. Your notes stay ordinary Markdown, tasks stay ordinary
checkboxes, and every view is a query.

    capture → context → task → today → done → weekly review

See [LifeOS.md](LifeOS.md) for what it does and how to use it, [DESIGN.md](DESIGN.md) for the
contract that outlives any particular scope, and [ROADMAP.md](ROADMAP.md) for what is built and
what is not.

A Markdown-first life OS, built as a [SilverBullet](https://silverbullet.md) library — no plug,
no database, no format of its own. Your notes stay ordinary Markdown, tasks stay ordinary
checkboxes, and every view is a query.

    capture → context → task → today → done → weekly review

See [LifeOS.md](LifeOS.md) for what it does and how to use it.

## Layout

The repository mirrors the paths the library takes in a space, so the manifest page and its
files line up with what `Library: Install` writes:

```
LifeOS.md              → Library/LifeOS      (the manifest: name, files, docs)
LifeOS/                → Library/LifeOS/     (everything the manifest lists)
```

## Development

Symlink both into a space instead of copying, so edits are live:

```bash
ln -s "$PWD/LifeOS.md"  ~/myspace/Library/LifeOS.md
ln -s "$PWD/LifeOS"     ~/myspace/Library/LifeOS
```

Space Lua reloads on save; run `System: Reload` if a definition seems stale.

## Testing

There is no build step. Verification runs against a real SilverBullet client: the object index,
Space Lua and queries all live in the client, so exercising this code means driving one. The
[Runtime API](https://silverbullet.md/Features/Runtime%20API) does that, and the `sb` CLI that
ships with the desktop app is its front end.

```bash
sb space add "$PWD/tmp/test_space"   # once
sb open tmp/test_space               # assigns the space a port

ln -s "$PWD/LifeOS.md" tmp/test_space/Library/LifeOS.md
ln -s "$PWD/LifeOS"    tmp/test_space/Library/LifeOS

bash test/verify.sh                  # 57 assertions, about 20 seconds
node test/luacheck.mjs               # parse every Lua block without a client
```

The whole suite is a single round trip: `test/suite.lua` runs every assertion inside the client
and returns the results. One CLI call per test cost about thirty seconds each, which made the
suite unusable at fifty of them.

Symlink rather than copy: a stale copy silently tests code you are no longer writing.
`test/verify.sh` reloads the client, waits for it to come back, resets its fixtures, and is safe
to re-run. Do not edit it while it is running — bash reads scripts lazily by byte offset.

The suite spends as much effort on what must *not* happen as on what must:

* a stale inbox item is left completely alone
* a task completed before LifeOS existed is never stamped with today's date
* a tick from a query view records nothing, because that event cannot say which task it was
* freezing a review twice is byte-for-byte identical, and a missing section aborts the whole thing
* a nested inbox item moves as an entire subtree or not at all

Without the desktop app, the same API is available from the Docker image, which bundles Chromium:

```bash
docker run --rm -p 3000:3000 -v "$PWD/tmp/test_space:/space" \
  ghcr.io/silverbulletmd/silverbullet:2.10.0-runtime-api
curl -s -d 'return lifeos.week("2026-09-03")' localhost:3000/.runtime/lua_script
```

Before a release, install the library for real — a fresh space, `Library: Install` pointed at the
manifest URL, reload, then walk the loop. Symlinked development never exercises the manifest, the
`files:` list, or their relative paths.

Installing from a *local* server needs one piece of scaffolding: Std registers a `net.readURI`
service for `https:` only, so add the `http:` equivalent to the throwaway space's `CONFIG`:

```lua
service.define {
  selector = "net.readURI:http:*",
  match = {},
  run = function(data) return net.proxyFetch(data.uri).body end
}
```

## Licence

MIT
