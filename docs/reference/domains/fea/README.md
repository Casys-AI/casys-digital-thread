# Domain reference: FEA

Audience: both · Diátaxis: reference · Kind: domain map

This directory describes the **finite-element-analysis domain owned by Digital Thread**.
It does not describe every capability of the CalculiX engine. A native CalculiX feature
is not a product capability until a versioned case, lowering, validator and registered
operation admit it.

| Read                                                    | Contract                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Mechanical proof case V1](mechanical-proof-case-v1.md) | Reviewed linear-static assumptions and limits; sealing is not solving           |
| [CalculiX static proof V3](calculix-static-proof-v3.md) | Server-owned lowering, isolated execution, outputs, SysON evaluation and replay |

## Boundary in one view

```text
catalog case -> seal MRTR -> mechanical-proof-case/1.0 Thread document
                                      |
canonical STEP + separate run MRTR ----+
                                      v
                 verify.run-fea-static-proof@3
                    | local Gmsh + CalculiX
                    v
             observations + SysON evaluations
```

The agent proposes and executes registered operations. It does not author a proof JSON,
choose a catalog case, write a CalculiX `.inp`, or select solver commands and arguments.
The human signs consequential decisions; the server owns catalog resolution, profiles,
lowering and recovery.

Shared references:

- [Compile FEA seal and run parameters](../../../how-to/compile/compile-fea-parameters.md)
- [FEA lookalike traps](../../agent/lookalike-traps.md#fea-sensitivity-correction)
- [Compilation and isolation](../../pipeline/compilation-and-isolation.md)
- [Proofs and verdicts](../../../explanations/product/proofs-and-verdicts.md)
