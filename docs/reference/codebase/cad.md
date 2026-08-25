# Reference: source map — CAD

Audience: agent · Diátaxis: reference · Kind: contract

Census of isolated Build123d execution, isolated-geometry seal, and canonical geometry
files. Shared admission lives on [compile](compile.md).

Index: [workspace source map](../codebase/codebase-map.md). Domain coverage stays
on [engineering domains](../domains/README.md).

## Source map

#### [`src/adapters/cad/source/qualified-build123d-source-analyzer.ts`](../../../src/adapters/cad/source/qualified-build123d-source-analyzer.ts)

Qualified executable-source frontend `build123d-qualified-lezer` 1.6.0: D4 guard plus
Lezer-proved
`Box`/`Cylinder`/`Cone`/`Sphere`/`Torus`/`Ellipsoid`/`Wedge`/`Rectangle`/`Circle`/`Ellipse`/`RegularPolygon`/`Pos`/`Rot`/`Compound`,
same-kind `+`/`-`, named `Pos`/`Rot` bindings and left-associative
`Pos`/`Rot`/`Plane.XY\|XZ\|YZ\|YX\|ZX\|ZY` * solid or sketch, `scale(solid, scalar)`,
`fillet(solid, scalar)` or `fillet(solid.edges(), radius=scalar or positional)`,
`chamfer(solid, scalar)` or `chamfer(solid.edges(), scalar)`,
`extrude(sketch, amount=scalar or positional, optional taper=scalar)`,
`offset(solid, amount)`, `revolve(sketch, Axis.X\|Y\|Z)` and math scalars
`pi`/`e`/`tau`; earlier qualified bundles stay bit-identical; a sketch is never a valid
result; `shell` is not a 0.11.1 algebra function; `&` is D4-rejected; anything allowed
but not proven remains unresolved

#### [`src/domain/cad/isolated/build123d-execution-proposal.ts`](../../../src/domain/cad/isolated/build123d-execution-proposal.ts)

Closed 50-scalar MRTR grammar for `design.execute-build123d@1`: exact admission,
source/profile/policy/runtime, AP214 output, OCCT validator and cleanup threshold; no
source bytes, provider option, command or capability

#### [`src/application/use-cases/cad/isolated/prepare-project-build123d-execution-review.ts`](../../../src/application/use-cases/cad/isolated/prepare-project-build123d-execution-review.ts)

Provider-free execution-review use case: reopens the exact sealed compilation admission
and server profile, then derives the MRTR without accepting caller-selected runtime
facts

#### [`src/adapters/cad/isolated/fixed-build123d-execution-profile-catalog.ts`](../../../src/adapters/cad/isolated/fixed-build123d-execution-profile-catalog.ts)

One code-owned Build123d execution profile binding the qualified compiler frontend,
isolation policy, digest-pinned OCI microVM image, limits and assurances, exact AP214
manifest, OCCT validator identity and `proven` teardown threshold

#### [`src/adapters/cad/isolated/build123d-execution-composition.ts`](../../../src/adapters/cad/isolated/build123d-execution-composition.ts)

Explicit conditional composition: profile-only exposes review facts; an exact empty
runtime marker constructs the unique local Microsandbox backend, broker, AP214 validator
and output CAS. The profile fixes command, paths, image, policy and limits; there is no
construction-time dispatch or legacy MCP fallback

#### [`src/adapters/cad/server-composition.ts`](../../../src/adapters/cad/server-composition.ts)

Build123d capability and CAD project contributions. Profile-only exposes review;
isolated execution needs the empty runtime marker. Private sandbox admitted export is
composed independently of `--local-execution`.

#### [`scripts/gates/verify-build123d-microsandbox-vertical.ts`](../../../scripts/gates/verify-build123d-microsandbox-vertical.ts)

Explicit generation-0 real-runtime gate for the exact Build123d worker digest: local
microVM execution, AP214/OCCT validation, proven broker destruction, published
resolution and CAS reread; it is not a recovery, production project-run or
canonical-promotion gate

#### [`src/adapters/cad/isolated/occt-step-output-validator.ts`](../../../src/adapters/cad/isolated/occt-step-output-validator.ts)

Parser-backed exact AP214 output validator: bounded Part 21 schema check followed by
full OCCT import and referenced non-degenerate triangulated geometry; plausible headers
and truncated files do not qualify

#### [`src/domain/cad/isolated/build123d-execution-evidence.ts`](../../../src/domain/cad/isolated/build123d-execution-evidence.ts)

Separates a private noncanonical execution draft from its documentary capture; both bind
producer generation and exact receipt/publication, while STEP remains publication-gated
and neither contract creates canonical geometry or a solver verdict

#### [`src/adapters/cad/isolated/build123d-execution-evidence.ts`](../../../src/adapters/cad/isolated/build123d-execution-evidence.ts)

Exact private draft/capture CAS adapters with canonical reread and bounded filesystem
permissions; composed under the recorded-analysis root only with the complete explicit
runtime

#### [`src/application/ports/out/cad/isolated/build123d-execution-attempt-store.ts`](../../../src/application/ports/out/cad/isolated/build123d-execution-attempt-store.ts)

Closed monotone attempt contract
`prepared -> dispatching -> output-published -> draft-persisted -> thread-persisted -> completed`;
tri-state recovery, producer generation and all replay identity remain provider-free

#### [`src/adapters/cad/isolated/file-build123d-execution-attempt-store.ts`](../../../src/adapters/cad/isolated/file-build123d-execution-attempt-store.ts)

Private canonical WAL keyed by project/run identity; divergent recovery facts or
out-of-order transitions fail closed. One second dispatch requires gen0 cleanup, durable
canonical `0 -> 1` advance and fresh `authorized -> consumed`; draft/completed replay
retain the exact receipt-generation link; there is no gen2

#### [`src/adapters/cad/isolated/design-execute-build123d-run-executor.ts`](../../../src/adapters/cad/isolated/design-execute-build123d-run-executor.ts)

Specialized draft-only executor: replays MRTR/admission/profile, recovers through
publication and WAL ports, and adds one documentary Thread artifact with no STEP;
registered only when the complete explicit runtime is present

#### [`src/domain/cad/sealed-isolated/isolated-geometry-seal-proposal.ts`](../../../src/domain/cad/sealed-isolated/isolated-geometry-seal-proposal.ts)

Closed MRTR grammar for `design.seal-isolated-geometry@1`; signs execution-capture,
draft, publication and STEP identities only

#### [`src/application/use-cases/cad/sealed-isolated/prepare-project-isolated-geometry-seal-review.ts`](../../../src/application/use-cases/cad/sealed-isolated/prepare-project-isolated-geometry-seal-review.ts)

Provider-free seal-review use case: reopens one documentary execution capture and
derives the seal MRTR without returning STEP bytes

#### [`src/adapters/cad/sealed-isolated/design-seal-isolated-geometry-run-executor.ts`](../../../src/adapters/cad/sealed-isolated/design-seal-isolated-geometry-run-executor.ts)

Provider-free sealer: re-reads published STEP only to verify sha256+byteCount, then
writes one Thread document; no thread-assets copy, cad-model, or FEA authority

#### [`src/adapters/cad/canonical/geometry-bundle-product-catalog.ts`](../../../src/adapters/cad/canonical/geometry-bundle-product-catalog.ts)

Strict read-only current projector for `geometry-capture/1.2` (assembly),
`geometry-capture/2.1` (bundle), and `geometry-part-capture/1.0` (target): active tip,
source/N+1 provenance, binary traces, and exact SysML occurrence-to-STEP bindings
without label joins. Older captures are rejected.

#### [`src/domain/cad/canonical/geometry-proposal.ts`](../../../src/domain/cad/canonical/geometry-proposal.ts)

Generic geometry manifest types, `encodeGeometryDecisionParameters`, and MRTR parameter
encoding for `design.write-geometry@1`

#### [`src/domain/cad/canonical/geometry-module-evidence.ts`](../../../src/domain/cad/canonical/geometry-module-evidence.ts)

Public facade for the bounded module family. Identities, isolation recross, manifest,
draft and capture stay in the sibling files below.

#### [`src/domain/cad/geometry-module-contract.ts`](../../../src/domain/cad/geometry-module-contract.ts)

Shared geometry-module literal identities (capture schema, input-bundle schema,
unit/placement convention, child capture schemas, child STEP media type). Imported by
runtime encoding and canonical evidence. Not a parser and not a second authority.

#### [`src/domain/cad/canonical/geometry-module-identities.ts`](../../../src/domain/cad/canonical/geometry-module-identities.ts)

Shared value objects: nonempty immediate-child table, structure capture with canonical
`part-definitions-<digest>` id, complete input-bundle identity including the validated
runtime manifest, and child capture plus authoritative STEP identities. Placement
locator authority stays on `cad-placement-analysis-capture.ts`. No program, lowerer, or
admission stamp.

#### [`src/domain/cad/canonical/geometry-module-isolation.ts`](../../../src/domain/cad/canonical/geometry-module-isolation.ts)

Recross of the existing `IsolatedCodeExecutionReceiptRecord` to the code-owned
`build123d-module-assembler-v1` profile, input-bundle digest, proven destruction,
accepted termination, and `assembly.step` / `assembly.glb` outputs. Does not restate
receipt fields.

#### [`src/domain/cad/canonical/geometry-module-manifest.ts`](../../../src/domain/cad/canonical/geometry-module-manifest.ts)

`geometry-module-manifest/1.0` and its flat MRTR grammar. A completed manifest names the
complete input-bundle identity and assembly STEP/GLB fingerprints. Placement analysis is
mandatory.

#### [`src/domain/cad/canonical/geometry-module-draft.ts`](../../../src/domain/cad/canonical/geometry-module-draft.ts)

Review-only `geometry-module-draft-capture/1.0`: complete input-bundle identity,
isolated receipt, reopened child capture/STEP identities, produced STEP+GLB. No Thread
write.

#### [`src/domain/cad/canonical/geometry-module-capture.ts`](../../../src/domain/cad/canonical/geometry-module-capture.ts)

Canonical `geometry-module-capture/1.0` after the existing geometry seal. Recrosses the
signed manifest, complete input-bundle identity against every child, architecture
`architecture-<digest>` plus structure identity, receipt and produced assets.

#### [`src/application/ports/out/cad/canonical/geometry-module-evidence-store.ts`](../../../src/application/ports/out/cad/canonical/geometry-module-evidence-store.ts)

Typed draft/capture CAS ports. They persist through existing geometry CAS families and
do not export, call a provider, or seal Thread state.

#### [`src/adapters/cad/canonical/file-geometry-module-evidence-store.ts`](../../../src/adapters/cad/canonical/file-geometry-module-evidence-store.ts)

File adapters that persist those records through the existing
`casys://geometry-draft-capture/` and `casys://geometry-capture/` stores.

#### [`src/application/ports/out/cad/canonical/geometry-draft-asset-store.ts`](../../../src/application/ports/out/cad/canonical/geometry-draft-asset-store.ts)

Outward port for review-only assembly STEP/GLB bytes. The application names only bytes;
CAS layout stays in the adapter. Not Thread evidence.

#### [`src/adapters/cad/canonical/file-geometry-draft-asset-store.ts`](../../../src/adapters/cad/canonical/file-geometry-draft-asset-store.ts)

File CAS adapter for those draft binaries under `casys://geometry-draft-asset/`.

#### [`src/domain/cad/canonical/geometry-bundle.ts`](../../../src/domain/cad/canonical/geometry-bundle.ts)

`geometry-manifest/2.0`: exhaustive PartUsage/PartDefinition identities, explicit
placements, assembly/definition formats, and strict flat MRTR round-trip

#### [`src/adapters/cad/canonical/geometry-draft-capture.ts`](../../../src/adapters/cad/canonical/geometry-draft-capture.ts)

Calls `build123d_export`, attests each binary's SHA-256, and stores draft JSON + binary
assets in the draft stores; never writes a `ThreadSnapshot`

#### [`src/adapters/cad/source/python-cad-source-analyzer.ts`](../../../src/adapters/cad/source/python-cad-source-analyzer.ts)

Conservative, parser-backed Python CAD frontend: bounded syntax facts and unresolved
constructs, no execution, provider call, source rewrite or authority

#### [`src/domain/cad/placement/`](../../../src/domain/cad/placement)

Closed `cad-immediate-placement-source/1.0`, same-file `design-source@1` `PartUsage`
resolution, exact immediate-usage coverage plus `typed_by` recross, and the opaque
`cad-placement-analysis-capture/1.0` locator. No provider, runtime, MRTR or verdict
fields.

#### [`src/application/use-cases/cad/placement/capture-project-cad-placement.ts`](../../../src/application/use-cases/cad/placement/capture-project-cad-placement.ts)

`project_cad_placement_capture`: reopen one named attachment head, all active same-file
placement attachments, and the exact architecture capture, then persist a locator only
when coverage is exact.

#### [`src/adapters/cad/placement/`](../../../src/adapters/cad/placement)

Durable source and analysis FileByteStore codecs, declaredAgainst Thread/architecture
recross adapter, and placement composition. Not a workspace aggregate change and not a
new attachment role.

#### [`src/adapters/cad/source/geometry-source-analysis-capture.ts`](../../../src/adapters/cad/source/geometry-source-analysis-capture.ts)

Pre-provider causal boundary: exact CAD source CAS readback, passive analysis, analysis
CAS readback, and seal/replay verification of their shared identity

#### [`src/adapters/cad/canonical/design-write-geometry-run-executor.ts`](../../../src/adapters/cad/canonical/design-write-geometry-run-executor.ts)

Trusted executor for `design.write-geometry@1`: seals exact bytes from a human-signed
draft into a geometry artifact; no provider call; requires a matching MRTR decision
before promoting

#### [`src/ui/src/cad/geometry-decision-model.ts`](../../../src/ui/src/cad/geometry-decision-model.ts)

Browser-safe parser for MRTR geometry decision parameters; returns `{ kind: "valid" }`
or `{ kind: "invalid", reason }`; no domain imports

#### [`src/domain/cad/module-assembly/geometry-module-input-bundle.ts`](../../../src/domain/cad/module-assembly/geometry-module-input-bundle.ts)

Closed `geometry-module-input-bundle/1.0`: canonical manifest, usage-ordered immediate
occurrences, placements, child-capture and STEP identities, packed offsets, then exact
child STEP bytes. Shared literals come from `geometry-module-contract.ts`.
Encode/decode/re-hash only. No agent CAD source and no exporter

#### [`src/adapters/cad/module-assembly/geometry-module-assembly-composition.ts`](../../../src/adapters/cad/module-assembly/geometry-module-assembly-composition.ts)

Digest-pinned module-assembler composition: profile-only review facts; empty runtime
marker reuses the single-source Microsandbox broker and atomic output CAS. Not the
public export tool and not the sealer

#### [`src/application/ports/in/cad/canonical/project-geometry-module-export.ts`](../../../src/application/ports/in/cad/canonical/project-geometry-module-export.ts)

Closed public command for `project_geometry_module_export`: project, exact Thread basis,
composite PartDefinition and placement locator only

#### [`src/application/use-cases/cad/canonical/export-project-geometry-module.ts`](../../../src/application/use-cases/cad/canonical/export-project-geometry-module.ts)

Server recross of the exact Thread architecture, part-definitions CAS URI/digest/byte
count, immediate placement coverage, unique active child capture and authoritative STEP
bytes. A published generation-zero receipt is reopened exactly on retry; outcome-unknown
never redispatches and no artificial generation one exists. Produces a review-only
draft. No Thread write

#### [`src/adapters/cad/module-assembly/geometry-module-export-composition.ts`](../../../src/adapters/cad/module-assembly/geometry-module-export-composition.ts)

Separate composition for the public export vertical. Wires the use case only when the
same runtime exposes both `IsolatedCodeRunner` and its publication-gated receipt reader.
Does not enter `createCadProject` or the sealer

#### [`src/tools/project-control/geometry-module-export-tools.ts`](../../../src/tools/project-control/geometry-module-export-tools.ts)

MCP registration for `project_geometry_module_export`. Conditional on the composed use
case. Description teaches the later `design.write-geometry@1` step from
`decisionParameters` and names the forbidden fields

#### [`src/domain/cad/assembly-integrity/assembly-integrity-observation-proposal.ts`](../../../src/domain/cad/assembly-integrity/assembly-integrity-observation-proposal.ts)

Closed MRTR grammar for the factual `verify.observe-assembly-integrity@1` review: exact
Thread and geometry-module capture, server-owned profile/method and neutral
digest-pinned configured runtime; no caller-selected provider/runtime/tool, transform,
tolerance or verdict

#### [`src/application/ports/out/cad/assembly-integrity/assembly-integrity-review-resolver.ts`](../../../src/application/ports/out/cad/assembly-integrity/assembly-integrity-review-resolver.ts)

Injected read-only seam that alone reopens the exact current Thread and unique primary
geometry-module capture for review. The use case compiles only append/propose; it does
not duplicate the recross, write state, call an observer or compose an executor

#### [`src/tools/project-control/assembly-integrity-review-tools.ts`](../../../src/tools/project-control/assembly-integrity-review-tools.ts)

Conditional `project_assembly_integrity_review` MCP registration for the closed
read-only factual L3 review command. The separate trusted observer executor persists
only a normalized custom evidence capture, never a product verdict

#### [`src/domain/cad/assembly-integrity/assembly-integrity-evaluation.ts`](../../../src/domain/cad/assembly-integrity/assembly-integrity-evaluation.ts)

Code-owned `assembly-integrity-evaluation-method/1.0` and custom
`assembly-integrity-evaluation-capture/1.0`: five deterministic L4 criteria over exact
normalized L3 facts, fixed rigid-matrix representation epsilon, diagnostics-only
measurement tolerance, and explicit limits for joints, clearance, motion, load,
fabricability and safety. No generic SysML RequirementEvaluation

#### [`src/application/use-cases/cad/assembly-integrity/recross-assembly-integrity-evaluation.ts`](../../../src/application/use-cases/cad/assembly-integrity/recross-assembly-integrity-evaluation.ts)

Server-only L4 input recross: selects the exact current L4 leaf and its completed L3
dependency, then reopens and checks the L3 custom capture, dynamic module binding,
canonical module/STEP, signed profile, full bundle and normalized observation before
evaluation. Provider, tool, tolerance, facts and verdict never enter the public command

#### [`src/adapters/cad/assembly-integrity/verify-evaluate-assembly-integrity-run-executor.ts`](../../../src/adapters/cad/assembly-integrity/verify-evaluate-assembly-integrity-run-executor.ts)

Trusted provider-free L4 executor with deterministic WAL recovery. It emits one custom
`evidence` artifact over ordered module, STEP and L3 observation inputs; it writes no
generic SysML evaluation and never satisfies a Brief gate

#### [`src/tools/project-control/assembly-integrity-evaluation-review-tools.ts`](../../../src/tools/project-control/assembly-integrity-evaluation-review-tools.ts)

Conditional project-only `project_assembly_integrity_evaluation_review` MCP review:
server selection and recross precede canonical MRTR parameters. It never accepts a
provider, tolerance, fact, criterion, verdict or gate selection from the caller

#### [`images/build123d-module-assembler-worker/run-module-assembler.py`](../../../images/build123d-module-assembler-worker/run-module-assembler.py)

Code-owned Build123d assembler: decode/rehash the bundle, import staged child STEPs,
apply right-handed mm extrinsic XYZ, export `assembly.step` and `assembly.glb`. Leaves
the untrusted `build123d-microsandbox-worker` unchanged. The production local entrypoint
pins image digest `5aa833e19f1956a001013661e726c19c4566677a75f58493a6534456b99b6707` and
wrapper digest `609eaf93f2564b88b9103d5e0d53d1dd3e93fcdf8e54c61cc313b957370bf581`
