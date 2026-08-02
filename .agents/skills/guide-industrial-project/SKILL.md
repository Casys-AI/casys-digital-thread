---
name: guide-industrial-project
description: Guide a person from a plain-language industrial product idea to a reviewable engineering brief, explicit assumptions, decision proposals, planned verification, and manufacturing-cost evidence. Use for new-product discovery, unclear specifications, required project decisions, CAD or simulation trade-offs, beginner guidance, or whenever the Casys Engineering Workbench is waiting for human review.
---

# Guide an industrial project

Turn an intent into reviewable project truth without asking the human to invent
technical payloads. Treat the human as the owner of intent and approval; let tools
provide observable engineering facts.

## Start from the current truth

1. For an existing project, read `project_snapshot` before asking questions.
2. For a new idea, restate the intended outcome as a provisional brief. Do not
   silently promote it to a requirement or approved project.
3. Inspect available engineering evidence and tools before asking for facts which
   CAD, SysML, simulation, ERP, supplier, or regulatory sources can establish.
4. Separate every statement into one of: human intent, observed fact, calculated
   result, external evidence, provisional assumption, or approved decision.

If the control plane cannot yet persist a new project or question, say so. Keep the
draft in the response instead of disguising it as canonical state.

## Conduct an adaptive interview

Ask one question at a time unless two questions are inseparable. Start with mission
and operating context; derive technical questions only after those answers make them
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
- identify the tool result, test, supplier quote, standard, or expert review needed
  to resolve them.

Read [question-and-evidence-contract.md](references/question-and-evidence-contract.md)
when preparing question cards, a project brief, or cost evidence.

## Prepare decisions for review

Use `project_decision_propose` only when a declared decision has a concrete,
typed recommendation. Bind it to the exact project revision and evidence exposed by
the control plane. Explain assumptions and downstream impact in the proposal summary.

Never approve or reject a decision, impersonate a human reviewer, queue work without
explicit human authorization, or manufacture evidence to unblock a run. If a needed
decision has not been declared, present it as a proposed question until the control
plane offers an authorized way to persist it.

## Plan the engineering loop

For each approved objective, derive the smallest useful loop:

1. parameterize or import a source artifact with provenance and license;
2. generate an exact CAD revision and content fingerprint;
3. run the relevant physical or behavioural verification against explicit inputs;
4. evaluate named requirements with units and margins;
5. update the design or escalate an unresolved trade-off;
6. produce a BOM and cost view whose evidence class is explicit;
7. present only the consequential choices for human review.

Downloaded geometry is a starting artifact, not automatically a parametric or
manufacturable model. Prefer editable source geometry; otherwise record the conversion
and any lost design intent.

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

Ask where the product is intended to be manufactured, supplied, and operated;
these may be different jurisdictions. Do not ask a beginner to select a legal
category or certification path. Derive candidate applicability from the intended
use, then explain it for review.

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

Persist proposals through the control plane when available so the Workbench, not the
chat transcript, remains the durable review surface.
