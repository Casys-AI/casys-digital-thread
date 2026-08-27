---
name: extend-engineering-capability
description: Implement a bounded, versioned extension to a repo-owned CAD, admitted Modelica, FEA, or generic SysML authority surface. Use when current documented coverage rejects the requested construct or physics; do not use for project data or models that already fit an existing surface.
---

# Extend an engineering capability

Apply one existing maintainer runbook to one bounded authority extension. The runbooks
and reference documentation remain normative; this skill routes the work and enforces
its completion boundary.

## Classify before editing

1. Read [`AGENTS.md`](../../../AGENTS.md).
2. Read [capability routes](references/capability-routes.md).
3. Select exactly one authority path, then read its current coverage and runbook
   completely.
4. Establish the exact current refusal or missing capability.

If the request already fits current coverage, stop this skill and route the work through
the normal project capture, compilation, MRTR, and execution workflow.

Before changing code, state:

- the exact construct, physics, or concept being added;
- accepted, boundary, and refused cases;
- units, limits, semantics, and explicit exclusions;
- versioning, migration, or retirement consequences;
- the single authority path and evidence needed to complete it.

If an unresolved choice would change sealed meaning, present that decision and stop
before implementation.

## Implement the selected authority slice

Follow the selected runbook rather than copying it into a second checklist.

- Trace the existing implementation and tests end to end before editing.
- Keep parser, analyzer, admission, lowering, worker, evidence, recovery, and
  publication on the same versioned authority where the selected route requires them.
- Keep provider, runtime, solver, image, arguments, and lowering server-owned.
- Update focused accepted, boundary, refused, replay, and ambiguity tests together with
  the implementation.
- Update normative coverage only after the runbook's complete authority chain is
  demonstrated.
- Preserve pre-existing worktree changes and keep unrelated paths outside the scope.

Do not fabricate provider-server changes when the required source is outside this
repository. Do not substitute an unregistered operation or a retired fixture.

## Validate and report

Run the focused checks required by the selected runbook and the applicable repository
source and documentation gates. Compare `git status --short` before and after
validation.

Report separately:

- implemented and tested stages;
- stages proven through the real pinned runtime;
- documentary-only evidence;
- `unresolved`, `unavailable`, or rejected coverage;
- external publication or activation still required.

## Stop conditions

Stop and report the exact boundary when:

- no existing route owns the requested capability;
- the request requires weakening or bypassing a closed contract;
- the required provider implementation is not present in this repository;
- source, profile, runtime, or evidence identities cannot be kept aligned;
- the real runtime or oracle needed for a completion claim is unavailable;
- publishing an OCI image or changing a live runtime was not explicitly authorized.

Never describe partial implementation or a successful isolated execution as completed
product coverage.
