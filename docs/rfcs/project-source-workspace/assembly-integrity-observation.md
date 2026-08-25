# Assembly integrity observation

Status: contract accepted · provider profile and runtime proof pending

## Separate question from assembly build

A canonical module STEP proves that exact admitted sources and placements produced a
sealed artifact. It does not by itself prove that solids are valid, that every
occurrence is represented at the expected transform, that parts do not interfere, or
that the product is fit for use.

Assembly integrity is therefore a post-publication observation over exact canonical
bytes. It never changes product structure, rebuilds CAD, or invents a product verdict.

## Provider and Digital Thread boundary

The raw `build123d_observe_assembly_integrity` capability belongs to standalone
`mcp-build123d`. It receives engine-native input and returns raw geometry facts plus its
own producer provenance; it knows no Casys project, Thread snapshot, MRTR, approval,
requirement, evaluation or verdict.

The pending Digital Thread vertical reopens the exact `geometry-module-capture/1.0` and
its canonical assembly STEP, selects a registered provider profile server-side, and
seals normalized factual output as `assembly-integrity-observation/1.0` with provenance.
No caller selects provider, tool, profile, tolerance, runtime or arguments. The provider
profile and a real runtime proof remain required before any public review tool or
registered operation is described as available.

This observer has no local OCCT worker and no local fallback. It is facts only: overlap,
contact, invalid topology or transform disagreement cannot become a product verdict by
being observed.

## Observation contract

`assembly-integrity-observation/1.0` binds:

- one exact `geometry-module-capture/1.0` and its canonical assembly STEP;
- its exact structure and placement bases;
- every immediate child capture and occurrence transform;
- one registered, digest-pinned geometry-analysis method.

For this module contract, `rotationDeg: [x, y, z]` is lowered with Build123d semantics
as `Rx · Ry · Rz`; the historical `extrinsic-xyz` label alone is ambiguous.

The first qualified method should report facts in three groups:

1. STEP import and topology: unit, solid count, BRep validity, degenerate entities and
   free-edge or shell diagnostics supported by the engine;
2. exact recross: occurrence coverage, target identity and expected-versus-observed
   transform;
3. pairwise geometry: intersection volume, contact state and minimum distance for every
   immediate-child pair, with the method tolerance recorded explicitly.

Missing identity, topology or transform observability is `unresolved`. Unsupported
metrics remain `unavailable`. A successful import must not be renamed “valid assembly”.

## Evaluation boundary

L3 is the facts-only observation. L4 is a later, registered evaluation with an explicit
`pass`, `fail` or `unresolved` result; L5 is a human closeout of the consequential
decision. `design.write-geometry@1` seals geometry and never satisfies that gate.

The first L4 gate can cover numerical integrity only. A later registered evaluation may
compare it with a sealed requirement or versioned policy. Zero interference can use a
method-owned numerical tolerance; joints, required clearance, motion, load capacity and
fabricability still need their own explicit engineering criteria.

FEA remains a separate proof family. It answers a declared mechanical proof case and
cannot substitute for structure coverage, placement recross or interference analysis.

## Deliberately deferred

The observer consumes canonical module evidence as it exists. It does not silently
migrate the module assembler to `mcp-build123d` or replace that assembler's bounded
execution contract. Such a migration is a separate bounded follow-up after the observer
vertical, with its own profile, runtime proof and authority review.
