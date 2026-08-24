# CAD assembly bridge

## Required source shape

A multi-part CAD product is not one Python file. It is:

- one small coordination module for an assembly or subassembly;
- one Build123d source file per represented `PartDefinition`;
- one typed placement source for the immediate `PartUsage` children;
- nested subassembly modules when the immediate child set becomes large.

The placement source is engineering input. It may name exact SysML occurrence and
definition identities plus translation/rotation values. It may not name providers,
tools, paths, formats, images or expected output hashes.

## Admission

The bundle review re-opens:

1. the exact current architecture capture;
2. the exact workspace file revisions selected for one assembly module;
3. one ready, newly versioned multi-source Build123d compilation admission covering
   those exact file revisions within the qualified source-count bound;
4. the typed placement source.

The server derives the draft manifest from architecture, admitted definition sources and
the typed placement source. It must prove exactly one source for every represented
`PartDefinition`, exact coverage of every immediate occurrence, and no extra source. The
agent does not submit a second occurrence table. The signed decision restates this
resolved mapping and the draft hashes before `design.write-geometry@1`.

## Canonical result

For the first bounded assembly module, one versioned geometry capture contains:

- the assembly STEP and presentation asset;
- an independently identified STEP per `PartDefinition`;
- the exact occurrence-to-definition placement table;
- source-file revision, analysis and admission provenance for every definition.

FEA selects a definition STEP by the exact `PartDefinition`/asset identity. It must not
select by content digest alone, because two different definitions may legitimately
produce byte-identical STEP files.

Archived geometry families are excluded before uniqueness checks.

This bounded capture is not the product-wide target for thousands of parts. A later
hierarchical geometry schema seals one module at a time and lets a parent assembly
reference exact child-module geometry artifacts. It must not inline every descendant
definition and occurrence again at the root.

## Bounded current execution

The first vertical supports one modest assembly module, the current closed Build123d
language and the server-owned admission source-count bound. The source workspace itself
is not limited to that size, but a navigable source module is not automatically an
executable source set. Larger products are navigable immediately, while execution
remains literally `unavailable` beyond the qualified assembly-module bound until the
hierarchical evidence schema, subassembly lowering and multi-file execution path are
qualified.
