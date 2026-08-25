# Assembly integrity observation

Status: contract accepted · qualified implementation and runtime proof pending

## Separate question from assembly build

A canonical module STEP proves that exact admitted sources and placements produced a
sealed artifact. It does not by itself prove that solids are valid, that every occurrence
is represented at the expected transform, that parts do not interfere, or that the
product is fit for use.

Assembly integrity is therefore a post-publication observation over exact canonical
bytes. It never changes product structure, rebuilds CAD, or invents a product verdict.

## Observation contract

`assembly-integrity-observation/1.0` binds:

- one exact `geometry-module-capture/1.0` and its canonical assembly STEP;
- its exact structure and placement bases;
- every immediate child capture and occurrence transform;
- one registered, digest-pinned geometry-analysis method.

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

The observation contains measurements and diagnostics only. A later registered
evaluation may compare them with a sealed requirement or a versioned policy. Zero
interference can use a method-owned numerical tolerance; a required clearance, load
capacity, motion envelope or functional fitness needs explicit engineering criteria.

FEA remains a separate proof family. It answers a declared mechanical proof case and
cannot substitute for structure coverage, placement recross or interference analysis.
