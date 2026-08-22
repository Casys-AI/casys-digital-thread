# Casys Digital Thread Desktop

This package is the first Deno Desktop product shell. It contains one native system
WebView, an embedded component manifest, platform application-support layout resolution,
and honest static diagnostics. It does not yet start the Casys control plane, providers,
Workbench, chat, Docker, MCP, or an agent.

## Current behavior

- Product `0.1.0`, Deno `2.9.2`, and the Deno Desktop runtime `2.9.2` are exact pins.
  The WebView engine remains OS-owned and is labelled that way in the manifest.
- `Deno.version.deno` proves the runtime pin. `Deno.desktopVersion` independently proves
  the product release baked by `deno desktop`.
- The normal aggregate is `degraded`: manifest, runtime, layout, and shell are `ready`;
  the control plane, provider observation, Workbench, and Chat Host remain literally
  `unavailable`.
- A bad manifest, wrong runtime/product version, or unresolved application-support base
  produces `recovery-required`. It never manufactures `ready`.
- The HTTP surface serves one static document through `GET` and `HEAD`. Other methods
  return 405 and unknown paths return 404. There is no command route.

## Runtime boundary

The packaged process can read only `HOME`, `XDG_DATA_HOME`, `APPDATA`, and
`LOCALAPPDATA`. Runtime remote imports are denied explicitly. It receives no general
filesystem read/write, network, subprocess, FFI, or system permission. Deno Desktop owns
its internal ephemeral loopback listener; the renderer receives only escaped HTML with a
restrictive CSP and no script, form, external resource, or privileged bridge.

Lot 1 resolves but does not create these application-support locations:

| Platform | Root                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------ |
| macOS    | `$HOME/Library/Application Support/ai.casys.digital-thread`                                      |
| Linux    | `$XDG_DATA_HOME/ai.casys.digital-thread`, otherwise `$HOME/.local/share/ai.casys.digital-thread` |
| Windows  | `%LOCALAPPDATA%\\ai.casys.digital-thread`; roaming config under `%APPDATA%`                      |

Each root separates configuration, Thread, CAS, experience, journals, logs, cache, and
runtime paths. No state is written in the checkout or at the home-directory root.

## Commands

From this directory:

```sh
deno task verify
deno task dev
deno task package
```

`dev` opens the native window. `package` currently builds the macOS arm64 application at
`dist/CasysDigitalThread.app`; `dist/` is ignored. The packaging finalizer aligns the
Info.plist with product `0.1.0`, removes Deno's unused camera, microphone, audio, and
Bluetooth usage descriptions, and verifies a fresh ad-hoc signature.

Deno Desktop and config-file permission sets are experimental in Deno 2.9.2. The ad-hoc
signature proves bundle integrity locally; it is not a Developer ID signature or a
notarized public release. Windows and Linux layout behavior is unit-tested, but their
installers are not part of this macOS Lot 1 proof.

The renderer and host preserve the authority model in [AGENTS.md](../AGENTS.md): this
shell neither selects engineering providers/tools/arguments nor writes engineering truth
outside Thread/CAS. Later control-plane, Workbench GET/SSE, and Chat Host work must
reuse these boundaries instead of adding authority to the WebView.
