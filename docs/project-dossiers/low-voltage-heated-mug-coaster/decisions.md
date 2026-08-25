# Low-voltage heated mug coaster — decisions

Audience: both · Diátaxis: none · Kind: tracking decisions

This file is **not** storage and **not** an MRTR. The agent must not self-approve.
Exact identities: [evidence.md](evidence.md).

`deno task start:yolo` persists fixed human origin `local-yolo:startup-opt-in` for
positive brief confirmations and decision approvals through canonical command
services. Recorded approvals on this project are `human/local-yolo`. That path is
not an execution or evidence shortcut and does not turn engine success into L5
([workspace map](../../reference/runtime/local-runtime-and-ports.md)).

Authority: [AGENTS.md](../../../AGENTS.md). Workbench / cockpit focus does not
decide.

## Recorded

| Decision | Owning authority | Identity | Bound | Not granted |
| -------- | ---------------- | -------- | ----- | ----------- |
| Confirmed brief | Canonical YOLO `human/local-yolo` | Brief `heated-mug-coaster-hc01:brief:r1:25097c9bcb733d52`; fingerprint `sha256:ec719d70fc7eaca462fe257540cb811e2dec94a551e00264fa6a812103c87057` | Documentary baseline Thread r1 | Requirements, CAD, physics, L5 |
| SysON seed | Canonical YOLO `human/local-yolo` | Decision fingerprint `sha256:9c27c6b608c6ab2821589f19481165dcf58e1d68acb551091ee1968de03ad9a8` | Thread r2 seed container | Architecture, requirements, or a model |
| Single-part architecture | Canonical YOLO `human/local-yolo` | Decision fingerprint `sha256:072f57a47f0e0d94d085ab9caa36aed99988a8f8d0a7da3c9e72832c0c8359fb` | Thread r3; package `HeatedMugCoasterPackage`; system `HeatedMugCoaster` | Components, attributes, requirements, CAD |

`project_start` created the project; it is not a human product-class selection.
Product class and intent remain agent-proposed ([README.md](README.md)).

## Pending

| Decision | Exact owning authority | Tool / record when live | Forbidden shortcut |
| -------- | ---------------------- | ----------------------- | ------------------ |
| Physical scenario and remaining [inputs.md](inputs.md) unknowns | Human intent | Sourced Q&A | Inventing values, units, materials, topology, or thresholds |
| Scalar requirements | Human MRTR | `project_brief_requirements_review` → `model.write-requirements@1` | Invented thresholds or units |
| Structure beyond the single system | Human MRTR | Later architecture review / `model.write-architecture@1` | Invented components or attributes |
| Canonical geometry subject and admission | Human MRTR | `compile.seal-admission@1` then `design.write-geometry@1` | Isolated Build123d as STEP |
| Static proof seal and `@3` run | Separate human MRTRs | `verify.seal-proof-case@1` then `verify.run-fea-static-proof@3` | Caller deck or historical catalog row |
| Mechanical L5 | Human, exact `@3` branch | `decide.accept-evaluation-closeout@1` / reject | Treating L4 `pass` as L5 |
| Thermal method and admitted run | Human MRTRs | `verify.seal-modelica-thermal-method-sheet@1`; `simulate.run-admitted-modelica@1` | Kit `@1`; invented `.mo`; OMC success as verdict |
| Thermal L4 / L5 | SysON L4 then human L5 | `verify.evaluate-admitted-modelica-observations@1` then accept/reject | Skipping L5 |
| Electrical method | Human, and only if a **generic** registered operation exists | None today (`unavailable`) | LED-driver fiche, `mcp-spice` `tools/call`, invented netlist |
| Impact change and independence | Human origin | `verify.seal-cross-domain-impact-manifest@1` then `decide.accept-cross-domain-impact@1` | Preservation by omitted edges; inventing X10 |
| Make / Buy | Out of this Behave canary | — | Opening DFM or BOM to “finish” |

Queue pattern for consequential registered ops
([agent workspace](../../reference/agent/agent-workspace.md)):

```text
project_change_append
  → project_decision_propose
  → project_decision_approve
  → project_agent_run_queue
  → project_agent_run_execute
```
