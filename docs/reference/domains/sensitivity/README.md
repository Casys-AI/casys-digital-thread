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

## Sealed study declaration

`analyze.seal-sensitivity-study@1` seals a
`sensitivity-study-case/3.0`; it does not seal a CalculiX request. The case keeps the
scientific declaration provider-neutral:

- `cadSource` names the exact content-addressed Thread artifact for the sealed
  compilation admission, with its SHA-256. The executor reopens and validates it before
  deriving either perturbed CAD source; the agent supplies no source text.
- `method` records physical mesh, material, supports, and loads. It contains no provider,
  endpoint, tool, response schema, runtime, path, or wire arguments.
- The sealed base value, finite-difference step, metrics, and domain define data to be
  observed. They do not define a verdict, a requirement mapping, or a correction grant.

`sensitivity-study-case/2.0` is not the current sealed case contract. Its provider and
tool literals were removed because runtime binding and lowering are server-owned.

## Recorded CalculiX route

When the registered binding is eligible, `analyze.run-fea-sensitivity@1` has one
server-owned path:

```text
sealed admission + sensitivity-study-case/3.0
  -> isolated Build123d base and stepped executions
  -> exact capability-session staging into casys-mcp-calculix
  -> one recorded CalculiX request per phase
  -> calculix_run_get readback and ordered resource capture
  -> sensitivity-study-capture/1.0 + finite-difference observations
```

Each `base` and `stepped` recorded solve must expose exactly this ordered nine-resource
ledger before its resources are independently captured into CAS:

`input.step`, `request.json`, `mesh.geo`, `mesh.inp`, `gmsh.log`, `job.inp`, `ccx.log`,
`job.dat`, `result.json`.

The adapter reopens the stable request id through `calculix_run_get`, checks the ordered
ledger, independently rehashes captured `request.json`, and normalizes only the static
observations. The two phase captures also feed a separate
`sensitivity-runtime-provenance/1.0` record. That record is L3 provenance of the
server-resolved runtime and recorded bundles; it is neither a provider qualification nor
a solver verdict.

## Current live binding and the isolated proof path

The HTTP `mcp-calculix` sensitivity binding is currently `unqualified`. Its exact
`casys-mcp-calculix` launch group and recorded protocol do not change that state: it is
non-activable until a live contract qualification is recorded. Until then, live
sensitivity execution is `unavailable`; no completed provider call, health observation,
or cached image may be presented as a sensitivity result or qualification.

`verify.run-fea-static-proof@3` is a separate product-static path: it uses the isolated
local CalculiX worker and a separate SysON oracle over a sealed mechanical proof case.
It is not the HTTP sensitivity route, does not qualify it, and a proof evaluation cannot
authorize sensitivity correction.

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
