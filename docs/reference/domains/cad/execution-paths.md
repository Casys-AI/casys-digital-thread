# Reference: CAD execution paths

Audience: both · Diátaxis: reference · Kind: contract

An admitted Build123d source has two execution paths. They reuse the exact sealed source
bytes but produce different authority. They are not substitutes.

| Path                      | Execution                                | Successful output                                                                      | Product authority                |
| ------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------- |
| Canonical admitted export | Published `mcp-build123d-sandbox` image  | Server-fixed STEP and GLTF draft, then sealed Thread geometry                          | Canonical STEP for proof and DFM |
| Isolated execution        | Digest-pinned local Microsandbox microVM | One validated AP214 `geometry.step` in the private output CAS plus documentary capture | Noncanonical draft only          |

## Canonical admitted export

```text
project_technical_source_capture
  → project_technical_compilation_preview
  → compile.seal-admission@1
  → project_admitted_geometry_export
  → human MRTR
  → design.write-geometry@1
```

`project_admitted_geometry_export` reopens the exact admitted source. A caller cannot
supply Python, provider, tool, path, image, or output formats. The exporter fixes STEP
and GLTF and creates a draft stamped with the admission identity. It does not write
Thread state.

`design.write-geometry@1` makes no provider call and does not execute Build123d again.
It rereads the signed draft and exact assets, requires the admission stamp, and seals
the canonical geometry into the Thread. This canonical STEP is the geometry accepted by
the product proof and measured-DFM paths.

The system-only admitted export requires one uniquely represented PartDefinition and no
PartUsage occurrences. It retains the `geometry-manifest/2.0` bundle draft and the
canonical-write review path. In a multi-part architecture, the same public command instead
derives that exact represented definition and produces one `geometry-part-manifest/1.0`
target draft. That draft has no assembly, component, occurrence, placement, or
`partDefinitions` array, makes one server-fixed export call, and does not write Thread state.

Code:
[admitted export use case](../../../../src/application/use-cases/cad/canonical/export-admitted-project-geometry.ts),
[fixed exporter](../../../../src/adapters/cad/canonical/admission-backed-geometry-export-adapter.ts),
and
[canonical sealer](../../../../src/adapters/cad/canonical/design-write-geometry-run-executor.ts).

## Isolated documentary execution

```text
compile.seal-admission@1
  → project_build123d_execution_review
  → human MRTR
  → design.execute-build123d@1
  → optional project_isolated_geometry_seal_review
  → optional design.seal-isolated-geometry@1
```

The shared reopen use case supplies the exact admitted bytes to a code-owned wrapper in
a network-disabled microVM. A caller cannot select the runtime, image, command,
arguments, paths, environment, policy, validator, or output manifest. The only declared
output is `geometry.step`, media type `model/step`, format `step-ap214`; the broker
validates it outside the microVM with the code-owned OCCT validator before publication.

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
