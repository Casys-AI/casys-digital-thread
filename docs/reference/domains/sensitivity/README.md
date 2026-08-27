# Sensitivity domain reference

Audience: both · Diátaxis: reference · Kind: index

The sensitivity bounded context owns first-order study declarations, catalog offers,
base-metric joins, and vector correction. It does not own isolated CalculiX proof
execution or Build123d admission.

- [Boundedness inventory](boundedness.md) — H01 catalog, vector, and derived CAD
  ceilings.
- [Compile sensitivity parameters](../../../how-to/compile/compile-sensitivity-parameters.md)
  — operational parameter walk.

A proof-run evaluation cannot authorize `design.apply-vector-correction@1`.
`verify.evaluate-sensitivity-base@1` joins `sensitivity-base-<metric>-<digest>` only.

## Installation-private exact reuse

`analyze.run-fea-sensitivity@1` owns an optional server-internal exact memoization path
between projects in one trusted local installation. Before any sensitivity CAD dispatch,
the server compiles the target's project-neutral scientific key from the sealed case,
admitted source, frozen Build123d identities, and the exact observed pinned CalculiX
runtime. Callers cannot provide an experience id, key, source project, provider, or
runtime.

An exact healthy hit publishes a target-local reuse review, receipt, observations, and
`sensitivity-study-reuse-result/1.0`; it performs neither of the two CAD executions nor
either solver call. The reused result contains target study facts, measurements,
derivatives, and its receipt fingerprint, but no CAD claim or readable source origin.
Fresh execution still publishes `sensitivity-study-capture/1.0`. Base evaluation,
sensitivity edges, and vector correction accept this closed scientific-result union
without changing their existing freshness or MRTR rules. A later CAD correction is a new
`project_resource_capture` plus a successor workspace file revision.

An `exact` review is the only hit. A scientific-key miss is `incompatible`; provenance,
lineage, freshness, runtime, or index that cannot be proven is `unavailable`; divergent
results under one key are `unresolved`. Before a hit, the server proves that the source
project's current intact Thread tip descends from the exact admitted source snapshot and
rereads every bound artifact as fresh. Every non-`exact` outcome fails closed to the
normal registered execution path.

Review/receipt replay is WAL-backed. The WAL rejects symlinked directory ancestors and
records transplanted between project/run tuples before selecting any rewrite path. The
installation-private index is reconstructible from append-only admission and
invalidation journals; it is not an agent or Workbench surface. Nothing is shared with a
team, another installation, a registry, or a marketplace. The registered-operation and
persistence contracts described on this page are the public source of truth.
