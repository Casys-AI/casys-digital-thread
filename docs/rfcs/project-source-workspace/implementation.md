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

## Vertical 3: MCS-02 single-root modular proof

- Workspace r15 contains five modules, four active files and three active attachments.
- RailFrame advanced from file r1 to r2 without recreating its stable attachment.
  Modelica and SPICE attachment chains advanced to r2 so each technical capture named
  the exact current Thread basis before its admission.
- CAD, Modelica and SPICE were captured and admitted from their exact workspace
  attachments. Canonical RailFrame STEP then fed the part-level CalculiX proof through
  L5.
- The FEA proof-case JSON used generic resource ingress but was not itself a workspace
  file. This vertical therefore proves the downstream FEA join, not workspace-native FEA
  targeting.

## Vertical 4: admitted CAD bundle

- Add the typed immediate-assembly placement source.
- Re-open a bounded multi-source CAD admission without the singular-source helper.
- Expose the existing N+1 draft/seal machinery through a server-derived review.
- Fix archive filtering and definition-asset selection by semantic identity.
- Execute a future MCS-02 assembly successor and recross its RailFrame proof.

## Explicitly later

- Cross-file Modelica, SPICE `.include`, or general Python imports.
- Unlimited provider execution.
- Product-wide flat CAD evidence; large assemblies require hierarchical module captures
  rather than one descendant manifest.
- Streaming a whole project to a model in one response.
- A second mutable source tree in the Workbench.

## Legacy retirement

This repository is in active development without compatibility clients. Once the
workspace bridge is live, loose technical capture calls and misleading documentation are
removed rather than maintained in parallel. Immutable historical CAS bytes may remain
readable, but old commands and schemas do not constrain the new source model.
