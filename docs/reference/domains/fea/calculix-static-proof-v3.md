# Domain reference: isolated CalculiX static proof V3

Audience: both · Diátaxis: reference · Kind: domain contract

`verify.run-fea-static-proof@3` is the registered product execution for the
[mechanical proof case V1](mechanical-proof-case-v1.md). It asks one bounded FEA
question: how the exact canonical part STEP behaves under the reviewed linear-static
case.

CalculiX is the numerical engine, not the FEA domain or the verdict authority. The
operation runs Gmsh and CalculiX locally in a digest-pinned microVM, then asks SysON to
evaluate the resulting observations against exact Thread requirements. Historical MCP
operations `@1` and `@2` are not registered product substitutes.

Source contracts:

- [`calculix-isolated-execution.ts`](../../../../src/domain/fea/isolated-v3/calculix-isolated-execution.ts)
- [`sealed-static-proof-capture.ts`](../../../../src/domain/fea/isolated-v3/sealed-static-proof-capture.ts)
- [`static-proof-identity.ts`](../../../../src/domain/fea/isolated-v3/static-proof-identity.ts)
- [`static-proof-oracle-input.ts`](../../../../src/domain/fea/isolated-v3/static-proof-oracle-input.ts)
- [`static-proof-thread-evidence.ts`](../../../../src/domain/fea/isolated-v3/static-proof-thread-evidence.ts)
- [`calculix-static-proof-v1/run.ts`](../../../../src/adapters/fea/isolated-v3/calculix-static-proof-v1/run.ts)
- [`verify-run-fea-static-proof-v3-run-executor.ts`](../../../../src/adapters/fea/isolated-v3/verify-run-fea-static-proof-v3-run-executor.ts)
- [`fea-oracle-adapter.ts`](../../../../src/adapters/fea/isolated-v3/fea-oracle-adapter.ts)

## Admitted inputs and lowering

The operation reopens all of the following before execution:

- a current `resolved-operation-plan/2.0` naming `@3` and its separate run MRTR;
- the sealed `mechanical-proof-case/1.0` Thread document;
- the exact canonical part artifact (`kind: step`, `mediaType: model/step`), never its
  sibling `cad-model`;
- the requirements artifact and Thread requirement identities referenced by the proof;
- the registered `calculix-static-proof-v1@1.0.0` profile, image, isolation policy,
  wrapper and lowering identities.

The server supplies the effective element order (`1 | 2`) and timeout in the plan. The
agent supplies neither. The worker receives one code-owned bundle containing the proof,
those effective values and the exact STEP bytes.

The lowering is fixed:

1. verify the STEP byte count and SHA-256 against the reviewed proof;
2. generate a Gmsh script from the target mesh size and AABB selections;
3. mesh the STEP and inspect the resulting node sets;
4. generate the CalculiX/Abaqus deck from the mesh, material, fixed supports and forces;
5. run CalculiX and parse its data file;
6. reconstruct and compare the expected mesh script, deck and result metrics before
   admitting evidence.

The agent never writes `.inp` and cannot select a shell, command, path, provider, image,
environment or native solver argument. The worker imports the qualified
`@casys/mcp-calculix` core library, but it does not call an MCP CalculiX server and the
published operation does not claim `mcp-calculix` provenance.

The executor cross-binds the complete worker output to the resolved operation plan,
sealed proof, input bundle, registered profile and canonical STEP before publication.

## Exact output batch

All nine files are required, externally byte-counted and SHA-256 hashed, then published
through the output CAS as one complete batch.

| Role           | Meaning                                                                             |
| -------------- | ----------------------------------------------------------------------------------- |
| `input.step`   | Byte-identical canonical part STEP consumed by the worker                           |
| `request.json` | Canonical request identity, proof fingerprint, effective settings and STEP identity |
| `mesh.geo`     | Code-owned Gmsh script                                                              |
| `mesh.inp`     | Generated volume mesh in Abaqus/CalculiX text form                                  |
| `gmsh.log`     | Gmsh diagnostics                                                                    |
| `job.inp`      | Server-generated CalculiX deck; never caller-authored                               |
| `ccx.log`      | CalculiX diagnostics                                                                |
| `job.dat`      | CalculiX result data parsed by the validator                                        |
| `result.json`  | Normalized mesh, constraints, maximum displacement and maximum von Mises metrics    |

`result.json` always carries maximum displacement in `mm` and maximum von Mises stress
in `MPa`, including their node or element identities. The proof may declare one or both
corresponding criteria; only declared criteria become Thread observations.

A completed operation publishes eleven artifacts: the nine files, one isolated-execution
evidence artifact and one immutable SysON evaluation-capture artifact.

## Evaluation is separate from solving

A zero CalculiX exit code is not a requirement verdict. After local evidence is durable,
the executor projects each declared proof criterion onto its exact SysON feature and
calls `syson_constraint_evaluate`. SysON owns unit-aware comparison, including the `MPa`
result to `Pa` limit conversion for von Mises stress.

Each outcome remains literal: `pass`, `fail`, `unresolved` or `error`. Only `pass`
proves that one named condition on this exact basis is within its limit. A `fail` is
publishable: the named violation is `caused_by` the failing evaluation; the violation
`evidences` both the local execution evidence artifact and the immutable SysON
evaluation-capture artifact; the proposed review action `addresses` that violation.
`error` and `unresolved` get no comparison and no violation; they never become `pass`.

## Isolation and replay

The shared isolated runner pins the OCI digest, direct wrapper invocation, disabled
network, resource limits, output manifest and proven destruction. See
[compilation and isolation](../../pipeline/compilation-and-isolation.md) for that common
boundary.

The product WAL captures local execution evidence before the SysON call and journals
oracle dispatch intent before that non-idempotent call. An ambiguous oracle outcome is
not retried. Completed replay reopens the exact output CAS, execution evidence,
evaluation capture and Thread successor; it does not run Gmsh, CalculiX or SysON again.

Operational guide:
[compile FEA seal and isolated-run bindings](../../../how-to/compile/compile-fea-parameters.md).
