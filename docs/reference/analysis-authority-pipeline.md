# Reference: source analysis and authority pipeline

This boundary keeps agent-authored engineering work expressive while making every
authority transition explicit and reviewable. The agent talks directly to the Casys
Digital Thread MCP server. Provider MCP servers remain private backend dependencies;
they are never a second, bypassable tool surface.

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
- Graphology is a read/navigation projection. The BFF still emits analysis edges
  with `origin: "analysis"` so Product and tests can inspect the index. The
  Evidence canvas omits that overlay and loads the Thread dossier
  (provenance + structure) into a `MultiDirectedGraph`, so parallel recorded
  relations stay inspectable rather than collapsed. Sensitivity and other
  `AnalysisGraph` islands remain a semantic index, not a second painted graph.
  Canonical relations and evidence remain domain records and thread captures.

## Hexagonal placement

The source, assertion, graph, admission and resolved-plan contracts live in
`src/domain/analysis/` and import no MCP, storage, provider, UI, Graphology or SysML
code. Language frontends and provider lowerings are adapters. The agent-facing
project-control tools validate MCP input and call inward-facing use cases; they do not
own provider clients or CAS stores. `ProjectGeometryPreviewUseCase` lives under
`src/application/ports/in/`, while exact operation dispatch lives under
`src/application/use-cases/` and depends only on the generic `ProjectRunExecutor`
contract in `src/application/ports/in/project-run-executor.ts`. The legacy
capture-backed geometry adapter owns source capture, analysis and its private build123d
MCP dispatch. Concrete registered executors remain the only components allowed to call
private provider MCP clients for admitted project runs.

## Implemented legacy CAD preview and promotion vertical

The following MCP-backed CAD path remains the historical preview and canonical-promotion
route. Its tools, schemas and persisted project state have not yet been migrated or
removed, so they remain supported and readable. It is not the newer local microVM
execution path and must not be used as evidence that the isolated compiler route
produced or promoted canonical geometry. The agent calls the single
`project_geometry_preview` Digital Thread tool with native Python/build123d text. There
is no parser tool to call and no intermediate DSL to author. The backend performs this
exact order:

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
the provider readback from the renderer declaration. SysON remains a private provider
MCP behind its own WAL, resource readback and Thread publication; it is not executed
inside the local code-isolation backend.

## Implemented agent-authored architecture SysML slice

The first slice accepts agent-authored UTF-8 that matches exactly the three renderer
write forms: a package block, a part definition that is empty or a block, and
`part usage : Type;`. Digital Thread tokenizes that text fail-closed, parses it,
CAS-captures the exact bytes, and analyses them under
`sysml-architecture-closed-subset-v1`. Unresolved constructs are first-class and are
never omitted. Bindings published by the analyzer are symbol ids, never labels.

This slice is deliberately not `model.write-architecture@2`, not
`compile.seal-admission@1`, and not `sysml-source-capture/1.0`. The renderer envelope
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
| Thread write   | `architecture-capture/3.0`                            | Document + `architecture-sysml-seal-capture/1.0`      |

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
[author architecture SysML](../how-to/author-architecture-sysml.md).

## Product admission compiler boundary

The approved brief remains a versioned, human-readable statement of intent. It may seed
explicit proposals, but the compiler never parses its prose or treats wording as a
technical binding. Once technical modelling starts, the exact reread SysON identities
from the supported SysML subset are the technical truth. Every technical binding—parts,
RequirementUsages and ConstraintUsages—must therefore cite exact semantic identifiers
and the exact project and thread basis; labels are display data and never join keys.

That basis is deliberately not advertised as a full SysON model AST. Compilation V1
reopens the parser-backed `architecture-capture/3.0` Package, PartDefinitions and
PartUsages. It also admits exact RequirementUsage and ConstraintUsage identities from an
active `requirements-capture/3.0` only after the capture bytes, provider identities,
architecture basis and Thread artifact lineage have all been reread. Each anchor element
carries the exact capture artifact fingerprint that attests it. Historical requirements
capture V2 remains readable but contributes no individual constraint identity; a
container, label or capture id is never expanded into fictional per-requirement anchors.

The compiler consumes only closed, fingerprinted inputs: the reread SysML basis, exact
native source bytes with their analysis, explicit source-symbol-to-SysML bindings and a
server-owned method profile. It is a pure deterministic transformation. It performs no
MCP call, filesystem or network I/O, chooses no provider or tool, accepts no raw
provider arguments and never repairs a missing binding by matching names. Unsupported,
ambiguous or cross-basis input remains explicit as `unresolved` or `rejected`; it cannot
dispatch a provider.

```text
exact reread SysML basis + captured native source + explicit bindings
                              + server-owned method profile
                                      |
                                      v
                         pure compilation draft
                                      |
                                      v
                         human MRTR over exact digest
                                      |
                                      v
                    provider-free sealed compilation
                                      |
                                      v
              separate execution review + human MRTR
                                      |
                                      v
         registered specialized executor, when explicitly composed
                                      |
                                      v
       isolated run -> validated non-canonical output publication
```

The sealed compilation is reviewed engineering input, not a transport envelope. A
specialized, code-owned backend adapter remains responsible for lowering it immediately
before execution and for capturing what the provider actually observed. Build123d,
Modelica and CalculiX consequently keep distinct method and evidence contracts even when
they consume projections from the same compilation.

### Reusable substrate versus first vertical

The implementation deliberately shares control-plane contracts, not one universal solver
protocol. The boundary is split as follows:

| Boundary               | Reusable contract                                                                                                                                              | First concrete binding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admission              | Pure `technical-compilation/1.0`, exact-basis/source readers, content-addressed review draft and provider-free admission seal                                  | The only registered compilation profile is the qualified Build123d closed subset (`Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Ellipsoid`, `Wedge`, `Rectangle`, `Circle`, `Ellipse`, `RegularPolygon`, `Pos`, `Rot`, `Compound`, named `Pos`/`Rot` bindings and `Plane.XY\|…\|ZY *` shape, `scale(solid, scalar)`, `fillet(solid, scalar)` or `fillet(solid.edges(), radius=scalar or positional)`, `chamfer(solid, scalar)` or `chamfer(solid.edges(), scalar)`, `extrude(sketch, amount=scalar or positional, optional taper=scalar)`, `offset(solid, amount)`, `revolve(sketch, Axis.X\|Y\|Z)`, math `pi`/`e`/`tau`) |
| Isolated execution     | Public `IsolatedCodeRunner`, fail-closed broker and technology-neutral `EphemeralExecutionBackend`; opaque backend lease/output handles stay inside the broker | Microsandbox local 0.6.8 implements the single active backend for one fixed Python wrapper in a digest-pinned OCI microVM                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Declared outputs       | Code-owned output manifest, injected format validator, external byte count/hash and publication-gated output CAS                                               | `geometry.step`, AP214, `OcctStepOutputValidator` and `FileIsolatedOutputCas`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Recovery               | Generic run-scoped destruction and tri-state CAS-publication reconciliation                                                                                    | The durable attempt state machine and evidence schemas are Build123d-specific; there is no universal cross-solver WAL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Evidence and promotion | An isolation receipt proves only the execution boundary; canonical promotion is a separate reviewed authority transition                                       | Build123d currently publishes a documentary execution capture and noncanonical draft only; its canonical promotion operation does not yet exist                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

“Interchangeable” therefore applies at explicit seams. A new sandbox backend implements
`EphemeralExecutionBackend`; a new output format supplies a code-owned manifest and
validator; and a new engineering vertical supplies its own qualified compilation and
execution profiles, WAL, evidence schema and promotion operation. None can be selected
or registered by caller input. The generic broker suite proves this seam with a second
registered `equation-language-fixture` profile and a JSON output, without pretending
that fixture is a production engineering profile. The deployed composition registers one
local backend, not a runtime menu: interchangeability is an inward port property, not a
caller or agent capability.

The compiler also does not execute agent-authored code. Such execution crosses a
separate isolated-runner port with a server-owned policy and a declared-output broker.
The port, broker and evidence contracts do not name a sandbox technology. The sole
registered isolation-backend technology is local Microsandbox 0.6.8 with an attached,
digest-pinned OCI microVM lifecycle; all three isolated product profiles bind through
that backend. This route uses neither Deno Deploy nor `@deno/sandbox`; it has no remote
control plane, sandbox credential or remote snapshot. A conforming deployment gives the
microVM neither repository access, secrets, Docker socket nor canonical evidence
volumes.

The adapter accepts only the exact OCI reference and digest owned by the reviewed
profile, uses pull policy `Never`, and checks the observed manifest, architecture, OS,
image user, entrypoint, command and environment before execution. Native runtime binary
overrides are rejected before the SDK is loaded; the code-owned empty Microsandbox
configuration, native module, `msb` executable and `libkrunfw` file are resolved inside
the pinned platform package and verified by SHA-256. Unsupported host/architecture
combinations fail closed. The post-create configuration must still match the fixed
policy: restricted security, attached recovery lifecycle, one ephemeral `/tmp` mount,
exact run labels, no patches, and network disabled with deny-all ingress and egress, no
ports, nameservers, secrets or host CA trust.

The agent is not given a shell surface. The adapter directly executes
`/usr/local/bin/python3 -I -B /opt/casys/bin/run-build123d.py`; it writes the admitted
source bytes unchanged only to `/input/source.py`, uses `/work`, and can inventory only
the declared `/out/geometry.step` candidate plus code-owned quiescence and log records.
No path, command, argument, environment variable, volume, socket or backend selection
comes from agent input. Requested resource ceilings are explicit. The runtime attests
wall time and memory, the broker observes log and output byte caps, and CPU time and
process-count ceilings remain explicitly unattested rather than being promoted into
facts.

The sole qualified V1 output is `geometry.step` with media type `model/step` and format
`step-ap214`. Its code-owned validator identity is part of the execution-profile
fingerprint. Outside the sandbox, a bounded Part 21 header check establishes the
declared AP214 family, then `occt-import-js` must parse the complete bytes and expose
referenced, non-degenerate triangulated geometry. A plausible header, another
application protocol, truncated bytes or an empty shape is therefore rejected before
publication. Returned bytes otherwise stay untrusted until the broker validates their
declared identity and size and recomputes their digest outside the isolation boundary.

Only cleanup meeting the code-owned `proven` threshold permits release. The adapter
removes the named microVM, lists by exact run labels and requires zero remaining
sandboxes before emitting its run-scoped destruction proof. This is concrete backend
cleanup evidence, not a claim of cryptographic erasure. After cleanup, the broker stages
and rereads the complete output batch. The filesystem CAS makes the blobs and a complete
byte-free receipt durable before publishing one run-and-producer-generation marker. A
lost commit acknowledgement is resolved from that exact marker under the run lock;
resolution is tri-state: `published`, `not-published` or `outcome-unknown`. An unknown
outcome remains fail-closed and blocks every redispatch. Run-scoped abort refuses a
published or ambiguous generation, durably fences an absent one, then removes only that
generation's staging. Even `not-published` cannot authorize another execution until
run-scoped staging and environment cleanup have also succeeded. Orphaned blobs remain
invisible because reads require both the publication reference and exact receipt
membership. An isolation receipt records the boundary and its assurance; it is neither
MRTR approval nor engineering evidence by itself.

`design.execute-build123d@1` is intentionally draft-only. A successful execution is
modelled as one private `build123d-execution-draft/1.0` whose STEP bytes remain behind
the publication-gated output CAS, plus one `build123d-execution-capture/1.0` JSON
artifact of kind `document` in a successor Thread snapshot. The Thread addition records
the reviewed execution and its exact admission consumption; it adds no STEP artifact,
canonical geometry, observation, requirement, evaluation, violation or verdict. The
draft and capture both bind the producer generation and exact receipt/publication, while
the WAL binds the persisted draft reference back to that same receipt and checks the
link again during completed replay. The existing `design.write-geometry@1` cannot
promote this new draft because it seals a different historical sandbox-preview contract.
`design.seal-isolated-geometry@1` is that second, distinct MRTR. It reopens the
execution capture, draft and publication-gated STEP, rehashes the bytes, and writes one
Thread document (`isolated-geometry-seal-capture/1.0`). It does not copy STEP into
`thread-assets`, does not publish a `step` or `cad-model` artifact, and does not grant
Product or FEA authority. Canonical promotion still requires a later, separately
reviewed operation.

The durable execution journal is monotone:
`prepared -> dispatching -> output-published -> draft-persisted -> thread-persisted -> completed`.
After `dispatching`, the executor resolves the publication by its server-derived run id
and current producer generation before considering another call. Only an exact
`not-published` result followed by successful run-scoped CAS and environment cleanup can
authorize one second dispatch. The same logical `executionRunId` is retained, but
producer generation 0 is first fenced durably and an exact canonical `0 -> 1` generation
advance is persisted. Authorization then moves through the durable
`authorized -> consumed` substate within `dispatching`, and only the fresh
`consumed-now` transition can invoke the runner with `dispatchCount: 2` and producer
generation 1. Replaying a consumed authorization cannot invoke the runner again. If
consumed generation 1 resolves `not-published`, the executor proves generation-1 cleanup
and enters terminal quarantine; an unknown outcome also blocks dispatch. Generation 2
does not exist, so a third dispatch is impossible. From `output-published` onward,
recovery is CAS/WAL-only and reopens the same draft, capture and Thread evidence instead
of executing source again.

Modelica has now passed one deliberately narrow real Microsandbox qualification against
`casys/modelica-microsandbox-worker@sha256:7d3fdeabe794b0ded5360921b16724c7904487e9d11bc24fa37c72f9b92a1894`.
The gate ran OpenModelica 1.27.0 with MSL 4.1.0 in the local microVM at producer
generation 0, externally validated `temperature_final = 22 degC`, proved destruction,
reread the publication after recreating the CAS adapter and persisted qualification
capture `d6aee5fe375daa55cec29a32acf27181dd4bb8ea8e5c3f90f848cc718c149428`. That
authority is exact, not general: it covers only `linear-thermal-ramp-v1@0.1.0` /
`linear-ramp-nominal` and accepts no arbitrary Modelica. The separate local product
operation descriptor and fail-closed dispatcher entry for
`simulate.run-qualified-modelica-kit@1` remain registered independently of runtime
availability. Its read-only review and concrete executor become available only when
`--local-execution` composes the exact profile, runtime and pinned qualification. The
review accepts only the exact project and current Thread basis; its MRTR has no ROP,
provider or caller-selected source. A completed run adds the execution capture,
normalized `evidence.json`, retained `result.csv` and the one `22 degC` observation,
never an implicit requirement verdict, evaluation, violation or action. Replay reopens
the durable claim, inner WAL, evidence and Thread successor without another solver call.

CalculiX has also crossed a real generation-0 local microVM gate against
`casys/calculix-microsandbox-worker@sha256:9b3a7468bfbc3f0fe27f7a9ac17c0eb72f1925968173e5a01d985cfa19cbc0a2`.
The bounded gate reopened all nine publication-gated CAS objects, validated a 5,713-node
/ 22,362-element mesh and observed maximum displacement `0.0761 mm <= 5 mm` and maximum
von Mises stress `0.723 MPa <= 90 MPa`; it then replayed the exact evidence, proved
destruction and removed its temporary state. The post-lease rerun also proved one
run-scoped claimant across concurrent calls, with one worker dispatch and identical
evidence replay. This qualifies the worker/profile and its standalone local use case
only. The new product operation descriptor and fail-closed dispatcher entry for
`verify.run-fea-static-proof@3` remain registered independently of runtime availability.
Its concrete executor becomes available only when `--local-execution` composes the exact
local profile/runtime and a SysON oracle is available. It consumes a newly sealed local
ROP2 that names `@3`; the executor refuses an `@2` plan before either solve or SysON.
Its outer WAL separates local evidence capture from the journaled SysON evaluation,
quarantines an ambiguous oracle outcome without a retry, and on replay reopens both CAS
captures before reconstructing the same Thread successor. That successor contains the
nine local output artifacts, one isolated execution-evidence artifact, one SysON
evaluation capture, observations and evaluations; it never claims `mcp-calculix`
provenance for local execution. CalculiX never accepts an agent-authored `.inp` deck:
the local use case constructs the worker bundle from exact reviewed proof and STEP
bytes, and the fixed wrapper owns mesh/deck lowering and declared outputs.

SysON is deliberately different. Its bounded architecture, requirements and evaluation
operations remain provider MCP calls outside the microVM, with operation-specific WAL,
readback and Thread evidence. Local code isolation neither replaces that provider path
nor grants it execution or decision authority.

This is the reusable product boundary, not a claim that every language frontend or
backend route is already activated. A route without a qualified profile, exact bindings,
review or executor remains non-dispatchable.

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
semantic identity. The live producer is `analyze.run-fea-sensitivity@1` after
`analyze.seal-sensitivity-study@1`. After its two solver runs, the sensitivity path
creates one observed `measured-local-sensitivity` assertion per declared response
metric, including the reviewed finite-difference case, base and stepped results,
derivative, local scope and the one exact persisted sensitivity-capture fingerprint. The
provider responses and STEP handoff digests are normalized inside that capture; they are
not represented as synthetic `solver-result` artifacts or as independent evidence bytes.
The case identifies its driver, but no component-to-driver assertion is emitted until
exact architecture/source binding evidence exists. Consequently the global graph shows
the qualified measurement while component facets remain empty. The snapshot extension
publishes that graph as `ThreadSnapshot/1.1`; its browser projection is explicitly
`origin: "analysis"`. No analysis edge grants MCP, provider, admission or decision
authority.

`verify.evaluate-sensitivity-base@1` is the missing join between
`analyze.run-fea-sensitivity@1` observations and Thread requirements. It never
invents a metric alias. A study whose metric ids do not Object.is-equal the
requirement metrics stays `UNLINKED` for the whole set. Proof-run evaluations
(`calculix-observation-*`) are a different authority and cannot authorize a
correction.

`design.apply-vector-correction@1` seals a Thread document of one bounded first-order
proposal. The capture declares `grants: none`. It is not a CAD admission, a SysON write,
or a mandate for a successor execution. `compile.capture-corrected-source@1`
then substitutes the signed `z*` into the parent admission source. The later
`compile.seal-admission@1` stays its own MRTR. The AnalysisGraph edge
`measured-local-sensitivity` remains an inspectable fact, not an execution gate.
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

Behave, make, and buy share the canonical STEP and part identities. They do
not share verdicts. Product wording:
[Three judgement branches](../explanations/product-direction.md#three-judgement-branches).
Exact ops: [agent workspace golden path](agent-workspace.md#7-golden-path-generic-v3).

| This | Is not |
| --- | --- |
| Study-base `fail` → `design.apply-vector-correction@1` | A DFM fail, a proof-run `@2` fail, or a BOM gap |
| `industrialize.run-dfm-checks@1` | A CalculiX consumer, a `z*` grant, or isolated-geometry DFM |
| A missing ERP / BOM binding | An implied part, a cost, or a fabricate verdict |
| A new `design.write-geometry@1` STEP | A silent refresh of old FEA, DFM, or BOM facts |

Constrained vehicles have played **behave**. Opening make or buy now is later
V1 work, not a hole in the current authority boundary.

## Implementation status

The pure technical compiler, exact source-analysis capture boundary, provider-free
preview use case, canonical `compile.seal-admission@1` MRTR grammar, isolated-execution
contracts and broker are present as product foundations. Only `ready-for-review` output
is persisted as a content-addressed draft that retains the exact source-capture
references. The source-capture and preview tools are composed on the MCP project
surface. The operation, proposal validator and provider-free sealer are also composed
through the existing MRTR, queue and registered-run tools: after exact replay, the
sealer publishes a `technical-compilation-admission-capture/1.0` document artifact into
the Thread.

That artifact still grants no execution authority. The concrete local Microsandbox
adapter implements the disposable-backend port for the qualified Build123d profile. It
binds one digest-pinned OCI microVM, fixed direct execution without a shell, deny-all
networking, bounded streamed logs and output reads, and label-based cleanup recovery. A
filesystem output CAS implements receipt-before-marker publication, tri-state
reconciliation and publication-gated reads. The AP214 validator performs a real OCCT
import and meaningful-mesh check before the broker can publish the candidate.

Composition is explicit. At the Build123d seam, without configuration neither review nor
execution is exposed; a `profile` exposes only the provider-free review; and the exact
empty `runtime` marker adds the adapter, validator, broker, CAS, WAL, evidence stores
and registered executor. Ordinary startup supplies no local runtime, while explicit
local execution supplies fixed Build123d, Modelica and CalculiX profile/runtime pairs.
Modelica must additionally reopen the pinned qualification before exposing review or
execution; CalculiX `@3` also requires the separate SysON oracle. Profiles—not markers
or callers— own images, policies, limits, commands and paths. Composition performs no
microVM I/O and never falls back to a provider operation.

The executable bootstrap adds another explicit boundary. Ordinary `deno task start`
passes no local execution configuration. `server.ts --local-execution` is the sole CLI
trigger that supplies all three fixed code-owned profile/runtime pairs; it is effective
only on the loopback project surface and accepts no value or runtime choices.
`deno task start:local` provides its bounded native package read, environment and FFI
permissions while keeping interactive MRTR. `deno task start:yolo` adds the separate
loopback-only `--yolo` approval convenience to that same local runtime. Both use
`--no-prompt --frozen --node-modules-dir=auto`; neither flag can change an image digest,
policy, limit, command, path, network rule or backend.

The bootstrap profile fixes policy `build123d-microsandbox-deny-all-v1@1.0.0`,
supervisor `0:0`, untrusted child `65532:65532`, 30 s wall time, 25 s requested CPU, 1
GiB memory, 32 requested processes, 64 KiB per log stream and 128 MiB per-file and total
output. These are ceilings, not all equally attested: CPU and process count remain
explicitly unattested.

The evidence at this point is deliberately targeted: domain and adapter tests cover the
closed contracts, CAS reconciliation and a real repository AP214 fixture, while
composition/register tests exercise all three configuration states and malformed or
truncated STEP inputs are rejected. The executor, evidence/WAL and composition/register
suites, targeted lint/format checks and `deno task check:build123d-execution` are green.
The final producer-generation integration slice is 103/103 green and its independent
review reports no remaining P0/P1; the underlying CAS/generation slice is 74/74 green,
including inter-process reproduction on fresh and existing roots. The stable generic
gate is deliberately independent of the Microsandbox/Build123d runtime:

```bash
deno task verify:generic:core
```

It covers the closed multi-target compiler/proposal contracts, isolated-execution
domain, broker, filesystem output CAS, a non-Build123d broker profile and production
import boundaries. The local backend, composition, validator, executor, evidence and WAL
remain a separate targeted slice. The real Build123d vertical is exercised explicitly:

```bash
deno task check:build123d-execution
deno task verify:build123d:microsandbox:vertical
```

The final gate passed against
`casys/build123d-microsandbox-worker@sha256:0e19aee61aaab326ec29e50753a0ef56432d255fb44fd21c40988e90ff7601f8`.
It exercised the real local microVM at producer generation 0, produced a 15,430-byte
STEP file, validated AP214 through OCCT, proved broker destruction, resolved the output
as `published` and reread the publication-gated CAS. The published path correctly did
not invoke recovery abort. This qualifies that exact local Build123d worker vertical; it
is not evidence of a different image, host architecture, method or generation-1 crash
recovery.

The two additional real worker verticals have their own explicit tasks; neither task is
a product HTTP-run gate or permission to reroute a historical provider plan:

```bash
deno task verify:modelica:microsandbox:vertical
deno task verify:calculix:microsandbox:vertical
```

The separately reviewed product executors are green on their targeted recovery and
concurrency suites. Those tests qualify the registered control flow; they are not a
second microVM execution beyond the exact worker gates described above.

The remaining limits are explicit. The smoke did not execute a persisted project
`design.execute-build123d@1` run, activate a production deployment or promote canonical
geometry. CPU-time and process-count ceilings remain requested but unattested. The
Thread receives only the documentary JSON capture; STEP stays private and noncanonical.
The historical MCP preview/promotion tools and their persisted items/state still exist,
so no legacy removal or migration is claimed. A global release suite would not replace
these method-specific runtime and migration proofs.

The backend also retains bounded host/runtime limitations. A deadline cannot cancel an
already entered native N-API call; a privileged same-host actor could race a verified
native artifact after hashing and before import; and the SDK materializes a guest
directory listing whose availability ceiling is the protocol frame rather than an
adapter-level pagination limit. These do not broaden the agent surface, but they remain
part of the qualified host trust and availability envelope.

The initial code-owned compilation catalogue qualifies only a parser-backed Build123d
closed subset (`Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Ellipsoid`, `Wedge`,
`Rectangle`, `Circle`, `Ellipse`, `RegularPolygon`, `Pos`, `Rot`, `Compound`, named
`Pos`/`Rot` bindings, `Plane.XY|XZ|YZ|YX|ZX|ZY *` shape, `scale(solid, scalar)`,
`fillet(solid, scalar)` or `fillet(solid.edges(), radius=scalar or positional)`,
`chamfer(solid, scalar)` or `chamfer(solid.edges(), scalar)`,
`extrude(sketch, amount=scalar or positional, optional taper=scalar)`,
`offset(solid, amount)`, `revolve(sketch, Axis.X|Y|Z)`, math scalars `pi`/`e`/`tau`;
analyzer `build123d-qualified-lezer` 1.6.0). Previously qualified bundles stay
bit-identical for existing sources. A sketch is never a valid `result`. `shell` is not a
0.11.1 algebra function. `&` remains a D4-rejected token. Modelica and CalculiX compiler
profiles remain absent and therefore fail closed.

The recorded-analysis provider routes remain available for existing Modelica/CalculiX
operations. `simulate.run-modelica-scenario@1/@2` and `verify.run-fea-static-proof@1/@2`
retain their own provider capability ports, MCP adapters, plans and operation-specific
WALs. They are not fallbacks for `simulate.run-qualified-modelica-kit@1` or
`verify.run-fea-static-proof@3`, and old ROP2 plans are never redirected to a local
executor. Conversely, the local Modelica operation remains the one fixed linear-ramp
conformance kit rather than a replacement for historical arbitrary approved provider
scenarios. Provider availability, an approved MRTR, a queued run or an isolated-worker
smoke is never proof of a product execution; that requires the exact registered
executor, runtime resources and resulting Thread evidence to be composed, captured and
reread.
