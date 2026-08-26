---
name: admit-and-run-engineering-source
description: Capture, admit, and execute an existing Build123d, Modelica, or circuit-only SPICE source through a Casys Digital Thread project and its registered operations. Use when the project, source bytes, SysML target, and intended execution mode already exist. Do not use for product discovery, architecture authoring, running FEA, provider setup, arbitrary code execution, or post-run L4/L5 evaluation.
---

# Admit and run engineering source

Move existing closed-subset source through the current project authority. Preserve exact
bytes and identities. Never choose a provider, runtime, command, lowering, output path,
or unregistered operation.

## Establish the route

1. Read [`AGENTS.md`](../../../AGENTS.md), `project_snapshot`, and
   `project_source_workspace_snapshot`.
2. Require an approved project, a current Thread architecture, an exact `PartDefinition`
   or `PartUsage` target, exact source bytes, and one mode below.
3. If framing, architecture, target, or source authoring is still required, stop and
   route that work to `$guide-industrial-project`.
4. Inspect the currently exposed tools and registered operations. Do not start or
   restart services, import images, or alter runtime configuration unless the user
   requested runtime setup.

For CAD, select the authority before acting:

- use **canonical CAD** when STEP must feed Product, FEA, or DFM;
- use **isolated CAD** only for explicitly requested documentary microVM execution;
- if the intended authority is unclear, explain the distinction and ask before mutation.

Preparing canonical STEP for later FEA is in scope. Defining, sealing, and running the
FEA proof is a separate verification workflow.

## Read only the applicable documentation

Always read:

- [capture an agent resource](../../../docs/how-to/compile/capture-an-agent-resource.md);
- [author a project source workspace](../../../docs/how-to/compile/author-project-source-workspace.md).

Then read the selected route completely:

| Route                     | Required documentation                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical or isolated CAD | [CAD execution paths](../../../docs/reference/domains/cad/execution-paths.md)                                                                                                      |
| Modelica                  | [run admitted Modelica](../../../docs/how-to/run/run-admitted-modelica.md) and [admitted-source isolation](../../../docs/reference/pipeline/admitted-source-isolated-execution.md) |
| SPICE                     | [run admitted SPICE](../../../docs/how-to/run/run-admitted-spice.md) and [admitted-source isolation](../../../docs/reference/pipeline/admitted-source-isolated-execution.md)       |

Read the relevant language boundary only to inspect or correct a typed refusal:

- [Build123d closed subset](../../../docs/reference/domains/cad/build123d-closed-subset-v1.md);
- [Modelica language](../../../docs/reference/domains/modelica/language.md);
- [SPICE circuit closed subset](../../../docs/reference/domains/electrical/spice-circuit-closed-subset-v1.md).

Read [source gates](references/source-gates.md) before the first mutation. Read
[SPICE preflight](../../../docs/how-to/maintainers/preflight-spice-provider.md) only
when runtime preparation was explicitly requested.

## Capture and admit

Follow the two shared how-tos using exact current revisions and full returned
references:

1. Capture the exact source bytes once.
2. Put one bounded workspace root and attach it to the exact SysML element. For the
   active Build123d V1 direct closure, add only its exact direct scalar-leaf dependencies
   using the documented virtual-import form; do not create a generated file or choose a
   lowerer. Modelica and SPICE remain one executable root each.
3. Capture the unique active attachment head with `project_technical_source_capture`.
4. Preserve its opaque `result.reference`; do not reconstruct or reduce it.
5. Preview compilation using only the accepted public inputs and server-selected joins.
6. Continue only on literal `ready-for-review` with returned decision parameters.

Keep parser state, CAD levers, SysML bindings, compilation readiness, and admission as
separate facts. A Build123d closure gets the separate
`technical-unit:<closure sha256>` identity; its authored closure and attachment remain
the evidence. For a preview combining distinct capture locators, every locator must
share the exact project and workspace snapshot.

For `compile.seal-admission@3`, reuse existing durable work only when it is still exact.
Otherwise append the work item and required decision together. Pass returned decision
parameters verbatim to the decision proposal, obtain exact human approval, then queue
and execute the registered operation. Reread project state and the published Thread
successor before continuing.

## Run the selected route

- **Canonical CAD:** use `project_admitted_geometry_export`, then a separate
  human-reviewed `design.write-geometry@1` work item. Only its sealed STEP is canonical.
- **Isolated CAD:** use `project_build123d_execution_review` and its returned operation
  verbatim for a separately approved `design.execute-build123d@1` run. An optional
  `design.seal-isolated-geometry@1` has its own review and remains documentary.
- **Modelica:** call `project_admitted_modelica_run_review` with the documented public
  inputs and reuse its returned operation verbatim for a separately approved
  `simulate.run-admitted-modelica@1` run.
- **SPICE:** call `project_admitted_spice_run_review` with the documented public inputs
  and reuse its returned operation verbatim for a separately approved
  `simulate.run-admitted-spice@1` run.

Every consequential operation gets its own human MRTR. Never reuse a historical
admission creation snapshot as the current run binding.

## Finish

Report exact source, workspace, and attachment identities; parser and binding states;
each approved operation; the reread published result; unresolved conditions; and whether
the final authority is `canonical` or `documentary`.
