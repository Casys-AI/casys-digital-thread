# Reference: canonical `ThreadSnapshot` contract

> **Diátaxis category: reference.** This page describes the domain contract implemented
> in [`src/domain/thread-snapshot.ts`](../../src/domain/thread-snapshot.ts) and its
> local immutable file adapter.

`ThreadSnapshot` is the versioned, transport-independent state of one executable digital
thread. It is the canonical product model shared by orchestration, persistence, and
presentation. MCP responses and the browser-specific projection are adapters around this
model; neither is the source of truth.

The current schema version is `1.0`. Every value is JSON-compatible and every reference
uses a stable identifier.

## Subject identity and extensions

Provider evidence begins under provider-native identities. It may be attached to a
common product subject only through a reviewed
[`ThreadSubjectManifest`](../../src/domain/thread-subject-manifest.ts), currently
[`coffee-machine-cm01.json`](../../config/thread-subjects/coffee-machine-cm01.json).
Each binding is an exact `{provider, kind, id}` tuple. A matching label, part name, or
model name is never enough to join two branches.

Providers contribute bounded `ThreadSnapshotExtension` values; the assembler is the sole
component that advances the root revision and records its artifact changes. An extension
adds evidence and provenance. It does not imply that its branch caused, invalidated, or
verifies another branch unless an explicit link exists in the snapshot.

## Root fields

| Field             | Contract                                                                 |
| ----------------- | ------------------------------------------------------------------------ |
| `id`, `revision`  | Stable snapshot identity and positive revision                           |
| `previous`        | Optional previous snapshot identity and revision                         |
| `generatedAt`     | ISO timestamp for this materialized state                                |
| `subject`         | Versioned system, assembly, part, or process under analysis              |
| `freshness`       | Aggregate `fresh`, `stale`, `running`, or `failed` state                 |
| `changeSet`       | Proposed or applied changes that explain invalidation                    |
| `artifacts`       | Versioned model, script, CAD, STEP, mesh, solver, BOM, and evidence data |
| `consumptions`    | Consumer attestations for exact artifact bytes                           |
| `observations`    | Named, unit-bearing engineering measurements with source provenance      |
| `requirements`    | Model-owned criteria and traces to constrained artifacts                 |
| `evaluations`     | Units-aware comparisons and their evidence                               |
| `violations`      | Named actionable violations; never only an unexplained number            |
| `provenance`      | Typed causal links between all entities                                  |
| `proposedActions` | Explicit recompute, correction, review, synchronization, or inspection   |

The validator in
[`src/domain/thread-snapshot-validation.ts`](../../src/domain/thread-snapshot-validation.ts)
rejects structurally invalid JSON and broken references. It never fills missing
engineering data, invents units, or converts an unresolved state into success.

## Artifact identity and consumption

Every `ThreadArtifact` has a lowercase SHA-256 content fingerprint. A path is only a
location and may be reused; it is not an identity. A downstream tool therefore records a
separate `ThreadArtifactConsumption` containing:

- the producer artifact ID;
- the consumer server, tool, and run ID;
- the SHA-256 recomputed from the bytes actually read;
- `verified` or `mismatch` and the verification timestamp.

The CAD → FEA edge is valid only when the STEP producer fingerprint equals the
consumer-observed fingerprint. Supplying an expected hash is a precondition, not a hint:
a mismatch must fail before meshing or solving.

On 2026-08-01 this boundary was proved against the local provider checkouts:

| Evidence                       | Observed value                                                     |
| ------------------------------ | ------------------------------------------------------------------ |
| STEP size                      | `35319` bytes                                                      |
| build123d STEP SHA-256         | `b29f52b39a390405d271ca4eceb3f0cdfd675cabe944d4babb8dd21f0010e3fd` |
| CalculiX consumed STEP SHA-256 | Same digest                                                        |
| Maximum displacement           | `0.0427849 mm`                                                     |
| Maximum von Mises stress       | `26.2900 MPa`                                                      |
| Negative test                  | A false expected hash was rejected before the solve                |

This is a local integration proof, not yet a committed or published provider release.
Consumers must continue to discover and validate the actual live schemas.

## Freshness, evaluations, and violations

Every derived entity has explicit freshness. `stale` and `failed` states require a
reason; `invalidatedByChangeIds` records the changes responsible for recomputation.
Opening the UI does not change freshness and never makes an entity fresh.

An evaluation has one of `pass`, `fail`, `unresolved`, or `error`. A failed evaluation
may create a named violation linked to its requirement, observations, and evidence.
`unresolved` and `error` remain visible outcomes; they are not optimistic passes.

The current live CoffeeMachine SysON model contains two `RequirementUsage` elements but
zero `ConstraintUsage` elements. It therefore does not yet provide model-owned criteria
for a mechanical verdict. The existing `90 degC` comparison is a separate provisional
scenario contract, not proof of this product-requirement loop. An empty extracted list
remains explicit: a reviewed analysis case may still create FEA evidence, but it cannot
create a pass or fail.

## Persistence and UI status

[`src/domain/thread-snapshot-store.ts`](../../src/domain/thread-snapshot-store.ts)
defines the `get`, `latest`, and `save` persistence boundary.
[`src/adapters/file-thread-snapshot-store.ts`](../../src/adapters/file-thread-snapshot-store.ts)
implements it as immutable JSON documents under ignored local state. Saving identical
content is idempotent; reusing a snapshot ID for different content is rejected. Every
read crosses the canonical validator again.

`deno task thread:assemble` materializes the declared CoffeeMachine CM-01 subject into
that store. It starts from a captured SysON inventory, reads the declared persisted
Modelica run, and reads the reviewed ERPNext BOM and Bin projections. Explicit build and
future FEA runners publish later immutable revisions. The BFF's passive read path
projects the latest validated subject snapshot into the deliberately smaller browser
contract. The projection is never promoted back into the canonical domain model, and
project commands cannot create thread evidence.

The browser projection includes a required `graph` with typed nodes and edges. Canonical
`provenance` links retain their relation and rationale. Exact `inputArtifactIds` and
observation source artifact IDs become explicit structural edges; no label or filename
matching is allowed. A CAD-to-solver edge may carry the corresponding consumption
attestation so the UI can distinguish a semantic relation from matching producer and
consumer bytes.

Every projected graph node may expose `recordedAt`, copied from the closest canonical
timestamp for that entity: applied change time, freshness change time, consumption
verification, observation capture, evaluation, or violation detection. It only orders
the activity feed. The projector does not invent a timestamp for a proposed action whose
canonical contract has none.

The BFF also exposes `/api/thread/workbench/events` as a passive SSE stream. Its event
ID is `<project-revision>:<thread-revision>:<live-sequence>` and its data is the
complete validated Workbench projection. Full replacement snapshots are intentional: the
browser never has to apply an unvalidated partial lineage patch, reconnection is
idempotent, and observing the stream cannot execute an engineering tool. Project
commands may cause a new full replacement, but completion is accepted only after the
cited exact technical snapshot and its entities already exist.

A clean CM-01 bootstrap contains SysON, Modelica, and ERPNext evidence; explicit runs
add build123d and later CalculiX revisions. None is a solver run performed on UI load.
With zero model-owned criteria, evaluations, and violations, the UI says “verdict
unavailable” instead of treating the absence of a violation as success.

Per-component identity is deliberately declared in the separate reviewed
[`ThreadComponentCatalog`](thread-components.md). Its bindings cite artifacts in this
canonical snapshot, including the complete ERPNext BOM-detail artifact. The catalog can
identify cross-tool facets without adding an unrecorded causal edge to canonical
provenance.
