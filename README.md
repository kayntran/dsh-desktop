# Harness Desktop

A Windows desktop app for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — install it, click the icon, start working. No terminal, no Node.js install.

🇻🇳 [Tiếng Việt](README.vi.md)

> **Not affiliated with DeepSeek.** This is an unofficial, community-built desktop
> shell. See [NOTICE.md](NOTICE.md).

## What it is

DeepSeek Harness (`dsh`) is an open-source agent harness. Out of the box you run
it by typing `npx @deepseek-ai/dsh web` in a terminal and opening a browser at
`http://127.0.0.1:3080`.

Harness Desktop removes that step. It is a thin Electron shell that starts the
same engine on a private loopback port and shows the same interface in a desktop
window. **It does not modify upstream in any way** — the engine ships unchanged
from npm, so every feature and every fix arrives with a version bump.

What the shell adds:

- **One app at a time.** Clicking the icon twice focuses the open window instead
  of starting a second engine that would corrupt your session history.
- **Close to tray.** The X button hides the window; the agent keeps working. Only
  *Quit* in the tray menu stops it.
- **Windows notifications** when the agent needs your approval, asks a question,
  finishes a turn, or fails — shown only while the window is not in front of you.
- **Remembers your window** position and size, and clamps it back on-screen if
  you unplug a monitor.
- **Cleans up after a hard kill** — verified by process identity, not just PID,
  so it can never kill an unrelated process that inherited the number.
- **Tells you about new releases** (it never installs them behind your back).

## Install

Download the latest `Harness Desktop-<version>-setup.exe` from
[Releases](../../releases) and run it. A `-portable.exe` is also published if you
prefer not to install.

The app is not code-signed, so Windows SmartScreen will warn on first run:
click **More info → Run anyway**. Signing requires a paid certificate.

Your data lives in `%USERPROFILE%\.dsh` — the same place the `dsh` CLI uses, so
the app and the CLI share sessions and settings. Uninstalling keeps that folder.

## Build from source

Requires Node.js ≥ 22.19 and Windows.

```sh
git clone <this repo>
cd harness-desktop
npm install             # shell tooling
npm run engine:install  # the dsh engine, into engine/node_modules
npm run runtime:install # the Node runtime the engine runs on, into runtime/
npm run icons           # generate icon.ico and tray images
npm run dev             # run it
npm run dist            # build installer + portable into release/
```

### Why the app ships its own `node.exe`

The engine does not run on Electron's Node. Electron builds V8 with the memory
cage enabled, so N-API cannot create external ArrayBuffers. `koffi` — which is
how upstream calls the Windows folder dialog — needs exactly that, and when it
is missing the process aborts (`FATAL ERROR: Error::New`) rather than throwing
something catchable. The dialog opened fine; picking a folder killed the worker,
and the UI reported *"win32 folder dialog worker exited before reporting a
result"*.

So `npm run runtime:install` downloads an official `node.exe` (~88 MB,
SHA256-verified against nodejs.org) into `runtime/`, and the engine is spawned
with that. Upstream spawns its own child processes via `process.execPath`, so
the whole engine tree inherits it. The binary is not committed; the version is
pinned in [`scripts/fetch-node.ps1`](scripts/fetch-node.ps1).

### Why `engine/` is a separate install

The dsh packages declare their real dependencies as `peerDependencies`.
electron-builder's dependency collector only walks `dependencies`, so packaging
the engine as a normal dependency silently dropped 214 packages and the app died
at startup with `ERR_MODULE_NOT_FOUND`. Installing the engine under its own
`engine/package.json` lets npm resolve the closure, and the packager just copies
the directory. Upgrading dsh means changing one version there and reinstalling.

### Before your first release

Set `REPOSITORY` in [`src/main/updates.ts`](src/main/updates.ts) to your
`owner/repo`. It ships empty, and while it is empty the update check is skipped
entirely — no network call, no error. Filling it in turns the feature on.

### Layout

| Path | What |
|---|---|
| `src/main/` | the whole shell — engine lifecycle, window, tray, notifier, updates |
| `resources/` | splash, error, and about pages; generated icons |
| `engine/` | the dsh engine's own dependency tree |
| `runtime/` | the downloaded `node.exe` the engine runs on (not committed) |
| `scripts/` | icon generation, the Node download, and the upstream-contract spikes |

### The spikes

`scripts/spike*.mjs` are not tests — they are probes against the real engine,
used to verify assumptions this shell depends on:

- `npm run spike` — the engine boots on the bundled runtime, serves the UI,
  answers RPC, and accepts a WebSocket downlink.
- `npm run spike:picker` — the native Win32 folder dialog opens **and returns a
  path**. It clicks the confirm button rather than cancelling, because only the
  confirm branch reads the result out of native memory, and that read is what
  broke on Electron's Node. A cancel-only probe passes on a build that is
  already broken.
- `npm run spike:frames` — prints the raw wire frames.

**Run all three after every `@deepseek-ai/dsh` upgrade.** Upstream states the RPC
protocol carries no version number and that client and host are released
together, so the notifier's frame handling is the part most likely to drift.

## Known limits

- **Windows only.** macOS and Linux are not built or tested.
- **Notifications cannot jump to a session.** Upstream's UI keeps session
  selection in memory with no per-session route, so clicking a notification opens
  the window but cannot select the session that raised it. Fixing this would
  require patching upstream, which this project deliberately does not do.
- **Updates are announced, not installed.** By design.
- **Upstream is a developer preview** and states there will be breaking changes.
  The engine version is pinned for that reason.

## License

MIT — see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
