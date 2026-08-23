Audience: agent · Diátaxis: none · Kind: RFC

Status: implemented · Desktop Lot 4

# RFC: embedded acpx chat with native elicitation

This page is the implementation record for the primary Deno Desktop conversation.
The [acpx 0.13.1 alignment](acpx-0.13.1-elicitation-alignment.md) is complete, while the
[Deno Desktop shell](deno-desktop-product-shell.md) hosts the separate Chat capability
in product `0.4.0`. It does not turn the Workbench HTTP surface into a command channel
or make chat history engineering evidence.

## Current implementation boundary

- The component manifest declares active sidecar `chat-host` `0.4.0`.
- The packaged target is `darwin-arm64`, using official Node `26.5.0`, exact Casys acpx
  commit `3c927fc`, and exact adapter `1.1.5`, all with recorded digests. Linux and
  Windows are modelled targets with `missing-pins` and stop explicitly.
- `BrowserWindow.bind` exposes only snapshot and command functions over
  `casys-desktop-chat/1.0`. The React renderer reconstructs closed DTOs and receives no
  path, process handle, MCP/provider credential, arbitrary HTML, or raw tool payload.
- The dashboard binds new conversations to the validated Workbench project projection;
  it offers no free-form project selector. The Chat Host validates the project id again.
- Metadata and bounded transcripts use a separate retained chat store. Thread/CAS
  remains authoritative.

## Target outcome

A user will be able to work with the Casys agent inside Deno Desktop, see streamed
progress, answer ACP form/URL elicitations, accept or decline exact consequential
reviews, and resume a project conversation. All engineering actions must still pass
through registered Casys MCP operations and existing server authority.

The embedded chat is intended to become the default product interaction. Claude Code,
Codex, Grok, and other native clients may remain optional companion access through
`mcp-bridge` to the same local project and server.

## Target topology

```text
Deno Desktop renderer
  ├─ Chat UI ── typed IPC ──> privileged Chat Host
  └─ Workbench <──────────── GET + SSE only

privileged Chat Host
  ├─ per-session FIFO and lifecycle
  ├─ pinned acpx runtime sidecar
  ├─ permission + elicitation handlers
  └─ exact adapter configuration
                  │
                  v
           Casys MCP server :3020
                  │
                  v
       registered server-owned operations
```

The Chat Host is a sibling of the Workbench BFF, not part of it. The renderer
must never receive MCP credentials, provider credentials, ACP process handles, or raw
filesystem and terminal authority.

## Why acpx

Here acpx has concrete value beyond provider-native CLI access: one embedded ACP runtime
can provide supported agent adapters, session continuity, streaming events,
cancellation, permissions, and native elicitation behind a single host contract. The
Desktop must not reimplement ACP connection/session machinery or invent a Casys-specific
elicitation protocol.

The implementation must pin the public `acpx/runtime` surface and the exact agent
adapter in a supervised Chat Host whose runtime requirement is explicit in the component
manifest. Whether that host is a dedicated executable or another bounded process is an
implementation decision for this lot; it must not be folded into the existing
control-plane helper. The Deno Desktop host communicates through one closed, versioned
IPC contract. A CLI subprocess may be used for diagnostics, but human-readable CLI
output is not the production IPC protocol.

## Implemented session contract

- One Desktop conversation owns one exact acpx session and one explicit Casys project
  focus.
- Turns for a session are FIFO. A second send cannot race an active prompt.
- Resume uses the persisted acpx session identity plus current Casys project state; it
  never treats conversational memory as current Thread truth.
- Switching project focus is explicit and starts or attaches the corresponding
  conversation. No hidden default project is inferred.
- Cancel aborts the active prompt and any pending elicitation. It does not forge a
  provider outcome or delete persisted engineering state.
- Closing Desktop drains or cancels owned turns, closes sidecars, and leaves no orphan.

## Enduring MCP boundary

The embedded agent sees the Casys Digital Thread MCP server, not raw engineering
provider MCP servers. Registered server operations continue to own provider/tool/args,
lowering, recovery, CAS, and Thread publication.

The bridge and embedded Chat Host may both connect to the same local Casys
server, but they must not share an active ACP session concurrently. The server remains
the arbiter of project basis and run claims; neither client can repair a conflict by
selecting a provider call or stale revision.

## Elicitation contract

acpx `0.13.1` exposes the aligned API. The Desktop host configures only the modes for
which its native renderer is installed:

- `form` — render supported structured fields from the ACP request as native controls;
  preserve exact schema, `sessionId`, optional `toolCallId`, and request id;
- `url` — display the exact origin and purpose, require an explicit human open/return,
  and propagate `elicitation/complete`; and
- responses — return exactly `accept`, `decline`, or `cancel` with validated content.

Unsupported schemas/modes, missing handlers, mismatched sessions, replaced prompts,
shutdown, timeout, or late responses return `cancel` or a literal unavailable result.
The host never invents a default answer or auto-accepts.

The renderer receives a safe view model, never arbitrary HTML or executable content from
an elicitation. Form fields are bounded by the installed renderer contract; an unknown
construct fails closed.

## Permission is not MRTR

ACP `session/request_permission` asks whether an agent may perform a tool action in its
host. Casys MRTR is the human's consequential engineering decision bound to an exact
project/Thread revision and registered operation. They are distinct.

A chat answer becomes authoritative only when the owning Casys operation validates the
exact elicitation response and persists its normal signed decision/retry path. acpx and
the Desktop do not manufacture or reuse that decision.

## Privacy and persistence

- ACP transcripts and session metadata provide conversation continuity only.
- Thread/CAS remains the durable engineering record.
- Generic ACP taps, application logs, crash reports, and telemetry must not contain
  elicitation schemas, answers, prompts, source, CAD, solver values, credentials, or
  provider payloads.
- If transcript retention is enabled, it uses a separate local store with an explicit
  retention/deletion policy and never becomes sensitivity experience.
- The Chat Host passes only the minimum sanitized event model required by the renderer.

## Implemented lots

### Lot 1 — pinned Chat Host

**Implemented.** A closed native launcher accepts only one exact data-root argument and
executes the private official Node plus fixed `main.mjs`. The host imports the packaged
`acpx/runtime`; no ambient Node/acpx/adapter or checkout fallback exists.

- Consume the aligned, pinned acpx runtime and exact agent adapter.
- Define the Desktop IPC DTOs for session lifecycle, turns, streaming events, status,
  cancellation, permissions, and elicitation.
- Implement per-session FIFO, ownership, graceful shutdown, and orphan checks.

### Lot 2 — conversation UI

**Implemented in the Workbench React dashboard.** Normal browser previews feature-detect
the absent Desktop binding and render no simulated authority. The static Desktop shell
remains only a diagnostic fallback when the Workbench cannot be served.

- Render user/agent turns, streamed progress, tool activity summaries, errors, and
  project focus.
- Keep raw protocol/provider details behind explicit inspection.
- Project completed work from persisted Casys evidence rather than chat assertions.

### Lot 3 — native elicitation

**Implemented.** Form and URL interactions preserve correlation, support
`accept`/`decline`/`cancel`, propagate abort, and reject late or mismatched replies.
URL opening is a separate HTTPS-only Desktop capability that invokes the external
browser; the privileged webview does not navigate to the requested origin.

- Enable `form` and `url` modes only when their renderers are installed.
- Implement `accept`, `decline`, `cancel`, abort, timeout, prompt replacement, and late
  response behavior.
- Exercise one real registered Casys human-decision path end to end.

### Lot 4 — companion bridge coexistence

**Prepared, with companion live proof still separate.** Desktop session keys use the
reserved `casys-desktop-exclusive/<project>/<conversation>` namespace and the host
rejects a backend/agent session identity already owned by another conversation. A bridge
must use another session and may share only the server-authoritative project/Thread.

- Document connection from Claude Code, Codex, and Grok through `mcp-bridge`.
- Prove embedded and companion clients observe the same project/Thread truth without
  sharing or racing one ACP session.

## Acceptance evidence in product 0.4.0

- The packaged-runtime smoke imports the real fork runtime, creates a session, starts and
  streams one turn, crosses form elicitation, closes it, and observes no fixture agent or
  grandchild orphan.
- Two rapid sends remain ordered and do not cross session/project ownership.
- Form elicitation preserves request/session/tool-call identity and validates accepted
  content.
- `decline`, `cancel`, timeout, shutdown, and late responses all fail closed.
- URL completion is correlated to the exact request.
- A focused regression proves schemas and answers do not enter generic ACP taps or logs.
- A Desktop Chat E2E drives `project_brief_confirm` through the real Casys HTTP server:
  first `input_required`, then accepted form content with signed `requestState`, server
  retry verification, and persisted human approval. Ordinary ACP permission remains a
  separately labelled interaction and cannot substitute.
- Chat Host client shutdown is bounded through graceful request, `SIGTERM`, and
  `SIGKILL`; a final unsettled status is surfaced as `unresolved` instead of hanging or
  claiming exit.
- Workbench remains GET/SSE only and has no MCP credential or command IPC.
- The packaged macOS application and a companion bridge must still be exercised
  together before claiming a live coexistence proof. Linux and Windows remain
  `missing-pins`, not shipped packages.

## Stop rules

Stop rather than adding a Workbench POST, exposing raw provider MCP, auto-accepting an
elicitation, treating a permission as MRTR, persisting sensitive answers in generic
logs, allowing concurrent owners of one ACP session, or implementing a second ACP stack
inside Desktop.
