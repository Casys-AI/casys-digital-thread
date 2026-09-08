# Overview hulls

Shared, source-independent hull content for the native Workbench whiteboard. The
Workbench remains a read-only projection: these modules never call a provider,
invent a Thread entity, or authorize an App.

## Responsibilities

| Module                          | Owns                                                                       | Must not                                                                 |
| ------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `types.ts`                      | One generic hull/row contract, including roles, graphRefs, counts          | Encode a provider operation, FEA DTO, or layout geometry                 |
| `content.ts`                    | Orchestrator: tree/list rows plus immutable records                        | Choose an App, parent by labels, guess a revision, or emit graph nodes   |
| `adapters/`                     | Domain post-passes that fill the same generic contract                     | Own canvas paint, invent a case id, or emit Thread `supersedes`          |
| `domain-groups.ts`              | Display domains and captions from typed records and exact operations       | Rewrite provenance, invent a source, or assign a verdict                 |
| `row.ts`                        | Row actions and captions consumed by canvas and contextual menu            | Special-case a provider domain result                                    |
| `row.tsx`                       | Contextual menu row body; canvas items use `FlowItemSurface`               | Own canvas item paint, layout, cables, scrolling, or pointer capture     |
| `version-history.ts`            | Current members from the shared version projection                         | Reimplement family membership or fold by label                           |
| `current-brief.ts`              | Complete current approved Project brief, registered generic adapter        | Select a version from analysis fingerprints or retarget old sources      |
| `row-viewer.ts`                 | Shared exact App binding for a graph-backed row                            | Invent a session, alias, or capture identity                             |
| `row-layout.ts`                 | Same content keys in tree, flat list, and points; orthogonal parent guides | Change the dataset or Thread graph routing when the presentation changes |
| `row-anchors.ts`                | Exact existing record docks beside content rows                            | Turn navigation keys or hierarchy links into Thread evidence             |
| `presentation-identity.ts`      | Group-scoped row keys and graphRefs selection mapping                      | Select by label, date, digest, or volatile occurrence id                 |
| `../activity-status-caption.ts` | Neutral Planned / IN PROGRESS / BLOCKED captions                           | Live in two contradictory copies                                         |

Generic canvas engines stay outside this folder
(`overview-thread-d3-flow-layout.ts`, hull density/physics, cable routing). They
size and move boxes; they do not decide what a Brief snapshot or a CAD
occurrence _is_.

SYSML and its Requirements subset share the same blue (`domain:sysml-model`,
system-model lane). An architecture tree keeps the occurrence rows and appends
one root navigation section `Requirements` that lists each recorded requirement
exactly once. Capture artifacts stay in the existing contextual record menu;
they are not extra requirement rows and never borrow a parent from a label or
rationale. Viewer aliases still require the exact capture predicate, not the
display group. Geometry includes both canonical captures and their typed
STEP/GLB assets in one hull. Provider names remain on provenance records; the
grouping never merges their identities or creates additional App capabilities.

Brief source snapshot folders are labeled `Sources référencées · brief rN`. That
name is the exact source snapshot, not a second brief. The current Brief adapter
owns that tree; `content.ts` does not emit a parallel `Clauses sources`
grouping.

## Row contract

A row is navigation, a source note, or an immutable record:

- `navigation` — grouping or occurrence. Not a Thread entity, not a cable
  endpoint. May carry exact `sessionIds` when a registered App is anchored.
- `source` — exact brief-source note. Selectable; retains its documentary
  requirement cable. Keyed by snapshot + source item, never by label.
- `record` — immutable Thread/project record, including historical captures.

Presentation `role` is a closed union (`folder`, `current`, `prior`,
`non-result`, `overlay`). Graph identity lives on `graphRefs` (with `nodeKey`
kept while migrating). Folders have empty `graphRefs` and `endpoint: false`. An
overlay occurrence maps raw-to-structured selection through those refs, never a
label, date, digest, or volatile occurrence id.

`mode: "tree"` when the hull has a navigation tree (current product hierarchy,
exact brief snapshot grouping, or recorded analysis-node members grouped by
exact `semanticRef` domain/kind/basisFingerprint). `mode: "records"` otherwise.
`mode` describes the dataset, not a renderer. Hierarchy always paints `rows`
through `FlowStructureRow` → `FlowItemSurface` in tree, list, and points.
`FlowNode` is only the fail-closed fallback for a group without exploitable
`OverviewHullContent` rows. List is flat; tree preserves parentage through
indentation and hierarchy connector paths, never a static tree glyph. Immutable
captures remain in the existing contextual record menu rather than becoming
extra product occurrences or requirements.

The hierarchy renderer does not paint `role`, `availability`, `provenance`,
`selectable`, or `focusable`. Generic `counts` stay a header control when an
adapter emits them. `current-engineering-cases` does not emit counts, rN,
prior/current members, a revision counter, or History.

When `project.framing.currentBrief` exists, the Brief hull shows all of its
items in source order. Rows stay compact; clicking opens the complete statement.
Exact declared brief dependencies remain presentation-only project dependency
links. Prior analysis records and source snapshots stay inspectable, without
claiming an unrecorded revision join.

`row-anchors.ts` docks an existing record only to exact row `graphRefs` (or
`nodeKey` while migrating) or a unique same-hull occurrence whose validated
hierarchy names that artifact. A folder has empty `graphRefs` and is never a
graph endpoint. Switching tree, list, or matrix never changes `key` or
`graphRefs`. Shared artifacts across occurrences remain hull stubs. Row
identities and graph endpoints stay distinct. Navigation parent connectors are
separately marked orthogonal containment guides and never enter the Thread graph
or graph inspection counts. Thread cables highlight through `FlowSegmentLayer`;
parent guides stay on their own CSS18 layer.

When several recorded artifacts share one visible row, they share one visual
cable dock. Listed docks span the row's lateral sides; Points docks stay within
the centered occurrence dot. Exact routes and graphRefs stay distinct; the dock
follows the cell in tree, list, and points.

Recorded analysis members stay selectable `record` rows under a navigation
folder. The folder is not a Thread entity and has no cable endpoint. Evidence,
`declared-dependency`, and a guessed brief revision never form that folder.
Unknown semantic identity stays an ungrouped visible row. An approved baseline
record stays independently actionable at the tree root.

## Adapter ownership

`buildOverviewHullContents` remains the orchestrator for the generic row
contract. Registered adapters in `adapters/` are post-passes: they wrap already
classified hulls and must emit the same `OverviewHullContent` / row fields.

| Adapter / overlay                                   | Owns                                                           | Target                                              |
| --------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| `current-brief.ts`                                  | Current approved Brief snapshot tree                           | Registered (`current-brief`)                        |
| `adapters/from-current-engineering-cases.ts`        | `engineering-cases/1.1` `current` recrossed with exact `cases` | Registered (`current-engineering-cases`)            |
| Hierarchy / requirements / analysis in `content.ts` | Occurrence tree, typed requirements, analysis basis folders    | Stay in the orchestrator until a domain DTO appears |

Do not add a `FeaHull*.tsx` or a second visible row grammar. Generic `counts`
remain available for adapters that emit them. `current-engineering-cases` does
not: the whiteboard is current-only and paints neither rN, prior/current
members, a revision counter, nor History. That adapter never routes through
`evidenceFamilyGraph` or artifact `supersedes`. FEA Physics and FEA Verdicts
stay two distinct hulls, linked by exact case refs.

`current-brief.ts` owns the complete current Brief tree and historical exact
source snapshots. `content.ts` no longer emits a parallel `briefNavigationRows`
grouping. Do not add a `BriefHull.tsx`.

## Adding a hull

1. Project members as existing hero nodes. Do not fabricate graph nodes for
   folders.
2. In `content.ts`, organize those members into `OverviewHullContentRow`s using
   exact identities already on the projection. Fail closed on unknown, dangling,
   or conflicting identity.
3. Reuse `overviewHullRowActions` on the canvas and `OverviewHullMenuRowBody` in
   the contextual menu. Canvas rows use `FlowItemSurface`. Do not copy CAD
   assembly copy or add a per-hull renderer.
4. Keep `records` as the inspectable history. Grouping rows never become cable
   endpoints.

Literal labels (`TRACE GAP`, `UNLINKED`, `documentary`) stay literal.

## Version history

Current revisions are the default in every hull. `version-history.ts` consumes
`buildVersionedProvenanceProjection` and the server's evidence families; it does
not invent membership. That fold is the generic current-only graph fold for
explicit Requirement and Geometry `supersedes`. Historical captures remain
accessible in the existing record menu, without extra hull controls.
Review-required, missing, or inconsistently placed members stay visible. The
complete record index still resolves sessions, viewer anchors, and
requirement-source aliases against the raw graph.

Mechanical-proof case `revision` is not artifact supersession and is not a
protocol or implementation version (`verify.run-fea-static-proof@3`,
`isolated-v3`). The `current-engineering-cases` adapter recrosses
`engineering-cases/1.1` `current` with exact `cases` and paints current-only
rows on the distinct FEA Physics and FEA Verdicts hulls. Physics presents the
current solver-result and its viewer; Verdicts presents the exact Requirement
evaluation. A `case-current-divergent` group omits that current selection and
leaves exact case records untouched. Do not route that catalog through
`version-history.ts` or fabricate a FEA lineage.
