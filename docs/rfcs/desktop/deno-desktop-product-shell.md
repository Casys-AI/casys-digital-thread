Audience: agent · Diátaxis: none · Kind: RFC

Status: active · Implemented through Lot 2

# RFC: Deno Desktop product shell

This page is the implementation brief and status record for the Desktop product shell.
Deno Desktop is the decided first product distribution, not a spike to compare with a
bridge-only product. Lots 1 and 2 are implemented in product `0.2.0`; the Workbench and
Chat Host lots remain future work. The living Casys authority and runtime topology
remain in the [workspace map](../../reference/runtime/workspace-map.md) and
[product direction](../../explanations/product/product-direction.md).

## Implemented now — product 0.2.0

| Capability                | Current state                                                                                                                                                                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native product shell      | **Implemented.** The macOS package opens one system WebView and serves one static, sanitized diagnostics document through `GET` and `HEAD` only.                                                                                                                                                          |
| Component/bootstrap gate  | **Implemented.** Product, Deno, Desktop runtime, layout, and the exact active sidecar declaration are validated before the control-plane factory can create a subprocess.                                                                                                                                 |
| Local control plane       | **Implemented.** A dedicated compiled Deno helper binds the existing Casys server composition on loopback `:3020`, uses server-owned operations and persists its closed workspace below macOS Application Support. It is a privilege/lifecycle sidecar, not a second backend authority or language stack. |
| Lifecycle                 | **Implemented.** Desktop can inspect, start, reconnect to an exact matching identity, report conflicts without adoption, and stop only an owned in-memory child handle. Lock, marker, configuration digest, readiness handshake, stdin lifeline, and bounded shutdown are distinct checks.                |
| Provider observation      | **Implemented as fail-closed diagnostics only.** The helper has no Docker authority; provider state may remain `unavailable`, and candidate or `demo` records never become verified evidence.                                                                                                             |
| Live Workbench projection | **Not implemented.** The bundle has no Workbench BFF, project dossier, `/api` route, or SSE stream. The current renderer is the static shell above.                                                                                                                                                       |
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
or a marketplace. Product `0.2.0` already runs its local control plane without those
clients, but it does not yet supply the in-app Workbench or conversation.

## Product boundary

Current product `0.2.0`:

```text
Deno Desktop host
├─ static diagnostics renderer: GET + HEAD only
└─ packaged Deno control-plane helper
   ├─ existing Casys server composition on loopback :3020
   ├─ persistent project/CAS/WAL roots below Application Support
   └─ exact inspect | start | reconnect | owned-stop lifecycle
```

Target after the deferred Workbench and Chat Host lots:

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

### Deferred product-shell ownership

- explicit local project selection; never a hidden default project;
- a privileged IPC boundary for chat and native actions;
- navigation between conversation, project dossier, activity, evidence, and settings;
- live Workbench GET/SSE projection; and
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

1. **Static renderer/webview** — presentation only. It receives one sanitized
   `DesktopControlPlaneProjection`. It has no project API, SSE, chat model, provider
   credentials, filesystem authority, process spawning, Docker socket, or raw MCP
   transport.
2. **Desktop host** — owns bootstrap and application lifecycle. It can launch only the
   nested packaged helper, probe loopback `:3020`, and pass the closed projection to the
   renderer.
3. **Deno control-plane helper** — hosts the existing Casys server composition, closed
   persistent state, MRTR signing material, exact lifecycle identity, and server-owned
   operations. Its Docker observer deliberately reports unavailable.

The later Chat Host and live Workbench must be separate privilege domains. The Chat Host
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
  -> validate manifest, runtime pins and finite macOS layout
  -> resolve only Contents/Helpers/casys-control-plane from Deno.execPath()
  -> helper inspect of embedded digest, configuration, lock and marker
  -> reconnect to one exact identity or start one owned helper
  -> verify health, server identity and lifecycle handshake
  -> observe provider/evidence status without inventing availability
  -> serve the static ready | degraded | recovery-required document
```

Shutdown drains the static renderer server and stops only the control-plane child handle
owned in memory. A reconnected instance never stops the helper it did not launch. Chat
turn draining and Chat Host cleanup are future requirements, not current behavior.

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

**Implemented and retained in product 0.2.0.**

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

**Deferred; not implemented.**

- Embed the existing Workbench through GET/SSE only.
- Preserve explicit project focus, read-only behavior, and literal evidence states.
- Keep provider credentials and command APIs outside the renderer.

### Lot 4 — Chat Host seam

**Deferred; not implemented.** acpx `0.13.1` already provides the required upstream
elicitation surface; Desktop still needs the host, IPC and UI integration.

- Add only the typed IPC and lifecycle boundary required by the separate chat RFC.
- Do not invent an ACP implementation inside the Desktop shell.

## Acceptance proven for Lots 1 and 2

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

## Acceptance deferred with Lots 3 and 4

- Workbench project, activity, lineage, and evidence load through GET/SSE; no POST or
  provider credential is reachable from the renderer.
- Offline launch exposes existing local projects through the live read-only dossier.
- Desktop starts, drains and resumes its embedded Chat Host without creating alternate
  project or evidence truth.
- The optional bridge and Desktop observe the same project/Thread truth.

## Current distribution envelope

- Lot 2 is packaged only for macOS 14.0 or later. Linux and Windows paths are validated
  data contracts, not shipped helpers.
- The current package is ad-hoc signed and its nested signatures are verified locally.
  It has no Developer ID signature, hardened-runtime release gate, notarization,
  stapling, or public-release installer.
- No-orphan is not yet a universal shutdown invariant: after EOF, `SIGTERM` and
  `SIGKILL`, the host bounds its last status wait and returns even if child status is
  still unresolved. The real packaged helper passed the E2E cleanup gate, but public
  release must surface or otherwise resolve that terminal timeout rather than infer
  child exit.
- Deno Desktop and config-file permission sets remain experimental in the pinned Deno
  `2.9.2` toolchain. Product `0.2.0` therefore proves the reviewed local package, not a
  generally supported or notarized distribution channel.
- Production permissions are closed and process-specific. The current test tasks still
  use unscoped `--allow-read --allow-write`; that is test-harness hardening debt, not a
  permission granted to the packaged Desktop host or helper.

## Stop rules

Stop rather than broadening permissions, exposing the Docker socket to the renderer,
adding a Workbench command channel, duplicating Thread/CAS, choosing providers in the
shell, or hiding a missing local dependency behind a generic "ready" state.
