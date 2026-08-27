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
        |  omit analysis overlay, fold campaign instruments,
        |  fold closed actions, essential mask, SysML compact
        v
Graphology MultiDirectedGraph
  navigation / Sigma / neighbourhood — not Thread authority
```

| Layer             | Owns                                                   | Must not                                          |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------- |
| `ThreadSnapshot`  | Product facts and typed provenance                     | Analysis relation names, Graphology, UI compact   |
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

### BFF-only nodes (not ThreadSnapshot entity kinds)

| `entityKind`          | What it is                                              | dl05 example                                     |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------ |
| `part-definition`     | Reviewed SysON type identity                            | `Arm` · `bfca49ea-3876-479c-9463-a55ddae57fee`   |
| `part-usage`          | Reviewed SysON occurrence                               | `arm` · `8f041729-706d-4102-8025-4cf799c03c87`   |
| `attribute-usage`     | Declared SysML AttributeUsage owned by a PartDefinition | `Arm · thickness` · AttributeUsage on `Arm`      |
| `cad-lever`           | Named numeric CAD lever from a sealed admission         | `CAD · thickness = 8` · unit undeclared          |
| `cad-unnamed-literal` | Constructor-photo hole: span + value, no invented name  | `CAD · unnamed 30` · no name                     |
| `analysis-node`       | `AnalysisGraph` semantic endpoint                       | `sensitivity-parameter:…`, brief items, proof BC |

`part-definition` / `part-usage` / `attribute-usage` come from the reviewed component
catalog. Geometry is optional. They are not promoted back into `ThreadSnapshot`. An
`attribute-usage` is a declared SysML AttributeUsage from
`catalog.components[].attributes[]` (exact id + label), not a CAD lever, unit, or
default value. The painted label includes the owning PartDefinition (`Arm · thickness`)
so two homonymous attributes stay distinct.

`cad-lever` is BFF-only, reopened from a `compile.seal-admission@3` capture. It is
emitted only when that admission uniquely `parameterizes` an AttributeUsage already
present in the graph. `cad-unnamed-literal` is the constructor-photo hole: a bare
numeric argument that reaches `result`, hung on the unique `represents` PartDefinition.
It has a span and a value. It does not invent `width` / `length`. The unit is
`undeclared`.

`analysis-node` is the analysis overlay. The BFF still emits it. Evidence does not paint
it.

### Artifact kinds seen on dl05

`document`, `evidence`, `cad-model`, `step`, `sysml-model`, `solver-input`, `mesh`,
`solver-result`. Supporting kinds (`mesh`, `script`, `solver-input`, consumptions,
changes) are hidden by the essential mask on the full map.

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
requirement `sourceArtifactId`, reviewed catalog). Never from a label.

| Relation         | Meaning                                                                                         | dl05 example                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `input_to`       | Explicit input artifact of a later artifact                                                     | Architecture → Requirements: Arm (twins the `derived_from` pair with a different claim) |
| `source_of`      | Observation source artifact                                                                     | `CalculiX result.json` → `maxDisplacement measured by CalculiX`                         |
| `traces_to`      | Requirement source artifact (when provenance did not already emit the pair)                     | Requirements: Arm → `Arm tip deflection`                                                |
| `contains`       | Architecture → root PartDefinition; PartDefinition → PartUsage; PartDefinition → AttributeUsage | `HeronLampSystem` → `arm`; `Arm` → `thickness`                                          |
| `typed_by`       | PartUsage → PartDefinition                                                                      | `arm` → `Arm`                                                                           |
| `represented_by` | PartDefinition → exact STEP (authoritative) or GLB (presentation)                               | `Arm` → `Authoritative STEP: Arm`                                                       |
| `parameterizes`  | Sealed CAD lever → exact AttributeUsage. Unique compile join only.                              | `CAD · thickness = 8` → `Arm · thickness`                                               |
| `unnamed_in`     | Constructor literal → unique represented PartDefinition. Not a named lever.                     | `CAD · unnamed 30` → `WallHook`                                                         |

There is **no** structure edge `Requirements: Arm` → `arm` or → `Arm`. Requirements
target the PartDefinition at write time; that identity lives on the capture and in a
rationale, not as a graph endpoint. See the Arm note below.

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

## What the live BFF actually emits (dl05 r156)

Raw `thread.graph`: **173 nodes / 242 edges**.

| `entityKind`    |  n |   | `origin`   |   n |
| --------------- | -: | - | ---------- | --: |
| consumption     | 45 |   | provenance | 155 |
| change          | 40 |   | structure  |  66 |
| artifact        | 40 |   | analysis   |  21 |
| analysis-node   | 23 |   |            |     |
| observation     | 10 |   |            |     |
| part-definition |  5 |   |            |     |
| evaluation      |  4 |   |            |     |
| part-usage      |  4 |   |            |     |
| requirement     |  2 |   |            |     |

Top painted pairs:

|  n | origin     | pair                                                          |
| -: | ---------- | ------------------------------------------------------------- |
| 45 | provenance | artifact `--uses-->` consumption                              |
| 40 | provenance | change `--changes-->` artifact                                |
| 36 | provenance | artifact `--derived_from-->` artifact                         |
| 36 | structure  | artifact `--input_to-->` artifact                             |
| 10 | provenance | artifact `--traces_to-->` artifact                            |
| 10 | structure  | artifact `--source_of-->` observation                         |
|  9 | analysis   | analysis-node `--structural-incidence-->` analysis-node       |
|  9 | structure  | part-definition `--represented_by-->` artifact                |
|  8 | analysis   | analysis-node `--declared-dependency-->` analysis-node        |
|  4 | analysis   | analysis-node `--measured-local-sensitivity-->` analysis-node |
|  4 | provenance | requirement `--evaluates-->` evaluation                       |
|  4 | structure  | part-usage `--typed_by-->` part-definition                    |

`input_to` and `derived_from` often share endpoints. That is two claims (explicit input
vs derivation), not a duplicate bug. Sigma may draw one visual route and keep both
assertions in the table.

## What Evidence paints (presentation policy)

Applied only in the UI, in this order:

1. Drop `analysis-node` and `origin: "analysis"` (`graphWithoutAnalysisOverlay`).
2. Drop closed action nodes.
3. Fold analyze.* / sensitivity _campaign_ instruments (`isAnalyzeInstrumentNode`):
   server-fixed id prefixes `sensitivity-case-`, `sensitivity-study-`,
   `sensitivity-edges-`, `sensitivity-relations-`, `sensitivity-base-evaluation-`, plus
   CAD/FEA artifacts and observations whose id contains `sensitivity`.
4. Fold provider solver envelopes (`isSolverEnvelopeNode`): `solver-input` and
   `solver-result`. `CalculiX input.step` is a byte-identical copy of the authoritative
   STEP; `CalculiX result.json` is the raw container of the extracted observations.
   Neither is a second build123d product. Stubs keep STEP → observation.
5. Version-fold `supersedes` families.
6. Essential mask (hide mesh / script / remaining envelopes / changes / consumptions
   unless they are the sole path).
7. Compact one unambiguous `PartUsage --typed_by--> PartDefinition` into
   `usage : Definition` (UI-only edge id `ui:sysml-composite:…`).
8. Compact one unambiguous authoritative STEP + GLB preview onto the STEP (UI-only edge
   id `ui:cad-presentation:…`). Two CAS identities stay exact; the agent still publishes
   both. Focusing either member expands the pair.

On this head after (1)+(3)+(4): campaign documents, `sensitivity-base-*` /
`sensitivity-d-*` observations, `CalculiX input.step` and `CalculiX result.json` leave
the canvas. **Study-base evaluations stay**, attached to the Thread requirements. Stubs
keep the recorded path from the compilation admission
(`via Sensitivity study case — folded`) and from Authoritative STEP: Arm to the proof
observations (`via CalculiX result.json — folded`).

Painted Evidence (full canvas, essential mask) no longer treats the solver file pair as
a second CAD product. One Graphology + dagre + Sigma surface. The SVG Map is not a
second organisation of this dossier.

Kept construction facts include Architecture, Requirements: Arm, geometry bundle, four
STEP nodes that each carry their GLB presentation, FEA proof observations, two proof
evaluations, two study-base evaluations, SysML `arm : Arm` and siblings. Activity still
lists STEP and GLB as separate recorded artifacts.

## Three construction chains on this head

```text
Architecture: HeronLamp
  --contains--> HeronLampSystem
  --contains--> arm --typed_by--> Arm --represented_by--> STEP Arm
  --derived_from / input_to--> Requirements: Arm
  --traces_to--> Arm tip deflection
                 --evaluates--> maxDisplacement evaluation (proof)
                 --evaluates--> Arm tip deflection study-base evaluation

Architecture
  --derived_from--> Geometry bundle --traces_to--> STEP Arm
  --derived_from--> FEA proof seal --derived_from--> CalculiX result
  --source_of--> maxDisplacement measured by CalculiX
  --uses--> maxDisplacement evaluation

Technical compilation admission
  --stub via folded sensitivity-case--> study-base evaluations
```

No recorded edge `Requirements: Arm` → `arm` or → `Arm`. Requirements are owned by the
PartDefinition at write time; the graph only records Architecture as the endpoint. The
PartDefinition id appears in the rationale, never as a `to` ref. Parsing that rationale
to draw a line would be an invented join.

## Coherence review (open, not bugs by default)

Use this list when changing the model. Each item is a deliberate cut or a tension to
re-decide — not a silent defect.

1. **Three origins stay three languages.** Do not merge `derived_from` with
   `declared-dependency` or `measured-local-sensitivity`.
2. **AnalysisGraph is an index.** Painting it as islands was wrong. Hiding it on
   Evidence is the current policy. Product/tests may still inspect `origin: "analysis"`.
3. **Sensitivity is experience, not a second chantier.** Campaign artifacts fold.
   Study-base evaluations stay on the requirement they evaluate.
4. **`input_to` vs `derived_from`.** Same endpoints, different claim (declared input vs
   derivation). Keep both; do not drop one to “simplify”.
5. **Painted direction ≠ stored direction.** Reviews must say which layer they mean.
6. **Requirements attach to Architecture, not to `arm : Arm`.** Type-level write,
   occurrence-level compact. A future structure edge to the PartDefinition would need
   `capture.target.elementId`, not a label.
7. **`traces_to` is overloaded** (requirement↔model and historical evidence↔design). The
   validator documents this; do not add a third use without a new relation.
8. **BFF-only SysML nodes** are a read model. They must not appear in
   `ThreadSnapshot.provenance`.
9. **Graphology is a projection.** Parallel recorded edges stay distinct. Stubs are
   synthetic and labelled `via … — folded`.
10. **No join from analysis → Thread.** Overlay omission must not be “fixed” by
    inventing `projection-of` into an artifact.

## Review 2026-08-16 (dl05 r156)

The four-layer split and the three `origin` languages are coherent. The remaining
problems are lookalikes and presentation lies, not a second authority model.

| Severity | Finding                                                                                                                                                             | Call                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Keep     | `input_to` is a strict subset of painted `derived_from` artifact pairs (36/36). The 10 unpaired `derived_from` are artifact→observation (already have `source_of`). | Two claims, one route. Do not drop.                                                     |
| Keep     | Requirements target the PartDefinition; the graph endpoint is Architecture.                                                                                         | Not a missing `arm : Arm` join.                                                         |
| Keep     | Analysis overlay omitted; campaign folded; study-base evals stay on the requirement.                                                                                | Matches “experience, not chantier”.                                                     |
| Fixed    | Same requirement carries two `pass` evaluations (proof `@2` vs study-base join).                                                                                    | Distinct `evaluationFamily: "study-base"` chip / DisplayKind. Proof stays `evaluation`. |
| Tension  | Two sensitivity campaigns coexist (`assembly_max_*` / `af03a261…` and `maxDisplacement` / `b9155c34…`).                                                             | Honest history. The experience index is two neighbourhoods.                             |
| Fixed    | Header “2 independent domain branches” counted flow producers.                                                                                                      | Linked evidence now uses the painted full-map item and component counts.                |
| Tension  | Painted provenance reverses stored `from`/`to`.                                                                                                                     | Documented. Always name the layer.                                                      |
| Hole     | `target.elementId` (`bfca49ea-…`) lives in rationale text, not as a graph ref.                                                                                      | Project a structure edge only from the capture field, never from the rationale.         |
| Fixed    | Folding emitted self-loop stubs (`admission → admission via case`).                                                                                                 | Stubs whose endpoints share the same ref key are not emitted.                           |
| Fixed    | Analysis node ids were `graph:analysis-node:analysis-node:…`.                                                                                                       | `graphNodeId` does not repeat a kind prefix already on the id.                          |
| Fixed    | `traces_to` validator text mentioned proof→PartDefinition.                                                                                                          | Comment now matches live uses; PartDef→STEP stays `represented_by`.                     |
| Scatter  | Producer ids: `calculix` / `mcp-calculix` / `digital-thread` / `casys-digital-thread` / analysis domains `brief`/`thread`/`sysml`.                                  | Visual families are fine; do not rewrite provenance.                                    |

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
