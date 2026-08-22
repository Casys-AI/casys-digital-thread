# Isolation, WAL, and Thread collection bounds (H01)

Audience: both · Diátaxis: reference · Kind: inventory

HEAD inventory for surfaces that are not owned by one engineering domain: Thread
snapshot collections, analysis-graph evidence, project evidence refs, isolated output
counts, and WAL generations. Domain source/runtime numbers stay on the domain pages.
This page does not invent a generic isolated-output quota.

Status words: **enforced**, **physical-only**, **unbounded**, **needs decision**.
`unavailable` and `unresolved` stay literal.

Domain inventories: [SysML](../domains/sysml/boundedness.md),
[CAD](../domains/cad/boundedness.md), [Modelica](../domains/modelica/boundedness.md),
[FEA](../domains/fea/boundedness.md),
[sensitivity](../domains/sensitivity/boundedness.md),
[electrical](../domains/electrical/boundedness.md).

## Thread snapshot collections

Authority:
[`thread-snapshot-validation.ts`](../../../src/domain/thread/thread-snapshot-validation.ts)
(`validateArray` walks every item and has no `maxItems`). Schema 1.1 requires
`analysisGraph`; 1.0 forbids it.

| Collection | Today | Status | Missing value |
| ---------- | ----- | ------ | ------------- |
| `artifacts`, `consumptions`, `observations`, `requirements`, `evaluations`, `violations`, `provenance`, `proposedActions` | Schema-validated arrays; uniqueness and reference invariants | Enforced shape; **unbounded** cardinality | Needs a product/storage decision. No isolation profile supplies a snapshot-size number. |
| `changeSet` entries | Same | Same | Same |

## Analysis graph and assertion evidence

Authority:
[`analysis-graph.ts`](../../../src/domain/thread/analysis-graph.ts),
[`engineering-assertion.ts`](../../../src/domain/thread/engineering-assertion.ts).

| Surface | Today | Status | Missing value |
| ------- | ----- | ------ | ------------- |
| Graph nodes / relations | Non-empty; unique node ids and semantic refs; unique assertion ids; every node referenced | Enforced minima and uniqueness; **unbounded** upper count | Needs a product/storage decision |
| Assertion `evidence` | Non-empty; unique evidence ids | Enforced non-empty; **unbounded** upper count | Same |

## Project evidence refs

Authority:
[`engineering-project-validation.ts`](../../../src/domain/project/engineering-project-validation.ts)
(`uniqueEvidence` on phases, work items, and agent runs). Completed non-annotation work
requires at least one ref; annotation runs must have none.

| Surface | Today | Status | Missing value |
| ------- | ----- | ------ | ------------- |
| `evidenceRefs` | Unique `(snapshotId, revision, kind, id)` tuples; emptiness rules by status | Enforced uniqueness and emptiness rules; **unbounded** upper count | Needs a product/storage decision |

## Isolated output counts

Authority:
[`isolated-code-execution.ts`](../../../src/domain/compile/isolation/isolated-code-execution.ts)
(`validateIsolatedCodeOutputManifest` requires a non-empty unique-role list; it does
not impose a generic maximum). Active product manifests:

| Profile | Output count | Authority |
| ------- | ------------ | --------- |
| Build123d | Exactly 1 (`geometry`) | [CAD boundedness](../domains/cad/boundedness.md) |
| Admitted Modelica | Exactly 2 (`evidence`, `result`) | [Modelica boundedness](../domains/modelica/boundedness.md) |
| Qualified Modelica kit | Exactly 2 (`evidence`, `result`) | Same |
| CalculiX static proof | Exactly 9 roles | [FEA boundedness](../domains/fea/boundedness.md) |

No arbitrary generic isolated-output count is needed. Electrical has no executor.

Per-file and total output bytes are profile-specific and already listed on those domain
pages. They are read from `server.ts` (`LOCAL_*_EXECUTION_LIMITS`) and the matching
profile/worker modules.

## WAL attempts and generations

Producer generation is server-owned `0 | 1`. Advance is only `0 → 1`
(`createIsolatedOutputProducerGenerationAdvance`).

| Store | Today | Status | Missing value |
| ----- | ----- | ------ | ------------- |
| CAD / admitted Modelica / qualified-kit / CalculiX execution WAL | One attempt file per `(projectId, agentRunId)` digest path; generation 0 then optional 1 | Enforced 0\|1; **no retained-run or WAL-file quota** | A quota would be a product/storage decision. Not implied by output-role counts. |
| Admitted Modelica WAL file bytes | `MAX_WAL_BYTES = 1_048_576` in [`file-execution-attempt-store.ts`](../../../src/adapters/modelica/admitted/file-execution-attempt-store.ts) | Enforced per file | This is not an attempt-count quota. CAD, CalculiX, and qualified-kit stores have no equivalent byte ceiling. |
| Admitted-observation evaluation WAL (L4 / SysON) | Filename is `encodeURIComponent(JSON.stringify([projectId, runId, step]))` under a fixed directory; no digest key; no symlink-confined tree like the admitted execution store | Path construction is weaker than the execution WALs | State as a construction difference. `encodeURIComponent` encodes `/`; this inventory does not claim a demonstrated traversal or remote exploit. |

There is no electrical WAL.
