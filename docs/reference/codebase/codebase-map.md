# Reference: codebase map

Audience: agent · Diátaxis: reference · Kind: contract

Stable file-census index. Loopback ports, YOLO, server-park names, and runtime ownership
stay in [local runtime and ports](../runtime/local-runtime-and-ports.md). Isolation pattern:
[admitted source isolated execution](../pipeline/admitted-source-isolated-execution.md).
Compiler and isolation narrative:
[compilation and isolation](../pipeline/compilation-and-isolation.md).

Entry contracts: [AGENTS.md](../../../AGENTS.md),
[validate a source checkout](../../how-to/setup/validate-a-source-checkout.md), and
[docs/README.md](../../README.md).

Business coverage stays on [engineering domains](../domains/README.md). This index does
not repeat that catalogue.

## Census pages

| Page                                                                                      | Owns                                                                 |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [Foundation and composition](../codebase/foundation-and-composition.md)                 | Entry docs, kernel primitives, hexagonal port roots, shared adapters |
| [Project, Thread, and record](../codebase/project-thread-record.md)                     | Project ledger, Thread snapshot, brief, record reconciliation, source workspace |
| [Resource ingress](../codebase/resource-ingress.md)                                     | Generic agent-resource envelope and draft CAS                        |
| [Compile](../codebase/compile.md)                                                       | Admission, source analysis, ROP, shared isolation runner             |
| [SysML architecture and requirements](../codebase/sysml-architecture-requirements.md)   | Renderer, agent-seal, seed, requirements, part definitions           |
| [CAD](../codebase/cad.md)                                                               | Isolated Build123d, isolated-geometry seal, canonical geometry       |
| [Mechanism](../codebase/mechanism.md)                                                   | Prescribed case, L3 one-dispatch recovery, L4/L5 evidence             |
| [Modelica](../codebase/modelica.md)                                                     | Admitted run, qualified kit, retired recorded island                 |
| [FEA](../codebase/fea.md)                                                               | Proof-case seal and isolated CalculiX `@3`                           |
| [Sensitivity](../codebase/sensitivity.md)                                               | Study, edges, base evaluation, vector correction, live-FEA           |
| [Electrical and SPICE](../codebase/electrical-spice.md)                                 | LED-driver human-fiche slice listed in the census                    |
| [Impact](../codebase/impact.md)                                                         | Manifest, X07, X09, X11 preservation                                 |
| [Make and DFM](../codebase/make-dfm.md)                                                 | DFM case and check files                                             |
| [Workbench, control plane, and desktop](../codebase/workbench-control-plane-desktop.md) | Read-only Workbench, Console, Desktop packaging                      |
| [Persistence roots](../codebase/persistence-roots.md)                                   | `state/fixtures/` and gitignored `state/local/`                      |

## Compilation and isolation

The former inline spine is not recopied here. Unique Build123d composition states, the
generation-0 gate, and host-trust limits live on
[compilation and isolation](../pipeline/compilation-and-isolation.md). Compiler file
locations live on [compile](../codebase/compile.md). `state/local/` roots live on
[persistence roots](../codebase/persistence-roots.md).
