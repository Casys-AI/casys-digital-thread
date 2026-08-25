# How-to: extend the CAD closed subset

Audience: maintainers · Diátaxis: how-to · Kind: runbook

Use this only to add a construct to the server-owned Build123d language. It does not
authorize a new CAD transport, an agent-selected provider call, or agent-authored
renderer payload. Read the current [coverage](../../reference/domains/cad/coverage.md),
[closed subset](../../reference/domains/cad/build123d-closed-subset-v1.md), and
[execution paths](../../reference/domains/cad/execution-paths.md) first.

## Completion rule

A construct is covered only after this whole chain is true:

```text
pinned runtime API → D4 → parser/AST semantics → bindings/admission
  → canonical lowering + isolated lowering → exact evidence/recovery → proof use
```

At every unfinished stage, return `rejected` or `unresolved`; do not infer support from
a name in D4 or from a worker that happens to execute it.

## 1. Specify and pin the change

1. Define the exact source form, argument shapes, units/semantic constraints, output
   kind, and failure cases. State whether it is a primitive, placement, sketch, or solid
   transformation; preserve the solid/sketch separation.
2. Confirm it exists in the digest-pinned build123d runtime inventory. Do not promote a
   hand-table entry or an unpinned upstream API into product capability.
3. Decide that the new geometry remains source text in the existing capture and
   compilation contract. Do not add a geometry JSON envelope, a new agent verb, or a
   Workbench mutation route.

## 2. Extend the source proof, fail closed

1. Change D4 only if the construct needs a new imported name or lexical form; retain
   named imports and the I/O/reflection boundary.
2. Extend the Lezer/AST frontend with a narrow grammar and semantic resolver. It must
   resolve aliases, exact argument forms, prior references, dependency edges, geometry
   kind, and source locations; unsupported variants must populate
   `unresolvedConstructs`.
3. Update the analyzer identity/version and its tests together. Add positive examples,
   alias/ordering cases, every bad argument or kind mix, and a regression proving that
   nearby D4-allowed syntax is still unresolved.

The relevant seams are `geometry-script-validation.ts` and
`qualified-build123d-source-analyzer.ts`; do not make the inventory JSON a runtime
compiler implicitly.

## 3. Keep admission meaningful

1. Recheck the source-analysis capture profile and the fixed technical-compilation
   profile so their analyzer id/version and policy identity match exactly.
2. Ensure the analyzer emits the artifact and parameter symbols/dependencies needed by
   the construct. The server derives unique SysML joins; it never invents handles,
   units, or values.
3. Preserve the admission gates: the result artifact needs `represents`; every required
   parameter needs `parameterizes`; a finite module-level named numeric literal must
   causally reach `result`. A constructor photo is not a lever.
4. Test `ready-for-review`, `binding.missing`, `source.no-named-numeric-lever`, and
   `source.unresolved-construct` outcomes before allowing `compile.seal-admission@3`.

## 4. Prove both lowerings from the sealed bytes

1. The canonical path must reopen the exact admission, execute only through the fixed
   admitted exporter, validate its fixed STEP/GLTF draft and admission stamp, and let
   `design.write-geometry@1` seal it. Recheck its one uniquely represented
   `PartDefinition` / no-occurrence constraint; do not invent an assembly map.
2. The isolated path must reopen those same bytes through
   `ReopenAdmittedCompilationSource`, retain its fixed image/policy/limits and singular
   AP214 `geometry.step` manifest, then validate the output outside the microVM.
3. Add adversarial tests for a mismatched source/profile/fingerprint, unsupported
   output, failed output validation, and recovery/cleanup ambiguity. The output is not
   released when cleanup is not `proven`.

## 5. Close evidence and downstream proof

1. Keep the sealed source, analysis, admission, profile, runtime receipt, output
   manifest, hashes, and run/producer generation exactly linked and rereadable.
2. Add focused tests beside the validator/analyzer, compilation admission, canonical
   export/sealer, and isolated executor. Run only those focused checks plus a Markdown
   link/format check for this documentation change.
3. If FEA or DFM must consume the geometry, demonstrate the canonical STEP path in its
   existing qualified workflow. Isolated execution remains documentary; neither it nor a
   successful CAD export is a requirement verdict.

Only then update [coverage](../../reference/domains/cad/coverage.md). Record a construct
as a candidate or `unresolved` until the completion rule holds; version the relevant
analyzer/profile rather than silently widening an existing sealed contract.
