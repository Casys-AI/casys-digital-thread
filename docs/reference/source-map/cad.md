# Reference: source map — CAD

Audience: agent · Diátaxis: reference · Kind: contract

Census of isolated Build123d execution, isolated-geometry seal, and canonical geometry
files. Shared admission lives on [compile](compile.md).

Index: [workspace source map](../runtime/workspace-source-map.md). Domain coverage stays
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

Strict read-only current `geometry-capture/2.1` plus historical 2.0 projector: active
tip, source/N+1 provenance, binary traces, and exact SysML occurrence-to-STEP bindings
without label joins

#### [`src/domain/cad/canonical/geometry-proposal.ts`](../../../src/domain/cad/canonical/geometry-proposal.ts)

Generic geometry manifest types, `encodeGeometryDecisionParameters`, and MRTR parameter
encoding for `design.write-geometry@1`

#### [`src/domain/cad/canonical/geometry-bundle.ts`](../../../src/domain/cad/canonical/geometry-bundle.ts)

`geometry-manifest/2.0`: exhaustive PartUsage/PartDefinition identities, explicit
placements, assembly/definition formats, and strict flat MRTR round-trip

#### [`src/adapters/cad/canonical/geometry-draft-capture.ts`](../../../src/adapters/cad/canonical/geometry-draft-capture.ts)

Calls `build123d_export`, attests each binary's SHA-256, and stores draft JSON + binary
assets in the draft stores; never writes a `ThreadSnapshot`

#### [`src/adapters/cad/source/python-cad-source-analyzer.ts`](../../../src/adapters/cad/source/python-cad-source-analyzer.ts)

Conservative, parser-backed Python CAD frontend: bounded syntax facts and unresolved
constructs, no execution, provider call, source rewrite or authority

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
