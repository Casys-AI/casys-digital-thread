# Implementation and retirement

## Vertical 1: workspace kernel

- Domain types, strict validators and canonical fingerprints.
- Durable append-only event store, exact mutation replay and rebuildable materialised
  project index.
- Module/file put, remove, snapshot, tree, search and exact read use cases.
- MCP tools with project-scoped pagination.
- Tamper, predecessor, branch, path collision, cycle and cross-project tests.

## Vertical 2: exact technical-source bridge

- Resolve technical capture from one exact workspace file revision.
- Introduce versioned capture-locator and technical-admission grammars that preserve
  workspace provenance explicitly.
- Delete the caller-authored loose tuple once every live caller is migrated.
- Keep raw `project_resource_capture`; it remains the byte ingress.

## Vertical 3: MCS-01 modular sources

- Attach separate rail, carriage, mount, drive, motor, electronics, Modelica, SPICE
  and FEA source files.
- Prove tree navigation and one-file revision without rewriting siblings.
- Run current targeted rail CAD/FEA and admitted Modelica/SPICE from exact entries.

## Vertical 4: admitted CAD bundle

- Add the typed immediate-assembly placement source.
- Re-open a bounded multi-source CAD admission without the singular-source helper.
- Expose the existing N+1 draft/seal machinery through a server-derived review.
- Fix archive filtering and definition-asset selection by semantic identity.
- Execute MCS-01 assembly and recross its RailFrame proof.

## Explicitly later

- Cross-file Modelica, SPICE `.include`, or general Python imports.
- Unlimited provider execution.
- Product-wide flat CAD evidence; large assemblies require hierarchical module
  captures rather than one descendant manifest.
- Streaming a whole project to a model in one response.
- A second mutable source tree in the Workbench.

## Legacy retirement

This repository is in active development without compatibility clients. Once the
workspace bridge is live, loose technical capture calls and misleading documentation
are removed rather than maintained in parallel. Immutable historical CAS bytes may
remain readable, but old commands and schemas do not constrain the new source model.
