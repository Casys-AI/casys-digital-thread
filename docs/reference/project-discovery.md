# Reference: `ProjectDiscoverySnapshot` contract

> **Diátaxis category: reference.** This page describes the immutable
> pre-project contract in
> [`src/domain/project-discovery.ts`](../../src/domain/project-discovery.ts),
> its MCP authoring surface, and the separate human review channel.

`ProjectDiscoverySnapshot` owns the conversation before an engineering project
exists. It captures a person's plain-language intent, agent-prepared questions,
sourced answers, and one proposed brief. It never creates a `ThreadSnapshot`,
technical proof, approved requirement, or engineering project by implication.

The current schema version is `1.0`. Every accepted revision is strictly
validated, deeply frozen, persisted as a new file, and linked to the exact
preceding revision.

## Truth and authority boundaries

| Boundary            | Owns                                                                                              | Explicitly absent                                      |
| ------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Discovery           | Reported intent, bounded questions, sourced answers, assumptions, proposed brief and human review | CAD, simulation, requirement verdicts and project work |
| Engineering project | Approved objective, work, decisions, authorizations and agent runs                                | Discovery guesses promoted without review              |
| Digital thread      | Exact artifacts, observations, provenance and evaluated requirements                              | Product intent and human authority                     |

A discovery can reach `approved`, but the current slice does not yet materialize
an `EngineeringProjectSnapshot` from it. That handoff must be an explicit
command which preserves the approved brief fingerprint; creating an empty or
fake technical thread is not an acceptable substitute.

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
appropriate, records risk, and lists evidence which could later resolve the
point. A provided answer must be one of the question's bounded values. The store
never invents an answer or silently turns `unknown` into an assumption.

The V1 brief contains the intended objective, mission scenarios, success
criteria, constraints, exclusions, assumptions, open questions, verification
plan, intended markets, and manufacturing and operating jurisdictions.
`complianceTargets` are only candidate planning context. They are not legal
conclusions, licensed standards text, or certification evidence.

The first compliance validation case is EU UAS. V1 deliberately does not
implement a worldwide regulatory resolver. The simple jurisdiction fields keep
the discovery portable while the detailed, versioned compliance-case model
remains a later layer; see
[Compliance evidence cases](../explanations/compliance-evidence-cases.md).

## Agent MCP surface

The Console server at `http://127.0.0.1:3020/mcp` exposes:

- `project_discovery_start`;
- `project_discovery_snapshot`;
- `project_discovery_question_propose`;
- `project_discovery_answer_record`;
- `project_discovery_brief_propose`.

All mutations use a stable `commandId`, `issuedAt`, and optimistic
`expectedRevision`. The MCP subject or client identity is recorded as the agent
actor. There is intentionally no MCP tool for brief approval or rejection.

## Human browser surface

The loopback Discovery BFF exposes:

- `GET /api/project-discoveries/:id` for one complete immutable snapshot;
- `GET /api/project-discoveries/:id/events` for full replacement snapshots as
  `event: project-discovery-snapshot`, with the revision as event ID;
- `POST /api/project-discoveries/:id/commands` for a bounded human answer, brief
  approval, or revision request.

The Discovery Workbench is a shared project record for a paired conversation,
not a form-first authoring surface. The agent asks and discusses the active
question through the paired conversation, then records the agreed answer through
the MCP surface. The browser normally follows those immutable revisions through
JSON and SSE.

`Correct from cockpit` is an intentionally folded recovery route for a missing
conversation or a record correction. Its bounded answer controls use the same
explicit browser command contract; they do not let the browser prepare agent
questions, proposals, engineering work, or technical evidence.

The POST requires exact same-origin JSON and
`X-Casys-Operator-Intent: explicit`. The local reviewer ID is self-declared and
useful for audit, but it is not authentication. A browser cannot prepare agent
questions or briefs, call an engineering provider, or create technical evidence.

The browser consumes ordinary JSON and SSE. It receives no generic MCP endpoint,
provider credentials, or MCP Apps iframe. Agent tool calls and human review
converge on the same immutable file store under
`state/local/project-discoveries/`.
