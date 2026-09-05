# Reference: qualified binding catalogue

Audience: both · Diátaxis: reference · Kind: contract

This is the current code-owned mapping from provider-neutral semantic capability to one
concrete binding and atomic unit set. It is an inspection map, not an agent selector:
the server selects a binding through policy and the trusted catalogue. Digests, host
mode, availability, and host effects stay in the exact proposal and atomic catalogue
rather than being copied here.

`qualified` means the catalogue permits operational composition for that binding; it is
not an MRTR, an active runtime, a provider-health claim, or an engineering result.
`unqualified` remains literally unavailable until its own exact host qualification
exists.

| Semantic capability                                 | Binding · use · catalogue qualification                                        | Atomic unit(s)                           | Boundary                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `model.author-system@1`                             | `syson-author-system@1.0.0` · execution · qualified                            | `casys.syson-stack`                      | SysML authoring only; no engineering verdict                                                                                               |
| `model.evaluate-requirement@1`                      | `syson-evaluate-requirement@1.0.0` · execution · qualified                     | `casys.syson-stack`                      | Provider response is not L4/L5 by itself                                                                                                   |
| `model.inspect-system@1`                            | `syson-inspect-system@1.0.0` · execution · qualified                           | `casys.syson-stack`                      | Bounded system read, not product navigation authority                                                                                      |
| `geometry.export-admitted-source@1`                 | `build123d-export-admitted-source@1.0.0` · preparation · qualified             | `casys.mcp-build123d-sandbox`            | Exact admitted export, never arbitrary agent CAD                                                                                           |
| `geometry.execute-admitted-source@1`                | `build123d-execute-admitted-source@1.0.0` · execution · qualified              | `casys.build123d-isolated-worker`        | Isolated output stays documentary until another path admits it                                                                             |
| `geometry.observe-assembly-integrity@1`             | `build123d-observe-assembly-integrity@1.0.0` · execution · qualified           | `casys.mcp-build123d-observation`        | Static pairwise non-intersection only; no motion/trajectory clearance, contact dynamics, forces, safety, or manufacturability              |
| `geometry.module.immediate-compound@1.0`            | `build123d-geometry-module-immediate-compound@1.0.0` · preparation · qualified | `casys.geometry-module-assembler-worker` | Exact static immediate compound only                                                                                                       |
| `mechanics.solve-static-structural@1`               | `calculix-static-structural@1.0.0` · execution · qualified                     | `casys.calculix-worker`                  | Isolated product static proof; distinct from HTTP sensitivity                                                                              |
| `mechanics.observe-static-structural-sensitivity@1` | `calculix-http-static-sensitivity@1.0.0` · execution · unqualified             | `casys.mcp-calculix`                     | Factual sensitivity only; non-activable pending live qualification                                                                         |
| `simulation.run-qualified-modelica@1`               | `openmodelica-qualified-kit@1.0.0` · execution · qualified                     | `casys.modelica-worker`                  | Pinned LinearThermalRamp kit only. Shares the one physical Modelica atom; does not qualify admitted source                                 |
| `simulation.run-admitted-modelica@1`                | `openmodelica-admitted-modelica@1.0.0` · execution · unqualified               | `casys.modelica-worker`                  | Admitted method remains literally unqualified. Sharing the reviewed worker image does not qualify this binding                             |
| `electronics.run-admitted-spice@1`                  | `ngspice-admitted-circuit@1.0.0` · execution · qualified                       | `casys.spice-worker`                     | One exact microVM runtime material. Dockerfile/source provenance stays server-internal bootstrap metadata, never a project or JIT material |
| `mechanics.observe-prescribed-kinematics@1`         | `chrono-prescribed-kinematics@1` · execution · unqualified                     | `casys.mcp-chrono`                       | Factual prescribed kinematics only; ARM64 use needs the exact emulated host attestation                                                    |

The table has thirteen mappings because the current catalogue has three separate SysON
bindings and four separate Build123d bindings. A different provider, profile, adapter,
unit, material, digest, or host effect is not an equivalent row: it is handled through
the server-derived proposal/amendment and, where method meaning changes, the existing
MRTR transition boundary.

Exact units, materials, declared effects, and planning rules are in the
[atomic runtime catalogue](atomic-runtime-catalog.md). The source of truth is
[`first-party-capability-binding-catalog.ts`](../../../../src/adapters/control-plane/first-party-capability-binding-catalog.ts),
not this table.
