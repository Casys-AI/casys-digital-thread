# Reference: project capability demand

Audience: both · Diátaxis: reference · Kind: contract

`project-capability-demand/2.0` is the read-only, provider-neutral semantic runtime
ceiling compiled from one immutable engineering-project snapshot and the code-owned
registered-operation registry. It is not a runtime plan.

The registry declares exactly one `runtimeDemand` for every registered operation. It may
also declare closed `runtimePreparationPrerequisites`: exact internal operation references
which resolve only for the owning operation's demand, never as caller-planned work:

- `{ kind: "none" }` means the operation is resolved and requires no runtime capability;
- `{ kind: "required", capabilities: [...] }` names one or more versioned semantic
  capabilities, each with a minimum qualification and use (`preparation` or
  `execution`).

Neither form may select a provider, package, image, endpoint, tool, argument, port,
profile, or secret. The registry is the single demand authority; a second
operation-to-capability authority is not valid.

## Exact bases

The compiler takes a validated immutable project snapshot and the complete trusted
registry view selected by server composition. It never accepts a caller-provided
alternate demand authority. The result records these exact bases:

- project snapshot;
- approved brief basis;
- plan publication;
- complete registry fingerprint, including `none` operations.

The normal compiler lives in
[`compile-project-capability-demand.ts`](../../../../src/application/control-plane/compile-project-capability-demand.ts).
The atomic runtime catalogue consumes this same complete registry-derived demand; no
recipe name, package, or route can filter its authorization ceiling.

## History, ceiling, and JIT demand

Every work-item revision is recorded in `workItemHistory`, sorted by id, with its id,
activity, optional predecessor, status, operation identity without bindings, and literal
`resolved` or `unresolved` resolution. A historical operation unknown to the selected
registry remains `unresolved`; it is never silently treated as `none`.

`plannedCeiling` contains the current leaf revisions of every activity, computed with
`leafRevisionIdsForActivity`. Cancelled and abandoned leaves are excluded; completed
leaves remain. `jitDemand` is the subset of those same ceiling leaves whose status is
`ready` or `in-progress`.

Both slices contain canonical operation groups sorted by exact id/version and sorted
flattened requirements. A known `none` operation is a resolved group with an empty
capability list. A current unknown operation is an explicit
`unresolved / operation-unregistered` group. Malformed, cross-activity, disconnected,
cyclic, or root-ambiguous histories fail closed.

Subset coverage is evaluated against `plannedCeiling`, never `jitDemand`. An unresolved
ceiling group fails coverage. An allowed capability must match id, version, and use
exactly; `qualified` covers `compatible`, never the reverse.

## Fingerprints

The four deterministic SHA-256 fingerprints have separate meanings:

| Fingerprint                 | Binds                                                                        |
| --------------------------- | ---------------------------------------------------------------------------- |
| `registryFingerprint`       | Every registered operation id/version/runtime demand, `prerequisiteOnly` marker and preparation-prerequisite edge, including `none` |
| `historyPathFingerprint`    | Project snapshot, brief, plan, registry and full canonical work-item history |
| `plannedCeilingFingerprint` | Only the exact current authorization ceiling                                 |
| `jitDemandFingerprint`      | Only the ready/in-progress demand slice                                      |

The latter two fingerprints are independently canonical: neither nests history nor the
other demand slice. They are equality and approval-basis identities, not claims that a
runtime is installed, active, healthy, or qualified. Compiling a demand does not mutate
a runtime, authorize a brief, supervise a process, dispatch an operation, or publish
Thread evidence.
