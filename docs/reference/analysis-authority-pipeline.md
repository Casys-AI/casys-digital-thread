# Reference: source analysis and authority pipeline

This boundary keeps agent-authored engineering work expressive while making every
authority transition explicit and reviewable. The agent talks directly to the Casys
Digital Thread MCP server. Provider MCP servers remain private backend dependencies;
they are never a second, bypassable tool surface.

```text
native source or semantic intent
        |
        v
capture exact bytes --------------------------+
        |                                      |
        v                                      |
source-analysis/1.0                            |
facts, symbols, local dependencies, diagnostics|
        |                                      |
        |                                      |
        +--> qualified engineering-assertion/1.0|
        |    declared | inferred | observed     |
        |    + exact evidence, scope, rationale |
        |                 |                     |
        |                 v                     |
        |    AnalysisGraph/1.0                  |
        |    canonical assertion index          |
        |                 |                     |
        |                 v                     |
        |    ThreadSnapshot/1.1                 |
        |                 |                     |
        |                 v                     |
        |    BFF -> Graphology MultiDirectedGraph (read only)
        |                                      |
        +--> human MRTR + qualified method
             exact decision, approval and thread basis
                         |
                         v
             resolved-operation-plan/2.0
             one server-owned action, sealed when the run is queued
                         |
                         v
             server-fixed executor -> private MCP tools + identity-bound resources/read
                         |
                         v
             CAS capture, recovery and thread lineage
```

## Contracts and ownership

`source-analysis/1.0` describes one captured native source. It is deliberately not a
common AST: each frontend may use the best parser for its language, then publishes only
stable symbols, source-local dependencies, diagnostics and the fingerprint of the exact
source bytes. Brief text, SysML v2, Python or TypeScript CAD, Modelica and CalculiX
input files use the same outer contract without pretending to share one grammar.

`engineering-assertion/1.0` is the provider-neutral relation layer. It states whether a
relation was declared, inferred or observed, and cites exact evidence. It is distinct
from `ThreadSnapshot` provenance: `derived_from` and `caused_by` retain their
execution/violation meanings and must not be relabelled as analysis. A measured local
sensitivity retains its base point, perturbation step, two response values, derivative
and validity neighborhood. It is therefore a qualified scientific fact that can be
projected to SysML or Graphology without making either projection authoritative.

`analysis-graph/1.0` is the canonical, provider-neutral index of validated
`engineering-assertion/1.0` records. It owns stable semantic nodes and exact
assertion-to-node links; it deliberately introduces neither a second relation language
nor an authority dialect. `ThreadSnapshot/1.0` remains readable as provenance-only
history. `ThreadSnapshot/1.1` requires a non-empty valid `AnalysisGraph`, and validates
that each assertion evidence reference names an artifact in that snapshot with the exact
fingerprint.

`authority-admission/1.0` is separate from the assertion. It binds the exact assertion
fingerprint to an exact operation, basis and reviewed decision input. An analysis
result, AST node or MCP tool annotation never authorizes execution by itself.

`resolved-operation-plan/2.0` is the recorded-analysis contract. The server creates it
while queueing one registered run, stores it by content address and keeps only its exact
reference on that run. It binds the immutable project queue basis, one work item and
operation fingerprint, the signed human MRTR decision and approval, the qualified
method, one exact thread-snapshot basis, source artefacts, a fixed provider
contract/lowering and one recovery policy. It has exactly one action arm: it is not a
workflow language and there is no generic `execute-plan` tool.

The agent may author the reviewed artefact and select an already registered operation,
but cannot provide a provider name, tool, envelope, endpoint, path, recovery transition
or plan JSON. The executor rereads the plan and all its bound artefacts before the lease
or provider boundary. Transport credentials and endpoints stay out of the plan. The
code-owned adapter lowers the semantic action immediately before dispatch; the executor
captures the exact provider resources that were actually observed.

`resolved-operation-plan/1.0` remains readable as an earlier design contract. It is not
the queue-to-execution authority for recorded analysis. Existing `@1` operations remain
unchanged; `@2` is a successor vertical, not a reinterpretation of old captures.

## Authority rules

- Capture and fingerprint native bytes before analysis or preview.
- Parsing and analysis may create inferred facts; they cannot grant authority.
- The resolver accepts immutable references, never aliases such as `latest`.
- A dispatch can consume only a sealed source, analysis, admission, or an explicitly
  named output of an earlier dispatch in the same plan.
- Provider/tool selection and lowering versions are code-owned. Agent input cannot
  select a raw provider transport or inject its wire envelope.
- Execution revalidates the stored plan and its referenced records. An opaque plan id is
  a lookup handle, not proof of authority.
- Graphology is a read/navigation projection. The BFF emits analysis edges with
  `origin: "analysis"`; the UI renders them in a `MultiDirectedGraph` so parallel
  qualified relations are inspectable rather than collapsed. Canonical relations and
  evidence remain domain records and thread captures.

## Hexagonal placement

The source, assertion, graph, admission and resolved-plan contracts live in
`src/domain/analysis/` and import no MCP, storage, provider, UI, Graphology or SysML
code. Language frontends and provider lowerings are adapters. The agent-facing
project-control tools validate MCP input and call inward-facing use cases; they do not
own provider clients or CAS stores. `ProjectGeometryPreviewUseCase` is the first such
extraction. Its capture-backed adapter owns source capture, analysis and the private
build123d dispatch. Registered executors remain the only components allowed to call
private provider MCP clients for admitted project runs.

## Implemented CAD vertical

The sandboxed CAD path is the first production consumer of this architecture. The agent
still calls the single `project_geometry_preview` Digital Thread tool with native
Python/build123d text. There is no parser tool to call and no intermediate DSL to
author. The backend performs this exact order:

```text
validate the bounded execution surface (D4)
  -> geometry-source-capture/1.0 save + readback
  -> PythonCadSourceAnalyzer (Lezer Python 1.1.19)
  -> source-analysis/1.0 save + readback
  -> build123d_export on the private sandbox with the same source text
  -> geometry-draft-capture/1.2 or /2.1
  -> human MRTR over the complete draft digest
  -> design.write-geometry@1 reopens source + analysis records
  -> geometry-capture/1.2 or /2.1 + binary promotion
```

The Python frontend is deliberately conservative. It records module-level simple
bindings, pure numeric value flow, the `result` artifact and direct structural incidence
into `result`. Calls, imports, branches, functions, classes, comprehensions, attributes,
subscripts, mutations and reassignments remain explicit unresolved constructs rather
than invented causal edges. The source text is never regenerated or rewritten.

For a geometry bundle, source identity is the selector, not only the byte hash: assembly
and each exact `PartDefinition.elementId` receive distinct source-analysis references
even when two definitions intentionally share identical source bytes. The preview
response exposes the source, source-capture and analysis digests. The draft digest seals
those references; the geometry seal and completed replay re-read every record and fail
before canonical writes if one is missing or divergent.

Historical draft schemas `1.0`, `1.1` and `2.0`, and canonical capture schemas `1.1` and
`2.0`, remain readable. They do not gain fictional analyses. New captures use the
analysis-bearing schemas above. Downstream Product Structure and FEA readers accept both
the historical and current bundle forms.

## Implemented approved-brief vertical

The documentary baseline now applies the same causal order to the exact canonical JSON
of the approved brief:

```text
approved ProjectBriefRevision
  -> pure baseline eligibility check
  -> brief-source-capture/1.0 save + readback
  -> ProjectBriefSourceAnalyzer
  -> source-analysis/1.0 save + readback
  -> approved-brief-baseline-capture/1.1
  -> optional declared-dependency AnalysisGraph
```

The frontend records brief item identities and only the explicit V2 gate dependencies.
It never derives a relation from prose or documentary references. Historical V1 gates
remain explicit unresolved constructs because they have no dependency field. A brief
with no declared dependency keeps its sealed analysis but emits a provenance-only
`ThreadSnapshot/1.0`; a V2 brief with dependencies emits `ThreadSnapshot/1.1`.

The graph cites the approved-brief document artifact, not the private source-analysis
CAS, as evidence. The initial-baseline validator follows the sealed reference, reopens
and re-hashes both CAS records, reruns the fixed analyzer over the exact source bytes
and reconstructs the graph before accepting completion. Historical baseline capture
`1.0` remains readable and never receives a reconstructed analysis retroactively.

## Implemented bounded SysML vertical

There is no audited general SysML v2 parser in this workspace and the SysON MCP does not
currently expose source bytes or a stable parse tree. The implemented foundation is
therefore deliberately narrower: the server-owned architecture renderer emits its
supported SysML write text and a typed source map in the same pure call. It covers only
the registered full-package, PartDefinition and PartUsage forms.

The SysML capture service receives an already reviewed `ArchitectureProposal` plus an
exact selector and re-renders internally. It saves and rereads
`sysml-source-capture/1.0` before its companion analyzer publishes only
manifest-attested PartUsage-to-target incidences. A caller cannot inject arbitrary SysML
text or a forged manifest through that API.

`model.write-architecture@1` now applies this bounded pipeline in production:

```text
reviewed ArchitectureProposal
  -> pure render of text + typed manifest for every exact selector
  -> source capture save + readback
  -> manifest-attested analysis save + readback
  -> architecture WAL v3 seals the ordered source-analysis references
  -> reopen CAS + re-render the signed proposal and compare text + manifest
  -> dispatch only the reopened source text to the private SysON MCP
  -> separate provider readback
  -> architecture-capture/3.0 seals the same references
```

Requirements, geometry and Product Structure reopen every v3 source and analysis CAS
reference before treating the architecture as current. Missing, altered, foreign or
rejected analysis blocks authoritative writers; the read-only catalog returns
`unavailable`. Historical architecture capture/WAL v2 remains readable as historical
provider structure but cannot be promoted, rewritten or decorated with a fictional
source analysis. This vertical still does not claim to parse arbitrary SysML or derive
the provider readback from the renderer declaration.

## Declaration, source, lowering and runtime evidence

These stages are different records and must remain different:

```text
reviewed declaration
  -> exact native source, when available
  -> local source analysis
  -> qualified assertion
  -> separate authority admission
  -> semantic operation plan
  -> provider-specific lowering and exact dispatch receipt
  -> runtime artifact / observation
  -> measured local response, when an experiment exists
```

A `simulation-case/1.0`, `simulation-case/2.0` or `mechanical-proof-case/1.0` remains a
reviewed declaration, not a generic native-source AST. The recorded vertical crosses an
exact, identity-bound MCP `resources/read` boundary and saves then rereads every
acquired byte through local CAS.

For a mechanical proof, this vertical deliberately has two non-substitutable admissions.
The declaration's `authorization` is a **seal authorization**: it names the reviewed
`verify.seal-proof-case@1` work and decision that created the sealed proof artifact. The
later `verify.run-fea-static-proof@2` uses a separate **execution admission** in its
`resolved-operation-plan/2.0`: a different run, work item, MRTR approval, exact basis
and artifact bindings. The execution plan consumes the earlier sealed artifact; it must
verify the historical seal lineage, but must not require the seal work or decision IDs
to equal the run work or decision IDs. This separation prevents a proof file or a prior
approval from becoming a reusable solver capability.

Modelica `@2` consumes only `simulation-case/2.0`. This additive successor leaves
`simulation-case/1.0` and its `scenario.sha256` field unchanged as `@1` history. V2
instead records two provider facts with different meanings: `scenario.sourceSha256`
fingerprints the exact native scenario resource bytes, while `scenario.projectionSha256`
fingerprints the provider's canonical public scenario projection. The seal checks the
former against both the qualified manifest's scenario resource and its acquired CAS
bytes; it recomputes the latter from the manifest's public projection and checks it
against `scenarioProjectionSha256`. The projection is therefore manifest-attested data,
not a second source resource.

`simulate.seal-simulation-case@2` is a planless registered operation gated by the exact
human-approved MRTR over that closed V2 declaration. It accepts no
`resolved-operation-plan/2.0`; it reads the provider-qualified kit manifest and exact
model, scenario and optional parameter-schema resources, then seals distinct case,
method-manifest, source and qualification artefacts. The later
`simulate.run-modelica-scenario@2` is separately queued with one server-sealed plan
bound to the exact `simulationCase` and `methodManifest` thread artifacts. It rereads
those artifacts and the qualification-owned sources before submission, then captures the
resumable request, resolved parameters, model, scenario, script, diagnostics, evidence,
`run.json` and, on success, result CSV. It publishes normalized observations only: no
requirement, evaluation, violation, action or verdict is manufactured.

For CalculiX, the `@2` run rereads the historically sealed proof and exact STEP before
staging the private provider input. Its separately approved execution admission binds
the current descendant basis and those exact artifacts. It captures the fixed
nine-resource profile: STEP, request, Gmsh input/log, mesh, CalculiX deck/log/data and
result. The proof, requirements and result remain distinct inputs to the separate SysON
evaluation call and its exact request/structured-response capture. These bytes make
runtime provenance inspectable; they do not claim that an agent-authored arbitrary
`.inp` deck is accepted or parsed.

## Current authority boundary

The canonical analysis graph is now active, but it is deliberately a fact and
traceability layer, not an execution gate. Its producers include the approved-brief
baseline, the Modelica simulation-case seal, the CalculiX proof-case seal and retained
legacy observations. Modelica and CalculiX declaration nodes and scopes use the stable
case/proof digest; each seal assertion keeps its run-scoped capture fingerprint only as
evidence, so repeated seals can merge as parallel assertion occurrences without changing
semantic identity. After its two solver runs, the sensitivity path creates one observed
`measured-local-sensitivity` assertion per declared response metric, including the
reviewed finite-difference case, base and stepped results, derivative, local scope and
the one exact persisted sensitivity-capture fingerprint. The provider responses and STEP
handoff digests are normalized inside that capture; they are not represented as
synthetic `solver-result` artifacts or as independent evidence bytes. The case
identifies its driver, but no component-to-driver assertion is emitted until exact
architecture/source binding evidence exists. Consequently the global graph shows the
qualified measurement while component facets remain empty. The snapshot extension
publishes that graph as `ThreadSnapshot/1.1`; its browser projection is explicitly
`origin: "analysis"`. No analysis edge grants MCP, provider, admission or decision
authority.

The CAD integration still stops at passive source facts and sealed provenance. It does
not invent source-level CAD assertions from the parser. The Workbench does not infer
component sensitivity from historical observation labels; such labels can neither create
a relation nor establish authority.

Already-published evidence is never repaired by editing an old snapshot or by teaching a
projector a URI heuristic. When later code proves that a historical entity overstated
its provenance, a human-reviewed `record.archive-lineage@1` successor names the exact
entity references and lets the canonical archive cascade retire their descendants. The
old revision remains readable; the new head omits the retired branch from the current
Workbench projection. Re-running a provider is a separate reviewed operation and cannot
retroactively turn the old occurrence into exact evidence.

The `@2` resolver is server-owned: validating a plan does not establish that an agent
created it, and an opaque plan id is merely an inspection handle. Plan sealing, reading
and execution use the same closed CAS-backed capability. The provider call stays behind
the registered executor, including post-acknowledgement WAL recovery: a known request is
read back, never blindly dispatched again. Once solver resources are captured, that
provider phase is CAS-only. An operation with a separate evaluator records another WAL
intent before its one allowed evaluation call; after the evaluation capture, its
recovery is CAS-only. An unknown effect remains quarantined for human review.

Future native-language frontends should reuse this sequence without inventing a
universal AST: reviewed declaration -> exact identity-bound bytes -> local analysis when
the language contract supports it -> qualified method -> one-action plan -> captured
runtime evidence. Arbitrary agent-authored Modelica source and native CalculiX input
decks are deliberately deferred. Later facts may feed the analysis graph only as
qualified assertions with exact evidence; Graphology remains a read-only projection.

## Implementation status

This reference follows the current code for the recorded-analysis `@2` vertical. It does
not turn provider availability, an approved MRTR or a queued run into proof of a
successful provider execution. That success exists only when the recorded runtime
resources and resulting thread evidence have been captured and reread.
