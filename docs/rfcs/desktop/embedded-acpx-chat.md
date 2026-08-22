Audience: agent · Diátaxis: none · Kind: RFC

Status: proposed · Not implemented

# RFC: embedded acpx chat with native elicitation

This page is the future implementation brief for the primary Deno Desktop conversation.
The [acpx 0.13.1 alignment](acpx-0.13.1-elicitation-alignment.md) is complete, while the
[Deno Desktop shell](deno-desktop-product-shell.md) currently stops at Lot 2. This RFC
does not describe a capability present in product `0.2.0`; it does not turn the
Workbench into a command surface or make chat history engineering evidence.

## Current implementation boundary

- The Desktop component manifest declares `chat-host` with no version and lifecycle
  `deferred-lot-4`.
- No module under `desktop/` imports `acpx/runtime`, launches an acpx process, exposes
  chat IPC, persists an ACP session, or renders a conversation.
- The current WebView receives one static diagnostics document. The Workbench GET/SSE
  projection is also deferred, independently of chat.
- The separate acpx checkout and global CLI are aligned on `0.13.1`. That proves the
  dependency surface exists; it does not prove Desktop host wiring, renderer safety,
  session persistence, or a Casys MRTR path.

Everything below is a target contract and future acceptance gate.

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

The future Chat Host is a sibling of the Workbench BFF, not part of it. The renderer
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

## Future session contract

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

The bridge and future embedded Chat Host may both connect to the same local Casys
server, but they must not share an active ACP session concurrently. The server remains
the arbiter of project basis and run claims; neither client can repair a conflict by
selecting a provider call or stale revision.

## Elicitation contract

acpx `0.13.1` already exposes the aligned API. When Desktop implements its host,
configure only the modes for which a native renderer is installed:

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

## Future implementation lots

### Lot 1 — pinned Chat Host

**Not implemented.**

- Consume the aligned, pinned acpx runtime and exact agent adapter.
- Define the Desktop IPC DTOs for session lifecycle, turns, streaming events, status,
  cancellation, permissions, and elicitation.
- Implement per-session FIFO, ownership, graceful shutdown, and orphan checks.

### Lot 2 — conversation UI

**Not implemented.**

- Render user/agent turns, streamed progress, tool activity summaries, errors, and
  project focus.
- Keep raw protocol/provider details behind explicit inspection.
- Project completed work from persisted Casys evidence rather than chat assertions.

### Lot 3 — native elicitation

**Not implemented.** The acpx API dependency is ready; the Desktop form/URL renderer,
correlation and fail-closed lifecycle are not.

- Enable `form` and `url` modes only when their renderers are installed.
- Implement `accept`, `decline`, `cancel`, abort, timeout, prompt replacement, and late
  response behavior.
- Exercise one real registered Casys human-decision path end to end.

### Lot 4 — companion bridge coexistence

**Not implemented as a Desktop integration proof.** Existing bridge access is an
external companion surface, not evidence that the embedded session exists.

- Document connection from Claude Code, Codex, and Grok through `mcp-bridge`.
- Prove embedded and companion clients observe the same project/Thread truth without
  sharing or racing one ACP session.

## Future acceptance — none claimed by product 0.2.0

- Desktop starts a pinned agent, streams one turn, cancels one turn, and resumes one
  session after application restart.
- Two rapid sends remain ordered and do not cross session/project ownership.
- Form elicitation preserves request/session/tool-call identity and validates accepted
  content.
- `decline`, `cancel`, timeout, shutdown, and late responses all fail closed.
- URL completion is correlated to the exact request.
- A focused regression proves schemas and answers do not enter generic ACP taps or logs.
- A real Casys MRTR path requires its exact server validation; ordinary permission or
  chat text cannot substitute.
- Killing/restarting Desktop leaves no Chat Host or agent child orphan and does not
  corrupt the Casys project.
- Workbench remains GET/SSE only and has no MCP credential or command IPC.
- A companion native CLI reads the same persisted project state through the bridge but
  creates no alternate evidence truth.

## Stop rules

Stop rather than adding a Workbench POST, exposing raw provider MCP, auto-accepting an
elicitation, treating a permission as MRTR, persisting sensitive answers in generic
logs, allowing concurrent owners of one ACP session, or implementing a second ACP stack
inside Desktop.
