# Documentation

This repository uses the [Diátaxis](https://diataxis.fr/) framework: choose a page by
the job you are trying to do, rather than by the component you happen to know. The four
categories deliberately answer different questions.

Coding and project-control agents start at [AGENTS.md](../AGENTS.md) and the
[agent workspace reference](reference/agent-workspace.md). Those pages list lookalike
operations, exact tool grants, and code-placement rules. They are written to be parsed,
not paraphrased.

## Tutorials — learn the loop once

- [Follow the engineering loop](tutorials/first-engineering-loop.md) walks a person and
  a paired agent from plain-language intent to inspectable evidence. The cockpit
  observes; the conversation commands.
- [Run the behave loop from zero](how-to/run-the-behave-loop-from-zero.md) is the
  live script for a **new** project on the behave branch only. It lists the
  typed refusals that replace unharnessed shortcuts. Do not replay dl05.

## How-to guides — achieve a focused task

- `desk-lamp-dl04` / `desk-lamp-dl05` are the generic / Heron vehicles. A
  `verify.run-fea-static-proof@2` success is only a captured, reread Thread revision
  (local `state/local/`, gitignored). Absence is `unavailable`. Do not relabel `@1`.
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
- [Author and seal architecture SysML](how-to/author-architecture-sysml.md) captures
  agent-authored closed-subset SysML, previews unresolved constructs, and seals a Thread
  document without inserting into SysON.
- [Walk the post-proof loop](how-to/walk-the-post-proof-loop.md) is the **behave**
  continuation after FEA: join study-base observations, apply a correction only
  on a real fail, capture `z*`, reseal. Measured DFM is the separate **make**
  branch. Historical `desk-lamp-dl05` r16 is `UNLINKED`; a later join on that
  atelier can be `pass`. Those labels stay.
- [Product direction](explanations/product-direction.md#three-judgement-branches)
  names the three judgement branches (behave / make / buy). One STEP, no
  cross-verdict.

## Legacy and golden records — audit, not operation

- [CM-01 V3 archived golden dossier](legacy/cm01-v3.md) is the sole documentation entry
  point for the static fixture and immutable historical records. It describes no active
  code or runnable path.

## Reference — look up exact contracts and locations

- [Agent workspace](reference/agent-workspace.md) is the compact contract for agents:
  authority, lookalike traps, tool and operation catalogues, frontend profiles, and
  where to put code.
- [MCP console reference](reference/console.md) documents the console resource, tools,
  evidence model, agent project-control tools, signed MRTR elicitation, and authority
  boundary.
- [Workspace map and local ports](reference/workspace-map.md) identifies the workflow,
  observers, UI sources, generated bundle, harness, volumes, and every local endpoint.
- [Source analysis and authority pipeline](reference/analysis-authority-pipeline.md)
  separates native-language parsing, provider-neutral facts, human admission,
  inspectable lowering and private provider dispatch; it documents the recorded
  `resolved-operation-plan/2.0` vertical for qualified Modelica and CalculiX evidence,
  alongside the implemented CAD, approved-brief, bounded renderer SysML, and
  agent-authored architecture SysML verticals.
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
  execution runs, registered generic operations, immutable revisions, command receipts,
  authority, and exact references into immutable thread evidence.
- [Living project brief](reference/project-brief.md) defines intent, guided questions,
  sourced answers, proposal versus canonical truth, exact human confirmation, the
  versioned V2 gate contract with its declared dependencies, and the approved-brief
  documentary baseline inside one project.
- [Mechanical proof case and its execution receipt](reference/mechanical-proof-case.md)
  defines the strict declaration schema, the distinct seal and execution authorities,
  and the run that turns a sealed case into a published verdict — including the
  provenance every published run must satisfy.
- [Cross-tool component identity](reference/thread-components.md) defines the reviewed
  SysON PartUsage, build123d artifact, and ERPNext Item bindings used by the native
  **Parts** workspace, including visible trace gaps.
- [Native thread workflow YAML](reference/thread-workflows.md) documents the frozen DAG
  authoring prototype: reviewed grammar and typed bindings, no production caller.

## Explanation — understand why the boundaries exist

- [Product direction and delivery boundary](explanations/product-direction.md) is the
  canonical product compass: beginner-first human-agent work, idea/CAD/product entry
  points, vendor independence, and the verified-now/V1/V2 boundary.
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
has been attached. A demo or retired fixture is never active evidence. `unavailable`,
`unresolved`, and `error` are evidence states, not hidden successes.
