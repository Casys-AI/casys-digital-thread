# Reference: provider-neutral geometry-module assembly

Audience: both · Diátaxis: reference · Kind: contract

Geometry-module assembly is the bounded capability that combines the exact immediate
child STEP files and their reviewed placements into one assembly STEP plus one GLB. Its
stable application boundary is `GeometryModuleAssembler`; the application supplies only
a server-issued run id and the closed `geometry-module-input-bundle/1.0`.

The application, agent, and Workbench do not choose a CAD provider, executable, image,
profile, arguments, paths, or output formats. Server composition selects one adapter.
The current adapter uses the pinned Build123d module-assembler worker, but Build123d is
not part of the application port or the persisted capability identity.

## Stable result

Successful adapters return `geometry-module-assembly-receipt/1.0` with:

- capability `geometry.module.immediate-compound@1.0`;
- the exact input-bundle fingerprint and byte count;
- exact `assembly.step` and `assembly.glb` identities; and
- an implementation id, version, and evidence fingerprint.

The implementation evidence may name Build123d, Catia, OpenShape, or another qualified
backend. It is provenance, not caller-selectable configuration. The export use case
persists the returned bytes in the provider-neutral geometry draft asset store. The
existing `design.write-geometry@1` sealer reopens those exact bytes, rehashes them,
revalidates STEP and GLB, and seals the same module family without knowing the backend's
native publication format.

An alternative adapter must prove the same closed input and output identities and fail
closed on an absent, divergent, or uncertain prior outcome. Adding an adapter must not
add provider fields to the agent command or fork the module lifecycle.

## Why the current adapter still uses a micro-VM

The atelier has two distinct reasons to run engineering work in micro-VMs:

| Family                    | Executed content                                                 | Primary reason                                                                                       |
| ------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Admitted-source execution | Reviewed but agent-authored Build123d or Modelica source         | Contain arbitrary source execution and deny repository, secret, network, and canonical-volume access |
| Fixed native worker       | Code-owned module-assembly algorithm over a closed binary bundle | Pin heavy native dependencies, reproduce the runtime, contain faults, and publish outputs atomically |

The second family is not evidence that the agent supplied arbitrary Build123d code. Its
worker, command, image, paths, limits, and output manifest are adapter-private. A remote
CAD service or qualified desktop CAD integration could implement the same port without
using this local micro-VM.

The existing native Microsandbox receipt remains behind the current adapter and is
hashed into `implementation.evidenceFingerprint`. The Thread stores the neutral receipt,
not the native execution envelope. This keeps recovery evidence without coupling
canonical geometry to the current packaging choice.

## Exact qualified runtime

The fixed adapter requires the exact qualified runtime of its registered binding. Its
native receipt is recrossed against the fixed execution profile, isolation policy,
output manifest, destruction assurance, and exact Microsandbox runtime attestation. A
different, absent, divergent, or unknown runtime fails closed; it is `unavailable`, not
a reason to fall back to a Docker image, a host executable, or caller-selected settings.

`prepare:geometry-module:microsandbox` observes the exact Microsandbox target and, when
the Docker source is absent, reconstructs the in-repo Dockerfile as a local candidate
recipe, then imports under the fixed runtime manifest reference. That rebuild is not
bit-reproducible proof: after import, the cached image must still match the exact target
digest, or the capability stays unavailable. `oci-digest` is the preferred immutable
distribution source when a reviewed digest exists. A moving APT repository does not
promise reproduction of the pin. That cache entry is not a qualification attestation.
The separate `verify:geometry-module:microsandbox:qualification` gate verifies the fixed
active-pin qualification fixture and records its own WAL, capture, and attestation; it
neither promotes a catalogue binding nor performs a product assembly. A product export
remains a separate registered use of the exact qualified runtime.

An imported candidate uses
`verify:geometry-module-assembler-worker:candidate-qualification` with only
`--import-record=<path>` plus `--run` or `--recover`. That path binds
`first-party-microsandbox-image-candidate-import/3.0` to the current matrix, executes
the exact cached candidate image, and isolates state under
`state/local/first-party-microsandbox-image-candidate-qualification/geometry-module-assembler-worker/`.
It cannot substitute the active-pin authority, does not write
`state/local/capability-runtime-host` qualification stores, and leaves
`eligibleForPromotion=false`.

## Authority limit

Successful assembly proves that the registered adapter produced a parseable STEP/GLB
pair for the exact closed bundle. It does not prove collision freedom, clearances,
joints, motion, loads, manufacturability, safety, or certification. Those questions use
separate post-publication observers and evaluations, beginning with
[assembly integrity](assembly-integrity.md).

Code:
[neutral port](../../../../src/application/ports/out/cad/module-assembly/geometry-module-assembler.ts),
[current adapter](../../../../src/adapters/cad/module-assembly/fixed-geometry-module-assembler.ts),
and
[neutral receipt](../../../../src/domain/cad/module-assembly/geometry-module-assembly-receipt.ts).
