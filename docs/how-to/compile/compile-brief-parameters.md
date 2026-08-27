# How-to: compile an approved brief into MRTR parameters

Audience: agent · Diátaxis: how-to · Kind: how-to

Use this when an agent must turn reviewed brief criteria into the exact parameters of
`model.write-architecture@1` or `model.write-requirements@1`, instead of typing the
envelope by hand.

This is **not** brief authoring. `project_brief_propose` and `project_brief_confirm`
write and approve the brief; these two surfaces only read the already-approved one. They
are read-only: no registered operation runs, no project or Thread state changes, no MRTR
is created.

## Preconditions

- Digital Thread MCP is running (`deno task start` or `deno task dev`).
- The project already has a **human-approved canonical brief**. Without it both tools
  fail with `brief_not_approved`; nothing in the request can substitute for it, because
  the server reopens the brief from project truth and never accepts brief bytes.

## What the caller may name, and what it may not

| The caller names                                  | The server owns                                  |
| ------------------------------------------------- | ------------------------------------------------ |
| The target component, package, system, slugs      | Parameter keys, labels, the whole envelope shape |
| The reviewed scalar values and their units        | Unit admissibility and any unit normalisation    |
| The exact brief item that states each declaration | Which item kinds may state what, and the grammar |

## Provenance rules

Every emitted parameter records the brief item it was traced to. Which items qualify
depends on what is being stated:

- **A requirement threshold is normative.** It may only cite a `success-criterion` or a
  `verification-activity`. Citing an assumption, a constraint or an exclusion is refused
  as `brief-item-not-normative` — that would dress a non-binding statement as a signed
  requirement.
- **An architecture element is not a gate.** It only has to be sourced, but it may never
  cite an `exclusion` or an `open-question`: those declare what is out of scope or still
  undecided, so making one the provenance of a retained component inverts its meaning
  (`brief-item-not-committing`).
- **The requirements container component** only has to be sourced. It names where the
  requirements are anchored; it is not itself normative.
- Every cited item must carry at least one `sourceRefs` entry (`brief-item-unsourced`).

## Requirements

```jsonc
// project_brief_requirements_review
{
  "projectId": "desk-lamp-dl04",
  "containerComponent": "ArticulatedArm",
  "containerSourceItemId": "mission",
  "requirements": [{
    "slug": "arm-displacement",
    "name": "Maximum arm displacement",
    "metric": "arm_max_displacement",
    "operator": "<=",
    "threshold": 5,
    "unit": "mm",
    "sourceItemId": "mechanical-verdict"
  }]
}
```

A resolved result returns the canonical `decisionParameters` plus one provenance entry
per parameter:

```text
requirements.containerComponent          = ArticulatedArm
requirement.arm-displacement.name        = Maximum arm displacement
requirement.arm-displacement.metric      = arm_max_displacement
requirement.arm-displacement.operator    = <=
requirement.arm-displacement.threshold   = 5 mm
    ← mechanical-verdict (success-criterion)
```

### Units

A threshold declared in `MPa` is rescaled to `Pa` and the provenance entry names the
step as `transformation: "MPa-to-Pa"`; every other unit passes through as `identity`.
Any unit outside the server-owned allowlist is refused by the grammar itself. See
[Oracle units](../../reference/providers/oracle-units.md) for why `MPa` cannot be native and why the
conversion is done here rather than left to the agent.

## Architecture

```jsonc
// project_brief_architecture_review
{
  "projectId": "desk-lamp-dl04",
  "packageName": "DeskLampDL04",
  "packageSourceItemId": "objective",
  "systemName": "DeskLamp",
  "systemSourceItemId": "mission",
  "components": [
    {
      "slug": "arm",
      "name": "ArticulatedArm",
      "usage": "articulatedArm",
      "sourceItemId": "mission"
    },
    {
      "slug": "base",
      "name": "Base",
      "usage": "base",
      "parent": "DeskLamp",
      "sourceItemId": "environment"
    }
  ]
}
```

Component, attribute and requirement slugs follow the shared proposal-parameter grammar
(`^[A-Za-z0-9][A-Za-z0-9_-]*$`): hyphens are allowed because the slug is a grouping key,
not a SysML identifier. Dots and colons are refused: they would make the dotted key
ambiguous. SysML identifiers remain `packageName`, `systemName`, `name` and `usage`.

Omit `parent` and the production parser anchors the component to `system.name`. A parent
that names neither the system nor another declared component is refused by the grammar,
along with cycles and duplicate usages under one parent.

Zero `components` is a single-part system: the system name is the unique PartDefinition.
Optional `attributes` compile `attribute.<slug>.name` / `attribute.<slug>.parent` for
later unique `parameterizes` joins.

```jsonc
{
  "projectId": "cantilever-arm-ca01",
  "packageName": "Cantilever",
  "packageSourceItemId": "objective",
  "systemName": "CantileverArm",
  "systemSourceItemId": "mission",
  "components": [],
  "attributes": [{
    "slug": "thickness",
    "name": "thickness",
    "parent": "CantileverArm",
    "sourceItemId": "constraint-thickness"
  }]
}
```

## Reading an unresolved result

`status` is `unresolved` whenever anything was refused, and **no** `decisionParameters`
are returned — there is no partially compiled proposal. Do not reconstruct the envelope
by hand from an unresolved review; fix the declaration against the brief and call again.

Diagnostics name a **root cause, never its consequence**: the grammar check only runs on
an otherwise clean set, so a missing brief item yields exactly `brief-item-absent` and
not an extra grammar complaint about the parameters that item would have produced.

```text
status: unresolved
→ brief-item-not-normative | Brief item "assumption-safety-factor" has kind assumption;
  only a success-criterion or a verification-activity states a normative requirement.
```

## What these tools do not decide

The brief carries free-text statements. The server never reads that prose, so it never
asserts that a declared value restates its item. It records **where the value came
from**; the human confirms **what it says** when signing the MRTR.

So the review is one step, not the step:

```text
project_brief_*_review        # here: parameters + provenance, no authority
project_change_append         # phase, work item, required decision
project_decision_propose      # the returned decisionParameters, verbatim
project_decision_approve      # human MRTR — the values are confirmed here
project_agent_run_queue / _execute
```

## See also

- [Agent workspace](../../reference/agent/agent-workspace.md) — the surfaces and their grants.
- [Oracle units](../../reference/providers/oracle-units.md) — admissible units and the temperature
  gap.
- [Author architecture SysML](author-architecture-sysml.md) — the other, provider-free
  SysML path, which seals a Thread document instead of feeding a SysON write.
