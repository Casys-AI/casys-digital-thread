# Reference: source map — compile

Audience: agent · Diátaxis: reference · Kind: contract

Census of admission, source analysis, ROP, and the shared isolation runner. Narrative
stays on [compilation and isolation](../pipeline/compilation-and-isolation.md). Not a
CAD tree.

Index: [workspace source map](../codebase/codebase-map.md). Domain coverage stays
on [engineering domains](../domains/README.md).

## Source map

#### [`docs/reference/pipeline/compilation-and-isolation.md`](../pipeline/compilation-and-isolation.md)

Admission compiler plus CAD / Modelica kit / admitted Modelica / CalculiX `@3` isolated
verticals, extracted from the authority pipeline

#### [`docs/reference/pipeline/admitted-source-isolated-execution.md`](../pipeline/admitted-source-isolated-execution.md)

Recurrent hexagonal pattern: `compile.seal-admission@3` →
`ReopenAdmittedCompilationSource` → `IsolatedCodeRunner`. CAD execute and admitted
Modelica. Not the Modelica kit, not CalculiX `@3`

#### [`config/microsandbox-local.json`](../../../config/microsandbox-local.json)

Exact code-owned empty local-runtime config; startup rejects symlink, link-count,
content or native override drift before loading Microsandbox

#### [`src/domain/compile/`](../../../src/domain/compile)

Compile kernel: `isolation/` (request/receipt + local runtime identity), `admission/`
(`technical-compilation/2.0` + `compile.seal-admission@3`), `source/` (language-neutral
analysis + named CAD levers), `rop/` (`resolved-operation-plan`), `brief/`
(approved-brief graph). Used by CAD and Modelica. Not a CAD tree

#### [`src/application/ports/in/compile/`](../../../src/application/ports/in/compile)

Inbound compile ports: technical-source capture, compilation preview, reopen admitted
compilation

#### [`src/application/ports/out/compile/`](../../../src/application/ports/out/compile)

Outbound compile ports: admission/source/draft/profile/basis readers plus
`IsolatedCodeRunner` and ephemeral backend. Microsandbox adapter lives in
`adapters/shared/execution/`

#### [`src/application/use-cases/compile/`](../../../src/application/use-cases/compile)

Shared `reopen-admitted-compilation-source`, brokered isolated runner,
technical-compilation preview

#### [`src/adapters/compile/`](../../../src/adapters/compile)

Compile adapters: `admission/`, `captures/`, `plans/`, `executors/`, `source/`
(project-brief frontend). `initial-technical-source-analysis-composition` remains one
CAD+Modelica registry. Architecture SysML composition lives under
`adapters/architecture/agent-seal/`

#### `deno task verify:generic:core`

Stable local gate for the closed multi-target compiler/proposal contracts, generic
isolated-execution domain, broker, filesystem output CAS, non-Build123d profile fixture
and production import boundaries; it does not exercise a real local microVM or
engineering run

#### [`src/domain/compile/source/source-analysis.ts`](../../../src/domain/compile/source/source-analysis.ts)

Provider-neutral facts and diagnostics derived from one exact native source; never
authority

#### [`src/domain/compile/source/source-analysis-frontend.ts`](../../../src/domain/compile/source/source-analysis-frontend.ts)

Hexagonal port from exact native source text to a provider-neutral
`SourceAnalysisBundle`; callers never supply the source fingerprint

#### [`src/adapters/compile/captures/technical-source-analysis-capture.ts`](../../../src/adapters/compile/captures/technical-source-analysis-capture.ts)

Profile-registry-owned capture and exact replay of technical source plus parser-backed
analysis before compilation; callers cannot select language, analyzer, provider, tool or
execution arguments

#### [`src/domain/compile/admission/technical-compilation.ts`](../../../src/domain/compile/admission/technical-compilation.ts)

V2 `technical-compilation-input/2.0` and `technical-compilation/2.0`: exact
Thread/SysML/source fingerprints, explicit symbol-to-element bindings and server-owned
profiles produce deterministic target-local review projections. Current Build123d
profile 3.0.0 adds exact direct scalar-leaf workspace-closure lowering and requires a
parser-reported finite module-level numeric parameter bound through `parameterizes` and
causally reaching the unique `result`; it has no legacy-profile reader or compatibility
path

#### [`src/domain/compile/source/named-cad-levers.ts`](../../../src/domain/compile/source/named-cad-levers.ts)

Two predicates: analysis-reachable named literals (capture-time handle, no SysML bind)
and geometry-affecting levers (reachable + unique `parameterizes`). Missing bind is
`binding.missing`, not `source.no-named-numeric-lever`

#### [`src/domain/compile/admission/technical-source-capture-review.ts`](../../../src/domain/compile/admission/technical-source-capture-review.ts)

Agent-facing `technical-source-capture-review/4.0`: hoists `parser` and `levers` beside
the opaque `technical-source-analysis-capture-locator/4.0`. Compilation accepts only
`result.reference`

#### [`src/domain/compile/admission/technical-compilation-join.ts`](../../../src/domain/compile/admission/technical-compilation-join.ts)

Server-owned unique compile join: one catalog profile per source role;
`represents`/`parameterizes` only when the SysML target is unique. Does not invent a
lever or an AttributeUsage

#### [`src/domain/compile/admission/compilation-admission-run-operation.ts`](../../../src/domain/compile/admission/compilation-admission-run-operation.ts)

Named immutable admitted-compilation execution operation.
`assembleCompilationAdmissionRunOperation` binds exactly one `compilationAdmission`
thread-entity artifact on the current review basis. Not a historical creation ref.
Callers pass the registered operation identity; CAD, Modelica and SPICE ids stay in
those domains. Used by Build123d, admitted Modelica and admitted SPICE run reviews

#### [`src/domain/compile/admission/technical-compilation-preview-review.ts`](../../../src/domain/compile/admission/technical-compilation-preview-review.ts)

Agent-facing compile `gaps`: names and recoveries for `binding.missing` /
`source.no-named-numeric-lever`. Not part of `technical-compilation/2.0`; sealed
documents stay closed

#### [`src/application/ports/in/compile/admission/project-technical-compilation-preview.ts`](../../../src/application/ports/in/compile/admission/project-technical-compilation-preview.ts)

Provider-free preview command/result seam: callers submit exact identities and opaque
capture references, never source bytes, parser results, basis records or profile
catalogues

#### [`src/application/use-cases/compile/admission/preview-project-technical-compilation.ts`](../../../src/application/use-cases/compile/admission/preview-project-technical-compilation.ts)

Reopens an exact non-`latest` Thread/SysML basis, captured sources and the code-owned
profile catalogue; compiles inward and persists only `ready-for-review` drafts through
content-addressed outward ports

#### [`src/adapters/compile/captures/technical-compilation-basis-resolver.ts`](../../../src/adapters/compile/captures/technical-compilation-basis-resolver.ts)

Provider-free exact-basis adapter: verifies project declaration, full Thread lineage,
unique active architecture v3 tip, seed/capture CAS and byte consumptions; emits exact
Package, PartDefinition, PartUsage, AttributeUsage, RequirementUsage and ConstraintUsage
identities

#### [`src/adapters/compile/admission/capture-backed-technical-compilation-source-reader.ts`](../../../src/adapters/compile/admission/capture-backed-technical-compilation-source-reader.ts)

Reopens an opaque technical-source reference through its exact profile/frontend replay
and supplies verified bytes plus analysis to the inward compiler

#### [fixed technical-compilation profile catalogue][technical-compilation-profile-catalogue]

Immutable server-owned compiler-profile catalogue. Build123d is profile 3.0.0 over the
qualified closed subset with direct scalar-leaf workspace-closure lowering
(`Box`/`Cylinder`/`Cone`/`Sphere`/`Torus`/`Ellipsoid`/`Wedge`/`Rectangle`/`Circle`/`Ellipse`/`RegularPolygon`/`Pos`/`Rot`/`Compound`,
named `Pos`/`Rot` bindings and `Plane.XY\|…\|ZY *` shape, `scale`, `fillet`, `chamfer`,
`extrude`, `offset`, `revolve`, math `pi`/`e`/`tau`) plus the causal named-lever
admission invariant. Modelica `modelica-closed-subset-v2` compiles bounded generic `.mo`
source with its exact experiment annotation for `compile.seal-admission@3`. CalculiX
compilation stays fail-closed: the agent never writes `.inp`

#### [`src/adapters/compile/captures/initial-technical-source-analysis-composition.ts`](../../../src/adapters/compile/captures/initial-technical-source-analysis-composition.ts)

Closed composition that pairs the initial Build123d source profile with its exact
frontend, analyzer version and two CAS stores; callers cannot substitute a different
parser identity

#### [`src/adapters/compile/server-composition.ts`](../../../src/adapters/compile/server-composition.ts)

Technical compilation foundation, basis/seal, and preview. One admission CAS is shared
by the reopen reader and `compile.seal-admission@3`. Preview is not admission authority.

#### [`src/adapters/compile/admission/file-technical-compilation-draft-store.ts`](../../../src/adapters/compile/admission/file-technical-compilation-draft-store.ts)

Content-addressed canonical JSON store for `ready-for-review` drafts only; validates
project/document/reference hashes and exact save/readback while keeping filesystem paths
outside application contracts

#### [`src/domain/compile/admission/technical-compilation-proposal.ts`](../../../src/domain/compile/admission/technical-compilation-proposal.ts)

Closed canonical MRTR grammar for registered `compile.seal-admission@3`; signs the exact
draft, basis, source-capture references, bindings and profile identities without
granting execution authority

#### [`src/adapters/compile/executors/compile-seal-admission-run-executor.ts`](../../../src/adapters/compile/executors/compile-seal-admission-run-executor.ts)

Provider-free registered sealer: after human MRTR it reopens draft, Thread/SysML basis,
sources and profiles, then publishes one exact admission-capture document in the Thread.
It neither calls a provider nor grants downstream execution authority

#### [`src/domain/compile/isolation/isolated-code-execution.ts`](../../../src/domain/compile/isolation/isolated-code-execution.ts)

Closed request/receipt contracts for code execution by value: exact source/output bytes,
policy/profile references, requested limits with per-limit assurance, content-addressed
outputs and explicit teardown assurance; no backend handle or path

#### [`src/application/ports/out/compile/isolation/isolated-code-runner.ts`](../../../src/application/ports/out/compile/isolation/isolated-code-runner.ts)

Public isolated-runner, per-producer-generation tri-state publication and marker-gated
reader seams; commit is reconciled under a run lock as published, absent or outcome
unknown without exposing backend leases or filesystem paths

#### [`src/application/ports/out/compile/isolation/ephemeral-execution-backend.ts`](../../../src/application/ports/out/compile/isolation/ephemeral-execution-backend.ts)

Technology-neutral disposable-backend lifecycle; output inventory metadata is explicitly
untrusted and opaque lease/output handles cannot cross the broker

#### [`src/adapters/shared/cas/file-isolated-output-cas.ts`](../../../src/adapters/shared/cas/file-isolated-output-cas.ts)

Filesystem output CAS: durable shared blobs and complete byte-free receipt precede one
run/generation marker; orphan blobs remain invisible and ACK loss is reconciled. Batch
abort removes its staging; run abort refuses a present/ambiguous marker, durably fences
that producer generation, then removes its staging

#### [`src/application/use-cases/compile/isolation/brokered-isolated-code-runner.ts`](../../../src/application/use-cases/compile/isolation/brokered-isolated-code-runner.ts)

Fail-closed broker: validates the code-owned manifest and external bytes, closes
teardown, stages and rereads outputs, then resolves commit ambiguity without retrying
execution inside the broker; an unknown publication blocks release

#### [`src/domain/compile/isolation/local-isolation-runtime.ts`](../../../src/domain/compile/isolation/local-isolation-runtime.ts)

Code-owned identity for Microsandbox local 0.6.8: attached lifecycle, no network,
digest-pinned OCI image and honest per-limit assurance; the record is review evidence,
not a runtime capability

#### [`src/adapters/shared/execution/microsandbox-ephemeral-execution-backend.ts`](../../../src/adapters/shared/execution/microsandbox-ephemeral-execution-backend.ts)

Local OCI/microVM adapter behind the neutral backend port: SDK and native runtime
artifacts pinned and hashed, exact image/config readback, no shell, fixed direct wrapper
and paths, disabled deny-all network, one `/tmp` mount, bounded logs/output and
run-label cleanup proven by zero remaining sandboxes

#### [`src/application/ports/in/compile/admission/reopen-admitted-compilation-source.ts`](../../../src/application/ports/in/compile/admission/reopen-admitted-compilation-source.ts)

Inward port for the recurrent admitted-file microVM entry: reopen
`compile.seal-admission@3` as exact source bytes for one compilation target. No worker,
image, or caller source text

#### [`src/application/use-cases/compile/admission/reopen-admitted-compilation-source.ts`](../../../src/application/use-cases/compile/admission/reopen-admitted-compilation-source.ts)

Shared use case plus `isolatedRequestFromAdmittedSource`. Used by
`design.execute-build123d@1` and `simulate.run-admitted-modelica@1`

#### [`src/tools/project-control/technical-compilation-tools.ts`](../../../src/tools/project-control/technical-compilation-tools.ts)

Project-control module for exact source capture, provider-free compilation preview and
conditionally exposed Build123d, isolated-geometry-seal, admitted-Modelica and fixed
qualified-Modelica execution reviews

#### [`src/domain/compile/source/provider-resource-reader.ts`](../../../src/domain/compile/source/provider-resource-reader.ts)

Port for one exact DT-normalized acquisition tuple; copied bytes and content-match
attestation only. It is not a provider-native run envelope; each vertical must prove
that envelope-to-tuple mapping

#### [`src/domain/compile/brief/brief-source-analysis-reference.ts`](../../../src/domain/compile/brief/brief-source-analysis-reference.ts)

Adapter-neutral, collision-safe reference to one exact approved-brief source capture and
analysis; a CAS locator, never evidence or authority

#### [`src/domain/compile/brief/brief-analysis-graph.ts`](../../../src/domain/compile/brief/brief-analysis-graph.ts)

Promotes only explicit V2 brief gate dependencies into declared assertions evidenced by
the exact approved-baseline document

#### [`src/domain/compile/rop/resolved-operation-plan.ts`](../../../src/domain/compile/rop/resolved-operation-plan.ts)

Inspectable server-owned causal-plan contract with immutable inputs and versioned
semantic-to-provider lowering; generic resolver/admission wiring is not yet active

#### [`src/domain/compile/rop/resolved-operation-plan-v2.ts`](../../../src/domain/compile/rop/resolved-operation-plan-v2.ts)

Closed `resolved-operation-plan/2.0` schema, exact CalculiX `@2`/`@3` resource profiles
and one-action recovery policy; no provider I/O

#### [`src/adapters/compile/plans/resolved-operation-plan-resolver.ts`](../../../src/adapters/compile/plans/resolved-operation-plan-resolver.ts)

Server-owned resolver: reopens exact MRTR, qualified method, thread basis, proof/case
and source artefacts while deriving one queued-run plan

#### [`src/adapters/compile/plans/capture-backed-run-plan-sealer.ts`](../../../src/adapters/compile/plans/capture-backed-run-plan-sealer.ts)

CAS plan sealer/reader used both at queue time and by the plan-inspection control
surface; not a generic execute-plan API

#### [`src/adapters/compile/plans/server-composition.ts`](../../../src/adapters/compile/plans/server-composition.ts)

ROP resolver and capture-backed sealer. Injects the shared FEA proof, requirements, and
catalog-offer CAS instances; optional CalculiX local profile is sealed into the plan
only when supplied.

#### [`src/adapters/compile/plans/recorded-analysis-cas-reader.ts`](../../../src/adapters/compile/plans/recorded-analysis-cas-reader.ts)

Closed local reader for FEA proof, sensitivity-catalog-offer, and requirements-capture
namespaces; rejects foreign URI/media-type/digest combinations. R08 moved this helper
next to the ROP sealer.

#### [`src/adapters/compile/source/project-brief-source-analyzer.ts`](../../../src/adapters/compile/source/project-brief-source-analyzer.ts)

Conservative canonical-brief frontend: item symbols plus explicit V2 gate dependencies;
no prose inference

#### [`src/adapters/compile/captures/brief-source-analysis-capture.ts`](../../../src/adapters/compile/captures/brief-source-analysis-capture.ts)

Exact approved-brief JSON capture/readback before local analysis, followed by analysis
CAS capture/readback

#### [`src/domain/compile/source/unnamed-cad-literals.ts`](../../../src/domain/compile/source/unnamed-cad-literals.ts)

Bare constructor-argument numerics that reach `result`. Span + value, never an invented
name

#### [`src/domain/compile/admission/sealed-cad-levers.ts`](../../../src/domain/compile/admission/sealed-cad-levers.ts)

Unique `parameterizes` CAD levers and unnamed constructor literals from a sealed
compilation document. No CAS, no name join

[technical-compilation-profile-catalogue]: ../../../src/adapters/compile/admission/fixed-technical-compilation-profile-catalog-provider.ts
