# Casys Digital Thread Desktop

This package is the Deno Desktop Lot 2 shell. It contains one native system WebView and
one dedicated, compiled Deno control-plane helper. The helper is a sidecar process for
privilege and lifecycle isolation; it is not a second language stack and it does not
contain a general Deno CLI.

Workbench and Chat Host remain separate later components. The Desktop renderer is still
presentation-only.

## Current behavior

- Product `0.2.0`, Deno `2.9.2`, the Deno Desktop runtime `2.9.2`, and control plane
  `0.2.0` are exact pins. The WebView engine remains OS-owned and is labelled that way
  in the manifest.
- Before any helper process is considered, Desktop validates the embedded manifest,
  observed Deno/Desktop/product versions, macOS application-support layout, product
  identifier, and the exact `active` + `sidecar` control-plane declaration.
- Production resolves only `Contents/Helpers/casys-control-plane` beside the executable
  returned by `Deno.execPath()`. There is no checkout helper, PATH lookup, or Deno CLI
  fallback.
- The helper's read-only `inspect` mode supplies the exact embedded-asset digest,
  configuration state, lock, and marker. Desktop then either reconnects to an exact
  identity or starts one helper and waits for its bounded readiness handshake.
- A foreign, stale, mismatched, or ambiguous listener is never adopted, replaced, or
  killed. Shutdown closes only the child handle retained by the Desktop process; stdin
  EOF is the crash lifeline. On `SIGINT` or `SIGTERM`, Desktop waits for that
  owned-child stop and the renderer server drain before explicitly exiting the native
  process.
- Control-plane readiness, engineering-provider health, and persisted evidence remain
  separate states. Providers may be `unavailable` without counts. Indexed or `demo` run
  records remain `candidate-unverified`; they are not promoted to verified Thread
  evidence.
- The renderer receives only a closed `DesktopControlPlaneProjection`. It never receives
  a pid, launch id, digest, endpoint, helper path, storage path, or process handle.
- The HTTP surface serves one static document through `GET` and `HEAD`. Other methods
  return 405 and every unknown or privileged-looking path returns 404. There is no MCP,
  command, lifecycle, health, filesystem, or provider route in the WebView server.

## Runtime boundary

The Desktop host can read only `HOME`, `XDG_DATA_HOME`, `APPDATA`, and `LOCALAPPDATA`,
run only the packaged `casys-control-plane` basename, and reach only `127.0.0.1:3020`.
It receives no filesystem, FFI, or general subprocess permission; runtime remote imports
are denied.

The separately compiled helper receives read/write access only to the product root
below, resolved against the validated `$HOME/Library/Application Support` launch
directory:

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

Windows and Linux application-support layouts remain validated by unit tests, but Lot 2
packages and launches the signed helper only on macOS. Their finite roots are reserved
for later target-specific helpers:

| Platform | Product root                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------ |
| macOS    | `$HOME/Library/Application Support/ai.casys.digital-thread`                                      |
| Linux    | `$XDG_DATA_HOME/ai.casys.digital-thread`, otherwise `$HOME/.local/share/ai.casys.digital-thread` |
| Windows  | `%LOCALAPPDATA%\\ai.casys.digital-thread`; roaming config under `%APPDATA%`                      |

## Commands

From this directory:

```sh
deno task verify
deno task sidecar:test
deno task package
```

There is intentionally no checkout `dev` task in Lot 2. Production resolves only the
nested signed helper from `Deno.execPath()`, and an HMR process cannot reproduce that
bundle topology without adding a second helper lookup or broader subprocess permission.
Use the packaged app for native runtime checks.

`package` compiles the dedicated helper, builds `dist/CasysDigitalThread.app`, stages
the helper under `Contents/Helpers`, and installs a minimal native launcher as the
bundle entrypoint. The launcher validates the unsymlinked packaged runtime and helper,
places the signed Helpers directory first on the initial process `PATH`, then `exec`s
the Deno Desktop runtime. This lets Deno resolve the exact basename-scoped `run`
permission before JavaScript starts while keeping a relocated bundle functional. It does
not grant general subprocess access or add a checkout lookup. Packaging rejects a
bundled general Deno CLI, signs the helper, runtime, launcher, and outer app, then
verifies every signature. It also fixes and verifies `LSMinimumSystemVersion` at macOS
14.0, matching the launcher and Deno Desktop runtime deployment target. `dist/` is
ignored. `sidecar:test` compiles its dedicated helper first, so it is reproducible from
a checkout with no prior `dist/` artifact.

Deno Desktop and config-file permission sets are experimental in Deno 2.9.2. The ad-hoc
signature proves local bundle integrity; it is not a Developer ID signature or a
notarized public release.

The renderer and host preserve the authority model in [AGENTS.md](../AGENTS.md): the
agent proposes registered operations, the human signs consequential decisions, the
server owns sequences/profiles/lowering/recovery, and the future Workbench remains a
read-only `GET` + SSE projection. A later acpx Chat Host belongs in its own sidecar and
must not be merged into this control-plane helper.
