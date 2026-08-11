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
        +--> authority-admission/1.0 [not yet wired]
             assertion hash + reviewed decision + basis
                         |
                         v
             resolved-operation-plan/1.0 [not yet wired]
             inspectable causal inputs + versioned lowering
                         |
                         v
             server-fixed executor -> private provider MCP
                         |
                         v
             captured receipt, observations and thread lineage
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

`resolved-operation-plan/1.0` is the inspectable output of the server-owned resolver. It
records captured sources, analyses, admissions, causal dispatch inputs, provider
contract versions and a versioned lowering. It contains semantic arguments, not a
provider wire envelope. Transport credentials, service endpoints and filesystem paths
are absent by construction of the code-owned resolver, not by guessing from JSON field
names. The adapter named by `lowering` produces the envelope immediately before the
backend call; the execution receipt captures what was actually sent and observed. An
analysis reference binds both the exact `sourceRefId` and its fingerprint, so two
semantically distinct PartDefinitions may share source bytes without becoming
interchangeable.

That paragraph describes the contract's intended ownership, not an activated runtime
path. Version 1.0 is not yet sufficient to sit between queueing and execution: it does
not durably bind a plan to one queued run and its MRTR decision, and it cannot fully
describe conditional WAL recovery or bind a provider output value into a later dispatch
argument. It also requires a provider dispatch, whereas documentary baseline and
geometry sealing deliberately have none. Activation therefore requires a successor
contract, a content-addressed plan store, a run-to-plan reference and code-owned
operation-specific lowerings. There must not be a second generic `execute-plan` tool.

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

A `simulation-case/1.0` or `mechanical-proof-case/1.0` is a reviewed declaration, not a
Modelica `.mo` file or CalculiX `.inp` deck. The current Modelica MCP can run a sealed
kit/scenario and return run artifacts, but Digital Thread cannot read the kit's native
source bytes through MCP. The current CalculiX MCP accepts a high-level static-solve
request but does not return the lowered input deck, mesh, solver log or result file.
Those absences prohibit source spans, static value-flow claims and native-source AST
facts for both providers.

Provider evolution should add read-only, identity-bound artifact reads. Modelica needs
the exact kit/scenario sources and the generated/consumed run sources; CalculiX needs a
stable run id plus exact input deck, mesh, log and result artifacts. Each response must
carry media type, byte count and independently verified SHA-256. A provider-returned AST
or semantic manifest may supplement those bytes but must never replace them.

## Current authority boundary

The canonical analysis graph is now active, but it is deliberately a fact and
traceability layer, not an execution gate. Its producers include the approved-brief
baseline, the Modelica simulation-case seal, the CalculiX proof-case seal and the CM-01
sensitivity executor. Modelica and CalculiX declaration nodes and scopes use the stable
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

The CM-01 DFM and PrusaSlicer paths are likewise observational, not generic oracles.
Their current WALs use a three-state
`dispatched -> capture-recorded -> completed` lifecycle. Once dispatch may have happened,
an unrecorded outcome is terminally unknown rather than eligible for blind redispatch;
once the canonical capture is recorded, recovery reopens the same CAS bytes and never
calls the provider again. Current printability and print-estimate captures bind the exact
case digest, trusted run and dispatch basis. Only the persisted JSON capture is published
as an artifact: STEP, STL and G-code digests remain attested fields because those binary
bytes are not retained and reread by these executors. DFM conditions and slicer estimates
become observations; they do not become requirements, evaluations or violations without
a separately reviewed oracle contract.

Already-published evidence is never repaired by editing an old snapshot or by teaching a
projector a URI heuristic. When later code proves that a historical entity overstated
its provenance, a human-reviewed `record.archive-lineage@1` successor names the exact
entity references and lets the canonical archive cascade retire their descendants. The
old revision remains readable; the new head omits the retired branch from the current
Workbench projection. Re-running a provider is a separate reviewed operation and cannot
retroactively turn the old occurrence into exact evidence.

`authority-admission/1.0` and `resolved-operation-plan/1.0` remain contracts, not an
activated generic admission/resolution path. In particular, validating a plan is not
proof that a registered resolver created it. Any future activation must use server-owned
builders which re-read the exact decision and basis before dispatch, and must first
close the run/decision/WAL limitations described above.

Future native-language frontends should follow the same port and storage sequence
without sharing a universal AST. Modelica equations and CalculiX input dependencies
remain blocked on exact provider-readable source bytes; case-level declarations and
runtime receipts must not be mislabeled as those native facts. Any later facts can feed
the existing canonical analysis graph only as qualified assertions with exact evidence;
Graphology remains a read-only projection.
