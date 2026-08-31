# Reference: source analysis and authority pipeline

Audience: agent · Diátaxis: reference · Kind: contract

This boundary keeps agent-authored engineering work expressive while making every
authority transition explicit and reviewable. The agent talks directly to the Casys
Digital Thread MCP server. Provider MCP servers remain private backend dependencies;
they are never a second, bypassable tool surface.

The prescribed-kinematics L3 path has a bounded provider-specific WAL and recovery
contract: [observation recovery](prescribed-kinematics-observation-recovery.md). It
does not make the private host qualification WAL into project or Thread evidence.

| Open                                                                        | Owns                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [Compilation and isolation](compilation-and-isolation.md)                   | Admission compiler, CAD/Modelica/CalculiX isolated verticals (extracted) |
| [Admitted source isolated execution](admitted-source-isolated-execution.md) | Shared reopen → microVM pattern                                          |
| Contracts and ownership                                                     | `source-analysis/1.0` vs assertions vs Thread                            |
| Implemented verticals                                                       | Current generic CAD preview, brief, SysML renderer, agent-authored SysML |
| Current authority boundary                                                  | What is live vs documentary                                              |

```mermaid
flowchart TD
  src["Native source or semantic intent"] --> cap["Capture exact bytes"]
  cap --> sa["source-analysis/1.0\nfacts, symbols, unresolved, diagnostics"]
  sa --> assert["engineering-assertion/1.0\ndeclared | inferred | observed"]
  assert --> graph["AnalysisGraph/1.0"]
  graph --> ts["ThreadSnapshot/1.1"]
  ts --> bff["BFF → Graphology MultiDirectedGraph\nread only, Thread dossier"]
  sa --> mrtr["Human MRTR + qualified method\nexact decision, approval, basis"]
  mrtr --> rop["resolved-operation-plan/2.0\none server-owned action"]
  rop --> exec["Server-fixed executor"]
  exec --> mcp["Private provider MCP\n+ identity-bound resources/read"]
  exec --> vm["Local OCI/microVM\nonly if independently qualified"]
  mcp --> cas["CAS capture, recovery, Thread lineage"]
  vm --> cas
```

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
        |    BFF -> Graphology MultiDirectedGraph (read only, Thread dossier)
        |                                      |
        +--> human MRTR + qualified method
             exact decision, approval and thread basis
                         |
                         v
             resolved-operation-plan/2.0
             one server-owned action, sealed when the run is queued
                         |
                         v
             server-fixed executor
                    |                    |
                    |                    +-> private provider MCP + identity-bound resources/read
                    +-> local OCI/microVM runner, only for an independently qualified vertical
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
the queue-to-execution authority for isolated analysis. Historical MCP FEA `@1`/`@2` and
recorded Modelica scenario/seal versions are not registered and cannot be queued.
Product FEA run is `verify.run-fea-static-proof@3`.

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
- Graphology is a read/navigation projection. The BFF still emits analysis edges with
  `origin: "analysis"` so Product and tests can inspect the index. The Evidence canvas
  omits that overlay and loads the Thread dossier (provenance + structure) into a
  `MultiDirectedGraph`, so parallel recorded relations stay inspectable rather than
  collapsed. Sensitivity and other `AnalysisGraph` islands remain a semantic index, not
  a second painted graph. Canonical relations and evidence remain domain records and
  thread captures.

## Hexagonal placement

The source, assertion, graph, admission and resolved-plan contracts live in
`src/domain/compile/` (`source/`, `admission/`, `rop/`, `brief/`) and import no MCP,
storage, provider, UI, Graphology or SysML code. Language frontends and provider
lowerings are adapters. The agent-facing project-control tools validate MCP input and
call inward-facing use cases; they do not own provider clients or CAS stores. Capture
returns `technical-source-capture-review/4.0` (`parser`, `levers`, opaque
`technical-source-analysis-capture-locator/4.0` `reference`). Compilation preview
accepts only `result.reference` and produces `technical-compilation/2.0`; unresolved
previews hoist join `gaps` beside that closed document. Exact operation dispatch lives
under `src/application/use-cases/` and depends only on the generic `ProjectRunExecutor`
contract in `src/application/ports/in/project-run-executor.ts`. Canonical CAD drafts
come from `project_admitted_geometry_export`. Concrete registered executors remain the
only components allowed to call private provider MCP clients for admitted project runs.

## Implemented generic CAD preview and promotion vertical

The following MCP-backed CAD path remains the current generic sandbox export used by
`project_admitted_geometry_export`. `project_geometry_preview` is not a product entry.
`design.write-geometry@1` seals only a draft stamped from `compile.seal-admission@3`. It
is not the local microVM execution path and must not be used as evidence that isolated
execution produced canonical geometry. The backend performs this exact order:

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

Older draft schemas `1.0`, `1.1` and `2.0`, and older canonical capture schemas `1.1`
and `2.0`, are unsupported and are rejected. They are not migrated, dual-read, or given
fictional analyses. Downstream Product Structure and FEA readers accept only the current
assembly, bundle, and target-part forms.

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
and reconstructs the graph before accepting completion. Only
`approved-brief-baseline-capture/1.1` is current; the brief source analysis is
mandatory. A missing or corrupted analysis fails closed.

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
  -> architecture-capture/4.0 seals the same references
```

Requirements, geometry and Product Structure reopen every current 4.0 source and
analysis CAS reference before treating the architecture as current. Missing, altered,
foreign or rejected analysis blocks authoritative writers; the read-only catalog returns
`unavailable`. Older architecture capture and WAL schemas are unsupported and are
rejected rather than projected. This vertical still does not claim to parse arbitrary
SysML or derive the provider readback from the renderer declaration. SysON remains a
private provider MCP behind its own WAL, resource readback and Thread publication; it is
not executed inside the local code-isolation backend.

## Implemented agent-authored architecture SysML slice

The first slice accepts agent-authored UTF-8 that matches exactly the three renderer
write forms: a package block, a part definition that is empty or a block, and
`part usage : Type;`. Digital Thread tokenizes that text fail-closed, parses it,
CAS-captures the exact bytes, and analyses them under
`sysml-architecture-closed-subset-v1`. Unresolved constructs are first-class and are
never omitted. Bindings published by the analyzer are symbol ids, never labels.

This slice is deliberately not `model.write-architecture@2`, not
`compile.seal-admission@3`, and not `sysml-source-capture/1.0`. The renderer envelope
remains the authority for the existing SysON insertion operation. The new
`model.seal-architecture-sysml@1` operation writes a Thread document only and never
calls a provider.

|                | Renderer / SysON write                                | Agent-authored seal                                   |
| -------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| Entry          | Flat MRTR `architecture.*` / `component.*` parameters | UTF-8 via `project_architecture_sysml_source_capture` |
| Capture schema | `sysml-source-capture/1.0`                            | `architecture-sysml-source-analysis-capture/1.0`      |
| Parser         | Server renderer + manifest-attested companion         | Lexical guard + closed-subset parser                  |
| Operation      | `model.write-architecture@1`                          | `model.seal-architecture-sysml@1`                     |
| SysON          | Inserts, journals, readback                           | Never called                                          |
| Thread write   | `architecture-capture/4.0`                            | Document + `architecture-sysml-seal-capture/1.0`      |

```text
agent-authored SysML UTF-8
  -> lexical guard
  -> closed-subset parse (unresolved first-class)
  -> architecture-sysml-source-analysis-capture/1.0 save + readback
  -> preview (no Thread write)
  -> human-signed model.seal-architecture-sysml@1
  -> Thread document only
```

Procedure for agents:
[author architecture SysML](../../how-to/compile/author-architecture-sysml.md).

## Product admission compiler boundary

Moved to [compilation and isolation](compilation-and-isolation.md). This heading remains
so older links still land. The sealed compilation is reviewed engineering input, not a
transport envelope. Build123d, Modelica and CalculiX keep distinct method and evidence
contracts even when they consume projections from the same compilation.

The active Build123d 3.0 profile is the one exception to otherwise non-executable
multi-file technical closures: it lowers the narrow direct scalar-leaf shape defined in
[workspace-closure lowering v1](../domains/cad/build123d-workspace-closure-lowering-v1.md).
Its V4 capture persists the full manifest and separates `technical-unit:<closure sha256>`
from workspace file identity. Every subsequent reopen recrosses the closure, reopens all
bytes, re-lowers, compares the full manifest and effective script, then reanalyses.
Modelica and circuit-only SPICE multi-file closures remain literally
`source.dependency-lowering-unavailable`. This compiler contract gives no caller a
provider, tool, path or lowerer choice, and is not itself runtime proof.

Admitted CAD/Modelica file → microVM:
[admitted source isolated execution](admitted-source-isolated-execution.md).

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

A `mechanical-proof-case/1.0` remains a reviewed declaration, not a generic
native-source AST. Isolated CalculiX V3 reopens sealed ROP2, the exact proof and STEP,
runs a digest-pinned local microVM, and publishes the closed nine outputs plus an
immutable SysON evaluation capture. Historical MCP FEA `@1`/`@2` are rejection
identities. Live-FEA sensitivity uses fleet `mcp-calculix`; that is not product static
`@3` provenance. Historical `simulation-case/1.0`/`2.0` seals are retired and not
registered.

For a mechanical proof, this vertical deliberately has two non-substitutable admissions.
The declaration's `authorization` is a **seal authorization**: it names the reviewed
`verify.seal-proof-case@1` work and decision that created the sealed proof artifact. The
later `verify.run-fea-static-proof@3` uses a separate **execution admission** in its
`resolved-operation-plan/2.0`: a different run, work item, MRTR approval, exact basis
and artifact bindings. The execution plan consumes the earlier sealed artifact; it must
verify the historical seal lineage, but must not require the seal work or decision IDs
to equal the run work or decision IDs. This separation prevents a proof file or a prior
approval from becoming a reusable solver capability.

Historical `simulate.seal-simulation-case@1`/`@2` and
`simulate.run-modelica-scenario@1`/`@2` are not registered and are not fallbacks.

Isolated CalculiX `@3`, admitted CAD/Modelica microVM runs, and the closed-subset
catalogue: [compilation and isolation](compilation-and-isolation.md). Those bytes make
runtime provenance inspectable; they do not claim that an agent-authored arbitrary
`.inp` deck is accepted or parsed. Historical MCP FEA `@1`/`@2` are not registered.

## Current authority boundary

The canonical analysis graph is now active, but it is deliberately a fact and
traceability layer, not an execution gate. Its producers include the approved-brief
baseline, the CalculiX proof-case seal and retained legacy observations. CalculiX
declaration nodes and scopes use the stable proof digest; each seal assertion keeps its
run-scoped capture fingerprint only as evidence, so repeated seals can merge as parallel
assertion occurrences without changing semantic identity. The live producer is
`analyze.run-fea-sensitivity@1` after `analyze.seal-sensitivity-study@1`. Seal
parameters come from the read-only `project_sensitivity_study_seal_review` compiler
(catalog template, or unique signed catalog-offer + its signed
`compile.seal-admission@3` admission when the catalog does not uniquely select).
`analyze.seal-sensitivity-study@1` reopens that same unique offer; it does not invent a
catalog JSON. The caller never invents `sensitivity.case.*` or a `cadSource`. A project
without a reviewed catalog JSON and without a unique signed offer (`desk-lamp-dl06`
before the FEA opt-in) stays `catalog-absent`. After its two solver runs, the
sensitivity path creates one observed `measured-local-sensitivity` assertion per
declared response metric, including the reviewed finite-difference case, base and
stepped results, derivative, local scope and the one exact persisted sensitivity-capture
fingerprint. The provider responses and STEP handoff digests are normalized inside that
capture; they are not represented as synthetic `solver-result` artifacts or as
independent evidence bytes. The case identifies its driver, but no component-to-driver
assertion is emitted until exact architecture/source binding evidence exists.
Consequently the global graph shows the qualified measurement while component facets
remain empty. The snapshot extension publishes that graph as `ThreadSnapshot/1.1`; its
browser projection is explicitly `origin: "analysis"`. No analysis edge grants MCP,
provider, admission or decision authority.

`verify.evaluate-sensitivity-base@1` is the missing join between
`analyze.run-fea-sensitivity@1` observations and Thread requirements. It never invents a
metric alias. A study whose metric ids do not Object.is-equal the requirement metrics
stays `UNLINKED` for the whole set. Proof-run evaluations (`calculix-observation-*`) are
a different authority and cannot authorize a correction.

`design.apply-vector-correction@1` seals a Thread document of one bounded first-order
proposal. The capture declares `grants: none`. It is not a CAD admission, a SysON write,
or a mandate for a successor execution. Corrections return through `AgentResource` plus
a successor workspace file revision, then a new technical-source capture and
`compile.seal-admission@3`. That later admission stays its own MRTR. The AnalysisGraph
edge `measured-local-sensitivity` remains an inspectable fact, not an execution gate.
Thread-entity bindings are identities only: `assertPlanBindingsResolve` does not resolve
them at plan publication, so the executor fail-closes if the named evaluation or study
capture is absent. `UNIT_NORMALISATION` remains a brief-compilation-boundary table and
is not a derivative rescale.

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

## Three judgement branches

Behave, make, and buy share the canonical STEP and part identities. They do not share
verdicts. Product wording:
[Three judgement branches](../../explanations/product/product-direction.md#three-judgement-branches).
Exact ops:
[agent workspace golden path](../agent/agent-workspace.md#7-golden-path-generic-v3).

| This                                                   | Is not                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| Study-base `fail` → `design.apply-vector-correction@1` | A DFM fail, a proof-run `@3` fail, or a BOM gap             |
| `industrialize.run-dfm-checks@1`                       | A CalculiX consumer, a `z*` grant, or isolated-geometry DFM |
| A missing ERP / BOM binding                            | An implied part, a cost, or a fabricate verdict             |
| A new `design.write-geometry@1` STEP                   | A silent refresh of old FEA, DFM, or BOM facts              |

Constrained vehicles have played **behave**. Opening make or buy now is later V1 work,
not a hole in the current authority boundary.

## Implementation status

The capture → analysis → MRTR → dispatch spine on this page is live. Only
`ready-for-review` compilation output is persisted as a content-addressed draft. After
exact replay the existing `compile.seal-admission@3` operation publishes a
`technical-compilation-admission-capture/4.0` document artifact into the Thread. That
artifact still grants no execution authority. The current contracts are V4 capture,
review and locator; V2 compilation input/document; and V4 admission/capture, with no
compatibility path implied by this reference.

Isolated CAD / Modelica / CalculiX composition, bootstrap flags, worker gates, host
limits and the closed-subset catalogue live on
[compilation and isolation](compilation-and-isolation.md). The shared reopen → microVM
pattern is [admitted source isolated execution](admitted-source-isolated-execution.md).

Historical recorded Modelica `@1`/`@2` and MCP FEA `@1`/`@2` are not registered and
cannot be queued. They are not fallbacks for `simulate.run-qualified-modelica-kit@1`,
`simulate.run-admitted-modelica@1`, or `verify.run-fea-static-proof@3`, and old ROP2
plans are never redirected to a local executor. Conversely, the local Modelica operation
remains the one fixed linear-ramp conformance kit rather than a replacement for
historical arbitrary approved provider scenarios. Provider availability, an approved
MRTR, a queued run or an isolated-worker smoke is never proof of a product execution;
that requires the exact registered executor, runtime resources and resulting Thread
evidence to be composed, captured and reread.
