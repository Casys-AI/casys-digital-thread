# Reference: living project brief

> **Diátaxis category: reference.** This page describes the schema-`3.0` framing
> contract implemented by
> [`src/domain/project-brief.ts`](../../src/domain/project-brief.ts) and stored inside
> each immutable `EngineeringProjectSnapshot` revision.

A project exists from the first reported intent. There is no pre-project aggregate,
Discovery page, or handoff in the current product contract. The paired conversation is
the authoring and review surface; the cockpit's **Project** tab is its passive, live
projection.

## Truth model

`framing.intent` records what the person or an exact document reported and who persisted
it. Questions are agent guidance, not requirements. Answers always cite a human, tool,
document, or expert source and may explicitly remain unknown.

The brief uses stable semantic item kinds such as objective, mission scenario, success
criterion, constraint, exclusion, jurisdiction, compliance target, observed fact,
assumption, open question, and proposed decision. Every item cites at least one source.
An assumption also names its owner and review trigger; an observed fact must cite a
tool, document, or expert rather than agent prose.

`currentBrief` is the latest human-approved canonical intent. `proposedBrief` is a newer
agent proposal. The latter never overwrites the former until the person confirms the
exact brief snapshot, revision, and SHA-256 fingerprint through signed MCP elicitation.
A rejection preserves the current canonical brief and leaves the proposed revision
visible for correction.

## MCP surface

| Tool                       | Authority         | Effect                                                                           |
| -------------------------- | ----------------- | -------------------------------------------------------------------------------- |
| `project_start`            | Agent or human    | Create revision 1 immediately from plain-language intent                         |
| `project_snapshot`         | Read              | Read the complete immutable project revision                                     |
| `project_question_propose` | Agent             | Add one adaptive question, recommendation, consequences, risk, and evidence need |
| `project_answer_record`    | Agent or human    | Record one sourced answer or explicit unknown                                    |
| `project_brief_propose`    | Agent             | Add an immutable review proposal without changing canonical intent               |
| `project_brief_confirm`    | Human elicitation | Promote only the exact accepted proposal to canonical brief                      |

Every mutation has a stable command ID, optimistic `expectedRevision` after project
creation, and stable issue time. An identical retry is idempotent; another payload under
the same command ID or a stale project revision fails closed.

## Boundary with MBSE and evidence

The brief owns stakeholder intent and project framing. Formal requirements,
architecture, geometry, simulation, measurements, requirement evaluations, BOM facts,
and certification evidence remain in their linked SysML/provider records and immutable
`ThreadSnapshot` evidence. The brief may cite those facts; it must not copy an agent
guess back as an observed result.

After approval, `project_plan_publish` binds the first reviewed path to the exact
approved brief. `baseline.from-approved-brief@1` then materializes a content-addressed
documentary baseline. That record proves which brief and plan were used; it is not
technical evidence by itself.

The generic V3 bootstrap is deliberately additive and exact:

```text
human-approved living brief
  -> baseline.from-approved-brief@1
  -> documentary ThreadSnapshot r1
  -> architecture.seed-syson-model@2
  -> syson-model-seed-capture/2.0 + ThreadSnapshot r2
```

The r2 record proves only the identity of the editable SysON container. It is not
geometry, physical analysis, cost, compliance, or a verified requirement verdict. The
generic route intentionally stops here: later technical work needs a sourced, reviewed
definition and its own operation/evidence contract.

The current technical reference is the fixed `coffee-machine-cm01-v3` catalog. It uses
the same approved-brief and exact-basis discipline, then executes reviewed CM-01
architecture, CAD, thermal, BOM, and isolated DripTray proof operations. Its bounded
28 mm → 30 mm correction has a separate R11 identity recovery and R12 closeout; see the
[CM-01 V3 golden-run guide](../how-to/run-cm01-v3-golden-local.md). This is evidence for
one product case, not a generic authoring capability.
