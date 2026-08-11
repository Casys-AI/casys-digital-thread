# Documentation

This repository uses the [Diátaxis](https://diataxis.fr/) framework: choose a page by
the job you are trying to do, rather than by the component you happen to know. The four
categories deliberately answer different questions.

## Tutorials — learn by doing

- [Run the first CoffeeMachine evidence](tutorials/coffee-machine-nominal.md) starts the
  stateless local services, creates a real Modelica run, reads its immutable structured
  evidence, and then follows its separate provisional scenario comparison.

## How-to guides — achieve a focused task

- [Run the CM-01 V3 golden path locally](how-to/run-cm01-v3-golden-local.md) starts a
  fresh isolated Compose topology without deleting retained evidence. It follows the
  documentary baseline and SysON seed into the five fixed CM-01 operations, then
  documents the bounded correction, identity recovery, and closeout path separately.
- [Recover a quarantined provider run](how-to/recover-a-quarantined-provider-run.md)
  covers the one path out of a dispatch the executor could not settle: inspect the
  provider, sign the seven-parameter reconciliation, execute it as a human, and requeue.
- [Preview the native digital-thread Workbench](how-to/preview-native-workbench.md)
  starts the single-shell Preact product surface, follows a project from its living
  brief into activity and evidence, and explains why the cockpit observes while the
  paired conversation controls bounded provider work.
- [Preview the MCP console in a local browser](how-to/preview-console.md) explains the
  `127.0.0.1:3021` harness, how to confirm that it is live, and what it intentionally
  does not do.
- [Add a result-viewer MCP App](how-to/add-mcp-app.md) scaffolds, builds, registers, and
  verifies a standard structured-result view without broadening its server grants.
- [Add a recorded analysis engine](how-to/add-a-recorded-analysis-engine.md) gives the
  short repeatable checklist for a qualified provider capability without giving agents a
  raw provider or plan-authoring surface.

## Reference — look up exact contracts and locations

- [MCP console reference](reference/console.md) documents the console resource, tools,
  evidence model, agent project-control tools, signed MRTR elicitation, and authority
  boundary.
- [Workspace map and local ports](reference/workspace-map.md) identifies the workflow,
  scenario-contract plan, observers, UI sources, generated bundle, harness, volumes, and
  every local endpoint.
- [Source analysis and authority pipeline](reference/analysis-authority-pipeline.md)
  separates native-language parsing, provider-neutral facts, human admission,
  inspectable lowering and private provider dispatch; it documents the recorded
  `resolved-operation-plan/2.0` vertical for qualified Modelica and CalculiX evidence,
  alongside the implemented CAD, approved-brief and bounded SysML verticals.
- [Providers, analyses, evidence and oracles](reference/provider-analysis-oracle-taxonomy.md)
  distinguishes engines such as CalculiX, SPICE, PrusaSlicer and ERP connectors from
  analysis families, evidence normalization, DFM rules and versioned verdict authority.
- [Building blocks and artifact ownership](reference/building-blocks.md) maps the MCP
  packages and engineering repositories to their code, images, manifests, dashboards,
  and evidence outputs.
- [Canonical ThreadSnapshot contract](reference/thread-snapshot.md) defines artifact
  identity, exact-byte consumption, observations, requirements, evaluations, violations,
  freshness, provenance, actions, explicit subject bindings, and the current persistence
  boundary.
- [EngineeringProjectSnapshot contract](reference/engineering-project.md) defines
  project intent, derived phases, human-agent work, decisions and approvals, blockers,
  execution runs, the fixed CM-01 V3 operation catalog, immutable revisions, command
  receipts, authority, and exact references into immutable thread evidence.
- [Living project brief](reference/project-brief.md) defines intent, guided questions,
  sourced answers, proposal versus canonical truth, exact human confirmation, the
  versioned V2 gate contract with its declared dependencies, and the approved-brief
  documentary baseline inside one project.
- [Mechanical proof case and its execution receipt](reference/mechanical-proof-case.md)
  defines the strict declaration schema, its limited identity binding, and the run that
  turns a sealed case into a published verdict — including the provenance every
  published run must satisfy.
- [Cross-tool component identity](reference/thread-components.md) defines the reviewed
  SysON PartUsage, build123d artifact, and ERPNext Item bindings used by the native
  **Parts** workspace, including visible trace gaps.
- [Native thread workflow YAML](reference/thread-workflows.md) documents the frozen DAG
  authoring prototype: reviewed grammar and typed bindings, no production caller.

## Explanation — understand why the boundaries exist

- [Product direction and delivery boundary](explanations/product-direction.md) is the
  canonical product compass: beginner-first human-agent work, idea/CAD/product entry
  points, vendor independence, and the verified-now/V1/V2 boundary.
- [CoffeeMachine verification architecture](reference/verification-architecture.md)
  explains the Modelica/SysON/CalculiX split and why the current comparison is a
  provisional scenario contract rather than a product requirement.
- [Proofs and verdicts](explanations/proofs-and-verdicts.md) explains why CAD, FEA,
  physical simulation, and constraint evaluation remain separate stages.
- [Industry positioning and state of the art](explanations/positioning.md) explains the
  executable-digital-thread and physics-in-the-loop framing.
- [Native digital-thread Workbench](explanations/native-digital-thread-workbench.md)
  records the accepted product direction: one linked thread model, one native Preact
  shell, explicit engineering execution, and MCP Apps only at host boundaries.
- [Lineage-feed Workbench UX](explanations/graph-workbench-ux.md) defines the live feed
  as the primary propagation view, the complete topology as a secondary view, and the
  five providers as contextual tool facets in one drawer.
- [Compliance evidence cases](explanations/compliance-evidence-cases.md) explains the
  target multi-jurisdiction architecture for versioned official sources, licensed
  standards, evidence reuse, and external certification boundaries, using EU UAS as the
  first sourced example.
- [The mcp-view component language](explanations/mcp-view-component-language.md)
  explains the ERPNext-derived visual baseline, Preact default, and component-only
  palette rule.

## Read the status labels literally

`succeeded` means that a simulation completed. `passed` or `failed` means a comparison
has been attached. The CoffeeMachine thermal comparison is a versioned **provisional
scenario contract** with one condition, `water_temperature_max >= 90 degC`; it is
neither a product requirement nor a requirement stored in a SysON project. The tracked
r5 CM-01 baseline has no model-owned mechanical criterion and therefore no product
verdict. The approved r6 DripTray extension instead contains two model-owned criteria
and two passing evaluations, bounded to that concept case. A demo fixture is always
labelled demo, and `unavailable`, `unresolved`, and `error` are evidence states, not
hidden successes.
