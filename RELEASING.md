# Packaging, installing and publishing

## The short version

```bash
npm run install-extension     # build → package → install into your VS Code
```

That is the whole loop for using it yourself. Everything below is detail for when you want to
hand it to someone else.

## Install it locally

```bash
npm run package               # build and package only; .vsix lands in dist/
npm run install-extension     # the same, then installs it
```

Then reload VS Code, open a folder of Markdown, and the LifeLoop view appears in the activity bar.

To remove it:

```bash
code --uninstall-extension lifeloop.lifeloop-vscode
```

**If the `code` command is not found**: in VS Code, Command Palette → *Shell Command: Install
'code' command in PATH*. Or install by hand: Extensions → `⋯` → *Install from VSIX…*

**If VS Code rejects its own flags** with `bad option: --install-extension`, something in your
environment exports `ELECTRON_RUN_AS_NODE=1` — any Electron-based parent process does, and it is
inherited. `scripts/install-extension.mjs` unsets it; if you are running `code` by hand, use
`env -u ELECTRON_RUN_AS_NODE code …`.

## Give it to someone else

The `.vsix` in `dist/` is a complete, self-contained extension — no marketplace account, no
publisher identity, nothing to sign. Send them the file:

```
Extensions → ⋯ → Install from VSIX…
```

It bundles everything: the semantic core, the Apple bridge, and SilverBullet's parser. There are
**no runtime dependencies to install**, because `node:sqlite` is built into the host. That is why
the extension needs VS Code 1.102 or newer, and why an older host gets a sentence explaining
exactly that rather than a stack trace.

## Publish to the Marketplace

Only needed if you want `code --install-extension lifeloop.lifeloop-vscode` to work for strangers.

**1. An Azure DevOps organisation and a publisher.** The Marketplace identity lives in Azure DevOps,
not GitHub. Create a publisher at <https://marketplace.visualstudio.com/manage>, then set its id in
`packages/vscode/package.json` — the `publisher` field must match, or publishing is rejected.

**2. A Personal Access Token.** In Azure DevOps → User settings → Personal access tokens. Scope it
to **Marketplace → Manage**, organisation "All accessible organisations". Treat it as a credential:
it can publish under your name.

```bash
npx vsce login <publisher>          # prompts for the PAT, stores it
npm run package
npx vsce publish --packagePath dist/lifeloop-vscode-0.1.0.vsix
```

Or in CI, without an interactive login:

```bash
VSCE_PAT=$TOKEN npx vsce publish --packagePath dist/lifeloop-*.vsix
```

**3. Open VSX, if you want VSCodium and Cursor users.** They do not use Microsoft's Marketplace.

```bash
npx ovsx publish dist/lifeloop-*.vsix -p $OPEN_VSX_TOKEN
```

## Before publishing anything

```bash
npm run verify                # typecheck, vendor integrity, schema pin, 525 tests
npm run test:integration      # 9 tests inside a real VS Code
```

`verify` includes two guards that matter more than the tests at release time:

* **`vendor:check`** — every vendored SilverBullet file still matches the pinned commit. Shipping a
  quietly edited parser is how the semantics diverge without anyone noticing.
* **`schema:check`** — the set of frontmatter keys and task attributes has not grown. If a release
  adds a field to everyone's Markdown, that is a decision someone should have made on purpose.

Then bump `version` in `packages/vscode/package.json`. The Marketplace refuses a version it has
already seen, and it cannot be replaced — only superseded.

## What ships, and what does not

`packages/vscode/.vscodeignore` keeps the package to what it needs:

```
dist/extension.js     the whole thing, bundled — 1.4 MB
package.json          commands, views, settings
readme.md             the Marketplace listing
resources/icon.png
LICENSE.md
```

No sources, no tests, no `node_modules`, no source maps. 362 KB compressed.

The bundle is large for an extension because it contains SilverBullet's Markdown parser and its Lua
grammar — the parser imports `luaLanguage` so that fenced Lua parses exactly as SilverBullet parses
it. That is the price of not reimplementing the semantics, and it is the right trade: the
alternative is a parser that agrees with upstream until it quietly does not.
