# Casys Digital Thread Desktop

This package is the Deno Desktop shell implemented through Lot 3. It contains one native
system WebView plus two dedicated compiled Deno helpers: the existing control plane and
a read-only Workbench BFF. They are separate privilege and lifecycle processes, not a
second authority model or language stack, and the bundle contains no general Deno CLI.

The Workbench reuses the existing Preact/Vite product UI and the existing GET/SSE BFF.
Chat Host remains a separate later component. The Desktop renderer is still
presentation-only. That web UI, the Deno BFF, its loopback proxy contract, and the
helper lifecycle are OS-independent product layers. macOS is the first distribution
proved by the current packager, not the product architecture boundary.

## Current behavior

- Product and Workbench `0.3.0`, Deno and Deno Desktop runtime `2.9.2`, and control
  plane server `0.2.0` are exact pins. The WebView engine remains OS-owned and is
  labelled that way in the manifest.
- Before any helper process is considered, Desktop validates the embedded manifest,
  observed Deno/Desktop/product versions, the selected finite platform
  application-support layout, product identifier, and the exact `active` + `sidecar`
  declarations.
- Runtime resolves helpers from `Deno.execPath()` plus one closed bundle layout selected
  by `DesktopPlatform`. There is no checkout helper, PATH lookup, ambiguous layout, or
  Deno CLI fallback. A missing helper or an inspect identity/digest mismatch remains a
  fail-closed startup result.
- Desktop passes the already validated layout profile through each helper's closed CLI
  grammar. The Workbench derives the existing control-plane and sibling lifecycle roots
  from that profile with native separators; neither renderer nor helper chooses a
  project root.
- The helper's read-only `inspect` mode supplies the exact embedded-asset digest,
  configuration state, lock, and marker. Desktop then either reconnects to an exact
  identity or starts one helper and waits for its bounded readiness handshake.
- Both helpers use exact inspect/start/reconnect ownership. A foreign, stale,
  mismatched, or ambiguous listener is never adopted, replaced, or killed. Shutdown
  closes only the child handle retained by the Desktop process; stdin EOF is the crash
  lifeline. On `SIGINT` or `SIGTERM`, Desktop drains the renderer and requests bounded
  owned-child cleanup through EOF, `SIGTERM`, then `SIGKILL` before explicitly exiting
  the native process. The moved-bundle E2E proves marker removal, port closure, and no
  owned orphan for the real packaged helper, including repeated signals. This is not a
  universal no-orphan guarantee: if child status remains unresolved after the final
  `SIGKILL` timeout, the host returns without proving the terminal child state.
- Control-plane readiness, engineering-provider health, and persisted evidence remain
  separate states. Providers may be `unavailable` without counts. Indexed or `demo` run
  records remain `candidate-unverified`; they are not promoted to verified Thread
  evidence.
- The renderer receives only closed lifecycle DTOs. It never receives a token, pid,
  launch id, digest, helper origin/path, storage path, provider credentials or process
  handle.
- When the Workbench helper is ready, the WebView root is the embedded Workbench. The
  Desktop host proxies only an exact path allowlist through `GET` and `HEAD`; SSE stays
  GET-only. It injects a host-only session capability and forwards only bounded `Accept`
  and `Last-Event-ID` headers. POST, MCP, lifecycle, health, command and unknown paths
  are rejected. If the helper is unavailable, the root remains the static diagnostics
  shell and Workbench API reads return a literal `unavailable` document.
- Project focus is the existing durable `primary` cockpit focus. With no focus, the
  read-only root lists sanitized persisted projects but provides no selection link or
  command. No hidden default, second project store, or second evidence authority exists.

## Runtime boundary

The Desktop host can read only `HOME`, `XDG_DATA_HOME`, `APPDATA`, and `LOCALAPPDATA`,
run only the two packaged helper basenames, and reach only `127.0.0.1:3020` and the
private Workbench BFF on `127.0.0.1:5176`. It receives no filesystem, FFI, or general
subprocess permission; runtime remote imports are denied.

The separately compiled helper receives read/write access only to the product root
below. In the currently proved macOS distribution it is resolved against the validated
`$HOME/Library/Application Support` launch directory:

```text
ai.casys.digital-thread
```

Its control-plane workspace is the fixed `ai.casys.digital-thread/control-plane`
subdirectory; the helper cannot traverse the rest of `HOME`.

Its network allowlist contains only the registered loopback control plane/provider
ports. Environment, subprocess, FFI, system, and remote-import permissions are denied.
It has no Docker permission and never searches a checkout or Compose root. The helper
uses the existing server composition and server-owned sequencing; Desktop does not gain
provider/tool/argument authority.

The Workbench helper is narrower. It can read only the existing
`ai.casys.digital-thread/control-plane` workspace and its separately owned
`ai.casys.digital-thread/workbench-runtime` lifecycle directory, write only that
lifecycle directory, and bind only `127.0.0.1:5176`. It has no environment, subprocess,
Docker, FFI, system or remote-import authority. Its private token is mode `0600`, bound
to the exact marker, retained only by the Desktop host, and removed by the owning helper
on shutdown.

These closed allowlists describe the packaged runtime binaries. The development
`deno task test` and `deno task sidecar:test` harnesses currently use unscoped
`--allow-read --allow-write` to exercise filesystem fixtures and generated artifacts.
Those test permissions are not embedded in the Desktop host or helper; narrowing them
remains test-harness hardening debt.

The workspace resolver treats platform layout as closed input data and its macOS,
Windows, and Linux contracts are covered by unit tests. Lot 3 currently packages and
launches the helpers only in the macOS distribution; later platform packagers must stage
the same portable web UI, BFF/proxy and least-privilege helper contracts under their
native application-support roots:

| Platform | Product root                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------ |
| macOS    | `$HOME/Library/Application Support/ai.casys.digital-thread`                                      |
| Linux    | `$XDG_DATA_HOME/ai.casys.digital-thread`, otherwise `$HOME/.local/share/ai.casys.digital-thread` |
| Windows  | `%LOCALAPPDATA%\\ai.casys.digital-thread`; roaming config under `%APPDATA%`                      |

The matching runtime bundle-path contracts are also closed and unit-tested. Only the
first row is produced and signature-verified by the current packager:

| Platform | Executable contract                                      | Helper contract                                       | Distribution proof |
| -------- | -------------------------------------------------------- | ----------------------------------------------------- | ------------------ |
| macOS    | `<root>.app/Contents/MacOS/<executable>`                 | `<root>.app/Contents/Helpers/<helper>`                | proved             |
| Linux    | `<prefix>/casys-digital-thread/bin/casys-digital-thread` | `<prefix>/casys-digital-thread/libexec/<helper>`      | not shipped        |
| Windows  | `<prefix>\\CasysDigitalThread\\CasysDigitalThread.exe`   | `<prefix>\\CasysDigitalThread\\Helpers\\<helper>.exe` | not shipped        |

The Windows and Linux rows are path contracts, not claims that a native package,
launcher, signature, or install flow has passed. Their future packagers must place the
exact artifacts there and compile the same closed sources with target-specific
filesystem and helper-executable grants; absent or non-conforming artifacts stay
unavailable.

## Commands

From this directory:

```sh
deno task verify
deno task workbench:test
deno task sidecar:test
deno task package
```

There is intentionally no checkout `dev` task. Production resolves only the nested
signed helpers from `Deno.execPath()`, and an HMR process cannot reproduce that bundle
topology without adding a second helper lookup or broader subprocess permission. Use the
packaged app for native runtime checks.

`package` builds the Vite Workbench, compiles both dedicated helpers, builds
`dist/CasysDigitalThread.app`, stages them under `Contents/Helpers`, and installs a
minimal native launcher as the bundle entrypoint. The launcher validates the unsymlinked
packaged runtime and helper, places the signed Helpers directory first on the initial
process `PATH`, then `exec`s the Deno Desktop runtime. This lets Deno resolve the exact
basename-scoped `run` permission before JavaScript starts while keeping a relocated
bundle functional. It does not grant general subprocess access or add a checkout lookup.
Packaging rejects a bundled general Deno CLI, signs the helper, runtime, launcher, and
outer app, then verifies every signature. It also fixes and verifies
`LSMinimumSystemVersion` at macOS 14.0, matching the launcher and Deno Desktop runtime
deployment target. `dist/` is ignored. `sidecar:test` compiles its dedicated helper
first, so it is reproducible from a checkout with no prior `dist/` artifact.

`workbench:test` is the isolated Lot 3 gate: it rebuilds only the portable web bundle
and Workbench helper, then tests its closed lifecycle and compiled offline GET/SSE path
on private loopback `:5176`. `sidecar:test` additionally exercises the older control
plane on `:3020` and therefore requires that port to be free.

Deno Desktop and config-file permission sets are experimental in Deno 2.9.2. The ad-hoc
signature proves local bundle integrity; it is not a Developer ID signature or a
notarized public release.

The renderer and host preserve the authority model in [AGENTS.md](../AGENTS.md): the
agent proposes registered operations, the human signs consequential decisions, the
server owns sequences/profiles/lowering/recovery, and the Workbench remains a read-only
`GET` + SSE projection. A later acpx Chat Host belongs in its own sidecar and must not
be merged into this control-plane helper.
