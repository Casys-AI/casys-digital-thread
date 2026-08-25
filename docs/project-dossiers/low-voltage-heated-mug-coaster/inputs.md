# Low-voltage heated mug coaster — inputs

Audience: both · Diátaxis: none · Kind: tracking inputs

**No engineering values.** Unknowns stay unknown. Do not fill them from typical
coasters, lamp fixtures, or CA02.

Brief contract: [living project brief](../../reference/contracts/project-brief.md).

## Human-sourced

| Item | Statement | Source | Still not established |
| ---- | --------- | ------ | --------------------- |
| `q-demo-scope` | `behave-portability-canary` | `conversation:2026-08-22:real-project-yolo` (human sourced) | Physical scenario, methods, and all rows below |

## Agent-proposed (tracked README)

Not a human product choice. Not `project_answer_record` except the scope row above.

| Item | Statement | Source | Still not established |
| ---- | --------- | ------ | --------------------- |
| Product class | A regulated low-voltage heated mug coaster | [README.md](README.md) (agent proposal) | Voltage, regulation, geometry, materials |
| Intent / role | Portability canary after the lamp reference demo | [README.md](README.md) (agent proposal) | Physical scenario |

Confirmed brief identity is a **decision**, not an additional sourced physical input
([decisions.md](decisions.md), [evidence.md](evidence.md)).

## Recorded architecture identity (not a physical input)

Architecture review resolved package `HeatedMugCoasterPackage` and system
`HeatedMugCoaster`. No components. No attributes. Structure **beyond** that
single-part identity remains unsourced.

## Unknown — current boundary

Unsourced. The agent must not invent a default.

| Topic | Why it matters | Owner of the answer |
| ----- | -------------- | ------------------- |
| Physical scenario | The confirmed scope is not a load case, thermal condition, or circuit test | Human intent |
| Structure beyond single-part identity | Components, attributes, and further PartDefinitions are absent | Human, via a later architecture proposal |
| Materials | Required before proof seal | Human + sourced fact |
| Geometry | Canonical STEP needs admitted source | Human + sourced fact |
| Supports | FEA selections are not invented | Human + sourced fact |
| Loads | FEA loads are not invented | Human + sourced fact |
| Thermal boundary and criterion | Required before a `.mo` is authored. OMC is not the method | Human + sourced fact |
| Electrical topology | Required before any future generic electrical method. Product operation is `unavailable` | Human + sourced fact |
| Values, units, and thresholds | No invention. Existing brief `MPa` → `Pa` rescale is the only code-owned unit rewrite | Human-approved brief items |

Physical blanks park only the dependent live evidence.
