# Documentation

This repository uses the [Diátaxis](https://diataxis.fr/) framework: choose a
page by the job you are trying to do, rather than by the component you happen
to know. The four categories deliberately answer different questions.

## Tutorials — learn by doing

- [Inspect the first real CoffeeMachine scenario run](tutorials/coffee-machine-nominal.md)
  starts the local stack, opens the live console, and follows one Modelica run
  through its provisional scenario-contract verdict.

## How-to guides — achieve a focused task

- [Preview the MCP console in a local browser](how-to/preview-console.md)
  explains the `127.0.0.1:3021` harness, how to confirm that it is live, and
  what it intentionally does not do.

## Reference — look up exact contracts and locations

- [MCP console reference](console.md) documents the console resource, tools,
  evidence model, and safety boundary.
- [Workspace map and local ports](reference/workspace-map.md) identifies the
  manifest, scenario-contract plan, observers, UI sources, generated bundle,
  harness, volumes, and every local endpoint.

## Explanation — understand why the boundaries exist

- [CoffeeMachine verification architecture](verification-architecture.md)
  explains the Modelica/SysON/CalculiX split and why the current comparison is
  a provisional scenario contract rather than a product requirement.
- [Industry positioning and state of the art](positioning.md) explains the
  executable-digital-thread and physics-in-the-loop framing.

## Read the status labels literally

`succeeded` means that a simulation completed. `passed` or `failed` means a
comparison has been attached. The current CoffeeMachine comparison is a
versioned **provisional scenario contract** with one condition,
`water_temperature_max >= 90 degC`; it is neither a product requirement nor a
requirement stored in a SysON project. A demo fixture is always labelled demo,
and `unavailable`, `unresolved`, and `error` are evidence states, not hidden
successes.
