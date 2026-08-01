# Documentation

This repository uses the [Diátaxis](https://diataxis.fr/) framework: choose a page by
the job you are trying to do, rather than by the component you happen to know. The four
categories deliberately answer different questions.

## Tutorials — learn by doing

- [Run the first CoffeeMachine evidence](tutorials/coffee-machine-nominal.md) starts the
  stateless local services, creates a real Modelica run, reads its immutable structured
  evidence, and then follows its separate provisional scenario comparison.

## How-to guides — achieve a focused task

- [Preview the native digital-thread Workbench](how-to/preview-native-workbench.md)
  assembles the observed CM-01 branches, starts the single-shell Preact product surface,
  and explains why the page itself performs no provider call or solve.
- [Assemble the CoffeeMachine CM-01 thread](how-to/assemble-coffee-machine-thread.md)
  joins five provider branches through reviewed identities and persists a read-only
  snapshot without manufacturing requirements or cross-branch cause.
- [Preview the MCP console in a local browser](how-to/preview-console.md) explains the
  `127.0.0.1:3021` harness, how to confirm that it is live, and what it intentionally
  does not do.
- [The mcp-view component language](explanations/mcp-view-component-language.md)
  explains the ERPNext-derived visual baseline, Preact default, and component-only
  palette rule.
- [Run the CoffeeMachine mechanical workflow](how-to/view-coffee-machine-cm01.md)
  validates the causal SysON → CAD → FEA graph and explains why it refuses to run until
  the model owns a real mechanical criterion.
- [Attach a persisted Modelica branch](how-to/attach-observed-modelica-branch.md)
  imports one exact, already-persisted thermal run as evidence only: the model,
  scenario, metrics, and hashes are retained, without inventing a verdict.
- [Add a result-viewer MCP App](how-to/add-mcp-app.md) scaffolds, builds, registers, and
  verifies a standard structured-result view without broadening its server grants.

## Reference — look up exact contracts and locations

- [MCP console reference](console.md) documents the console resource, tools, evidence
  model, and safety boundary.
- [Workspace map and local ports](reference/workspace-map.md) identifies the workflow,
  scenario-contract plan, observers, UI sources, generated bundle, harness, volumes, and
  every local endpoint.
- [Building blocks and artifact ownership](reference/building-blocks.md) maps the MCP
  packages and engineering repositories to their code, images, manifests, dashboards,
  and evidence outputs.
- [Canonical ThreadSnapshot contract](reference/thread-snapshot.md) defines artifact
  identity, exact-byte consumption, observations, requirements, evaluations, violations,
  freshness, provenance, actions, explicit subject bindings, and the current persistence
  boundary.
- [Cross-tool component identity](reference/thread-components.md) defines the reviewed
  SysON PartUsage, build123d artifact, and ERPNext Item bindings used by the native
  **Parts** workspace, including visible trace gaps.
- [Native thread workflow YAML](reference/thread-workflows.md) defines the reviewed DAG
  authoring grammar, backend-only explicit execution, and typed bindings.

## Explanation — understand why the boundaries exist

- [CoffeeMachine verification architecture](verification-architecture.md) explains the
  Modelica/SysON/CalculiX split and why the current comparison is a provisional scenario
  contract rather than a product requirement.
- [Proofs and verdicts](explanations/proofs-and-verdicts.md) explains why CAD, FEA,
  physical simulation, and constraint evaluation remain separate stages.
- [Industry positioning and state of the art](positioning.md) explains the
  executable-digital-thread and physics-in-the-loop framing.
- [Native digital-thread Workbench](explanations/native-digital-thread-workbench.md)
  records the accepted product direction: one linked thread model, one native Preact
  shell, explicit engineering execution, and MCP Apps only at host boundaries.
- [Lineage-feed Workbench UX](explanations/graph-workbench-ux.md) defines the live feed
  as the primary propagation view, the complete topology as a secondary view, and the
  five providers as contextual tool facets in one drawer.

## Read the status labels literally

`succeeded` means that a simulation completed. `passed` or `failed` means a comparison
has been attached. The current CoffeeMachine comparison is a versioned **provisional
scenario contract** with one condition, `water_temperature_max >= 90 degC`; it is
neither a product requirement nor a requirement stored in a SysON project. The assembled
CM-01 product snapshot has no model-owned mechanical criterion and therefore no product
verdict. A demo fixture is always labelled demo, and `unavailable`, `unresolved`, and
`error` are evidence states, not hidden successes.
