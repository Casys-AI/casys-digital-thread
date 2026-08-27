# Low-voltage heated mug coaster — tracking index

Audience: both · Diátaxis: none · Kind: tracking index

**Agent-proposed** product class and intent (this README). Not a human product
choice. This folder is documentation only.

Primary atelier, **2026-08-22**, local: current `EngineeringProjectSnapshot` is
project revision 29,
`heated-mug-coaster-hc01:project:r29:23da822e32f1ae06`. Human-sourced answer
`q-demo-scope` = `behave-portability-canary`. Confirmed brief, documentary Thread r1,
SysON seed Thread r2 (container, not architecture), generic single-part architecture
Thread r3, and exact PartDefinition reread Thread r4. The r4 bundle contains only
`HeatedMugCoaster`, with no usages. The exact execution retry returned the same project
r29 / Thread r4 and did not append evidence. No requirements, components, attributes,
CAD, FEA, Modelica, electrical, impact, verification, certification, Make, or Buy.
Cockpit primary focus revision 4 is projection selection only. Identities:
[evidence.md](evidence.md).

## Why this product class

The articulated LED desk lamp remains the reference demo
([lamp index](../articulated-led-desk-lamp/README.md)). This canary is a **different**
product so portability is actually tested: same generic versioned paths, no
product-specific TypeScript, config row, or catalog.

The class is a regulated low-voltage heated mug coaster because the same generic
surfaces can eventually be exercised **after** the still-unsourced physical
inputs exist.

| Surface | Recorded on this project? | Generic path |
| ------- | ------------------------- | ------------ |
| Structure and scalar requirements | Single-part architecture plus exact PartDefinition reread: package `HeatedMugCoasterPackage`, system `HeatedMugCoaster`, no components, usages, or attributes. Requirements unperformed | Renderer `model.write-architecture@1`; reread `model.capture-part-definitions@1`; `model.write-requirements@1` not run. Not agent-authored SysML as SysON authority ([SysML coverage](../../reference/domains/sysml/coverage.md)) |
| Canonical geometry | No | `project_technical_source_capture` → `compile.seal-admission@1` → `project_admitted_geometry_export` → `design.write-geometry@1`. Isolated Build123d is not canonical ([CAD execution paths](../../reference/domains/cad/execution-paths.md)) |
| Static mechanics | No | `mechanical-proof-case-source/1.0` → `verify.seal-proof-case@1` → `verify.run-fea-static-proof@3` ([FEA coverage](../../reference/domains/fea/coverage.md)) |
| Admitted thermal | No | `modelica-closed-subset-v2` → `compile.seal-admission@1` → `simulate.run-admitted-modelica@1`. Not the kit ([Modelica coverage](../../reference/domains/modelica/coverage.md)) |
| Electrical evidence | No. Product operation `unavailable` | Do not use the LED-driver fiche or `mcp-spice` as a registered run ([electrical](../../reference/domains/electrical/README.md)) |
| Cross-domain impact | No | `cross-domain-impact-manifest/1.0` path; X10 `unavailable` ([impact coverage](../../reference/domains/impact/coverage.md)) |

Do not invent values, units, materials, thresholds, parts, circuits, or standards.

## Bounded demo story

Stay on the **Behave** branch. Do not open Make or Buy to “finish”
([three judgement branches](../../explanations/product/product-direction.md#three-judgement-branches)).

Recorded scope: `behave-portability-canary`. Current architecture identity is one
system, no components. Physical scenario, further structure, materials, geometry,
supports, loads, thermal boundary and criterion, electrical topology, values, units
and thresholds remain **unsourced**. Generic electrical product operation is
`unavailable`. A successful engine run is not an oracle and not L5. This is not
certification.

## Pages

| Page | Owns |
| ---- | ---- |
| [status.md](status.md) | Truth columns; ticks stop at single-part architecture |
| [inputs.md](inputs.md) | One human-sourced scope answer; remaining inputs unknown |
| [decisions.md](decisions.md) | Recorded YOLO approvals vs pending |
| [evidence.md](evidence.md) | Exact identities. Not storage |

## Hard stops

- No mug-specific parser, catalog, fixture identity, or config file.
- No SysML/CAD/Modelica/netlist text invented for a renderer or solver path.
- No `latest`, alias, or caller-selected runtime
  ([AGENTS.md](../../../AGENTS.md)).
- Labels stay literal. A successful engine run is not an oracle and not L5.
