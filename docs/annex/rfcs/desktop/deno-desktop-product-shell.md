Audience: agent · Diátaxis: none · Kind: RFC

Status: active · Implemented through Lot 4

# RFC: Deno Desktop product shell

This page is the implementation brief and status record for the Desktop product shell.
Deno Desktop is the decided first product distribution, not a spike to compare with a
bridge-only product. Lots 1 through 4 are implemented in product `0.4.0`. The living
Casys authority and runtime topology remain in the
[workspace map](../../../reference/runtime/local-runtime-and-ports.md) and
[product direction](../../../explanations/product/product-direction.md).

The product architecture is OS-independent: the Preact/Vite Workbench, Deno BFF,
GET/HEAD/SSE proxy contract, Chat Host DTOs and React UI, and closed helper lifecycles
do not assume Darwin. macOS is the only distribution proved by the current packager and
signing pipeline, not the boundary of the product. Windows and Linux layouts remain
explicit, tested data contracts for later native packagers, while their Chat Host
entries still lack pins. The runtime selects one closed bundle layout from
`DesktopPlatform`; it never infers a platform from path text or falls back to a
checkout.

## Implemented now — product 0.4.0

| Capability                | Current state                                                                                                                                                                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native product shell      | **Implemented.** The current macOS package opens one OS-owned WebView. Its portable web root is the embedded Workbench when ready and the static sanitized diagnostics document only when Workbench is unavailable.                                                                                       |
| Component/bootstrap gate  | **Implemented.** Product, Deno, Desktop runtime, layout, and the exact active sidecar declaration are validated before the control-plane factory can create a subprocess.                                                                                                                                 |
| Local control plane       | **Implemented.** A dedicated compiled Deno helper binds the existing Casys server composition on loopback `:3020`, uses server-owned operations and persists its closed workspace below macOS Application Support. It is a privilege/lifecycle sidecar, not a second backend authority or language stack. |
| Lifecycle                 | **Implemented.** Desktop can inspect, start, reconnect to an exact matching identity, report conflicts without adoption, and stop only an owned in-memory child handle. Lock, marker, configuration digest, readiness handshake, stdin lifeline, and bounded shutdown are distinct checks.                |
| Provider observation      | **Implemented as fail-closed diagnostics only.** The helper has no Docker authority; provider state may remain `unavailable`, and candidate or `demo` records never become verified evidence.                                                                                                             |
| Live Workbench projection | **Implemented.** A separately compiled, read-only helper reuses the canonical Workbench GET/SSE BFF and Preact/Vite bundle. Desktop exposes only an exact GET/HEAD/SSE allowlist, while project focus remains the durable `primary` focus.                                                                |
| Embedded chat/acpx        | **Implemented by Lot 4.** A separate packaged Chat Host owns exact acpx/runtime, adapter, FIFO sessions, bounded lifecycle, retained transcripts and native elicitation behind two versioned bindings. The Workbench HTTP surface remains GET/SSE only.                                                   |

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
or a marketplace. Product `0.4.0` packages its local control plane, live Workbench and
Chat Host without those companion clients.

## Product boundary

Current product `0.4.0`:

```text
Deno Desktop host
├─ native HTTP seam: exact Workbench GET/HEAD/SSE proxy or static fallback
├─ separate packaged Chat Host
│  └─ exact private Node + acpx/runtime + adapter
├─ packaged Deno control-plane helper
│  ├─ existing Casys server composition on loopback :3020
│  ├─ persistent project/CAS/WAL roots below Application Support
│  └─ exact inspect | start | reconnect | owned-stop lifecycle
└─ packaged Deno Workbench helper on private loopback :5176
   ├─ reads the same control-plane project/Thread/CAS/focus roots
   ├─ serves embedded Preact/Vite assets plus the existing read-only BFF
   └─ separate lock, private token, exact reconnect and owned-stop lifecycle
```

Longer-term product topology:

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
agents and automation; it is neither an authority nor required for the embedded chat.
Neither surface may create a second project, store, provider route, permission model, or
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
  sanitized records or the catalog remains literally `unavailable`;
- a separate packaged Chat Host, closed native bindings, FIFO sessions, retained
  transcripts and native elicitation.

### Deferred product-shell ownership

- explicit local project selection; never a hidden default project;
- navigation refinement between conversation, project dossier, activity, evidence, and
  settings; and
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
   same-origin exact GET/HEAD/SSE proxy, sanitized lifecycle DTOs, and closed
   `casys-desktop-chat/1.0` DTOs through native bindings. It has no helper token/origin,
   chat model or MCP credentials, provider credentials, filesystem authority, process
   spawning, Docker socket, raw MCP transport, POST or command route.
2. **Desktop host** — owns bootstrap and application lifecycle. It can launch only the
   packaged control-plane and Workbench helpers plus the separate Chat Host, probe only
   loopback `:3020` and `:5176`, retain the Workbench session token outside renderer
   DTOs, and proxy only the canonical path allowlist.
3. **Deno control-plane helper** — hosts the existing Casys server composition, closed
   persistent state, MRTR signing material, exact lifecycle identity, and server-owned
   operations. Its Docker observer deliberately reports unavailable.
4. **Deno Workbench helper** — reads only the existing control-plane workspace, writes
   only its separate lifecycle directory, binds only `:5176`, and owns no MCP, provider,
   Docker, process, environment, FFI or remote-import capability. Its BFF cannot mutate
   project focus or engineering state.
5. **Chat Host** — a distinct, closed launcher and private Node/acpx runtime. It owns
   chat FIFO/session lifecycle and separate retained transcripts, and talks only to the
   Casys control plane. It is never folded into the helper or Workbench.

The Chat Host and live Workbench remain separate privilege domains. The Chat Host
contract is specified in [embedded acpx chat](embedded-acpx-chat.md). Engineering
providers remain independently versioned published images; Desktop may later supervise
their declared lifecycle but never absorbs their authority or source.

Deno permissions must be explicit per process. Do not use blanket permissions for
convenience. Scope filesystem access to application state and declared assets, network
access to required loopback endpoints, process execution to pinned supervisors, and
environment reads to a named allowlist. The renderer receives none of those permissions.

Loopback is a deployment guard, not user authentication. The first release remains one
local user/installation and makes no multi-user claim.

## Implemented startup sequence

```text
open Desktop
  -> validate manifest, product/runtime pins and the selected finite platform layout
  -> resolve the exact platform bundle contract from Deno.execPath()
  -> derive only that bundle's control-plane and Workbench helper paths
  -> pass the already validated fixed layout profile to both helper CLIs
  -> helper inspect of embedded digest, configuration, lock and marker
  -> reconnect to one exact identity or start one owned helper
  -> verify health, server identity and lifecycle handshake
  -> observe provider/evidence status without inventing availability
  -> inspect the Workbench helper independently
  -> reconnect to an exact Workbench identity or start one owned helper
  -> retain its private session capability in the host only
  -> if the exact Chat Host component is launchable, verify its package and executable
     digests, then start the separate host and retain its private session
  -> serve the Workbench root through the exact GET/HEAD/SSE proxy
  -> expose Chat only through the closed native bindings
  -> fall back to static ready | degraded | recovery-required diagnostics if unavailable
```

Shutdown drains the renderer server and stops only control-plane and Workbench child
handles owned in memory. A reconnected instance never stops a helper it did not launch.
Chat shutdown cancels pending interactions and turns, closes retained sessions, asks the
separate host to exit, escalates through `SIGTERM`/`SIGKILL`, and bounds the final wait.

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

**Implemented in 0.4.0.** acpx `0.13.1` provides the aligned elicitation surface;
Desktop packages the exact reviewed fork/runtime and adapter behind the separate host,
closed IPC, and Workbench-ready React UI.

- Add only the typed IPC and lifecycle boundary required by the separate chat RFC.
- Do not invent an ACP implementation inside the Desktop shell.

## Acceptance proven for Lots 1 through 4

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
- A fake owned child that ignores the first `SIGKILL` proves that bounded shutdown does
  not infer exit: `termination-unresolved` remains visible, the handle is retained for
  retry, application stop rejects, and the native supervisor withholds explicit exit.
- Packaging gates use current Deno tooling (`deno fmt --check`, `deno lint`,
  `deno test`, and `deno check`) with explicit permissions.
- Proxy tests prove exact GET/HEAD/SSE paths, bounded request headers, CSP/security
  headers, rejected POST/command/traversal paths, and absence of helper token/origin in
  renderer responses.
- The compiled Workbench E2E reopens one existing project while the control plane and
  providers are offline, exposes the no-focus catalog without a default, follows the
  later durable focus, emits SSE, then proves token/marker removal and port closure.
- Unit and startup tests cover the exact macOS, Linux, and Windows bundle-path contracts
  plus root, traversal, mixed-separator, cross-platform and ambiguous-layout rejection.
  Only the macOS package itself has been built and signature-verified.
- The real packaged acpx/runtime starts a fixture turn, streams output, crosses form
  elicitation, closes the session, and reaps the fixture process tree. A real Casys
  server E2E validates and persists an MRTR approval; ACP permission remains distinct.

## Acceptance deferred for distribution follow-up

- The optional bridge and Desktop observe the same project/Thread truth.

## Current distribution envelope

- Lot 3's first proved distribution is macOS 14.0 or later. Linux and Windows paths are
  validated data contracts, but their native packaging/finalization is not yet shipped;
  macOS is the first proved distribution, not the product limit, and this distribution
  envelope does not narrow the portable Workbench/BFF/proxy, Chat DTO or React UI
  architecture. Their Chat Host target entries remain `missing-pins`; no package is
  claimed for them.
- Linux uses `<prefix>/casys-digital-thread/{bin,libexec}` and Windows uses
  `<prefix>\\CasysDigitalThread\\{CasysDigitalThread.exe,Helpers}` as closed future
  bundle contracts. Missing helpers, failed inspect, or identity/digest mismatch remain
  unavailable or recovery-required. Their packagers must also emit target-specific
  closed filesystem and helper-executable grants; these contracts are not packaging
  proof.
- The current compiled relative filesystem grants cover `linux-xdg`, and the actual
  compiled Workbench helper executes that profile in the permission E2E. The
  `$HOME/.local/share/...` `linux-home` layout remains resolvable data but is explicitly
  non-launchable: startup creates neither helper factory, while direct compiled-helper
  execution proves permission denial. Neither result is a Linux package, launcher,
  signature, or distribution proof.
- The current package is ad-hoc signed and its nested signatures are verified locally.
  It has no Developer ID signature, hardened-runtime release gate, notarization,
  stapling, or public-release installer.
- No terminal Workbench child state is inferred. After EOF, `SIGTERM` and `SIGKILL`, an
  unresolved bounded status wait returns the literal `termination-unresolved` recovery
  state, retains the owned handle, rejects application stop, and prevents explicit
  native process exit while the supervisor retries. This closes the Workbench lifecycle
  invariant in code; the real packaged-helper E2E remains the proof for its exercised
  shutdown path. The older control-plane host still has its separately documented
  bounded terminal-timeout behavior, so universal no-orphan across every Desktop
  component is not claimed here.
- Deno Desktop and config-file permission sets remain experimental in the pinned Deno
  `2.9.2` toolchain. Product `0.4.0` therefore proves the reviewed local package, not a
  generally supported or notarized distribution channel.
- Production permissions are closed and process-specific. The current test tasks still
  use unscoped `--allow-read --allow-write`; that is test-harness hardening debt, not a
  permission granted to the packaged Desktop host or helper.

## Stop rules

Stop rather than broadening permissions, exposing the Docker socket to the renderer,
adding a Workbench command channel, duplicating Thread/CAS, choosing providers in the
shell, or hiding a missing local dependency behind a generic "ready" state.
