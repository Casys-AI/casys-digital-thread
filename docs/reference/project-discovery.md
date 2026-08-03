# Reference: `ProjectDiscoverySnapshot` contract

> **Historical schema 2.0 reference.** New work starts directly as an engineering
> project and uses the living brief documented in
> [`project-brief.md`](project-brief.md). The default MCP server and cockpit expose no
> Discovery creation or preview surface. This page exists only to explain immutable
> projects that were already recorded through the retired contract in
> [`src/domain/project-discovery.ts`](../../src/domain/project-discovery.ts), its MCP
> authoring surface, and its former conversation-owned human confirmation boundary.

`ProjectDiscoverySnapshot` owns the conversation before an engineering project exists.
It captures a person's plain-language intent, agent-prepared questions, sourced answers,
and one proposed brief. It never creates a `ThreadSnapshot`, technical proof, approved
requirement, or engineering project by implication.

The current schema version is `1.0`. Every accepted revision is strictly validated,
deeply frozen, persisted as a new file, and linked to the exact preceding revision.

## Truth and authority boundaries

| Boundary            | Owns                                                                                              | Explicitly absent                                      |
| ------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Discovery           | Reported intent, bounded questions, sourced answers, assumptions, proposed brief and human review | CAD, simulation, requirement verdicts and project work |
| Engineering project | Approved objective, work, decisions, authorizations and agent runs                                | Discovery guesses promoted without review              |
| Digital thread      | Exact artifacts, observations, provenance and evaluated requirements                              | Product intent and human authority                     |

A discovery can reach `approved` only after the person confirms the exact proposed brief
through signed MCP elicitation in the paired conversation. The agent may then call the
domain handoff to create revision 1 of an `EngineeringProjectSnapshot`. The handoff is
bound to that exact discovery revision, idempotent by command ID, and preserves the
approved brief fingerprint under `discoveryHandoff`. The resulting project intentionally
has no SysON model, `ThreadSnapshot`, phase, run, decision, or technical evidence. The
agent creates only the durable project shell; it does not imply that a technical plan is
already available. Creating an empty or fake technical thread is never a substitute for
that later work.

## Root fields

| Field                           | Contract                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `id`, `discoveryId`, `revision` | Immutable snapshot identity, stable discovery identity and positive revision |
| `previous`                      | Exact preceding snapshot identity after revision 1                           |
| `generatedAt`                   | Server-stamped ISO timestamp                                                 |
| `status`                        | `discovering`, `awaiting-review`, `revision-requested`, or `approved`        |
| `intent`                        | Plain-language statement plus the actor and time that reported it            |
| `questions`                     | Agent-prepared, bounded questions in presentation order                      |
| `answers`                       | Sourced `provided` or first-class `unknown` answers with supersession        |
| `brief`, `review`               | Proposed working brief and review bound to its exact SHA-256 scope           |
| `commandReceipts`               | Durable idempotency and audit ledger                                         |

Every question explains why it matters, supplies bounded directions and their
consequences, names one recommendation with confidence, permits `unknown` when
appropriate, records risk, and lists evidence which could later resolve the point. A
provided answer must be one of the question's bounded values. The store never invents an
answer or silently turns `unknown` into an assumption.

The V1 brief contains the intended objective, mission scenarios, success criteria,
constraints, exclusions, assumptions, open questions, verification plan, intended
markets, and manufacturing and operating jurisdictions. `complianceTargets` are only
candidate planning context. They are not legal conclusions, licensed standards text, or
certification evidence.

The first compliance validation case is EU UAS. V1 deliberately does not implement a
worldwide regulatory resolver. The simple jurisdiction fields keep the discovery
portable while the detailed, versioned compliance-case model remains a later layer; see
[Compliance evidence cases](../explanations/compliance-evidence-cases.md).

## Agent MCP surface

The Console server at `http://127.0.0.1:3020/mcp` exposes:

- `project_discovery_start`;
- `project_discovery_snapshot`;
- `project_discovery_question_propose`;
- `project_discovery_answer_record`;
- `project_discovery_brief_propose`;
- `project_discovery_brief_confirm`;
- `project_discovery_project_create`.

All mutations use a stable `commandId`, `issuedAt`, and optimistic `expectedRevision`.
The MCP subject or client identity is recorded as the agent actor for authoring and
handoff. A still-pending brief may be superseded directly by a new agent proposal after
the person corrects it in conversation; no browser-side revision request is required.

`project_discovery_brief_confirm` is different from an ordinary agent mutation. Its
first call returns an MCP `2026-07-28` MRTR `input_required` result containing an
`elicitation/create` form for the exact brief ID and SHA-256 fingerprint. The host asks
the person in the current conversation, then retries the same tool call with the opaque
`requestState` and response. Only a framework-verified retry with explicit confirmation
can call the human-only domain approval. Declining changes no state. The agent cannot
supply a different brief or treat its own prose as approval.

`project_discovery_project_create` is available only after that confirmed revision. It
derives the project name server-side from the approved objective and creates an empty
planning shell. It cannot attach SysML, CAD, simulation, measurement, evidence,
decisions, phases, or runs.

## Cockpit projection

The loopback Discovery BFF exposes:

- `GET /api/project-discoveries/:id` for one complete immutable snapshot;
- `GET /api/project-discoveries/:id/events` for full replacement snapshots as
  `event: project-discovery-snapshot`, with the revision as event ID.

The Discovery Workbench is a shared project record for a paired conversation, not a
form-first authoring surface. The agent asks and discusses the active question through
the paired conversation, then records the agreed answer through the MCP surface. The
browser follows those immutable revisions through JSON and SSE. Corrections,
confirmation, and project creation happen in the conversation; the page contains no
authority button or browser-to-MCP command proxy.

The browser consumes ordinary JSON and SSE. It receives no generic MCP endpoint,
provider credentials, or MCP Apps iframe. Agent tool calls and human review converge on
the same immutable file store under `state/local/project-discoveries/`.

## Agent-selected cockpit focus

Discovery authoring and cockpit routing are separate. Once a discovery already exists,
the paired agent can use `cockpit_focus_set` to select it for a named read-only cockpit
workspace (normally `primary`). It first reads `cockpit_focus_snapshot`, then submits a
stable `commandId`, `issuedAt`, and that focus revision as `expectedRevision`. After the
person confirms the brief and the agent creates the empty project shell through the
normal `project_discovery_project_create` handoff, the agent may select that project in
the same workspace instead.

A focus is not part of `ProjectDiscoverySnapshot`, does not alter any discovery revision,
and is never a confirmation, approval, plan, run, provider call, or evidence record.
It only tells the passive single-shell cockpit which existing dossier to read. The
browser has no project selector or mutation route; selection stays in the paired agent
conversation. See [the Console reference](../console.md#cockpit-focus-tools) for the
two focus-tool contracts.

## MRTR runtime boundary

`MCP_MRTR_SIGNING_KEY` is a server-only signing secret for opaque MRTR `requestState`;
it is not a user identity, MCP bearer token, or provider credential. Configure a stable,
high-entropy value for persistent deployments. When it is absent, the loopback server
generates a process-ephemeral key. That is convenient for local development, but a
pending elicitation cannot be completed after the process restarts.

Replay tracking is currently process-local. A shared signing key alone does not make
MRTR safe across replicas or restarts: another instance has not consumed the same nonce.
Before multi-instance deployment, configure a shared, durable replay store with atomic
consume semantics. Until that store is wired, run the control plane as one long-lived
instance and treat restart as cancellation of pending confirmations.
