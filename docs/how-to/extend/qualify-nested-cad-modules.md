# How-to: qualify nested CAD modules

Audience: contributor · Diátaxis: how-to · Kind: how-to

Use this bounded maintainer route to establish runtime evidence for manual sequential
composition of canonical leaf parts into child modules, then canonical child modules
into one parent. Establishing this route does not itself promote coverage.

The authority remains
[provider-neutral module assembly](../../reference/domains/cad/module-assembly.md). This
route does not create a new operation, CAD language, provider selection surface, runtime
qualification attestation, or assembly verdict.

## Scope and sealed meaning

- Accepted qualification case: two module levels, with each parent consuming the exact
  active canonical captures and STEP bytes of its immediate children. Mixed immediate
  part/module inputs may be tested separately; do not infer coverage from an all-module
  case.
- Keep `geometry-module-input-bundle/1.0`, `geometry-module-capture/1.0`, and
  `geometry.module.immediate-compound@1.0`: these contracts already identify module
  captures as children and compose their STEP bytes, not descendant manifests. No
  migration or reinterpretation of existing sealed evidence is needed for this
  qualification-only slice. A demonstrated semantic change requires a separate version
  decision.
- Units remain millimetres and placements retain the existing captured convention.
  Preserve the current per-invocation ceilings: 32 immediate occurrences, 1 MiB
  manifest, 32 MiB per child STEP, and 256 MiB input bundle. Deeper and unbounded trees
  are outside this qualification. Do not present those exclusions as a newly implemented
  depth validator.
- Missing, archived, ambiguous, stale, mismatched, or corrupt child evidence must remain
  refused. No caller-supplied child asset, provider, profile, source program, or
  runtime.
- Leaf replacement must retire dependent child and parent families through the existing
  dependency graph. This is transitive invalidation, not automatic ancestor rebuilding.
- Composition does not prove joints, load transfer, collision freedom, clearance,
  motion, manufacturability, safety, or fitness for use. Those remain separate evidence
  questions.

## Trace and focused source checks

Before editing, record the checkout status and follow a module child through
`ExportProjectGeometryModule`, the closed input bundle, adapter receipt, canonical
`design.write-geometry@1` sealer, and retirement cascade. Preserve unrelated work.

Demonstrate, with focused tests:

1. Encoding/reopening preserves the module child schema and rehashes its exact STEP.
2. Export resolves a canonical module child to its assembly STEP and exact target.
3. Sealing a parent records that child primary as an input and preserves the module
   capture/STEP identities; target/STEP divergence and stale evidence fail closed.
4. Replacing a leaf retires its dependent child module and parent module families,
   preserving unrelated targets and historical bytes. No new parent run or family is
   created.

Prefer tests through the real export/seal/publication control flow over isolated graph
helpers. Fix only demonstrated defects in this slice; do not redesign the authority. Run
scoped formatting/lint/tests and the applicable
[source checkout gates](../setup/validate-a-source-checkout.md). Code tests are not
runtime proof.

## Exact-runtime canary

Use a reviewable project with the current sealed SysML structural capture, canonical
leaf geometries, canonical immediate child modules, and exact placement attachments.
Capture the parent placements through `project_cad_placement_capture`, then use
`project_geometry_module_export` and the normal reviewed `design.write-geometry@1` flow.
Only the server selects the already-qualified adapter and runtime.

Record the exact architecture, placements, child capture/STEP hashes, input bundle,
neutral receipt with its implementation evidence, draft and canonical parent capture,
run, and Thread revision. Reopen the resulting STEP/GLB through the admitted reader or
registered observer and test the parent occurrence transforms on that exact basis. Do
not infer leaf identities from a flattened tessellation. Inspect the resulting
representation without treating a viewer screenshot as a geometry or physical oracle.

Exercise replacement/invalidation in a disposable test fixture, or as an explicitly
intended project correction. Do not replace a valid product leaf merely to create a
destructive canary. A source fixture can prove the two-hop archival lifecycle; state
separately whether this lifecycle was exercised on the real project.

## Promote only the proven boundary

Only after the source checks and exact-runtime canary pass, update the coverage and
part/module build reference with the dated, bounded evidence and explicit exclusions.
Keep deeper nesting, automatic rebuilds, physical joints, and unexecuted cases outside
the claim. Update the project dossier with actual references rather than fabricated
proof.

If the current pinned runtime cannot reopen the input/output or the sealer cannot
preserve lineage, stop at that boundary. Do not publish an image, change a pin, weaken a
contract, flatten the architecture, or substitute an isolated execution for canonical
geometry. Any such extension requires a separately scoped decision.
