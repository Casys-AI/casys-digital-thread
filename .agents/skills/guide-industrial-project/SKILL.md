---
name: guide-industrial-project
description: Guide a person from a plain-language industrial product idea to a reviewable engineering brief, explicit assumptions, decision proposals, planned verification, and manufacturing-cost evidence. Use for new-product discovery, unclear specifications, required project decisions, CAD or simulation trade-offs, beginner guidance, or whenever the paired conversation needs to advance a Casys engineering project.
---

# Guide an industrial project

Turn an intent into reviewable project truth without asking the human to invent
technical payloads. Treat the human as the owner of intent and approval; let tools
provide observable engineering facts.

## Start from the current truth

1. For an existing project, read `project_snapshot` before asking questions.
2. For a new idea, call `project_start` immediately with the reported intent. The
   project exists from that first revision; restate the intended outcome as provisional
   framing and do not silently promote it to a requirement or approved brief.
3. Inspect available engineering evidence and tools before asking for facts which CAD,
   SysML, simulation, ERP, supplier, or regulatory sources can establish.
4. Separate every statement into one of: human intent, observed fact, calculated result,
   external evidence, provisional assumption, or approved decision.

Use `project_question_propose` for a durable guidance question and
`project_answer_record` for its sourced answer. Use `project_brief_propose` only when
the current framing is coherent enough to review. The pending proposal is not the
canonical brief until `project_brief_confirm` succeeds through exact human elicitation.

## Conduct an adaptive interview

Ask one question at a time unless two questions are inseparable. Start with mission and
operating context; derive technical questions only after those answers make them
relevant. Do not run a fixed domain questionnaire.

Every question must include:

- the plain-language question;
- why the answer matters now;
- a recommended answer or bounded options when defensible;
- the consequences of the recommendation and alternatives;
- an explicit `I don't know` path;
- whether the answer is reversible, blocking, safety-critical, or regulatory.

When the human does not know:

- adopt a clearly labelled provisional assumption only when it is low-risk and
  reversible;
- keep high-impact, safety, compliance, or expensive choices unresolved;
- identify the tool result, test, supplier quote, standard, or expert review needed to
  resolve them.

Read [question-and-evidence-contract.md](references/question-and-evidence-contract.md)
when preparing question cards, a project brief, or cost evidence.

## Prepare decisions for review

Use `project_decision_propose` only when a declared decision has a concrete, typed
recommendation. Bind it to the exact project revision and evidence exposed by the
control plane. Explain assumptions and downstream impact in the proposal summary.

Never decide on the human's behalf, impersonate a reviewer, or manufacture evidence to
unblock a run. When an exact consequential decision needs human authority, call the
corresponding confirmation tool: MCP elicitation asks in the paired conversation and
only its verified retry records the human outcome.

For a project whose canonical brief is approved but has no technical baseline, use
`project_plan_publish` to declare the smallest bounded path, its registered operations,
and any genuinely required decisions. Never invent an operation identifier,
provider/tool name, raw provider argument, script, file path, or technical evidence in
that plan. Once a registered work item is ready, use `project_agent_run_queue`; the
server derives its run id, summary and exact basis. The agent may then execute that
bounded operation. A plan never grants permission to invent an operation or bypass a
still-unresolved human decision.

After the documentary baseline has produced a `ThreadSnapshot`, use the agent-only
`project_change_append` command for the next bounded change. Read `project_snapshot`
first and bind the change to its exact current `baseSnapshot`. A change can add only new
phases, work items, and required decisions: it must not rewrite prior work, decisions,
runs, evidence, or snapshots. Use registered operations only. `baseSnapshot` is the
change's provenance anchor, not a V2 run input; queueing still derives the run's exact
`basis` from durable project state.

If a needed decision has not been declared outside that unexecuted planning state,
present it as a proposed question until the control plane offers an authorized way to
persist it.

## Plan the engineering loop

Treat the plan as the starting point of a feedback loop, not a linear checklist:

```text
bounded operation -> observed/calculated evidence -> impact evaluation
                  -> correction or recomputation proposal -> human review when consequential
```

The agent may revise a plan that has not begun execution when new framing information
changes the best next step. Once a run, approval, or technical evidence exists, preserve
that history and propose the next bounded change instead of rewriting it.

For each approved objective, derive the smallest useful loop:

1. parameterize or import a source artifact with provenance and license;
2. generate an exact CAD revision and content fingerprint;
3. run the relevant physical or behavioural verification against explicit inputs;
4. evaluate named requirements with units and margins;
5. update the design or escalate an unresolved trade-off **only on a real
   study-base fail**;
6. present only the consequential choices for human review.

Stop on a joined `pass`. Do not open make (DFM / printability) or buy (BOM /
cost) to complete the behave loop. Those are later branches on the same
canonical STEP. Script:
[run the behave loop from zero](../../../docs/how-to/verify-design/verify-a-new-design-from-scratch.md).

For the currently registered generic physical chain, the reviewed vocabulary is
`model.write-architecture@1`, `model.write-requirements@1`, `design.write-geometry@1`,
`verify.seal-proof-case@1`, then `verify.run-fea-static-proof@3`. Historical MCP FEA
`@1`/`@2` are not registered. Treat this list as discoverable server state: re-read the
operation catalogue before planning and never substitute a retired product-specific
identifier.

Downloaded geometry is a starting artifact, not automatically a parametric or
manufacturable model. Prefer editable source geometry; otherwise record the conversion
and any lost design intent.

## Propose corrections from measured sensitivities

When a requirement fails and a correction is needed, look for sensitivity-study
observations in the project's thread before proposing a parameter change. A recorded
sensitivity study publishes a measured derivative with its unit, base point, step and
declared limitations. Cite that derivative and its neighbourhood when proposing the
bounded correction — never propose a magnitude from intuition when a measured
sensitivity exists. If none exists for the relevant parameter, first inspect the current
registered-operation catalogue. Propose a new study only when the server actually
exposes a reviewed generic operation; never invent an operation id or supply its
parameter, step, mesh, or metrics from the conversation.

A sensitivity result is data, not a verdict: it never satisfies a requirement by itself,
and the proposed correction must still be recomputed and re-evaluated through the normal
verification loop after human approval.

## Read refusals as information

Some typed refusals from registered operations carry meaning the agent must surface
rather than work around:

- `requirements_artifact_removed` — a prior revision anchored the requirements in the
  model and the current basis no longer carries them. The model's requirement anchoring
  was weakened; escalate to the human. Never retry, and never propose bypassing the
  check.
- A fidelity refusal from the requirements verification means the SysML model no longer
  matches the reviewed thresholds — someone changed the model outside the reviewed path.
  Same rule: surface it, do not work around it.
- `error` and `unresolved` evaluation statuses are first-class published states, not
  failures to retry. Present them as "the oracle could not decide", with whatever the
  status carries; never re-run in the hope of a pass, and never treat them as pass or
  fail.

## Report cost honestly

Never call a cost exact merely because an ERP BOM exists. Distinguish:

- observed supplier quote;
- calculated quantity or mass;
- configured rate or catalogue price;
- parametric estimate;
- unknown cost.

Include currency, quantity, date, manufacturing process, waste/scrap assumption,
tooling, labor, overhead, and excluded costs when they affect the conclusion. A cost
claim is review-ready only when its sources and assumptions are inspectable.

## Route compliance by jurisdiction

Ask where the product is intended to be manufactured, supplied, and operated; these may
be different jurisdictions. Do not ask a beginner to select a legal category or
certification path. Derive candidate applicability from the intended use, then explain
it for review.

For every candidate obligation, record the jurisdiction, issuing authority, exact
source, publication or effective date, applicability rationale, and evidence still
needed. Distinguish binding law, technical standard, authority guidance, and internal
design criteria. Use current primary sources. Treat paid or licensed standards as
metadata until authorized text is available; never reconstruct or copy them from
unofficial sources.

Build a traceable compliance case, not a certification claim. Authorities, notified
bodies, accredited laboratories, or other designated reviewers retain their roles.

## Finish each pass

Return a compact state update containing:

- what the agent learned;
- assumptions still in force;
- the next best question or proposed decision;
- work this answer unlocks;
- evidence still required;
- whether human review is needed now.

Persist proposals, confirmations and results through the control plane. The paired
conversation is the command and decision surface; the read-only Workbench is the
durable, live projection where the person can inspect the organized dossier, lineage and
evidence without repeating the same action in a second interface.
