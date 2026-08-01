# Composable MCP Apps: small components, surfaces, and events

The first Compose prototype placed complete standalone viewers side by side. That was
protocol correct, but product-wise weak: each App brought its own masthead, spacing,
controls, and preferred dimensions. A dashboard became a collage of pages rather than
one useful engineering surface.

The new boundary is smaller. An MCP App owns reusable domain components; Compose selects
and arranges them.

```text
tool result -> domain App -> advertised component catalog -> selected surface
                   |                                      |
                   +-- validation and rendering           +-- stack / row / grid
                   +-- local state and actions             +-- stable instance IDs
                   +-- standalone default surface          +-- declared event routes
```

## Three contracts, not one magic UI

1. Standard MCP Apps still owns the iframe handshake, host theme, display mode, tool
   result, and teardown lifecycle.
2. `mcp-view` adds `io.casys.mcp.view-components/v1`: stable component keys,
   descriptions, a default standalone surface, safe primitives, and deterministic
   mounting/cleanup.
3. `mcp-compose` sends `io.casys.mcp.surface/v1`: an explicit JSON-only selection and
   layout of advertised components. `ui/compose/event` remains a separate cross-view
   event route.

Compose never reads the child DOM, sends arbitrary CSS, or generates JavaScript for an
App. A surface contains only `stack|row|grid`, a bounded column count, a gap token,
stable instance IDs, component keys, and JSON props. An unknown key becomes
`unresolved`; it is not silently omitted.

## Standalone and dashboard use the same code

Every componentized App declares one `defaultSurface`. In an ordinary MCP Apps host,
that surface is the complete standalone viewer. In Compose, YAML may select a smaller or
differently arranged surface from the same component implementations:

```yaml
- id: simulation
  manifest: mcp-modelica
  surface:
    layout: { type: grid, columns: 2, gap: sm }
    components:
      - { id: status, component: modelica.execution-status }
      - { id: metrics, component: modelica.metrics }
      - { id: provenance, component: modelica.provenance }
  calls:
    - tool: modelica_simulate
```

This is deliberately not a DOM grammar. The agent composes a finite vocabulary with
domain meaning; the owning MCP still decides how a metric, CAD scene, SysML diagram,
table, or action is rendered.

## Current component estates

| MCP       | Components                                                                                                   | Examples                               |
| --------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Modelica  | run identity, execution status, metrics, parameters, provenance, artifacts, warnings, run-list summary/table | `modelica.metrics`                     |
| Build123d | geometry status, metrics, Three.js canvas, export artifacts                                                  | `build123d.geometry-canvas`            |
| CalculiX  | solve metrics, mesh summary, constraints, displacement details                                               | `calculix.mesh-summary`                |
| SysON     | 21 components across diagram, model explorer, query, requirements, validation, and value Apps                | `syson.diagram.visual`                 |
| ERPNext   | unchanged legacy React Apps                                                                                  | no component surface in this migration |

ERPNext is not defective. It already implements standard MCP Apps correctly and has the
only public viewer compatibility surface in this group. It remains a legacy child from
Compose's perspective; the host mounts its default complete App unchanged.

## Events remain orthogonal

Choosing visible components does not create communication authority. A source App may
emit a named event, and YAML may route it to an action accepted by another App. Existing
SysON selections and the filter/chart fixture prove this path. A surface change neither
rewrites the route nor grants access to undeclared tools.

## A2UI boundary

A2UI is a useful reference for agent-authored, host-native widget trees. This project
solves a different problem: composing specialized industrial components whose renderer
and state remain inside their MCP App. We may add an adapter for a safe A2UI subset
later, but Compose does not reimplement A2UI or execute agent-generated UI code.

## Source locations and release sequence

- `mcp-server/packages/view/src/components.ts` owns the child component/surface runtime.
- `mcp-server/packages/compose/src/core/components/` owns pure surface resolution.
- `mcp-server/packages/compose/src/host/renderer/js/event-bus.ts` negotiates catalogs
  and host context while preserving standard MCP Apps dimensions and events.
- each domain repository owns its `src/ui/` catalog and component implementations;
- this repository owns saved product surfaces under `config/compose/dashboards/`.

The local candidates are `@casys/mcp-view@0.5.0` and `@casys/mcp-compose@0.8.0`. Until
published, real integration checks use the sibling workspace builds. After publication,
update the domain locks and this repository's Compose pin, then rerun the same
built-resource and Workbench proof.

## Next boundary

The next useful feature is an agent-editable operation model—inspect a surface, propose
a typed patch, preview it, apply it, and retain history. That should extend this stable
component grammar; it should not bring back prebuilt page variants or make raw generated
code the default dashboard language.
