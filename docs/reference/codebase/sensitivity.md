# Reference: source map — sensitivity

Audience: agent · Diátaxis: reference · Kind: contract

Census of study, edges, base evaluation, vector correction, and live-FEA observation
files. Those authorities are not interchangeable. Corrections return through
`AgentResource` plus a successor workspace file revision.

Index: [workspace source map](../codebase/codebase-map.md). Domain coverage stays
on [engineering domains](../domains/README.md).

## Source map

#### [`src/domain/sensitivity/`](../../../src/domain/sensitivity)

Sensitivity authorities: `study/` (`analyze.seal-sensitivity-study@1`) ≠ `edges/`
(`model.write-sensitivity-edges@1`) ≠ `base-evaluation/`
(`verify.evaluate-sensitivity-base@1`, join `sensitivity-base-<metric>-<digest>` only) ≠
`vector-correction/` (`design.apply-vector-correction@1`; a proof-run evaluation does
not authorize this) ≠ `live-fea/` (`analyze.run-fea-sensitivity@1`, observations only).
`compile.capture-corrected-source@1` is not registered. Not interchangeable

#### [`src/application/ports/in/sensitivity/`](../../../src/application/ports/in/sensitivity)

Inbound sensitivity ports split by authority: study seal-review ≠ base-evaluation review
≠ vector-correction review

#### [`src/application/ports/out/sensitivity/`](../../../src/application/ports/out/sensitivity)

Outbound live-fea `SensitivityStaticStructuralSolver`. Not the isolated CalculiX `@3`
proof runner

#### [`src/application/use-cases/sensitivity/`](../../../src/application/use-cases/sensitivity)

Sensitivity reviews by authority: study seal, base-evaluation join, vector-correction.
Tools stay under `src/tools/project-control/`

#### [`src/adapters/sensitivity/`](../../../src/adapters/sensitivity)

Sensitivity adapters by authority: `study/`, `edges/`, `base-evaluation/`,
`vector-correction/`, `live-fea/` (WAL + CalculiX solver + wire parser). Not a flat
`captures/` / `executors/` dump. Not `fea/seal-case` or `fea/isolated-v3`

#### [`src/adapters/sensitivity/server-composition.ts`](../../../src/adapters/sensitivity/server-composition.ts)

Sensitivity composition. Live FEA requires isolated Build123d plus CalculiX; base
evaluation and edges require SysON. Vector correction is not authorized by a proof-run
evaluation. Corrections return through `AgentResource` plus a successor workspace file
revision, not an admission seal.

#### [`src/domain/sensitivity/study/sensitivity-study.ts`](../../../src/domain/sensitivity/study/sensitivity-study.ts)

Reviewed sensitivity case and pure finite-difference derivatives

#### [`src/domain/sensitivity/study/sensitivity-study-v2.ts`](../../../src/domain/sensitivity/study/sensitivity-study-v2.ts)

`sensitivity-study-case/2.0` with `cadSource` naming a sealed compilation admission

#### [`src/domain/sensitivity/study/sensitivity-study-proposal.ts`](../../../src/domain/sensitivity/study/sensitivity-study-proposal.ts)

Operation identities and the `analyze.seal-sensitivity-study@1` MRTR grammar

#### [`src/domain/sensitivity/study/sensitivity-study-case-catalog.ts`](../../../src/domain/sensitivity/study/sensitivity-study-case-catalog.ts)

Pure unique-case selection and server-owned sensitivity seal identities. It contains no
project ids, template paths, or filesystem authority

#### [`src/application/ports/out/sensitivity/study/catalogued-sensitivity-study-case-reader.ts`](../../../src/application/ports/out/sensitivity/study/catalogued-sensitivity-study-case-reader.ts)

Application boundary for listing catalogued case ids and reopening one reviewed template
by id; callers cannot select a path

#### [`src/adapters/sensitivity/study/file-catalogued-sensitivity-study-case-reader.ts`](../../../src/adapters/sensitivity/study/file-catalogued-sensitivity-study-case-reader.ts)

Strict `config/sensitivity-study-cases/catalog.json` adapter: exact schema, safe
relative JSON paths, no duplicate ids/files, manifest-to-template id equality, and
canonical descendant confinement of catalog.json and every declared case file

#### [`src/domain/sensitivity/study/sensitivity-study-seal-bindings.ts`](../../../src/domain/sensitivity/study/sensitivity-study-seal-bindings.ts)

Pure admission / lookalike classification for `cadSource`; `compile.seal-admission@3`
only

#### [`src/application/ports/in/sensitivity/study/project-sensitivity-study-seal-review.ts`](../../../src/application/ports/in/sensitivity/study/project-sensitivity-study-seal-review.ts)

Inward sensitivity seal-compilation port: project, basis and catalog id only

#### [`src/application/use-cases/sensitivity/study/reopen-signed-catalog-offer.ts`](../../../src/application/use-cases/sensitivity/study/reopen-signed-catalog-offer.ts)

Shared reopen/compile of the unique signed catalog-offer; review and seal call this,
they do not copy the I/O

#### [`src/application/use-cases/sensitivity/study/prepare-project-sensitivity-study-seal-review.ts`](../../../src/application/use-cases/sensitivity/study/prepare-project-sensitivity-study-seal-review.ts)

Reopens the catalogued template or the unique signed catalog-offer and compiles
`sensitivity.case.*` through `encodeSensitivityStudyDecisionParameters`; read-only, no
MRTR. `resolved` only when the append is paste-ready

#### [`src/tools/project-control/sensitivity-review-tools.ts`](../../../src/tools/project-control/sensitivity-review-tools.ts)

MCP `project_sensitivity_study_seal_review`

#### [`docs/how-to/compile/compile-sensitivity-parameters.md`](../../how-to/compile/compile-sensitivity-parameters.md)

First hop before `analyze.seal-sensitivity-study@1`; does not claim a dl06 case

#### [`src/adapters/sensitivity/study/analyze-seal-sensitivity-study-run-executor.ts`](../../../src/adapters/sensitivity/study/analyze-seal-sensitivity-study-run-executor.ts)

Provider-free seal of a reviewed 2.0 case into a Thread document. Known catalog id still
opens the JSON; otherwise the unique signed offer is reopened.

#### [`src/adapters/sensitivity/live-fea/analyze-run-fea-sensitivity-run-executor.ts`](../../../src/adapters/sensitivity/live-fea/analyze-run-fea-sensitivity-run-executor.ts)

Server-owned exact private lookup and reuse WAL before dispatch; exact hits publish
target facts without CAD/solver, misses run two isolated CAD executions plus two
attested CalculiX solves; observations only, never a verdict

#### [`src/domain/sensitivity/experience/sensitivity-experience.ts`](../../../src/domain/sensitivity/experience/sensitivity-experience.ts)

Closed project-neutral record, separate private origin, invalidation, review, receipt,
exact key compiler, admission, and validators; no caller-selected identity

#### [`src/domain/sensitivity/study/sensitivity-study-result.ts`](../../../src/domain/sensitivity/study/sensitivity-study-result.ts)

Closed fresh-or-reused scientific result union; reuse result carries no CAD evidence or
readable source origin

#### [`src/adapters/sensitivity/experience/sensitivity-experience-coordinator.ts`](../../../src/adapters/sensitivity/experience/sensitivity-experience-coordinator.ts)

Target compilation, exact selection, source/current-tip/runtime revalidation,
divergent-result rejection, target-basis review/receipt, and fresh-result admission

#### [`src/adapters/sensitivity/experience/file-sensitivity-experience-repository.ts`](../../../src/adapters/sensitivity/experience/file-sensitivity-experience-repository.ts)

Confined installation-private CAS plus append-only admissions/invalidations and
reconstructible deterministic index

#### [`src/adapters/sensitivity/edges/model-write-sensitivity-edges-run-executor.ts`](../../../src/adapters/sensitivity/edges/model-write-sensitivity-edges-run-executor.ts)

Server-rendered `renderSensitivityEdgeSetSysml` insert into SysON

#### [`src/domain/sensitivity/vector-correction/propose-vector-correction.ts`](../../../src/domain/sensitivity/vector-correction/propose-vector-correction.ts)

Pure first-order inversion; `domain_exceeded` if `z_current` is outside the living
neighborhood

#### [`src/domain/sensitivity/vector-correction/vector-correction-proposal.ts`](../../../src/domain/sensitivity/vector-correction/vector-correction-proposal.ts)

Closed MRTR grammar for `design.apply-vector-correction@1`

#### [`src/application/use-cases/sensitivity/vector-correction/prepare-project-vector-correction-review.ts`](../../../src/application/use-cases/sensitivity/vector-correction/prepare-project-vector-correction-review.ts)

Provider-free review: identities only, no Thread write

#### [`src/adapters/sensitivity/vector-correction/vector-correction-capture.ts`](../../../src/adapters/sensitivity/vector-correction/vector-correction-capture.ts)

Documentary `correction-proposal-capture/1.0` with `grants: none`

#### [`src/adapters/sensitivity/vector-correction/design-apply-vector-correction-run-executor.ts`](../../../src/adapters/sensitivity/vector-correction/design-apply-vector-correction-run-executor.ts)

Provider-free seal of one bounded correction document; not a CAD or SysON write

#### [`src/domain/sensitivity/base-evaluation/sensitivity-base-evaluation.ts`](../../../src/domain/sensitivity/base-evaluation/sensitivity-base-evaluation.ts)

Exact join of study-base observations to Thread requirements; any gap is `UNLINKED` for
the whole set

#### [`src/application/use-cases/sensitivity/base-evaluation/prepare-project-sensitivity-base-evaluation-review.ts`](../../../src/application/use-cases/sensitivity/base-evaluation/prepare-project-sensitivity-base-evaluation-review.ts)

Provider-free join check; writes no Thread state and invents no metric mapping

#### [`src/adapters/sensitivity/base-evaluation/verify-evaluate-sensitivity-base-run-executor.ts`](../../../src/adapters/sensitivity/base-evaluation/verify-evaluate-sensitivity-base-run-executor.ts)

SysON evaluation of `sensitivity-base-<metric>-<digest>` only; not a proof-run remap

#### [`src/domain/sensitivity/live-fea/sensitivity-analysis-graph.ts`](../../../src/domain/sensitivity/live-fea/sensitivity-analysis-graph.ts)

Builds observed `measured-local-sensitivity` assertions from exact finite-difference
evidence; first producer of the canonical analysis graph, never a verdict or authority
grant

#### [`src/domain/sensitivity/live-fea/static-structural-solver.ts`](../../../src/domain/sensitivity/live-fea/static-structural-solver.ts)

Capability-first `StaticStructuralSolver` port for a sealed proof and exact input
identity; returns normalized supports, loads, mesh counts and observations without
paths, provider echoes or CalculiX response vocabulary

#### [`src/domain/sensitivity/study/sensitivity-catalog-from-proof.ts`](../../../src/domain/sensitivity/study/sensitivity-catalog-from-proof.ts)

Pure false-by-default catalog-offer compiler: requires one exact causal admission lever,
source equality with the proof CAD definition and `result` equality with the proof
target; copies sealed solver facts, uses live metric units and leaves `step` explicitly
not compiled

#### [`src/domain/sensitivity/study/sensitivity-catalog-offer-capture.ts`](../../../src/domain/sensitivity/study/sensitivity-catalog-offer-capture.ts)

Fail-closed parser for the sealed `sensitivity-catalog-offer-capture/1.0` envelope
published by `verify.seal-proof-case@1`

#### [`src/domain/sensitivity/study/sensitivity-study-from-offer.ts`](../../../src/domain/sensitivity/study/sensitivity-study-from-offer.ts)

Compiles a `sensitivity-study-case-template/2.0` from a ready signed offer: copies
mesh/loads/metrics and sets `step` to the sealed proof mesh target size

#### [`src/adapters/sensitivity/live-fea/fea-solver-capture.ts`](../../../src/adapters/sensitivity/live-fea/fea-solver-capture.ts)

Proof-agnostic strict FEA wire parser used by sensitivity CalculiX and FEA
provider-contract gates; maps validated output to the domain through an opaque capture
token
