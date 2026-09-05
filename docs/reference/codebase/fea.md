# Reference: source map — FEA

Audience: agent · Diátaxis: reference · Kind: contract

Census of proof-case seal and isolated CalculiX `@3` files. Historical `@1`/`@2` stay
unregistered. Not live-FEA sensitivity.

Index: [workspace source map](../codebase/codebase-map.md). Domain coverage stays on
[engineering domains](../domains/README.md).

## Source map

#### [`src/testing/fixtures/fea/mechanical-proof-cases/`](../../../src/testing/fixtures/fea/mechanical-proof-cases)

Test/conformance compiled proof-case JSON only; not live production authority

#### [`src/domain/fea/seal-case/mechanical-proof-case.ts`](../../../src/domain/fea/seal-case/mechanical-proof-case.ts)

Declaration validation and limited identity matching

#### [`src/domain/fea/isolated-v3/calculix-isolated-execution.ts`](../../../src/domain/fea/isolated-v3/calculix-isolated-execution.ts)

Closed CalculiX worker input/output and evidence contracts: the local use case supplies
reviewed proof plus exact STEP; no caller-authored `.inp`, shell, command or path

#### [`src/domain/fea/isolated-v3/sealed-static-proof-capture.ts`](../../../src/domain/fea/isolated-v3/sealed-static-proof-capture.ts)

Parse already-read sealed static-proof bytes for isolated `@3`. CAS reads stay in the
adapter.

#### [`src/domain/fea/isolated-v3/static-proof-identity.ts`](../../../src/domain/fea/isolated-v3/static-proof-identity.ts)

Pure projected identity checks for isolated static FEA `@3`. No orchestration or adapter
imports.

#### [`src/domain/fea/isolated-v3/static-proof-oracle-input.ts`](../../../src/domain/fea/isolated-v3/static-proof-oracle-input.ts)

Closed oracle payload and evaluation mapping. `error`/`unresolved` have no comparison.

#### [`src/domain/fea/isolated-v3/static-proof-thread-evidence.ts`](../../../src/domain/fea/isolated-v3/static-proof-thread-evidence.ts)

Deterministic isolated static-proof Thread successor. A `fail` publishes `caused_by` /
`evidences` / `addresses`; `error`/`unresolved` publish no violation.

#### [`src/adapters/fea/isolated-v3/calculix-isolated-execution-composition.ts`](../../../src/adapters/fea/isolated-v3/calculix-isolated-execution-composition.ts)

Provider-free profile plus optional local Microsandbox capability graph, lease,
WAL/evidence stores and output CAS; the `@3` descriptor and unavailable dispatcher entry
remain registered, while its concrete executor is wired only under explicit local
execution with the separate SysON oracle

#### [`src/adapters/fea/server-composition.ts`](../../../src/adapters/fea/server-composition.ts)

FEA foundation (historical proof CAS on its descriptor path, not
recorded-analysis/calculix/proof-cases) plus project reviews/seal/@3. Product `@3` is
composed only when SysON and the CalculiX runtime are both present.

#### [`scripts/gates/verify-calculix-microsandbox-vertical.ts`](../../../scripts/gates/verify-calculix-microsandbox-vertical.ts)

Real generation-0 local microVM gate for the digest-pinned CalculiX worker: exact
historical ROP2/proof/STEP inputs, nine publication-gated outputs, external format and
physical checks, evidence replay and proven destruction; temporary gate state is removed
and no historical operation is rerouted

#### `deno task verify:calculix:microsandbox:vertical`

Permission-bounded entry point for that exact real CalculiX worker gate; it is distinct
from the registered `@3` product executor and does not reroute the historical `@2` plan
used as its qualification input

#### [`scripts/gates/verify-calculix-microsandbox-worker.ts`](../../../scripts/gates/verify-calculix-microsandbox-worker.ts)

Earlier Docker-only CalculiX worker prequalification with fixed wrapper and declared
outputs; it remains useful worker-contract evidence but not a substitute for the real
local microVM gate, imported-candidate Microsandbox qualification, or product runtime
wiring

#### [`scripts/gates/verify-calculix-worker-candidate-qualification.ts`](../../../scripts/gates/verify-calculix-worker-candidate-qualification.ts)

Maintainer-only imported-candidate qualification for `calculix-worker`. Input is only a
bound `first-party-microsandbox-image-candidate-import/3.0` record plus `--run` or
`--recover`. It reads the control-plane host observation once, refuses anything other
than `linux/arm64` before composition, then reuses the production composition,
`ExecuteIsolatedCalculixStaticProof`, validators, batch inspector, CAS reread and proven
destruction under a candidate-specific root. `eligibleForPromotion` stays `false`. It is
not a product FEA verdict and not L3/L4/L5 engineering evidence

#### [`src/adapters/fea/isolated-v3/local-calculix-isolated-execution-options.ts`](../../../src/adapters/fea/isolated-v3/local-calculix-isolated-execution-options.ts)

Code-owned active CalculiX policy, limits, wrapper digest and local server options. The
server, the active vertical and the imported-candidate gate share this builder. The
candidate factory accepts only an already-bound import record

#### [`src/adapters/fea/isolated-v3/calculix-worker-candidate-qualification.ts`](../../../src/adapters/fea/isolated-v3/calculix-worker-candidate-qualification.ts)

Record-bound plan/run/recover orchestration for an imported CalculiX worker candidate.
Synthetic candidate-qualification identities only; it never reopens a historical product
ROP/MRTR

#### [`src/adapters/fea/isolated-v3/verify-run-fea-static-proof-v3-run-executor.ts`](../../../src/adapters/fea/isolated-v3/verify-run-fea-static-proof-v3-run-executor.ts)

Registered local `verify.run-fea-static-proof@3`: refuses `@2`, reopens exact
ROP/MRTR/proof/STEP/profile, publishes nine local outputs plus isolated evidence,
journals the separate SysON oracle before dispatch, and exactly replays CAS/WAL/Thread
evidence without a second solve or oracle

#### [`src/orchestration/operations/fea-isolated-static-proof.ts`](../../../src/orchestration/operations/fea-isolated-static-proof.ts)

Isolated CalculiX `@3` registry descriptor plus thin `@2` absence identity for
ROP/`unknown_operation` guards. Not a recorded-analysis stack. Historical recorded
Modelica identities are unregistered literals, not a fallback.

#### [`src/domain/fea/seal-case/mechanical-proof-case-source.ts`](../../../src/domain/fea/seal-case/mechanical-proof-case-source.ts)

Closed agent-authored `mechanical-proof-case-source/1.0` plus server compile of
`mechanical-proof-case/1.0`

#### [`src/application/ports/out/fea/seal-case/fea-proof-case-source-capture-reader.ts`](../../../src/application/ports/out/fea/seal-case/fea-proof-case-source-capture-reader.ts)

Outward CAS seam: capture canonical source JSON and reopen by fingerprint only

#### [`src/adapters/fea/seal-case/fea-proof-case-source-capture.ts`](../../../src/adapters/fea/seal-case/fea-proof-case-source-capture.ts)

Dedicated draft-CAS adapter for `mechanical-proof-case-source/1.0`; no provider, path or
catalog id

#### [`src/domain/fea/seal-case/fea-proof-case-capture.ts`](../../../src/domain/fea/seal-case/fea-proof-case-capture.ts)

Fail-closed parser for the sealed `fea-proof-case-capture/1.0` document consumed by
`verify.run-fea-static-proof@3`

#### [`src/domain/fea/seal-case/fea-proof-seal-bindings.ts`](../../../src/domain/fea/seal-case/fea-proof-seal-bindings.ts)

Pure join of a compiled case to cad-model, requirements tip and STEP on one Thread basis

#### [`src/domain/fea/isolated-v3/isolated-calculix-bindings.ts`](../../../src/domain/fea/isolated-v3/isolated-calculix-bindings.ts)

`verify.run-fea-static-proof@3` binding contract: proof JSON document + canonical part
STEP; cad-model is a lookalike, never `fea.run.*`

#### [`src/application/ports/in/fea/seal-case/project-fea-proof-seal-review.ts`](../../../src/application/ports/in/fea/seal-case/project-fea-proof-seal-review.ts)

Inward FEA seal-compilation port: project, opaque source fingerprint, and an optional
false-by-default sensitivity-catalog opt-in only

#### [`src/application/use-cases/fea/seal-case/fea-review-support.ts`](../../../src/application/use-cases/fea/seal-case/fea-review-support.ts)

Shared FEA review parsing, current-tip resolution, snapshot reopen, and `next.append` /
`next.propose` hop; omitted basis is the unique max-revision Thread snapshot, never
`latest`

#### [`src/application/use-cases/fea/seal-case/prepare-project-fea-proof-seal-review.ts`](../../../src/application/use-cases/fea/seal-case/prepare-project-fea-proof-seal-review.ts)

Reopens the captured source and exact causal admission, compiles `fea.proof.*`, and when
explicitly requested adds the offer digest and admission identity to the same proposal;
read-only, no MRTR authority, and the proof-only review stays resolved when no offer
exists

#### [`src/application/use-cases/fea/seal-case/fea-proof-seal-source-admission.ts`](../../../src/application/use-cases/fea/seal-case/fea-proof-seal-source-admission.ts)

Shared read-only geometry-capture + canonical STEP admission used by the seal review and
`verify.seal-proof-case@1`; no claim, write, or MRTR gate

#### [`src/application/ports/in/fea/isolated-v3/project-fea-isolated-run-review.ts`](../../../src/application/ports/in/fea/isolated-v3/project-fea-isolated-run-review.ts)

Inward isolated-run port: project, basis and sealed proof artifact id; no numbers

#### [`src/application/ports/out/fea/seal-case/fea-proof-seal-requirements-reviewer.ts`](../../../src/application/ports/out/fea/seal-case/fea-proof-seal-requirements-reviewer.ts)

Outward port for reopening and validating the exact active requirements capture and seed
behind a proof seal

#### [`src/adapters/fea/seal-case/capture-backed-fea-proof-seal-requirements-reviewer.ts`](../../../src/adapters/fea/seal-case/capture-backed-fea-proof-seal-requirements-reviewer.ts)

Capture-backed, archive-aware requirements admission using the shared exact-component
tip selector

#### [`src/application/ports/out/fea/isolated-v3/fea-isolated-run-admission-reviewer.ts`](../../../src/application/ports/out/fea/isolated-v3/fea-isolated-run-admission-reviewer.ts)

Shared read-only admission contract implemented by the isolated plan resolver for proof
producer, inputs, subject, lineage and MRTR history

#### [`src/application/use-cases/fea/isolated-v3/prepare-project-fea-isolated-run-review.ts`](../../../src/application/use-cases/fea/isolated-v3/prepare-project-fea-isolated-run-review.ts)

Reopens the sealed capture and emits `verify.run-fea-static-proof@3` bindings; never
binds a cad-model as geometry. When the compiled root activity already exists, a
successor revision is derived only from its unique current leaf after one evidence-free
`isolated_output_validation_failed` attempt; the failed work item and run stay immutable

#### [`src/application/use-cases/fea/isolated-v3/fea-isolated-run-successor.ts`](../../../src/application/use-cases/fea/isolated-v3/fea-isolated-run-successor.ts)

Deterministic isolated-run activity-successor identities and leaf qualification. Not a
new operation, provider path, or physics surface

#### [`src/tools/project-control/fea-review-tools.ts`](../../../src/tools/project-control/fea-review-tools.ts)

MCP `project_fea_proof_case_capture`, `project_fea_proof_seal_review` and
`project_fea_isolated_run_review`

#### [`src/domain/fea/seal-case/fea-proof-proposal.ts`](../../../src/domain/fea/seal-case/fea-proof-proposal.ts)

MRTR grammar, fail-closed encoders and parsers, and field cross-check for
`verify.seal-proof-case@1`; historical proof-only proposals remain valid, while explicit
catalog opt-in signs schema, offer digest and exact admission artifact identity

#### [`src/adapters/fea/isolated-v3/fea-oracle-adapter.ts`](../../../src/adapters/fea/isolated-v3/fea-oracle-adapter.ts)

Translation boundary between the mechanical proof-case schema and
`syson_constraint_evaluate`; projects metric enum to featurePath without local
arithmetic; the sole authority on the unit convention (mm/MPa)

#### [`src/adapters/fea/seal-case/verify-seal-proof-case-run-executor.ts`](../../../src/adapters/fea/seal-case/verify-seal-proof-case-run-executor.ts)

Trusted executor for `verify.seal-proof-case@1`: reopens the signed source capture and
recrosses the current tip without a provider call; a signed catalog opt-in additionally
reopens the exact admission, recompiles and digest-checks the offer, stores its CAS
capture, and publishes a separate artifact derived from both proof and admission. The
offer is not a solve or complete sensitivity case
