# Reference: graph data model

Audience: both · Diátaxis: reference · Kind: contract

> **Diátaxis category: reference.** Inventory of the four graph layers, their
> vocabularies, and what a live projection actually emits. This page is for reviewing
> coherence. It is not a Workbench screen.

Graphology never grants admission, a join, or an execution. Labels never prove a link.
`unavailable`, `unresolved`, `UNLINKED`, `pass` stay literal.

Examples below are frozen from **desk-lamp-dl05**, project r156, Thread evidence
surface, `GET /api/thread/workbench` on 2026-08-16. Counts will change; the vocabularies
must not.

## Four layers, not one graph

```text
ThreadSnapshot/1.1          canonical product state
  artifacts, observations, requirements, evaluations, violations,
  consumptions, changes, actions, provenance[]
        |
        |  + AnalysisGraph/1.0     semantic assertion index
        |      nodes + engineering-assertion/1.0 relations
        v
BFF ThreadGraph             browser DTO (GET /api/thread/workbench)
  origin: provenance | structure | analysis
        |
        |  Evidence presentation policy (UI only)
        |  omit the analysis index from the main canvas,
        |  fold explicit supersedes history, keep literal records
        v
Graphology MultiDirectedGraph
  navigation / Sigma / neighbourhood — not Thread authority
```

| Layer             | Owns                                                   | Must not                                          |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------- |
| `ThreadSnapshot`  | Product facts and typed provenance                     | Analysis relation names, Graphology, UI layout    |
| `AnalysisGraph`   | Qualified assertions (`measured-local-sensitivity`, …) | Provenance rewrite, admission, a painted island   |
| BFF `ThreadGraph` | Read-model of both, tagged by `origin`                 | Become canonical; invent a join                   |
| Graphology        | Connected components, hops, Sigma                      | Authority, new edges, collapsing parallel records |

Sources:

- Canonical entities and `ProvenanceRelation`:
  [`src/domain/thread/thread-snapshot.ts`](../../../src/domain/thread/thread-snapshot.ts)
- Allowed provenance shapes:
  [`src/domain/thread/thread-snapshot-validation.ts`](../../../src/domain/thread/thread-snapshot-validation.ts)
- Analysis index:
  [`src/domain/thread/analysis-graph.ts`](../../../src/domain/thread/analysis-graph.ts)
- BFF DTO:
  [`src/presentation/workbench/thread/snapshot.ts`](../../../src/presentation/workbench/thread/snapshot.ts)
- Projector:
  [`src/adapters/thread/thread-workbench-projector.ts`](../../../src/adapters/thread/thread-workbench-projector.ts)
- Evidence policy:
  [`src/ui/src/thread/evidence-graph-model.ts`](../../../src/ui/src/thread/evidence-graph-model.ts),
  [`src/ui/src/thread/evidence-canvas-model.ts`](../../../src/ui/src/thread/evidence-canvas-model.ts)

## Node kinds

### Canonical Thread entities (also BFF nodes)

| `entityKind`  | What it is                                   | dl05 example                                                           |
| ------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| `artifact`    | Fingerprinted bytes / document               | `Architecture: HeronLamp`, `Requirements: Arm`, `CalculiX result.json` |
| `observation` | Named quantity + unit                        | `maxDisplacement measured by CalculiX` · `0.2391272 mm`                |
| `requirement` | Model-owned criterion                        | `Arm tip deflection` · `maxDisplacement <= 1 mm`                       |
| `evaluation`  | Units-aware compare                          | `maxDisplacement evaluation` · `pass`                                  |
| `violation`   | Named fail (none open on this head)          | —                                                                      |
| `consumption` | Fingerprint attestation of a read            | `Input attestation · Architecture: HeronLamp`                          |
| `change`      | Snapshot extension event                     | `Requirements: Arm: captured Requirements: Arm.`                       |
| `action`      | Proposed work (none painted as current here) | —                                                                      |

### Projection records outside the canonical entity union

The graph vocabulary retains `analysis-node` plus exact SysML structure references used
by existing non-admission projections. Their presence in the type does not authorize the
browser to manufacture them. The browser contract has no technical-admission source
catalog, `cad-lever`, `cad-unnamed-literal`, or `source-file` graph kind.

In particular, the separate reviewed component catalog is not embedded in
`ThreadWorkbenchSnapshot` and no longer creates PartDefinition, PartUsage,
AttributeUsage, or CAD-preview topology for the Workbench. `analysis-node` remains an
index record; the generic Evidence surface does not interpret its payload as a domain
viewer.

### Artifact kinds seen on dl05

`document`, `evidence`, `cad-model`, `step`, `sysml-model`, `solver-input`, `mesh`,
`solver-result`. These are literal recorded categories. The generic full map does not
hide a record because it recognises one of those domain labels.

## Edge origins — three vocabularies

An edge is `{ from, to, relation, rationale, origin, attestation?, analysis? }`.
`origin` is the only honest split. Do not treat the three as one language.

### `origin: "provenance"`

Copied from `ThreadSnapshot.provenance[]`, then **turned for painting**. Canonical
storage uses the validation shape (e.g. `evaluates`: evaluation → requirement). The BFF
paints **source → consumer** (`GRAPH_PROVENANCE_DIRECTION` in the projector). Most
relations are reversed for the canvas.

| Painted relation | Meaning                                 | Canonical shape                                         | dl05 example                                                                                           |
| ---------------- | --------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `changes`        | This change introduced that fact        | change → entity                                         | change `model-write-requirements-Arm-…` → artifact `requirements-Arm-…`                                |
| `derived_from`   | Result consumed this source             | stored result → source; painted source → result         | Architecture → Requirements: Arm. Rationale cites PartDefinition `Arm` (`bfca49ea-…`) **in text only** |
| `traces_to`      | Traceability, not consumption           | stored requirement/artifact → artifact; painted reverse | Architecture → `Arm tip deflection`. Also geometry bundle → STEP (historical bytes)                    |
| `uses`           | Evaluation/consumption used this input  | stored consumption/evaluation → artifact/observation    | artifact → consumption attestation                                                                     |
| `evaluates`      | This requirement was evaluated          | stored evaluation → requirement; painted reverse        | `Arm tip deflection` → `maxDisplacement evaluation`                                                    |
| `evidences`      | This artifact is the evaluation capture | stored evaluation → artifact; painted reverse           | `Recorded SysON FEA evaluation` → `maxDisplacement evaluation`                                         |
| `caused_by`      | Violation caused by this evaluation     | violation → evaluation                                  | none on this head                                                                                      |
| `addresses`      | Action addresses this violation         | action → violation                                      | none on this head                                                                                      |
| `supersedes`     | Current record replaces prior           | stored current → historical; painted reverse            | folded by versioned provenance on Evidence                                                             |

Allowed endpoint kinds are closed in `checkLinkShape` (`thread-snapshot-validation.ts`).
A new pair is a contract change, not a projector convenience.

### `origin: "structure"`

BFF-only. Derived from exact recorded fields (`inputArtifactIds`, observation sources,
requirement `sourceArtifactId`). Never from a label or from the separate component
catalog.

| Relation                                                                               | Meaning                                                                     | dl05 example                                                                            |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `input_to`                                                                             | Explicit input artifact of a later artifact                                 | Architecture → Requirements: Arm (twins the `derived_from` pair with a different claim) |
| `source_of`                                                                            | Observation source artifact                                                 | `CalculiX result.json` → `maxDisplacement measured by CalculiX`                         |
| `traces_to`                                                                            | Requirement source artifact (when provenance did not already emit the pair) | Requirements: Arm → `Arm tip deflection`                                                |
| Other structure relations in the closed graph vocabulary, including `contains`,        |                                                                             |                                                                                         |
| `typed_by`, and `represented_by`, must already name exact projected records. The       |                                                                             |                                                                                         |
| Workbench does not derive them from a component catalog, parse an admission payload to |                                                                             |                                                                                         |
| create them, or invent them from display text.                                         |                                                                             |                                                                                         |

### `origin: "analysis"`

Projection of `AnalysisGraph` relations. Different names, on purpose. Must not be
relabelled as `derived_from` / `traces_to`.

| Relation                     | Epistemic role                     | dl05 example                                         |
| ---------------------------- | ---------------------------------- | ---------------------------------------------------- |
| `declared-dependency`        | Brief / source-declared            | brief-item → brief-item                              |
| `structural-incidence`       | Declared incidence (e.g. proof BC) | SysML component `bfca49ea-…` → `fixed-support:…`     |
| `measured-local-sensitivity` | Observed finite-difference         | `sensitivity-parameter:…` → `sensitivity-response:…` |
| `semantic-binding`           | Identity binding                   | (family exists; not the dl05 majority)               |
| `static-value-flow`          | Source-local flow                  | (family exists)                                      |
| `runtime-consumption`        | Observed runtime use               | (family exists)                                      |
| `projection-of`              | Projection of a fact               | (family exists)                                      |

An analysis edge carries `analysis.assertionId`, `epistemicBasis`, evidence
fingerprints, scope. A `measured-local-sensitivity` edge also carries the base, step,
two responses, and derivative. That is the experience record.

## What the live BFF emits

Counts and domain kinds depend on the exact selected Project/Thread basis. They are not
a presentation contract. `input_to` and `derived_from` may share endpoints because they
remain two recorded claims (explicit input versus derivation); the canvas may share a
visual route while the generic inspector keeps both exact edges.

## What Evidence paints (presentation policy)

Evidence paints the recorded graph without reconstructing a domain view. It may use
literal recorded fields such as `label`, `system`, `entityKind`, `artifactKind`, and
lane for layout, colour, navigation, or a generic record inspector. It may version-fold
an explicit `supersedes` family. It does not infer a provider from an id prefix, combine
a SysML/CAD/solver chain, calculate a verdict or margin, or hide a record because the
browser recognises a domain payload.

Each recorded node and edge keeps its own identity. A separately framed whole App is a
read-only presentation of one explicitly registered exact anchor, not a second graph and
not a source of Thread authority. A context gesture opens the single matching exact
whole App; zero or multiple matches remain unavailable or ambiguous. Digital Thread does
not merge domain artifacts or render them through a native domain viewer.

## Coherence review (open, not bugs by default)

Use this list when changing the model. Each item is a deliberate cut or a tension to
re-decide — not a silent defect.

1. **Three origins stay three languages.** Do not merge `derived_from` with
   `declared-dependency` or `measured-local-sensitivity`.
2. **AnalysisGraph is an index.** It remains distinct from canonical Thread provenance
   and does not authorize a native analysis viewer.
3. **Recorded categories stay literal.** The browser may lay them out or colour them; it
   does not fold a provider campaign or recognise a solver envelope.
4. **`input_to` vs `derived_from`.** Same endpoints, different claim (declared input vs
   derivation). Keep both; do not drop one to “simplify”.
5. **Painted direction ≠ stored direction.** Reviews must say which layer they mean.
6. **No catalog topology.** A future structure edge to a PartDefinition would need an
   exact recorded reference, not a label or a browser-side catalog join.
7. **`traces_to` is overloaded** (requirement↔model and historical evidence↔design). The
   validator documents this; do not add a third use without a new relation.
8. **Separate catalog identities stay separate.** They are not a Workbench snapshot
   field or an implicit viewer binding.
9. **Graphology is a projection.** Parallel recorded edges stay distinct; it does not
   construct provider topology.
10. **No join from analysis → Thread.** Overlay omission must not be “fixed” by
    inventing `projection-of` into an artifact.

## Dump a live head (read only)

With `deno task preview:thread` on :5173:

```bash
curl -sS http://127.0.0.1:5173/api/thread/workbench \
  | python3 -c '
import json,sys
from collections import Counter
g=json.load(sys.stdin)["thread"]["graph"]
print(len(g["nodes"]), "nodes", len(g["edges"]), "edges")
print("kinds", Counter(n["entityKind"] for n in g["nodes"]))
print("origins", Counter(e["origin"] for e in g["edges"]))
print("relations", Counter((e["origin"], e["relation"]) for e in g["edges"]))
'
```

The payload is the BFF `ThreadGraph`, not Graphology and not the Evidence fold. Compare
it to this page; if a new `entityKind` or `relation` appears here first, the contract
was extended without this inventory.
