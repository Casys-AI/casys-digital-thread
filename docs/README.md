# Documentation

This repository uses the [Diátaxis](https://diataxis.fr/) framework: choose a page by
the job you are trying to do, rather than by the component you happen to know. The four
categories deliberately answer different questions.

## Tutorials — learn by doing

- [Run the first CoffeeMachine evidence through Compose](tutorials/coffee-machine-nominal.md)
  starts the stateless local services, creates a real Modelica run, reads its immutable
  structured evidence, and then follows its separate provisional scenario comparison.

## How-to guides — achieve a focused task

- [Preview the MCP console in a local browser](how-to/preview-console.md) explains the
  `127.0.0.1:3021` harness, how to confirm that it is live, and what it intentionally
  does not do.
- [Host the Console in a local Compose dashboard](how-to/compose-console.md) uses the
  generic local MCP Apps host, the explicit Console manifest, and the YAML template
  without replacing the fixed browser harness.
- [Show the real ERPNext BOM in Compose](how-to/show-erpnext-bom.md) builds the scoped
  ERP engineering bridge, keeps credentials outside Git, explains its mutation boundary,
  and distinguishes live ERP data from successful viewer hydration.
- [View the CoffeeMachine CM-01 digital thread](how-to/view-coffee-machine-cm01.md)
  replays the saved four-panel SysON, 3D CAD, ERPNext BOM, and Modelica dashboard with
  environment-specific identifiers kept outside Git.
- [Add a result-viewer MCP App](how-to/add-mcp-app.md) scaffolds, builds, registers, and
  verifies a standard structured-result view without broadening its server grants.

## Reference — look up exact contracts and locations

- [MCP console reference](console.md) documents the console resource, tools, evidence
  model, and safety boundary.
- [Workspace map and local ports](reference/workspace-map.md) identifies the Compose
  manifest/template, scenario-contract plan, observers, UI sources, generated bundle,
  harness, volumes, and every local endpoint.
- [Building blocks and artifact ownership](reference/building-blocks.md) maps the MCP
  packages and engineering repositories to their code, images, manifests, dashboards,
  and evidence outputs.

## Explanation — understand why the boundaries exist

- [CoffeeMachine verification architecture](verification-architecture.md) explains the
  Modelica/SysON/CalculiX split and why the current comparison is a provisional scenario
  contract rather than a product requirement.
- [Proofs and verdicts](explanations/proofs-and-verdicts.md) explains why CAD, FEA,
  physical simulation, and constraint evaluation remain separate stages.
- [Industry positioning and state of the art](positioning.md) explains the
  executable-digital-thread and physics-in-the-loop framing.

## Read the status labels literally

`succeeded` means that a simulation completed. `passed` or `failed` means a comparison
has been attached. The current CoffeeMachine comparison is a versioned **provisional
scenario contract** with one condition, `water_temperature_max >= 90 degC`; it is
neither a product requirement nor a requirement stored in a SysON project. A demo
fixture is always labelled demo, and `unavailable`, `unresolved`, and `error` are
evidence states, not hidden successes.
