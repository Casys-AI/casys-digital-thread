# Reference: CAD execution paths

Audience: both · Diátaxis: reference · Kind: contract

An admitted Build123d source has two execution paths. They reuse the exact sealed source
bytes but produce different authority. They are not substitutes.

| Path                      | Execution                                | Successful output                                                                      | Product authority                |
| ------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------- |
| Canonical admitted export | Published `mcp-build123d-sandbox` image  | Server-fixed STEP and GLTF draft, then sealed Thread geometry                          | Canonical STEP for proof and DFM |
| Isolated execution        | Digest-pinned local Microsandbox microVM | One validated AP214 `geometry.step` in the private output CAS plus documentary capture | Noncanonical draft only          |

## Admitted source identity

The same paths accept either an authored root or the active Build123d 3.0 direct
workspace closure. For a closure, capture derives one
`technical-unit:<closure sha256>` from the exact `project-source-closure/1.0`; that unit
is distinct from every workspace `fileId`. The V4 capture keeps the authored closure and
attachment as evidence and persists the complete lowering manifest. Preview uses
`technical-compilation/2.0`; admission and its Thread capture use V4, while the
registered operation remains `compile.seal-admission@3`.

No caller may choose a lowerer, provider, tool, path, image, runtime or output. A
lowered closure has code-test evidence for capture, reopening and admission mechanics;
a real private MCP execution of that multi-file form is still pending. This changes
neither canonical nor isolated authority.

## Canonical admitted export

```text
project_technical_source_capture
  → project_technical_compilation_preview
  → compile.seal-admission@3
  → project_admitted_geometry_export
  → human MRTR
  → design.write-geometry@1
```

`project_admitted_geometry_export` reopens the exact admitted source. A caller cannot
supply Python, provider, tool, path, image, or output formats. The exporter fixes STEP
and GLTF and creates a draft stamped with the admission identity. It does not write
Thread state.

Before the fixed export call, the server completes cold validation, obtains the exact
short Build123d preparation lease, repeats that full cold validation, then creates the
private loopback client. A local monotone record advances `prepared -> dispatching`
before this non-idempotent provider call, then to `recorded` only after capture+reread
and an exact durable result. Replay hits never activate a runtime; `dispatching` without
`recorded`, an unreadable record, or a collision is `unavailable` for recovery rather
than a fresh provider dispatch.

If an interruption occurs while only `prepared` exists, the server may resume the same
exact preparation reservation after cold validation; an expired reservation gains an
immutable linked successor rather than overwriting history. If `recorded` exists but the
success-path cleanup did not run, replay returns the captured result and releases only the
exact residual lease without activating Build123d or calling the provider.

For a lowered closure, every reopen and replay recrosses the sealed closure, reopens all
named file bytes, re-lowers them, compares the full manifest and effective script, and
reanalyses before this exporter is reached. A mismatch fails before a provider call.

`design.write-geometry@1` makes no provider call and does not execute Build123d again.
It rereads the signed draft and exact assets, requires the admission stamp, and seals
the canonical geometry into the Thread. This canonical STEP is the geometry accepted by
the product proof and measured-DFM paths.

The system-only admitted export requires one uniquely represented PartDefinition and no
PartUsage occurrences. It retains the `geometry-manifest/2.0` bundle draft and the
canonical-write review path. In a multi-part architecture, the same public command
instead derives that exact represented definition and produces one
`geometry-part-manifest/1.0` target draft. That draft has no assembly, component,
occurrence, placement, or `partDefinitions` array, makes one server-fixed export call,
and does not write Thread state.

The same canonical sealer accepts that strict target family. It reopens the exact
capture-backed `compile.seal-admission@3` artefact named by the
`geometry-draft-admission/2.0` stamp, then re-crosses its admitted source bytes/hash and
unique P1 `represents` PartDefinition against the target draft, passive source analysis,
architecture PartDefinition and signed STEP bytes before it writes a capture or promotes
any asset. The canonical record is `geometry-part-capture/1.0`, whose root is
target-only and repeats the PartDefinition ID, architecture basis, admission/source hash
and authoritative STEP hash. It never calls Build123d during promotion or replay.

Target capture succession is scoped to the exact PartDefinition element ID: different
targets coexist, while a same-target successor archives only the previous target capture
and its `cad-asset-<captureDigest>-target-<fileIndex>-<fileDigest>` files. An active V2
bundle covering the requested target is a fail-closed conflict; the sealer never
partially archives a V2 assembly family. The Product catalog maps a verified target
capture only to occurrences carrying the exact signed SysON PartDefinition identity,
with STEP authoritative and GLB presentational; it never projects that target as an
assembly. FEA source admission accepts its STEP only when the proof target equals that
captured PartDefinition and the target artifact's kind, media type, digest and byte
count are exact; a `cad-model` capture is never proof geometry.

Code:
[admitted export use case](../../../../src/application/use-cases/cad/canonical/export-admitted-project-geometry.ts),
[fixed exporter](../../../../src/adapters/cad/canonical/admission-backed-geometry-export-adapter.ts),
and
[canonical sealer](../../../../src/adapters/cad/canonical/design-write-geometry-run-executor.ts).

## Isolated documentary execution

```text
compile.seal-admission@3
  → project_build123d_execution_review
  → human MRTR
  → design.execute-build123d@1
  → optional project_isolated_geometry_seal_review
  → optional design.seal-isolated-geometry@1
```

`project_build123d_execution_review` returns the registered `design.execute-build123d@1`
operation with `compilationAdmission` bound to the selected admission artifact on the
current review Thread basis. Reuse that operation verbatim; do not reconstruct the
thread-entity reference from a historical `compile.seal-admission@3` creation snapshot.
The returned admission, `decisionParameters` and `operation` are review material only.

The shared reopen use case supplies the exact admitted bytes to a code-owned wrapper in
a network-disabled microVM. A caller cannot select the runtime, image, command,
arguments, paths, environment, policy, validator, or output manifest. The only declared
output is `geometry.step`, media type `model/step`, format `step-ap214`; the broker
validates it outside the microVM with the code-owned OCCT validator before publication.

That reopen applies the same closure recross, byte reopen, lowering-manifest/script
comparison and reanalysis before the microVM boundary. It does not stage workspace files
or turn the virtual import names into a filesystem/module-loader interface.

The fixed local ceilings are 30 s wall time, 25 s requested CPU time, 1 GiB memory, 32
requested processes, 64 KiB for each log, and 128 MiB per output file and in total. CPU
time and process count remain explicitly unattested. Cleanup must meet the code-owned
`proven` threshold before output release.

A successful `design.execute-build123d@1` adds a documentary JSON capture to the Thread,
not a STEP artifact. `design.seal-isolated-geometry@1` can later seal the execution
identities as another Thread document, but still does not create canonical STEP,
`cad-model`, FEA geometry, DFM authority, observation, evaluation, or verdict. There is
currently no operation that promotes the isolated output CAS into canonical geometry.

Code:
[execution proposal and output](../../../../src/domain/cad/isolated/build123d-execution-proposal.ts),
[fixed execution profile](../../../../src/adapters/cad/isolated/fixed-build123d-execution-profile-catalog.ts),
and
[isolated geometry seal](../../../../src/domain/cad/sealed-isolated/isolated-geometry-seal-proposal.ts).

The generic lifecycle and recovery rules live in
[admitted source isolated execution](../../pipeline/admitted-source-isolated-execution.md).

## Current post-publication assembly observation

The shared reopen is the profile-free
[exact static assembly basis](static-assembly-basis.md): one exact
`geometry-module-capture/1.0` and its authoritative assembly STEP. The
assembly-integrity consumer then adds its method, bounds, and server-owned profile. The
current adapter lowers that request to the raw
`build123d_observe_assembly_integrity` capability on `mcp-build123d` and seals the
facts as `assembly-integrity-observation/1.0`. Callers do not choose that provider.

The observer has no local OCCT worker, no sandbox or local-execution fallback, and no
verdict. It records import/topology, recross and pairwise geometry facts with their
provenance; `unavailable` and `unresolved` remain literal. `mcp-build123d` does not
receive a Casys project, Thread snapshot, MRTR or evaluation context.

The observer consumes the canonical module artifact produced through the
[provider-neutral module-assembly boundary](module-assembly.md). The current assembly
adapter uses a fixed Build123d worker, while the application and sealed receipt stay
provider-neutral. Kinematics is a different capability, not a richer profile on this
observer.
