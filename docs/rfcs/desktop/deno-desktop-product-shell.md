Audience: agent · Diátaxis: none · Kind: RFC

Status: active · Implemented through Lot 3

# RFC: Deno Desktop product shell

This page is the implementation brief and status record for the Desktop product shell.
Deno Desktop is the decided first product distribution, not a spike to compare with a
bridge-only product. Lots 1 through 3 are implemented in product `0.3.0`; only the Chat
Host lot remains future work. The living Casys authority and runtime topology remain in
the [workspace map](../../reference/runtime/workspace-map.md) and
[product direction](../../explanations/product/product-direction.md).

The product architecture is OS-independent: the Preact/Vite Workbench, Deno BFF,
GET/HEAD/SSE proxy contract and closed helper lifecycle do not assume Darwin. macOS is
the first distribution proved by the current packager and signing pipeline, not the
boundary of the product. Windows and Linux layouts remain explicit, tested data
contracts for later native packagers.

## Implemented now — product 0.3.0

| Capability                | Current state                                                                                                                                                                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native product shell      | **Implemented.** The current macOS package opens one OS-owned WebView. Its portable web root is the embedded Workbench when ready and the static sanitized diagnostics document only when Workbench is unavailable.                                                                                       |
| Component/bootstrap gate  | **Implemented.** Product, Deno, Desktop runtime, layout, and the exact active sidecar declaration are validated before the control-plane factory can create a subprocess.                                                                                                                                 |
| Local control plane       | **Implemented.** A dedicated compiled Deno helper binds the existing Casys server composition on loopback `:3020`, uses server-owned operations and persists its closed workspace below macOS Application Support. It is a privilege/lifecycle sidecar, not a second backend authority or language stack. |
| Lifecycle                 | **Implemented.** Desktop can inspect, start, reconnect to an exact matching identity, report conflicts without adoption, and stop only an owned in-memory child handle. Lock, marker, configuration digest, readiness handshake, stdin lifeline, and bounded shutdown are distinct checks.                |
| Provider observation      | **Implemented as fail-closed diagnostics only.** The helper has no Docker authority; provider state may remain `unavailable`, and candidate or `demo` records never become verified evidence.                                                                                                             |
| Live Workbench projection | **Implemented.** A separately compiled, read-only helper reuses the canonical Workbench GET/SSE BFF and Preact/Vite bundle. Desktop exposes only an exact GET/HEAD/SSE allowlist, while project focus remains the durable `primary` focus.                                                                |
| Embedded chat/acpx        | **Not implemented.** The bundle has no Chat Host, chat IPC, acpx runtime or agent subprocess. acpx `0.13.1` is aligned separately, but that completed dependency is not Desktop integration.                                                                                                              |

## Target outcome

After the later lots, one installable Deno Desktop application will own the local Casys
product experience:

- application lifecycle and local version manifest;
- paired chat container and human review surface;
- embedded read-only Workbench dossier;
- startup, health, recovery, and shutdown of the local Casys control plane;
- project-private Thread/CAS and sensitivity-experience storage; and
- clear status for required local engineering providers distributed as published images.

The target app works without Claude Code, Codex, Grok, a Casys SaaS account, team sync,
or a marketplace. Product `0.3.0` runs its local control plane and in-app Workbench
without those clients, but it does not yet supply the in-app conversation.

## Product boundary

Current product `0.3.0`:

```text
Deno Desktop host
├─ native HTTP seam: exact Workbench GET/HEAD/SSE proxy or static fallback
├─ packaged Deno control-plane helper
   ├─ existing Casys server composition on loopback :3020
   ├─ persistent project/CAS/WAL roots below Application Support
   └─ exact inspect | start | reconnect | owned-stop lifecycle
└─ packaged Deno Workbench helper on private loopback :5176
   ├─ reads the same control-plane project/Thread/CAS/focus roots
   ├─ serves embedded Preact/Vite assets plus the existing read-only BFF
   └─ separate lock, private token, exact reconnect and owned-stop lifecycle
```

Target after the deferred Chat Host lot:

```text
Deno Desktop
├─ native shell and lifecycle authority
├─ privileged Chat Host IPC seam
├─ Workbench webview: GET + SSE only
├─ local Casys MCP/control server
├─ local Thread/CAS/Experience Index
└─ provider supervisor/status for pinned published images

optional native agent CLI ── mcp-bridge ──> same local Casys server
```

Desktop is intended to become the primary onboarding, navigation, status, and update
surface. `mcp-bridge` remains optional out-of-process companion access for expert-native
agents and automation; it is not a substitute for the missing embedded chat. Neither
surface may create a second project, store, provider route, permission model, or
authority.

## Ownership

### Desktop owns now

- one fixed product identity and application-support directory;
- an exact component/bootstrap gate before any helper launch;
- the packaged helper lifecycle, readiness and renderer-safe diagnostics projection;
- a persistent closed local server workspace; and
- offline-first local state and a visible degraded state when a provider is unavailable;
  provider counts are not fabricated.
- the existing Workbench dossier through a separate least-privilege helper and host-only
  reverse proxy; and
- explicit durable cockpit focus. Without focus, persisted projects are shown as passive
  sanitized records or the catalog remains literally `unavailable`.

### Deferred product-shell ownership

- a privileged IPC boundary for chat and native actions;
- navigation between conversation and the existing project dossier; and
- update presentation and rollback metadata without silently changing engineering
  profiles during a run.

### Desktop does not own

- provider/tool/argument selection, lowering, or native solver payloads;
- engineering truth outside Thread/CAS;
- a second command endpoint in the Workbench;
- agent self-approval or human MRTR fabrication;
- engineering provider source code in this repository; providers remain published,
  pinned images; or
- team synchronization, public sharing, or marketplace distribution in the first
  release.

## Process and security topology

The implemented privilege domains are:

1. **Renderer/webview** — presentation only. It loads the Workbench through Desktop's
   same-origin exact GET/HEAD/SSE proxy and receives sanitized lifecycle DTOs. It has no
   helper token/origin, chat model, provider credentials, filesystem authority, process
   spawning, Docker socket, raw MCP transport, POST or command route.
2. **Desktop host** — owns bootstrap and application lifecycle. It can launch only the
   two nested packaged helpers, probe only loopback `:3020` and `:5176`, retain the
   Workbench session token outside renderer DTOs, and proxy only the canonical path
   allowlist.
3. **Deno control-plane helper** — hosts the existing Casys server composition, closed
   persistent state, MRTR signing material, exact lifecycle identity, and server-owned
   operations. Its Docker observer deliberately reports unavailable.
4. **Deno Workbench helper** — reads only the existing control-plane workspace, writes
   only its separate lifecycle directory, binds only `:5176`, and owns no MCP, provider,
   Docker, process, environment, FFI or remote-import capability. Its BFF cannot mutate
   project focus or engineering state.

The later Chat Host remains a separate privilege domain. Its contract is specified in
[embedded acpx chat](embedded-acpx-chat.md). Engineering providers remain independently
versioned published images; Desktop may later supervise their declared lifecycle but
never absorbs their authority or source.

Deno permissions must be explicit per process. Do not use blanket permissions for
convenience. Scope filesystem access to application state and declared assets, network
access to required loopback endpoints, process execution to pinned supervisors, and
environment reads to a named allowlist. The renderer receives none of those permissions.

Loopback is a deployment guard, not user authentication. The first release remains one
local user/installation and makes no multi-user claim.

## Implemented startup sequence

```text
open Desktop
  -> validate manifest, runtime pins and the selected finite platform layout
  -> resolve only Contents/Helpers/casys-control-plane from Deno.execPath()
  -> helper inspect of embedded digest, configuration, lock and marker
  -> reconnect to one exact identity or start one owned helper
  -> verify health, server identity and lifecycle handshake
  -> observe provider/evidence status without inventing availability
  -> resolve and inspect Contents/Helpers/casys-workbench independently
  -> reconnect to an exact Workbench identity or start one owned helper
  -> retain its private session capability in the host only
  -> serve the Workbench root through the exact GET/HEAD/SSE proxy
  -> fall back to static ready | degraded | recovery-required diagnostics if unavailable
```

Shutdown drains the renderer server and stops only control-plane and Workbench child
handles owned in memory. A reconnected instance never stops a helper it did not launch.
Chat turn draining and Chat Host cleanup are future requirements, not current behavior.

## Local data

- Use platform application-support paths, never the repository checkout, home-directory
  root, or a renderer-controlled path.
- Keep configuration, immutable evidence, mutable journals, logs, and caches separate.
- Preserve current CAS/WAL atomicity and replay semantics; Desktop lifecycle is not a
  replacement recovery protocol.
- A local cache miss, provider absence, or offline state remains `unavailable` or
  `unresolved`; the UI does not soften it.
- Backups and export are explicit future operations, not implicit cloud sync.

## Implementation lots

### Lot 1 — shell and manifest

**Implemented and retained in product 0.3.0.**

- Create the Deno Desktop application package with pinned Deno/Desktop/runtime versions.
- Define the component manifest and platform application-support layout.
- Render one native window with static ready/degraded diagnostics.

### Lot 2 — local control-plane lifecycle

**Implemented in 0.2.0.**

- Bind the existing Casys server in a packaged Deno helper; inspect, start, reconnect,
  health-check, and stop it through exact lifecycle identity.
- Distinguish written configuration, child-process liveness, provider readiness, and
  persisted project evidence.
- Add exact ownership markers so cleanup cannot target foreign processes.

### Lot 3 — Workbench projection

**Implemented in 0.3.0.**

- Embed the existing Workbench through GET/SSE only.
- Preserve explicit project focus, read-only behavior, and literal evidence states.
- Keep provider credentials and command APIs outside the renderer.
- Compile and package a distinct read-only helper whose filesystem read root is the
  existing control-plane workspace and whose only write root is separate lifecycle
  state.
- Expose persisted projects without choosing a default; the existing durable cockpit
  focus remains the sole project selection authority.

### Lot 4 — Chat Host seam

**Deferred; not implemented.** acpx `0.13.1` already provides the required upstream
elicitation surface; Desktop still needs the host, IPC and UI integration.

- Add only the typed IPC and lifecycle boundary required by the separate chat RFC.
- Do not invent an ACP implementation inside the Desktop shell.

## Acceptance proven for Lots 1 through 3

- A packaged app launches from a clean user context and uses its application-support
  directory, not the git checkout.
- A second app instance does not create a second control plane or corrupt state.
- Ready, degraded, and recovery-required states follow observed component health.
- The renderer receives no pid, launch id, digest, endpoint, helper/storage path or
  process handle; unknown and privileged-looking paths return 404.
- Provider absence remains literal and candidate/demo records remain unverified.
- The packaged-helper E2E proves marker removal, port closure and no owned orphan for
  the exercised graceful and repeated-signal shutdowns. Cleanup never targets a merely
  matching foreign or reconnected process.
- Packaging gates use current Deno tooling (`deno fmt --check`, `deno lint`,
  `deno test`, and `deno check`) with explicit permissions.
- Proxy tests prove exact GET/HEAD/SSE paths, bounded request headers, CSP/security
  headers, rejected POST/command/traversal paths, and absence of helper token/origin in
  renderer responses.
- The compiled Workbench E2E reopens one existing project while the control plane and
  providers are offline, exposes the no-focus catalog without a default, follows the
  later durable focus, emits SSE, then proves token/marker removal and port closure.

## Acceptance deferred with Lot 4

- Desktop starts, drains and resumes its embedded Chat Host without creating alternate
  project or evidence truth.
- The optional bridge and Desktop observe the same project/Thread truth.

## Current distribution envelope

- Lot 3's first proved distribution is macOS 14.0 or later. Linux and Windows paths are
  validated data contracts, but their native packaging/finalization is not yet shipped;
  this distribution limit does not narrow the portable Workbench/BFF/proxy architecture.
- The current package is ad-hoc signed and its nested signatures are verified locally.
  It has no Developer ID signature, hardened-runtime release gate, notarization,
  stapling, or public-release installer.
- No-orphan is not yet a universal shutdown invariant: after EOF, `SIGTERM` and
  `SIGKILL`, the host bounds its last status wait and returns even if child status is
  still unresolved. The real packaged helper passed the E2E cleanup gate, but public
  release must surface or otherwise resolve that terminal timeout rather than infer
  child exit.
- Deno Desktop and config-file permission sets remain experimental in the pinned Deno
  `2.9.2` toolchain. Product `0.3.0` therefore proves the reviewed local package, not a
  generally supported or notarized distribution channel.
- Production permissions are closed and process-specific. The current test tasks still
  use unscoped `--allow-read --allow-write`; that is test-harness hardening debt, not a
  permission granted to the packaged Desktop host or helper.

## Stop rules

Stop rather than broadening permissions, exposing the Docker socket to the renderer,
adding a Workbench command channel, duplicating Thread/CAS, choosing providers in the
shell, or hiding a missing local dependency behind a generic "ready" state.
