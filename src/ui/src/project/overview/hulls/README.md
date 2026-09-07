# Overview hulls

Shared, source-independent hull content for the native Workbench whiteboard. The
Workbench remains a read-only projection: these modules never call a provider,
invent a Thread entity, or authorize an App.

## Responsibilities

| Module                          | Owns                                                                 | Must not                                                               |
| ------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `content.ts`                    | One hull-content model: tree/list rows plus immutable records        | Choose an App, parent by labels, guess a revision, or emit graph nodes |
| `domain-groups.ts`              | Display domains and captions from typed records and exact operations | Rewrite provenance, invent a source, or assign a verdict               |
| `row.ts`                        | Row actions and captions consumed by canvas and contextual menu      | Special-case a provider domain result                                  |
| `row.tsx`                       | Shared visible row body                                              | Own layout, cables, scrolling, or pointer capture                      |
| `version-history.ts`            | Current members from the shared version projection                   | Reimplement family membership or fold by label                         |
| `current-brief.ts`              | Complete current approved Project brief, short clickable rows        | Select a version from analysis fingerprints or retarget old sources    |
| `row-layout.ts`                 | Same content keys in tree, flat list, and points                     | Change the dataset when the presentation changes                       |
| `row-anchors.ts`                | Exact existing record docks beside content rows                      | Turn navigation keys or hierarchy links into Thread evidence           |
| `../activity-status-caption.ts` | Neutral Planned / IN PROGRESS / BLOCKED captions                     | Live in two contradictory copies                                       |

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

Brief source snapshot folders are labeled `Clauses sources · brief rN`. That
name is the exact source snapshot, not a second brief.

## Row contract

A row is navigation, a source note, or an immutable record:

- `navigation` — grouping or occurrence. Not a Thread entity, not a cable
  endpoint. May carry exact `sessionIds` when a registered App is anchored.
- `source` — exact brief-source note. Selectable; retains its documentary
  requirement cable. Keyed by snapshot + source item, never by label.
- `record` — immutable Thread/project record, including historical captures.

`mode: "tree"` when the hull has a navigation tree (current product hierarchy,
exact brief snapshot grouping, or recorded analysis-node members grouped by
exact `semanticRef` domain/kind/basisFingerprint). `mode: "records"` otherwise.
Tree, list, and points arrange the same `rows`. List is flat, without tree
marks; tree preserves parentage. Immutable captures remain in the existing
contextual record menu rather than becoming extra product occurrences or
requirements.

When `project.framing.currentBrief` exists, the Brief hull shows all of its
items in source order. Rows stay compact; clicking opens the complete statement.
Exact declared brief dependencies remain presentation-only project dependency
links. Prior analysis records and source snapshots stay inspectable, without
claiming an unrecorded revision join.

`row-anchors.ts` docks an existing record only to its exact row node key or a
unique same-hull occurrence whose validated hierarchy names that artifact.
Shared artifacts across occurrences remain hull stubs. Row identities and graph
endpoints stay distinct. Navigation parent connectors are separately marked and
never enter the Thread graph. Both cable and navigation highlighting follow row
hover/focus through the shared renderer.

When several recorded artifacts share one visible row, each cable dock occupies
a distinct subslot. Listed docks span the row's lateral sides; Points docks stay
within the centered occurrence dot. Their bounds and obstacle clearance follow
the subslot, so co-records do not block each other's actual links.

Recorded analysis members stay selectable `record` rows under a navigation
folder. The folder is not a Thread entity and has no cable endpoint. Evidence,
`declared-dependency`, and a guessed brief revision never form that folder.
Unknown semantic identity stays an ungrouped visible row. An approved baseline
record stays independently actionable at the tree root.

## Adding a hull

1. Project members as existing hero nodes. Do not fabricate graph nodes for
   folders.
2. In `content.ts`, organize those members into `OverviewHullContentRow`s using
   exact identities already on the projection. Fail closed on unknown, dangling,
   or conflicting identity.
3. Reuse `overviewHullRowActions` / `OverviewHullRowBody` in canvas and menu. Do
   not copy CAD assembly copy or add a per-hull renderer.
4. Keep `records` as the inspectable history. Grouping rows never become cable
   endpoints.

Literal labels (`TRACE GAP`, `UNLINKED`, `documentary`) stay literal.

## Version history

Current revisions are the default in every hull. `version-history.ts` consumes
`buildVersionedProvenanceProjection` and the server's evidence families; it does
not invent membership. Historical captures remain accessible in the existing
record menu, without extra hull controls. Review-required, missing, or
inconsistently placed members stay visible. The complete record index still
resolves sessions, viewer anchors, and requirement-source aliases against the
raw graph.
